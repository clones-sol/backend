import type { Request } from 'express'

/**
 * Extends the default Express Request interface to include custom properties
 * that are attached by our middlewares, providing strong typing in route handlers.
 */
export interface AuthenticatedRequest extends Request {
  /**
   * The wallet address of the authenticated user. Attached by `requireWalletAddress`.
   */
  walletAddress?: string
}
