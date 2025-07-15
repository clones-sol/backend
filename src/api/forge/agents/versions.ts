import express, { Response, Router } from 'express';
import { requireWalletAddress } from '../../../middleware/auth.ts';
import { errorHandlerAsync } from '../../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../../middleware/validator.ts';
import { agentVersionSchema, setActiveVersionSchema } from '../../schemas/forge-agents.ts';
import { ApiError, successResponse } from '../../../middleware/types/errors.ts';
import { validateHuggingFaceApiKey } from '../../../services/huggingface/index.ts';
import { encrypt } from '../../../services/security/crypto.ts';
import { idValidationSchema } from '../../schemas/common.ts';
import { sanitizeAgentDataForLogging } from './helpers.ts';
import { requireAgentOwnership } from './middleware.ts';
import { DeploymentVersion } from '../../../models/GymAgent.ts';
import { AuthenticatedRequest } from '../../../middleware/types/request.ts';
import { GymAgentModel } from '../../../models/GymAgent.ts';

const router: Router = express.Router();
const MAX_VERSIONS_PER_AGENT = 10;

// POST /:id/versions
router.post(
    '/:id/versions',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(agentVersionSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;
        const { agent } = req;
        const { versionTag, customUrl, huggingFaceApiKey } = req.body;

        if (huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        const newVersion = {
            versionTag,
            customUrl,
            encryptedApiKey: huggingFaceApiKey ? encrypt(huggingFaceApiKey) : undefined,
            status: 'deprecated' as const,
            createdAt: new Date(),
        };

        const auditLogEntry = {
            timestamp: new Date(),
            user: ownerAddress,
            action: 'ADD_VERSION',
            details: sanitizeAgentDataForLogging({ versionTag, customUrl, huggingFaceApiKey })
        };

        // Atomic operation to add version with duplicate and limit checks
        const updatedAgent = await GymAgentModel.findOneAndUpdate(
            {
                _id: agent!._id,
                'deployment.versions.versionTag': { $ne: versionTag }, // Ensure no duplicate
                $expr: { $lt: [{ $size: '$deployment.versions' }, MAX_VERSIONS_PER_AGENT] } // Limit check
            },
            {
                $push: {
                    'deployment.versions': newVersion,
                    auditLog: auditLogEntry
                }
            },
            { new: true }
        );

        if (!updatedAgent) {
            // Check what went wrong
            const existingAgent = await GymAgentModel.findById(agent!._id);
            if (!existingAgent) {
                throw ApiError.notFound('Agent not found.');
            }

            if (existingAgent.deployment.versions.some((v: DeploymentVersion) => v.versionTag === versionTag)) {
                throw ApiError.conflict(`Version tag '${versionTag}' already exists for this agent.`);
            }

            if (existingAgent.deployment.versions.length >= MAX_VERSIONS_PER_AGENT) {
                throw ApiError.badRequest(`Cannot add more than ${MAX_VERSIONS_PER_AGENT} versions per agent.`);
            }

            throw ApiError.internalError('Failed to add version due to concurrent modification.');
        }

        res.status(201).json(successResponse(updatedAgent));
    })
);

// PUT /:id/versions/active
router.put(
    '/:id/versions/active',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(setActiveVersionSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;
        const { agent } = req;
        const { versionTag } = req.body;

        const targetVersion = agent!.deployment.versions.find((v: DeploymentVersion) => v.versionTag === versionTag);
        if (!targetVersion) {
            throw ApiError.notFound(`Version with tag '${versionTag}' not found.`);
        }

        if (targetVersion.status === 'active') {
            return res.status(200).json(successResponse(agent));
        }

        // Build the atomic update payload
        const updatePayload: { $set: any, $push?: any } = { $set: {} };
        const auditLog = {
            timestamp: new Date(),
            user: ownerAddress,
            action: 'SET_ACTIVE_VERSION',
            details: { versionTag }
        };
        updatePayload.$push = { auditLog };
        updatePayload.$set['deployment.activeVersionTag'] = versionTag;

        // Create a dynamic query to update all version statuses in one go
        const versionUpdates = agent!.deployment.versions.map((version, index) => {
            if (version.versionTag === versionTag) {
                return { [`deployment.versions.${index}.status`]: 'active' };
            } else if (version.status === 'active') {
                return { [`deployment.versions.${index}.status`]: 'deprecated' };
            }
            return null;
        }).filter(Boolean);

        // Merge all version status updates into the $set payload
        if (versionUpdates.length > 0) {
            Object.assign(updatePayload.$set, ...versionUpdates);
        }

        const updatedAgent = await GymAgentModel.findByIdAndUpdate(agent!._id, updatePayload, { new: true });

        res.status(200).json(successResponse(updatedAgent));
    })
);

export { router as versionRoutes }; 