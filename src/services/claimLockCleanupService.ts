/**
 * Claim Lock Cleanup Service
 * 
 * Automatically cleans up stale CLAIMING_ markers every 5 minutes
 * This prevents submissions from being permanently locked if a transaction fails
 */

import { DemonstrationSubmission } from '../models/Models.ts'

const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Run every 5 minutes

let cleanupInterval: NodeJS.Timeout | null = null

export function startClaimLockCleanupService() {
    if (cleanupInterval) {
        console.log('Claim lock cleanup service is already running')
        return
    }

    console.log('Starting claim lock cleanup service (runs every 5 minutes)')

    // Run immediately on start
    cleanupStaleLocks().catch((error) =>
        console.error('Error in initial cleanup:', error)
    )

    // Then run periodically
    cleanupInterval = setInterval(() => {
        cleanupStaleLocks().catch((error) =>
            console.error('Error in scheduled cleanup:', error)
        )
    }, CLEANUP_INTERVAL_MS)
}

export function stopClaimLockCleanupService() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval)
        cleanupInterval = null
        console.log('Claim lock cleanup service stopped')
    }
}

async function cleanupStaleLocks() {
    try {
        const now = Date.now()
        const cutoffTime = now - LOCK_TIMEOUT_MS

        // Remove stale locks atomically
        const result = await DemonstrationSubmission.updateMany(
            {
                'onChainReward.txHash': { $regex: /^CLAIMING_/ },
                'onChainReward.timestamp': { $lt: cutoffTime }
            },
            {
                $set: {
                    'onChainReward.txHash': null, // Set to null instead of removing
                    'onChainReward.timestamp': null
                }
            }
        )

        if (result.modifiedCount > 0) {
            console.log(
                `Cleaned up ${result.modifiedCount} stale claim lock(s) (older than ${LOCK_TIMEOUT_MS / 60000} minutes)`
            )
        }
    } catch (error) {
        console.error('Error cleaning up stale locks:', error)
    }
}

