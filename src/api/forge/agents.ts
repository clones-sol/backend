import express, { Request, Response, Router } from 'express';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../middleware/validator.ts';
import { createAgentSchema, updateAgentSchema } from '../schemas/forge-agents.ts';
import { ApiError, successResponse } from '../../middleware/types/errors.ts';
import { GymAgentModel, TrainingPoolModel } from '../../models/Models.ts';
import { IGymAgent } from '../../models/GymAgent.ts';
import { encrypt } from '../../services/security/crypto.ts';
import { ValidationRules } from '../../middleware/validator.ts';

const router: Router = express.Router();

router.post(
    '/',
    requireWalletAddress,
    validateBody(createAgentSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;
        const { pool_id, name, ticker, description, logoUrl, tokenomics, deployment } = req.body;

        // 1. Check if an agent already exists for this pool
        const existingAgent = await GymAgentModel.findOne({ pool_id });
        if (existingAgent) {
            throw ApiError.conflict(`An agent already exists for pool_id ${pool_id}.`);
        }

        // 2. Verify ownership of the training pool
        const pool = await TrainingPoolModel.findById(pool_id);
        if (!pool) {
            throw ApiError.notFound(`TrainingPool with id ${pool_id} not found.`);
        }
        if (pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not the owner of the specified TrainingPool.');
        }

        // Sanitize the request body for audit logging
        const sanitizedDetails = JSON.parse(JSON.stringify(req.body));
        if (sanitizedDetails.deployment?.huggingFaceApiKey) {
            sanitizedDetails.deployment.huggingFaceApiKey = '[REDACTED]';
        }

        // 3. Create the new agent
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

        // 4. Handle initial deployment version if provided
        if (deployment?.customUrl || deployment?.huggingFaceApiKey) {
            const firstVersion = {
                versionTag: 'v1.0',
                customUrl: deployment.customUrl,
                encryptedApiKey: deployment.huggingFaceApiKey ? encrypt(deployment.huggingFaceApiKey) : undefined,
                status: 'active' as const,
                createdAt: new Date(),
            };
            // The deployment object is guaranteed to be defined from step 3
            newAgentData.deployment!.versions.push(firstVersion);
            newAgentData.deployment!.activeVersionTag = firstVersion.versionTag;
        }

        const agent = new GymAgentModel(newAgentData);
        await agent.save();

        res.status(201).json(successResponse(agent));
    })
);

router.get(
    '/',
    requireWalletAddress,
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;

        // 1. Find all pools owned by the user
        const userPools = await TrainingPoolModel.find({ ownerAddress }).select('_id');

        // 2. Get the IDs of the pools
        const poolIds = userPools.map(pool => pool._id);

        if (poolIds.length === 0) {
            return res.status(200).json(successResponse([]));
        }

        // 3. Find all agents associated with those pools
        const agents = await GymAgentModel.find({ pool_id: { $in: poolIds } });

        res.status(200).json(successResponse(agents));
    })
);

router.put(
    '/:id',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    validateBody(updateAgentSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;
        const { id } = req.params;
        const updateData = req.body;

        // 1. Find agent and verify ownership
        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to update this agent.');
        }

        const changedFields: string[] = [];

        // 2. Apply updates based on status
        if (agent.deployment.status === 'DRAFT') {
            // Can update most fields in DRAFT
            if (updateData.name && agent.name !== updateData.name) {
                agent.name = updateData.name;
                changedFields.push('name');
            }
            if (updateData.tokenomics) {
                agent.tokenomics = { ...agent.tokenomics, ...updateData.tokenomics };
                changedFields.push('tokenomics');
            }
        }

        // Fields updatable in DRAFT, DEPLOYED, or DEACTIVATED status
        if (['DRAFT', 'DEPLOYED', 'DEACTIVATED'].includes(agent.deployment.status)) {
            if (updateData.description && agent.description !== updateData.description) {
                agent.description = updateData.description;
                changedFields.push('description');
            }
            if (updateData.logoUrl && agent.logoUrl !== updateData.logoUrl) {
                agent.logoUrl = updateData.logoUrl;
                changedFields.push('logoUrl');
            }

            // Handle deployment updates for the active version
            if (updateData.deployment) {
                let activeVersion = agent.deployment.versions.find(v => v.versionTag === agent.deployment.activeVersionTag);

                if (!activeVersion && agent.deployment.status === 'DRAFT' && (updateData.deployment.customUrl || updateData.deployment.huggingFaceApiKey)) {
                    // If in DRAFT and no versions exist, create the first one
                    const firstVersion = {
                        versionTag: 'v1.0', status: 'active' as const, createdAt: new Date(),
                        customUrl: undefined, encryptedApiKey: undefined,
                    };
                    agent.deployment.versions.push(firstVersion);
                    agent.deployment.activeVersionTag = firstVersion.versionTag;
                    activeVersion = agent.deployment.versions[0];
                    changedFields.push('deployment.versions');
                }

                if (activeVersion) {
                    if (updateData.deployment.customUrl && activeVersion.customUrl !== updateData.deployment.customUrl) {
                        activeVersion.customUrl = updateData.deployment.customUrl;
                        changedFields.push('deployment.customUrl');
                    }
                    if (updateData.deployment.huggingFaceApiKey) {
                        const newEncryptedKey = encrypt(updateData.deployment.huggingFaceApiKey);
                        if (activeVersion.encryptedApiKey !== newEncryptedKey) {
                            activeVersion.encryptedApiKey = newEncryptedKey;
                            changedFields.push('deployment.huggingFaceApiKey');
                        }
                    }
                }
            }
        }

        // 3. Add to audit log and save if changes were made
        if (changedFields.length > 0) {
            // Sanitize the update data before logging to avoid storing sensitive info
            const sanitizedDetails = JSON.parse(JSON.stringify(updateData));
            if (sanitizedDetails.deployment?.huggingFaceApiKey) {
                sanitizedDetails.deployment.huggingFaceApiKey = '[REDACTED]';
            }

            agent.auditLog.push({
                timestamp: new Date(),
                user: ownerAddress,
                action: 'UPDATE',
                details: sanitizedDetails
            });
            await agent.save();
        } else if (Object.keys(updateData).length > 0) {
            // If there's data in the body but no valid fields were updated, throw an error.
            throw ApiError.badRequest(`Agent cannot be updated in its current status: ${agent.deployment.status}, or no valid fields were provided.`);
        }

        res.status(200).json(successResponse(agent));
    })
);

router.get(
    '/pool/:pool_id',
    requireWalletAddress,
    validateParams({ pool_id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;
        const { pool_id } = req.params;

        // 1. Find the agent by pool_id
        const agent = await GymAgentModel.findOne({ pool_id });
        if (!agent) {
            throw ApiError.notFound(`Agent for pool_id ${pool_id} not found.`);
        }

        // 2. Verify ownership of the training pool
        const pool = await TrainingPoolModel.findById(pool_id);
        if (!pool) {
            // This case should ideally not happen if an agent exists, indicates data inconsistency
            throw ApiError.internalError(`Data inconsistency: TrainingPool ${pool_id} not found for existing agent.`);
        }
        if (pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not the owner of the specified TrainingPool.');
        }

        // 3. Return the agent
        res.status(200).json(successResponse(agent));
    })
);


export { router as forgeAgentsApi }; 