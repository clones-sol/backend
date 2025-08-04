import { ForgeRaceSubmission, TrainingPoolModel } from '../../models/Models.ts';
import { RewardPoolService } from '../blockchain/rewardPool.ts';
import { Connection, Keypair } from '@solana/web3.js';
import { getTokenAddress } from '../blockchain/tokens.ts';

export class ForgeMigrationService {
  private rewardPoolService: RewardPoolService;

  constructor() {
    this.rewardPoolService = new RewardPoolService(
      new Connection(process.env.RPC_URL || ''),
      process.env.REWARD_POOL_PROGRAM_ID || '11111111111111111111111111111111',
      Keypair.generate() // TODO: Replace with actual platform authority keypair
    );
  }

  /**
   * Migrate existing completed submissions to the new smart contract system
   * This should be run once when the smart contract is deployed
   */
  async migrateExistingRewards(): Promise<{
    totalProcessed: number;
    totalMigrated: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let totalProcessed = 0;
    let totalMigrated = 0;

    try {
      console.log('[MIGRATION] Starting migration of existing rewards to smart contract system...');

      // Find all completed submissions with rewards that haven't been migrated
      const submissions = await ForgeRaceSubmission.find({
        status: 'COMPLETED',
        reward: { $gt: 0 },
        $or: [
          { smartContractReward: { $exists: false } },
          { 'smartContractReward.isRecorded': { $ne: true } }
        ]
      }).populate('meta.quest.pool_id');

      console.log(`[MIGRATION] Found ${submissions.length} submissions to migrate`);

      for (const submission of submissions) {
        totalProcessed++;
        
        try {
          // Get pool information
          const poolId = submission.meta?.quest?.pool_id;
          if (!poolId) {
            errors.push(`Submission ${submission._id}: No pool ID found`);
            continue;
          }

          const pool = await TrainingPoolModel.findById(poolId);
          if (!pool) {
            errors.push(`Submission ${submission._id}: Pool not found`);
            continue;
          }

          // Generate unique task ID
          const taskId = `migration_${submission._id}_${Date.now()}`;
          
          // Calculate platform fee (10%) and farmer reward (90%)
          const reward = submission.reward || 0;
          const platformFeeAmount = reward * 0.1;
          const farmerRewardAmount = reward * 0.9;
          
          const tokenAddress = getTokenAddress(pool.token.symbol);

          // Record task completion in smart contract
          const recordResult = await this.rewardPoolService.recordTaskCompletion(
            taskId,
            submission.address,
            pool._id.toString(),
            reward,
            tokenAddress
          );

          // Update submission with smart contract reward data
          await ForgeRaceSubmission.findByIdAndUpdate(submission._id, {
            smartContractReward: {
              taskId,
              rewardAmount: reward,
              tokenMint: tokenAddress,
              poolId: pool._id.toString(),
              isRecorded: true,
              recordSignature: recordResult.signature,
              recordSlot: recordResult.slot,
              isWithdrawn: false,
              platformFeeAmount,
              farmerRewardAmount
            }
          });

          totalMigrated++;
          console.log(`[MIGRATION] Successfully migrated submission ${submission._id}`);

        } catch (error) {
          const errorMsg = `Submission ${submission._id}: ${(error as Error).message}`;
          errors.push(errorMsg);
          console.error(`[MIGRATION] Error migrating submission ${submission._id}:`, error);
        }
      }

      console.log(`[MIGRATION] Migration completed. Processed: ${totalProcessed}, Migrated: ${totalMigrated}, Errors: ${errors.length}`);

    } catch (error) {
      console.error('[MIGRATION] Fatal error during migration:', error);
      errors.push(`Fatal error: ${(error as Error).message}`);
    }

    return {
      totalProcessed,
      totalMigrated,
      errors
    };
  }

  /**
   * Get migration status and statistics
   */
  async getMigrationStatus(): Promise<{
    totalSubmissions: number;
    migratedSubmissions: number;
    pendingSubmissions: number;
    totalRewards: number;
    migratedRewards: number;
    pendingRewards: number;
  }> {
    try {
      // Get total completed submissions with rewards
      const totalSubmissions = await ForgeRaceSubmission.countDocuments({
        status: 'COMPLETED',
        reward: { $gt: 0 }
      });

      // Get migrated submissions
      const migratedSubmissions = await ForgeRaceSubmission.countDocuments({
        status: 'COMPLETED',
        reward: { $gt: 0 },
        'smartContractReward.isRecorded': true
      });

      // Get pending submissions
      const pendingSubmissions = await ForgeRaceSubmission.countDocuments({
        status: 'COMPLETED',
        reward: { $gt: 0 },
        $or: [
          { smartContractReward: { $exists: false } },
          { 'smartContractReward.isRecorded': { $ne: true } }
        ]
      });

      // Calculate total rewards
      const totalRewardsResult = await ForgeRaceSubmission.aggregate([
        {
          $match: {
            status: 'COMPLETED',
            reward: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalRewards: { $sum: '$reward' }
          }
        }
      ]);

      const totalRewards = totalRewardsResult[0]?.totalRewards || 0;

      // Calculate migrated rewards
      const migratedRewardsResult = await ForgeRaceSubmission.aggregate([
        {
          $match: {
            status: 'COMPLETED',
            reward: { $gt: 0 },
            'smartContractReward.isRecorded': true
          }
        },
        {
          $group: {
            _id: null,
            migratedRewards: { $sum: '$reward' }
          }
        }
      ]);

      const migratedRewards = migratedRewardsResult[0]?.migratedRewards || 0;

      // Calculate pending rewards
      const pendingRewardsResult = await ForgeRaceSubmission.aggregate([
        {
          $match: {
            status: 'COMPLETED',
            reward: { $gt: 0 },
            $or: [
              { smartContractReward: { $exists: false } },
              { 'smartContractReward.isRecorded': { $ne: true } }
            ]
          }
        },
        {
          $group: {
            _id: null,
            pendingRewards: { $sum: '$reward' }
          }
        }
      ]);

      const pendingRewards = pendingRewardsResult[0]?.pendingRewards || 0;

      return {
        totalSubmissions,
        migratedSubmissions,
        pendingSubmissions,
        totalRewards,
        migratedRewards,
        pendingRewards
      };

    } catch (error) {
      console.error('Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * Validate migration integrity
   */
  async validateMigration(): Promise<{
    isValid: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check for submissions with rewards but no smart contract data
      const submissionsWithoutSmartContract = await ForgeRaceSubmission.countDocuments({
        status: 'COMPLETED',
        reward: { $gt: 0 },
        smartContractReward: { $exists: false }
      });

      if (submissionsWithoutSmartContract > 0) {
        issues.push(`${submissionsWithoutSmartContract} submissions have rewards but no smart contract data`);
      }

      // Check for submissions with smart contract data but no rewards
      const submissionsWithSmartContractNoReward = await ForgeRaceSubmission.countDocuments({
        status: 'COMPLETED',
        reward: { $lte: 0 },
        'smartContractReward.isRecorded': true
      });

      if (submissionsWithSmartContractNoReward > 0) {
        warnings.push(`${submissionsWithSmartContractNoReward} submissions have smart contract data but no rewards`);
      }

      // Check for duplicate task IDs
      const duplicateTaskIds = await ForgeRaceSubmission.aggregate([
        {
          $match: {
            'smartContractReward.taskId': { $exists: true }
          }
        },
        {
          $group: {
            _id: '$smartContractReward.taskId',
            count: { $sum: 1 }
          }
        },
        {
          $match: {
            count: { $gt: 1 }
          }
        }
      ]);

      if (duplicateTaskIds.length > 0) {
        issues.push(`${duplicateTaskIds.length} duplicate task IDs found`);
      }

      // Check for submissions with inconsistent reward amounts
      const inconsistentRewards = await ForgeRaceSubmission.find({
        status: 'COMPLETED',
        reward: { $gt: 0 },
        'smartContractReward.isRecorded': true,
        $expr: {
          $ne: ['$reward', '$smartContractReward.rewardAmount']
        }
      });

      if (inconsistentRewards.length > 0) {
        issues.push(`${inconsistentRewards.length} submissions have inconsistent reward amounts`);
      }

      const isValid = issues.length === 0;

      return {
        isValid,
        issues,
        warnings
      };

    } catch (error) {
      console.error('Failed to validate migration:', error);
      issues.push(`Validation error: ${(error as Error).message}`);
      return {
        isValid: false,
        issues,
        warnings
      };
    }
  }
} 