import { Response, NextFunction } from 'express';
import { GymAgentModel, TrainingPoolModel } from '../../../models/Models.ts';
import { ApiError } from '../../../middleware/types/errors.ts';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../../../middleware/types/request.ts';

/**
 * Middleware to verify that the authenticated user is the owner of the requested agent.
 * It finds the agent by the 'id' param, checks its ownership via the associated TrainingPool,
 * and attaches the agent document to `req.agent` for use in subsequent handlers.
 *
 * Throws ApiError (notFound, forbidden, internalError) if checks fail.
 */
export const requireAgentOwnership = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ownerAddress = req.walletAddress;
        if (!ownerAddress) {
            // This should be caught by requireWalletAddress first, but as a safeguard
            return next(ApiError.unauthorized('Wallet address is required for this action.'));
        }

        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return next(ApiError.badRequest('A valid agent ID must be provided in the URL.'));
        }

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            return next(ApiError.notFound(`Agent with id ${id} not found.`));
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id).select('ownerAddress').lean();
        if (!pool) {
            // This indicates a data inconsistency issue.
            return next(ApiError.internalError(`Data inconsistency: TrainingPool ${agent.pool_id} not found for agent ${id}.`));
        }

        if (pool.ownerAddress !== ownerAddress) {
            return next(ApiError.forbidden('You are not authorized to perform this action on the specified agent.'));
        }

        // Attach the found agent to the request object for use in the route handler.
        // This avoids fetching the agent from the database again.
        req.agent = agent;

        next();
    } catch (error) {
        // Pass any other unexpected errors to the global error handler
        next(error);
    }
}; 