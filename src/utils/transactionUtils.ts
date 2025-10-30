import { MONGODB_TRANSACTION_ERROR_CODE } from '../constants/referral.ts'
import { logger } from "../services/logger.ts"

/**
 * Handle MongoDB transaction errors and fall back to non-transactional approach
 * @param error The error that occurred during transaction
 * @param fallbackFunction The function to call if transactions are not supported
 * @returns The result of the fallback function
 */
interface MongoError extends Error {
  code?: number
}

export async function handleTransactionError<T>(
  error: MongoError,
  fallbackFunction: () => Promise<T>
): Promise<T> {
  // If transactions are not supported (standalone MongoDB), fall back to non-transactional approach
  if (error.code === MONGODB_TRANSACTION_ERROR_CODE) {
    logger.warn('Transactions not supported, falling back to non-transactional approach')
    return await fallbackFunction()
  }

  // Re-throw the error if it's not a transaction support issue
  throw error
}
