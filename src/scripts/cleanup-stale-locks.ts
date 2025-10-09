/**
 * Cleanup script for stale claim locks
 * 
 * This script removes CLAIMING_ markers that are older than 10 minutes
 * These markers are set when a claim starts but should be replaced with
 * actual txHash or removed on failure.
 * 
 * Run manually or via cron: node --import tsx scripts/cleanup-stale-locks.ts
 */

import { DemonstrationSubmission } from '../models/Models.ts'
import mongoose from 'mongoose'

const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

async function cleanupStaleLocks() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clones'
        await mongoose.connect(mongoUri)

        console.log('Searching for stale claim locks...')

        const now = Date.now()
        const cutoffTime = now - LOCK_TIMEOUT_MS

        // Find submissions with CLAIMING_ marker older than timeout
        const staleSubmissions = await DemonstrationSubmission.find({
            'onChainReward.txHash': { $regex: /^CLAIMING_/ },
            'onChainReward.timestamp': { $lt: cutoffTime }
        })

        if (staleSubmissions.length === 0) {
            console.log('No stale locks found')
            return
        }

        console.log(`Found ${staleSubmissions.length} stale locks to clean up`)

        for (const submission of staleSubmissions) {
            console.log(`  - Unlocking submission ${submission._id} (locked at ${new Date(submission.onChainReward?.timestamp || 0).toISOString()})`)
        }

        // Remove the locks atomically
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

        console.log(`Cleaned up ${result.modifiedCount} stale locks`)

    } catch (error) {
        console.error('Error cleaning up stale locks:', error)
        process.exit(1)
    } finally {
        await mongoose.disconnect()
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    cleanupStaleLocks()
        .then(() => {
            console.log('Cleanup complete')
            process.exit(0)
        })
        .catch((error) => {
            console.error('Cleanup failed:', error)
            process.exit(1)
        })
}

export { cleanupStaleLocks }

