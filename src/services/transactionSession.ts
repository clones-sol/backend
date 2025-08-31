import { TransactionSessionModel } from '../models/TransactionSession.ts';

/**
 * Service for managing transaction sessions
 * Used by both backend APIs and website integration
 */
export class TransactionSessionService {
  /**
   * Get a transaction session by sessionId
   */
  static async getSession(sessionId: string) {
    const session = await TransactionSessionModel.findOne({ sessionId });
    if (!session) {
      throw new Error('Transaction session not found');
    }

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      if (session.status === 'pending') {
        session.status = 'failed';
        session.error = 'Transaction session expired';
        await session.save();
      }
    }

    return session;
  }

  /**
   * Update transaction session status (used by website after transaction completion)
   */
  static async updateSession(
    sessionId: string,
    status: 'completed' | 'failed' | 'cancelled',
    txHash?: string,
    error?: string
  ) {
    const session = await TransactionSessionModel.findOne({ sessionId });
    if (!session) {
      throw new Error('Transaction session not found');
    }

    // Update session
    session.status = status;
    if (txHash) session.txHash = txHash;
    if (error) session.error = error;
    
    await session.save();
    return session;
  }

  /**
   * Check if session is valid and get transaction details for website
   */
  static async validateSessionForWebsite(sessionId: string) {
    const session = await TransactionSessionService.getSession(sessionId);
    
    if (session.status !== 'pending') {
      throw new Error('Transaction session is not pending');
    }

    return {
      sessionId: session.sessionId,
      transactionType: session.transactionType,
      transactionParams: session.transactionParams,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Mark session as completed with transaction hash
   * Called by website after successful MetaMask transaction
   */
  static async markCompleted(sessionId: string, txHash: string) {
    return await TransactionSessionService.updateSession(sessionId, 'completed', txHash);
  }

  /**
   * Mark session as failed with error message  
   * Called by website when transaction fails
   */
  static async markFailed(sessionId: string, error: string) {
    return await TransactionSessionService.updateSession(sessionId, 'failed', undefined, error);
  }

  /**
   * Mark session as cancelled
   * Called by website when user cancels transaction
   */
  static async markCancelled(sessionId: string) {
    return await TransactionSessionService.updateSession(sessionId, 'cancelled');
  }

  /**
   * Clean up expired sessions (can be called by a cron job)
   */
  static async cleanupExpiredSessions() {
    const result = await TransactionSessionModel.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    return result.deletedCount;
  }
}