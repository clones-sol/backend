import OpenAI from 'openai'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { FactoryStatus } from '../../types/factory.ts'
import BlockchainService from '../blockchain/index.ts'
import { logger } from "../logger.ts"

// Cache to store generated instruction lists
const _CACHE_EXPIRY = 2 * 60 * 60 * 1000
const instructionCache = new Map<
  string,
  {
    instructions: string[]
    timestamp: number
    expiryMs: number
  }
>()

const _openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

let cleanupCache: NodeJS.Timeout

export function startCacheInterval() {
  cleanupCache = setInterval(
    () => {
      const now = Date.now()
      for (const [key, value] of instructionCache.entries()) {
        if (now - value.timestamp >= value.expiryMs) {
          instructionCache.delete(key)
        }
      }
    },
    60 * 60 * 1000
  )
}

export function stopCacheInterval() {
  clearInterval(cleanupCache)
}

/**
 * Smart token price fetcher - caches prices to avoid redundant API calls
 */
async function getTokenPricesUSD(tokenSymbols: string[]): Promise<Map<string, number>> {
  const uniqueSymbols = [...new Set(tokenSymbols)]
  const priceMap = new Map<string, number>()

  // Fetch all unique token prices in parallel
  const pricePromises = uniqueSymbols.map(async (symbol) => {
    try {
      const price = await BlockchainService.getTokenPriceUSD(symbol)
      priceMap.set(symbol, price)
      logger.info(`${symbol}: $${price}`)
    } catch (error) {
      priceMap.set(symbol, 0)
    }
  })

  await Promise.all(pricePromises)
  return priceMap
}

/**
 * Get leaderboard and stats information
 * @returns Object containing forge leaderboard, worker leaderboard, and overall stats
 */
export async function getLeaderboardData() {
  // Get worker leaderboard
  const workerLeaderboardData: {
    address: string
    tasks: number
    rewards: number
    avgScore: number
    nickname?: string
    tokens: Array<{
      symbol: string
      address: string
      decimals: number
      type: string
      totalReward: number
    }>
  }[] = await DemonstrationSubmission.aggregate([
    {
      $match: {
        status: 'completed',
        reward: { $exists: true, $gt: 0 },
        clampedScore: { $gte: 50 }
      }
    },
    {
      $group: {
        _id: {
          address: '$address',
          factoryId: '$meta.quest.pool_id',
          tokenAddress: '$onChainReward.tokenAddress'
        },
        tasks: { $sum: 1 },
        rewards: { $sum: '$reward' },
        avgScore: { $avg: '$clampedScore' }
      }
    },
    {
      $lookup: {
        from: 'factories',
        localField: '_id.factoryId',
        foreignField: '_id',
        as: 'factory'
      }
    },
    {
      $group: {
        _id: '$_id.address',
        tasks: { $sum: '$tasks' },
        rewards: { $sum: '$rewards' },
        avgScore: { $avg: '$avgScore' },
        tokens: {
          $push: {
            $cond: {
              if: { $ne: [{ $arrayElemAt: ['$factory.token', 0] }, null] },
              then: {
                $mergeObjects: [
                  { $arrayElemAt: ['$factory.token', 0] },
                  { totalReward: '$rewards' }
                ]
              },
              else: null
            }
          }
        }
      }
    },
    {
      $addFields: {
        tokens: {
          $filter: {
            input: '$tokens',
            cond: {
              $and: [
                { $ne: ['$$this', null] },
                { $eq: [{ $type: '$$this.symbol' }, 'string'] },
                { $eq: [{ $type: '$$this.address' }, 'string'] }
              ]
            }
          }
        }
      }
    },
    {
      $lookup: {
        from: 'walletconnections',
        localField: '_id',
        foreignField: 'address',
        as: 'walletConnection'
      }
    },
    { $sort: { rewards: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        address: '$_id',
        tasks: 1,
        rewards: 1,
        avgScore: 1,
        nickname: { $arrayElemAt: ['$walletConnection.nickname', 0] },
        tokens: 1
      }
    }
  ])

  // Extract all unique token symbols for price fetching
  const allTokenSymbols = new Set<string>()
  workerLeaderboardData.forEach(worker => {
    worker.tokens?.forEach(token => {
      if (token.symbol) allTokenSymbols.add(token.symbol)
    })
  })

  // Get token prices once for all tokens
  const tokenPrices = await getTokenPricesUSD([...allTokenSymbols])

  // Add rank, nickname and USD calculations to worker leaderboard
  const workerLeaderboard = workerLeaderboardData.map((worker, index) => {
    // Calculate total USD value for this worker
    const totalUSD = worker.tokens?.reduce((sum, token) => {
      if (token.symbol && token.totalReward) {
        const price = tokenPrices.get(token.symbol) || 0
        return sum + (token.totalReward * price)
      }
      return sum
    }, 0) || 0

    return {
      rank: index + 1,
      address: worker.address,
      nickname: worker.nickname || '',
      tasks: worker.tasks,
      rewards: worker.rewards,
      avgScore: worker.avgScore,
      tokens: worker.tokens || [],
      totalUSD: Math.round(totalUSD * 100) / 100 // Round to 2 decimals
    }
  })

  // Get forge leaderboard with token information
  const forgeLeaderboardData = await DemonstrationSubmission.aggregate([
    {
      $match: {
        status: 'completed',
        reward: { $exists: true, $gt: 0 },
        'meta.quest.pool_id': { $exists: true }
      }
    },
    {
      $group: {
        _id: '$meta.quest.pool_id',
        tasks: { $sum: 1 },
        payout: { $sum: '$reward' }
      }
    },
    {
      $lookup: {
        from: 'factories',
        localField: '_id',
        foreignField: '_id',
        as: 'pool'
      }
    },
    { $unwind: { path: '$pool', preserveNullAndEmptyArrays: true } },
    { $sort: { tasks: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        name: { $ifNull: ['$pool.name', 'Unknown Pool'] },
        tasks: 1,
        payout: 1,
        token: '$pool.token'
      }
    }
  ])

  // Add forge token symbols to price fetching
  forgeLeaderboardData.forEach(forge => {
    if (forge.token?.symbol) allTokenSymbols.add(forge.token.symbol)
  })

  // Update token prices if we have new symbols
  const newSymbols = [...allTokenSymbols].filter(symbol => !tokenPrices.has(symbol));
  if (newSymbols.length > 0) {
    const newTokenPrices = await getTokenPricesUSD(newSymbols);
    newTokenPrices.forEach((price, symbol) => tokenPrices.set(symbol, price));
  }

  // Add rank and USD calculations to forge leaderboard
  const forgeLeaderboard = forgeLeaderboardData.map((forge, index) => {
    const payoutUSD = forge.token?.symbol
      ? Math.round(forge.payout * (tokenPrices.get(forge.token.symbol) || 0) * 100) / 100
      : 0

    return {
      rank: index + 1,
      name: forge.name,
      tasks: forge.tasks,
      payout: forge.payout,
      token: forge.token || null,
      payoutUSD
    }
  })

  // Get overall stats

  const totalWorkersResult = await DemonstrationSubmission.aggregate([
    { $group: { _id: '$address' } },
    { $count: 'total' }
  ])

  const totalWorkers = totalWorkersResult.length > 0 ? totalWorkersResult[0].total : 0

  const tasksStats = await DemonstrationSubmission.aggregate([
    { $match: { status: 'completed' } },
    {
      $group: {
        _id: null,
        tasksCompleted: { $sum: 1 },
        totalRewards: { $sum: '$reward' }
      }
    }
  ])

  const tasksCompleted = tasksStats.length > 0 ? tasksStats[0].tasksCompleted : 0
  const totalRewards = tasksStats.length > 0 ? tasksStats[0].totalRewards : 0

  const activeForges = await FactoryModel.countDocuments({
    status: FactoryStatus.active
  })

  // Calculate total USD payout from all leaderboards
  const totalUSDPayout = Math.round(
    (forgeLeaderboard.reduce((sum, forge) => sum + forge.payoutUSD, 0) +
      workerLeaderboard.reduce((sum, worker) => sum + worker.totalUSD, 0)) * 100
  ) / 100

  // Compile final result
  const result = {
    forgeLeaderboard,
    workersLeaderboard: workerLeaderboard,
    stats: {
      totalWorkers,
      tasksCompleted,
      totalRewards,
      totalUSDPayout,
      activeForges
    }
  }
  return result
}
