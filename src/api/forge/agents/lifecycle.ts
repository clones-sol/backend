import express, { Request, Response, Router } from 'express';
import { requireWalletAddress } from '../../../middleware/auth.ts';
import { errorHandlerAsync } from '../../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../../middleware/validator.ts';
import { ApiError, successResponse } from '../../../middleware/types/errors.ts';
import { transitionAgentStatus } from '../../../services/agents/index.ts';
import { ValidationRules } from '../../../middleware/validator.ts';
import { updateAgentStatusSchema } from '../../schemas/forge-agents.ts';
import { requireAgentOwnership } from './middleware.ts';
import { AuthenticatedRequest } from '../../../middleware/types/request.ts';

const router: Router = express.Router();

// POST /:id/deploy
router.post(
    '/:id/deploy',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req;
        const updatedAgent = await transitionAgentStatus(agent!, { type: 'INITIATE_DEPLOYMENT' });
        res.status(200).json(successResponse(updatedAgent));
    })
);

// PATCH /:id/status
router.patch(
    '/:id/status',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    validateBody(updateAgentStatusSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req;
        const { status } = req.body;

        let updatedAgent;
        if (status === 'DEACTIVATED') {
            updatedAgent = await transitionAgentStatus(agent!, { type: 'DEACTIVATE' });
        } else {
            throw ApiError.badRequest(`Unsupported status transition to '${status}'.`);
        }

        res.status(200).json(successResponse(updatedAgent));
    })
);

// DELETE /:id
router.delete(
    '/:id',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req;
        const updatedAgent = await transitionAgentStatus(agent!, { type: 'ARCHIVE' });
        res.status(200).json(successResponse(updatedAgent));
    })
);

// POST /:id/retry-deployment
router.post(
    '/:id/retry-deployment',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req;
        const updatedAgent = await transitionAgentStatus(agent!, { type: 'RETRY' });
        res.status(200).json(successResponse(updatedAgent));
    })
);

// POST /:id/cancel
router.post(
    '/:id/cancel',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req;
        const updatedAgent = await transitionAgentStatus(agent!, { type: 'CANCEL' });
        res.status(200).json(successResponse(updatedAgent));
    })
);

export { router as lifecycleRoutes }; 