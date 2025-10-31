import { DemonstrationSubmission } from '../models/Models.ts'
import { ForgeSubmissionProcessingStatus } from '../types/factory.ts'

/**
 * Count completed demonstrations for a factory
 */
export async function getFactoryDemonstrationCount(factoryId: string): Promise<number> {
  console.log('factoryId', factoryId)
  console.log('status', ForgeSubmissionProcessingStatus.COMPLETED)
  console.log('reward', { $gt: 0 })
  const count = await DemonstrationSubmission.countDocuments({
    'meta.quest.pool_id': factoryId,
    status: ForgeSubmissionProcessingStatus.COMPLETED,
    reward: { $gt: 0 }
  })
  console.log('count', count)
  return count
}

/**
 * Get demonstration counts for multiple factories
 */
export async function getFactoriesDemonstrationCounts(
  factoryIds: string[]
): Promise<Map<string, number>> {
  const results = await DemonstrationSubmission.aggregate([
    {
      $match: {
        'meta.quest.pool_id': { $in: factoryIds },
        status: ForgeSubmissionProcessingStatus.COMPLETED,
        reward: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: '$meta.quest.pool_id',
        count: { $sum: 1 }
      }
    }
  ])

  const countsMap = new Map<string, number>()
  for (const result of results) {
    countsMap.set(result._id, result.count)
  }

  // Ensure all requested factoryIds have a count (default to 0)
  for (const factoryId of factoryIds) {
    if (!countsMap.has(factoryId)) {
      countsMap.set(factoryId, 0)
    }
  }

  return countsMap
}
