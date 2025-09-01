import mongoose from 'mongoose';

/**
 * Distributed lock for preventing race conditions in reward calculation
 * Uses MongoDB unique indexes to ensure only one process can hold a lock at a time
 */

interface IProcessingLock extends mongoose.Document {
  _id: string; // Lock ID, e.g., `${userAddress}-${factoryId}`
  createdAt: Date;
}

const processingLockSchema = new mongoose.Schema<IProcessingLock>({
  _id: { type: String, required: true }, // Lock ID
  createdAt: { 
    type: Date, 
    expires: '5m', // TTL: 5 minutes to prevent stale locks
    default: Date.now 
  }
}, { 
  collection: 'processing_locks',
  _id: false // Use custom _id
});

// Index for TTL
processingLockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

export const ProcessingLockModel = mongoose.model<IProcessingLock>('ProcessingLock', processingLockSchema);

/**
 * Acquire a distributed lock with timeout and retry limit
 * @param lockId - Unique identifier for the lock
 * @param maxRetries - Maximum number of retry attempts (default: 60)
 * @param retryDelayMs - Delay between retries in milliseconds (default: 500)
 */
export async function acquireLock(
  lockId: string, 
  maxRetries: number = 60, 
  retryDelayMs: number = 500
): Promise<void> {
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      await ProcessingLockModel.create({ _id: lockId });
      return; // Lock acquired successfully
    } catch (error: any) {
      if (error.code === 11000) { // Duplicate key error (lock already exists)
        attempts++;
        if (attempts >= maxRetries) {
          const maxWaitTime = maxRetries * retryDelayMs;
          throw new Error(`Failed to acquire lock ${lockId} after ${maxRetries} attempts (${maxWaitTime}ms). Lock may be stale or held by another process.`);
        }
        // Lock is held, wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        throw error; // Unexpected error
      }
    }
  }
}

/**
 * Release a distributed lock
 * @param lockId - Unique identifier for the lock to release
 */
export async function releaseLock(lockId: string): Promise<void> {
  await ProcessingLockModel.deleteOne({ _id: lockId });
}

/**
 * Check if a lock exists (useful for debugging)
 * @param lockId - Unique identifier for the lock
 * @returns true if lock exists, false otherwise
 */
export async function isLockHeld(lockId: string): Promise<boolean> {
  const lock = await ProcessingLockModel.findById(lockId);
  return !!lock;
}

/**
 * Force release all locks (use with caution, primarily for testing/debugging)
 */
export async function releaseAllLocks(): Promise<number> {
  const result = await ProcessingLockModel.deleteMany({});
  return result.deletedCount;
}