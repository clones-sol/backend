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

/**
 * @openapi
 * components:
 *   schemas:
 *     GymAgent:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The unique identifier for the agent.
 *           example: "60d5f2f5c7b5f2a8a4f5b6c7"
 *         pool_id:
 *           type: string
 *           description: The ID of the TrainingPool this agent is derived from.
 *         name:
 *           type: string
 *           description: The public display name of the agent.
 *         ticker:
 *           type: string
 *           description: The token ticker for the agent's SPL token.
 *         description:
 *           type: string
 *           description: A detailed description of the agent's purpose and capabilities.
 *         tokenomics:
 *           type: object
 *           properties:
 *             supply:
 *               type: number
 *             minLiquiditySol:
 *               type: number
 *             gatedPercentage:
 *               type: number
 *             decimals:
 *               type: number
 *         deployment:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: [DRAFT, PENDING_TOKEN_SIGNATURE, TOKEN_CREATED, PENDING_POOL_SIGNATURE, DEPLOYED, DEACTIVATED, FAILED, ARCHIVED]
 *             lastError:
 *               type: string
 *             activeVersionTag:
 *               type: string
 *             versions:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   versionTag:
 *                     type: string
 *                   customUrl:
 *                     type: string
 *                   status:
 *                     type: string
 *                     enum: [active, deprecated]
 *         blockchain:
 *           type: object
 *           properties:
 *             tokenAddress:
 *               type: string
 *             poolAddress:
 *               type: string
 *     ApiError:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: object
 *           properties:
 *             code:
 *               type: string
 *               description: A machine-readable error code.
 *             message:
 *               type: string
 *               description: A human-readable error message.
 *   responses:
 *     Unauthorized:
 *       description: Unauthorized. The request lacks valid authentication credentials.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiError'
 *     Forbidden:
 *       description: Forbidden. The user is not authorized to perform this action.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiError'
 *     BadRequest:
 *       description: Bad Request. The request was malformed or invalid.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiError'
 *     NotFound:
 *       description: Not Found. The requested resource could not be found.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiError'
 *     Conflict:
 *       description: Conflict. The request could not be completed due to a conflict with the current state of the resource.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiError'
 *     InternalError:
 *       description: Internal Server Error. An unexpected error occurred on the server.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiError'
 */
const router: Router = express.Router();

/**
 * @openapi
 * /forge/agents:
 *   post:
 *     tags:
 *       - Agents Management
 *     summary: Create a new AI Agent
 *     description: Creates a new AI Agent record in `DRAFT` status. The authenticated user must be the owner of the `pool_id` provided.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAgentRequest'
 *     responses:
 *       '201':
 *         description: Agent created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GymAgent'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */
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

/**
 * @openapi
 * /forge/agents:
 *   get:
 *     tags:
 *       - Agents Management
 *     summary: List all agents owned by the user
 *     description: Retrieves a list of all AI Agents owned by the authenticated user, regardless of their status. This is for the owner's private management view.
 *     responses:
 *       '200':
 *         description: A list of agents owned by the user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GymAgent'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 */
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

/**
 * @openapi
 * /forge/agents/{id}:
 *   put:
 *     tags:
 *       - Agents Management
 *     summary: Update an agent's details
 *     description: |-
 *       Updates the details of an agent. The updatable fields depend on the agent's current status.
 *       - In `DRAFT`, most configuration fields can be updated.
 *       - In `DEPLOYED` or `DEACTIVATED`, only non-critical metadata such as `description`, `logoUrl`, and deployment credentials can be modified.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAgentRequest'
 *     responses:
 *       '200':
 *         description: Agent updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GymAgent'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * @openapi
 * /forge/agents/pool/{pool_id}:
 *   get:
 *     tags:
 *       - Agents Management
 *     summary: Get an agent by its associated Pool ID
 *     description: Retrieves the agent document linked to a specific `TrainingPool`. The authenticated user must be the owner of the pool.
 *     parameters:
 *       - in: path
 *         name: pool_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the `TrainingPool`.
 *     responses:
 *       '200':
 *         description: The agent associated with the pool.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GymAgent'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
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