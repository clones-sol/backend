import { Request } from 'express';
import { IGymAgent } from '../../models/Models.ts';

/**
 * Extends the default Express Request interface to include custom properties
 * that are attached by our middlewares, providing strong typing in route handlers.
 */
export interface AuthenticatedRequest extends Request {
    /**
     * The wallet address of the authenticated user. Attached by `requireWalletAddress`.
     */
    walletAddress?: string;

    /**
     * The GymAgent document related to the current request. Attached by `requireAgentOwnership`.
     */
    agent?: IGymAgent;
} 