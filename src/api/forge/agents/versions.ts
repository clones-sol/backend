import express, { Request, Response, Router } from 'express';
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

const router: Router = express.Router();

// POST /:id/versions
router.post(
    '/:id/versions',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(agentVersionSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        // @ts-ignore
        const { agent } = req;
        const { versionTag, customUrl, huggingFaceApiKey } = req.body;

        if (huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        if (agent.deployment.versions.some((v: any) => v.versionTag === versionTag)) {
            throw ApiError.conflict(`Version tag '${versionTag}' already exists for this agent.`);
        }

        const newVersion = {
            versionTag,
            customUrl,
            encryptedApiKey: huggingFaceApiKey ? encrypt(huggingFaceApiKey) : undefined,
            status: 'deprecated' as const,
            createdAt: new Date(),
        };

        agent.deployment.versions.push(newVersion);

        agent.auditLog.push({
            timestamp: new Date(),
            user: ownerAddress,
            action: 'ADD_VERSION',
            details: sanitizeAgentDataForLogging({ versionTag, customUrl, huggingFaceApiKey })
        });

        await agent.save();

        res.status(201).json(successResponse(agent));
    })
);

// PUT /:id/versions/active
router.put(
    '/:id/versions/active',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(setActiveVersionSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        // @ts-ignore
        const { agent } = req;
        const { versionTag } = req.body;

        const targetVersion = agent.deployment.versions.find((v: any) => v.versionTag === versionTag);
        if (!targetVersion) {
            throw ApiError.notFound(`Version with tag '${versionTag}' not found.`);
        }

        if (targetVersion.status === 'active') {
            return res.status(200).json(successResponse(agent));
        }

        const currentActiveVersion = agent.deployment.versions.find((v: any) => v.status === 'active');
        if (currentActiveVersion) {
            currentActiveVersion.status = 'deprecated';
        }

        targetVersion.status = 'active';
        agent.deployment.activeVersionTag = versionTag;

        agent.auditLog.push({
            timestamp: new Date(),
            user: ownerAddress,
            action: 'SET_ACTIVE_VERSION',
            details: { versionTag } as any
        });

        await agent.save();

        res.status(200).json(successResponse(agent));
    })
);

export { router as versionRoutes }; 