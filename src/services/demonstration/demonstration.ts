import OpenAI from 'openai';
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts';

// Cache to store generated instruction lists
const CACHE_EXPIRY = 2 * 60 * 60 * 1000;
const instructionCache = new Map<
  string,
  {
    instructions: string[];
    timestamp: number;
    expiryMs: number;
  }
>();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let cleanupCache: NodeJS.Timeout;

export function startCacheInterval() {
  cleanupCache = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of instructionCache.entries()) {
      if (now - value.timestamp >= value.expiryMs) {
        instructionCache.delete(key);
      }
    }
  }, 60 * 60 * 1000);
}

export function stopCacheInterval() {
  clearInterval(cleanupCache);
}

/**
 * Get leaderboard and stats information
 * @returns Object containing forge leaderboard, worker leaderboard, and overall stats
 */
export async function getLeaderboardData() {
  // Get worker leaderboard
  const workerLeaderboardData: {
    address: string;
    tasks: number;
    rewards: number;
    avgScore: number;
    nickname?: string;
  }[] = await DemonstrationSubmission.aggregate([
    { $match: { status: 'completed', reward: { $exists: true, $gt: 0 }, clampedScore: { $gte: 50 } } },
    {
      $group: {
        _id: '$address',
        tasks: { $sum: 1 },
        rewards: { $sum: '$reward' },
        avgScore: { $avg: '$clampedScore' }
      }
    },
    {
      $lookup: {
        from: 'wallet_connections',
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
        nickname: { $arrayElemAt: ['$walletConnection.nickname', 0] }
      }
    }
  ]);

  // Add rank and nickname to worker leaderboard
  const workerLeaderboard = workerLeaderboardData.map((worker, index) => ({
    rank: index + 1,
    address: worker.address,
    nickname: worker.nickname || '', // Nickname is optional
    tasks: worker.tasks,
    rewards: worker.rewards,
    avgScore: worker.avgScore
  }));

  // Get forge leaderboard - convert string pool_id to ObjectId
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
        _id: { $toObjectId: '$meta.quest.pool_id' }, // Convert string to ObjectId
        tasks: { $sum: 1 },
        payout: { $sum: '$reward' }
      }
    },
    {
      $lookup: {
        from: 'training_pools',
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
        name: { $ifNull: ['$pool.name', 'Unknown Pool'] }, // Handle missing pool
        tasks: 1,
        payout: 1
      }
    }
  ]);

  // Add rank to forge leaderboard
  const forgeLeaderboard = forgeLeaderboardData.map((forge, index) => ({
    rank: index + 1,
    name: forge.name,
    tasks: forge.tasks,
    payout: forge.payout
  }));

  // Get overall stats

  const totalWorkersResult = await DemonstrationSubmission.aggregate([
    { $group: { _id: '$address' } },
    { $count: 'total' }
  ]);

  const totalWorkers = totalWorkersResult.length > 0 ? totalWorkersResult[0].total : 0;

  const tasksStats = await DemonstrationSubmission.aggregate([
    { $match: { status: 'completed' } },
    {
      $group: {
        _id: null,
        tasksCompleted: { $sum: 1 },
        totalRewards: { $sum: '$reward' }
      }
    }
  ]);

  const tasksCompleted = tasksStats.length > 0 ? tasksStats[0].tasksCompleted : 0;
  const totalRewards = tasksStats.length > 0 ? tasksStats[0].totalRewards : 0;

  const activeForges = await FactoryModel.countDocuments({
    status: 'active'
  });

  // Compile final result
  return {
    forgeLeaderboard,
    workersLeaderboard: workerLeaderboard,
    stats: {
      totalWorkers,
      tasksCompleted,
      totalRewards,
      activeForges
    }
  };
}
