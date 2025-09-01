import { DemonstrationSubmission } from '../models/Models.ts'
import { ForgeSubmissionProcessingStatus } from '../types/factory.ts'

/**
 * Count completed demonstrations for a factory
 */
export async function getFactoryDemonstrationCount(factoryId: string): Promise<number> {
  return await DemonstrationSubmission.countDocuments({
    'meta.factoryId': factoryId,
    status: ForgeSubmissionProcessingStatus.COMPLETED,
    reward: { $gt: 0 }
  })
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
        'meta.factoryId': { $in: factoryIds },
        status: ForgeSubmissionProcessingStatus.COMPLETED,
        reward: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: '$meta.factoryId',
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
