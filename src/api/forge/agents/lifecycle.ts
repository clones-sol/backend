import express, { Response, Router } from 'express';
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

/**
 * @openapi
 * /forge/agents/{id}/deploy:
 *   post:
 *     tags:
 *       - Agents Lifecycle
 *     summary: Initiate agent deployment
 *     description: Moves the agent from `DRAFT` to `PENDING_TOKEN_SIGNATURE`, officially starting the on-chain deployment flow.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent to deploy.
 *     responses:
 *       '200':
 *         description: Deployment initiated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
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

/**
 * @openapi
 * /forge/agents/{id}/cancel:
 *   post:
 *     tags:
 *       - Agents Lifecycle
 *     summary: Cancel an in-progress deployment
 *     description: |-
 *       Cancels a deployment that is awaiting a user signature.
 *       - If the status is `PENDING_TOKEN_SIGNATURE`, the agent reverts to `DRAFT`.
 *       - If the status is `PENDING_POOL_SIGNATURE`, the agent moves to `FAILED` because token creation is irreversible.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent to cancel.
 *     responses:
 *       '200':
 *         description: Deployment cancelled successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
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

/**
 * @openapi
 * /forge/agents/{id}/status:
 *   patch:
 *     tags:
 *       - Agents Lifecycle
 *     summary: Deactivate a deployed agent
 *     description: Changes the status of a deployed agent to `DEACTIVATED`. A deactivated agent is hidden from public view but is not deleted.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent to deactivate.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [DEACTIVATED]
 *     responses:
 *       '200':
 *         description: Agent deactivated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
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
router.route('/:id/status')
    .patch(
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

/**
 * @openapi
 * /forge/agents/{id}:
 *   delete:
 *     tags:
 *       - Agents Lifecycle
 *     summary: Archive an agent (soft delete)
 *     description: Performs a soft delete by moving the agent to an `ARCHIVED` status. This is only allowed if the agent is in a non-active state (`DRAFT`, `DEACTIVATED`, or `FAILED`).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent to archive.
 *     responses:
 *       '200':
 *         description: Agent archived successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
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

/**
 * @openapi
 * /forge/agents/{id}/retry-deployment:
 *   post:
 *     tags:
 *       - Agents Lifecycle
 *     summary: Retry a failed deployment
 *     description: |-
 *       Allows the user to retry a deployment that has entered a `FAILED` state.
 *       The system intelligently resumes from the failed step.
 *       - If `blockchain.tokenAddress` is null, it resets the status to `PENDING_TOKEN_SIGNATURE`.
 *       - If `blockchain.tokenAddress` exists, it resets the status to `PENDING_POOL_SIGNATURE`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent to retry.
 *     responses:
 *       '200':
 *         description: Deployment retry initiated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
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

export { router as lifecycleRoutes }; 