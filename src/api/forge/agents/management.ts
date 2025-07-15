import express, { Response, Router } from 'express';
import { requireWalletAddress } from '../../../middleware/auth.ts';
import { errorHandlerAsync } from '../../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../../middleware/validator.ts';
import { createAgentSchema, updateAgentSchema } from '../../schemas/forge-agents.ts';
import { ApiError, successResponse } from '../../../middleware/types/errors.ts';
import { GymAgentModel, TrainingPoolModel } from '../../../models/Models.ts';
import { IGymAgent, DeploymentVersion } from '../../../models/GymAgent.ts';
import { validateHuggingFaceApiKey } from '../../../services/huggingface/index.ts';
import { ValidationRules } from '../../../middleware/validator.ts';
import { createFirstDeploymentVersion, sanitizeAgentDataForLogging } from './helpers.ts';
import { encrypt } from '../../../services/security/crypto.ts';
import { requireAgentOwnership } from './middleware.ts';
import { AuthenticatedRequest } from '../../../middleware/types/request.ts';

const router: Router = express.Router();

// POST / - Create Agent
router.post(
    '/',
    requireWalletAddress,
    validateBody(createAgentSchema),
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;
        const { pool_id, name, ticker, description, logoUrl, tokenomics, deployment } = req.body;

        if (deployment?.huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(deployment.huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        const existingAgent = await GymAgentModel.findOne({ pool_id });
        if (existingAgent) {
            throw ApiError.conflict(`An agent already exists for pool_id ${pool_id}.`);
        }

        const pool = await TrainingPoolModel.findById(pool_id);
        if (!pool) {
            throw ApiError.notFound(`TrainingPool with id ${pool_id} not found.`);
        }
        if (pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not the owner of the specified TrainingPool.');
        }

        const sanitizedDetails = sanitizeAgentDataForLogging(req.body);

        const newAgentData: Partial<IGymAgent> = {
            pool_id,
            name,
            ticker,
            description,
            logoUrl,
            tokenomics,
            deployment: {
                status: 'DRAFT',
                versions: [],
            },
            auditLog: [{
                timestamp: new Date(),
                user: ownerAddress,
                action: 'CREATE',
                details: sanitizedDetails
            }]
        };

        const firstVersion = createFirstDeploymentVersion(deployment);
        if (firstVersion) {
            newAgentData.deployment!.versions.push(firstVersion);
            newAgentData.deployment!.activeVersionTag = firstVersion.versionTag;
        }

        const agent = new GymAgentModel(newAgentData);
        await agent.save();

        res.status(201).json(successResponse(agent));
    })
);

// GET / - List Own Agents
router.get(
    '/',
    requireWalletAddress,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;

        const userPools = await TrainingPoolModel.find({ ownerAddress }).select('_id');
        const poolIds = userPools.map(pool => pool._id);

        if (poolIds.length === 0) {
            return res.status(200).json(successResponse([]));
        }

        const agents = await GymAgentModel.find({ pool_id: { $in: poolIds } });
        res.status(200).json(successResponse(agents));
    })
);

// PUT /:id - Update Agent
router.put(
    '/:id',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    validateBody(updateAgentSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;
        const { agent } = req;
        const updateData = req.body;

        if (!agent) {
            // Should not happen due to requireAgentOwnership, but for type safety
            throw ApiError.internalError('Agent not found in request.');
        }

        if (updateData.deployment?.huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(updateData.deployment.huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        const updatePayload: { $set: any, $push?: any } = { $set: {} };
        const changedFields: string[] = [];

        if (agent.deployment.status === 'DRAFT') {
            if (updateData.name && agent.name !== updateData.name) {
                updatePayload.$set.name = updateData.name;
                changedFields.push('name');
            }
            if (updateData.tokenomics) {
                // Use dot notation for updating nested fields
                for (const [key, value] of Object.entries(updateData.tokenomics)) {
                    updatePayload.$set[`tokenomics.${key}`] = value;
                }
                changedFields.push('tokenomics');
            }
        }

        if (['DRAFT', 'DEPLOYED', 'DEACTIVATED'].includes(agent.deployment.status)) {
            if (updateData.description && agent.description !== updateData.description) {
                updatePayload.$set.description = updateData.description;
                changedFields.push('description');
            }
            if (updateData.logoUrl && agent.logoUrl !== updateData.logoUrl) {
                updatePayload.$set.logoUrl = updateData.logoUrl;
                changedFields.push('logoUrl');
            }

            if (updateData.deployment) {
                const activeVersionIndex = agent.deployment.versions.findIndex((v: DeploymentVersion) => v.versionTag === agent.deployment.activeVersionTag);

                if (activeVersionIndex === -1 && agent.deployment.status === 'DRAFT') {
                    const firstVersion = createFirstDeploymentVersion(updateData.deployment);
                    if (firstVersion) {
                        updatePayload.$set['deployment.versions'] = [firstVersion];
                        updatePayload.$set['deployment.activeVersionTag'] = firstVersion.versionTag;
                        changedFields.push('deployment.versions');
                    }
                } else if (activeVersionIndex !== -1) {
                    const activeVersion = agent.deployment.versions[activeVersionIndex];
                    if (updateData.deployment.customUrl && activeVersion.customUrl !== updateData.deployment.customUrl) {
                        updatePayload.$set[`deployment.versions.${activeVersionIndex}.customUrl`] = updateData.deployment.customUrl;
                        changedFields.push('deployment.customUrl');
                    }
                    if (updateData.deployment.huggingFaceApiKey) {
                        const newEncryptedKey = encrypt(updateData.deployment.huggingFaceApiKey);
                        if (activeVersion.encryptedApiKey !== newEncryptedKey) {
                            updatePayload.$set[`deployment.versions.${activeVersionIndex}.encryptedApiKey`] = newEncryptedKey;
                            changedFields.push('deployment.huggingFaceApiKey');
                        }
                    }
                }
            }
        }

        if (changedFields.length > 0) {
            const sanitizedDetails = sanitizeAgentDataForLogging(updateData);
            updatePayload.$push = {
                auditLog: {
                    timestamp: new Date(),
                    user: ownerAddress,
                    action: 'UPDATE',
                    details: sanitizedDetails
                }
            };
            const updatedAgent = await GymAgentModel.findByIdAndUpdate(agent._id, updatePayload, { new: true });
            res.status(200).json(successResponse(updatedAgent));
        } else if (Object.keys(updateData).length > 0) {
            throw ApiError.badRequest(`Agent cannot be updated in its current status: ${agent.deployment.status}, or no valid fields were provided.`);
        } else {
            // No changes, just return the agent
            res.status(200).json(successResponse(agent));
        }
    })
);

// GET /pool/:pool_id - Get Agent by Pool ID
router.get(
    '/pool/:pool_id',
    requireWalletAddress,
    validateParams({ pool_id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;
        const { pool_id } = req.params;

        const agent = await GymAgentModel.findOne({ pool_id });
        if (!agent) {
            throw ApiError.notFound(`Agent for pool_id ${pool_id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(pool_id);
        if (!pool) {
            throw ApiError.internalError(`Data inconsistency: TrainingPool ${pool_id} not found for existing agent.`);
        }
        if (pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not the owner of the specified TrainingPool.');
        }

        res.status(200).json(successResponse(agent));
    })
);

export { router as managementRoutes }; 