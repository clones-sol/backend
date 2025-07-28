import { MONGODB_TRANSACTION_ERROR_CODE } from '../constants/referral.ts';

/**
 * Handle MongoDB transaction errors and fall back to non-transactional approach
 * @param error The error that occurred during transaction
 * @param fallbackFunction The function to call if transactions are not supported
 * @returns The result of the fallback function
 */
export async function handleTransactionError<T>(
  error: any,
  fallbackFunction: () => Promise<T>
): Promise<T> {
  // If transactions are not supported (standalone MongoDB), fall back to non-transactional approach
  if (error.code === MONGODB_TRANSACTION_ERROR_CODE || error.message?.includes('Transaction numbers are only allowed')) {
    console.warn('Transactions not supported, falling back to non-transactional approach');
    return await fallbackFunction();
  }
  
  // Re-throw the error if it's not a transaction support issue
  throw error;
} 