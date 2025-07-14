import express, { Request, Response, Router } from 'express';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../middleware/validator.ts';
import { createAgentSchema, updateAgentSchema } from '../schemas/forge-agents.ts';
import { ApiError, successResponse } from '../../middleware/types/errors.ts';
import { GymAgentModel, TrainingPoolModel } from '../../models/Models.ts';
import { IGymAgent } from '../../models/GymAgent.ts';
import { encrypt } from '../../services/security/crypto.ts';

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
                details: { ...req.body }
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
    validateParams({ id: { required: true } }),
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
            // Can update most fields
            if (updateData.name && agent.name !== updateData.name) {
                agent.name = updateData.name;
                changedFields.push('name');
            }
            if (updateData.description && agent.description !== updateData.description) {
                agent.description = updateData.description;
                changedFields.push('description');
            }
            if (updateData.logoUrl && agent.logoUrl !== updateData.logoUrl) {
                agent.logoUrl = updateData.logoUrl;
                changedFields.push('logoUrl');
            }
            if (updateData.tokenomics) {
                agent.tokenomics = { ...agent.tokenomics, ...updateData.tokenomics };
                changedFields.push('tokenomics');
            }
        } else if (['DEPLOYED', 'DEACTIVATED'].includes(agent.deployment.status)) {
            // Can only update non-critical metadata
            if (updateData.description && agent.description !== updateData.description) {
                agent.description = updateData.description;
                changedFields.push('description');
            }
            if (updateData.logoUrl && agent.logoUrl !== updateData.logoUrl) {
                agent.logoUrl = updateData.logoUrl;
                changedFields.push('logoUrl');
            }
        } else {
            throw ApiError.badRequest(`Agent cannot be updated in its current status: ${agent.deployment.status}`);
        }

        // 3. Add to audit log if changes were made
        if (changedFields.length > 0) {
            agent.auditLog.push({
                timestamp: new Date(),
                user: ownerAddress,
                action: 'UPDATE',
                details: { changedFields, ...updateData }
            });
            await agent.save();
        }

        res.status(200).json(successResponse(agent));
    })
);

router.get(
    '/pool/:pool_id',
    requireWalletAddress,
    validateParams({ pool_id: { required: true } }),
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