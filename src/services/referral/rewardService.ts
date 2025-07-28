import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import { ReferralProgramService } from '../blockchain/referralProgram.ts';
import mongoose from 'mongoose';
import { MONGODB_TRANSACTION_ERROR_CODE } from '../../constants/referral.ts';

export interface RewardConfig {
  baseReward: number; // Base reward amount in tokens
  bonusMultiplier: number; // Multiplier for additional referrals
  maxReferrals: number; // Maximum referrals for bonus
  minActionValue: number; // Minimum value of first action to qualify
  cooldownPeriod: number; // Cooldown period in milliseconds
  maxReferralsPerCooldownPeriod: number; // Maximum referrals allowed in cooldown period
}

export interface RewardEvent {
  referrerAddress: string;
  referreeAddress: string;
  actionType: string;
  actionValue: number;
  rewardAmount: number;
  timestamp: Date;
}

export class RewardService {
  private referralProgramService: ReferralProgramService;
  private rewardConfig: RewardConfig;

  constructor(rpcUrl: string, programId: string) {
    this.referralProgramService = new ReferralProgramService(rpcUrl, programId);
    this.rewardConfig = {
      baseReward: 100, // 100 tokens
      bonusMultiplier: 1.5, // 50% bonus
      maxReferrals: 10, // Max referrals for bonus
      minActionValue: 10, // Minimum 10 tokens worth of action
      cooldownPeriod: 24 * 60 * 60 * 1000, // 24 hours
      maxReferralsPerCooldownPeriod: 5 // Maximum referrals per cooldown period
    };
  }

  /**
   * Calculate reward amount based on referral count and action value
   */
  private calculateReward(referralCount: number, actionValue: number): number {
    if (actionValue < this.rewardConfig.minActionValue) {
      return 0; // No reward if action value is too low
    }

    let reward = this.rewardConfig.baseReward;

    // Apply bonus multiplier for multiple referrals
    if (referralCount > 1 && referralCount <= this.rewardConfig.maxReferrals) {
      const bonus = Math.min(referralCount - 1, this.rewardConfig.maxReferrals - 1);
      reward *= (1 + (bonus * (this.rewardConfig.bonusMultiplier - 1)) / this.rewardConfig.maxReferrals);
    }

    return Math.floor(reward);
  }

  /**
   * Check if user is eligible for rewards (anti-abuse)
   */
  private async isEligibleForReward(referrerAddress: string, referreeAddress: string): Promise<boolean> {
    // Check if referree has been referred before
    const existingReferral = await ReferralModel.findOne({ referreeAddress });
    if (existingReferral) {
      return false; // Already referred
    }

    // Check cooldown period for referrer
    const recentReferrals = await ReferralModel.find({
      referrerAddress,
      createdAt: { $gte: new Date(Date.now() - this.rewardConfig.cooldownPeriod) }
    });

    if (recentReferrals.length >= this.rewardConfig.maxReferralsPerCooldownPeriod) {
      return false; // Too many referrals in cooldown period
    }

    // Check for suspicious patterns (same IP, device, etc.)
    // This would require additional data collection
    return true;
  }

  /**
   * Process reward for a referral action with atomic transaction
   */
  async processReward(
    referrerAddress: string,
    referreeAddress: string,
    actionType: string,
    actionValue: number
  ): Promise<RewardEvent | null> {
    try {
      // Try to use transactions if available (replica set)
      const session = await mongoose.startSession();
      
      try {
        const result = await session.withTransaction(async () => {
          // Check if referree has been referred before (atomic within transaction)
          const existingReferral = await ReferralModel.findOne({ referreeAddress }).session(session);
          if (existingReferral) {
            return null; // Already referred, no reward
          }

          // Check cooldown period for referrer (atomic within transaction)
          const recentReferrals = await ReferralModel.find({
            referrerAddress,
            createdAt: { $gte: new Date(Date.now() - this.rewardConfig.cooldownPeriod) }
          }).session(session);

          if (recentReferrals.length >= this.rewardConfig.maxReferralsPerCooldownPeriod) {
            return null; // Too many referrals in cooldown period
          }

          // Get referrer's current referral count (atomic within transaction)
          const referralCount = await ReferralModel.countDocuments({
            referrerAddress,
            status: 'confirmed'
          }).session(session);

          // Calculate reward
          const rewardAmount = this.calculateReward(referralCount + 1, actionValue);
          
          if (rewardAmount === 0) {
            return null; // No reward for this action
          }

          // Create reward event
          const rewardEvent: RewardEvent = {
            referrerAddress,
            referreeAddress,
            actionType,
            actionValue,
            rewardAmount,
            timestamp: new Date()
          };

          // Update referrer's total rewards (atomic within transaction)
          await ReferralCodeModel.findOneAndUpdate(
            { walletAddress: referrerAddress },
            { $inc: { totalRewards: rewardAmount } },
            { session }
          );

          return rewardEvent;
        });

        // If we have a reward event, distribute it on-chain (outside transaction for reliability)
        if (result) {
          try {
            await this.referralProgramService.distributeReward(
              referrerAddress,
              result.rewardAmount
            );
          } catch (error) {
            console.error('Failed to distribute reward on-chain:', error);
            // Continue with off-chain reward tracking
          }
        }

        return result;

      } finally {
        await session.endSession();
      }

    } catch (error: any) {
      // If transactions are not supported (standalone MongoDB), fall back to non-transactional approach
      if (error.code === MONGODB_TRANSACTION_ERROR_CODE) {
        console.warn('Transactions not supported, falling back to non-transactional approach');
        return await this.processRewardWithoutTransaction(referrerAddress, referreeAddress, actionType, actionValue);
      }
      
      console.error('Failed to process reward:', error);
      return null;
    }
  }

  /**
   * Fallback method for processing rewards without transactions (for standalone MongoDB)
   */
  private async processRewardWithoutTransaction(
    referrerAddress: string,
    referreeAddress: string,
    actionType: string,
    actionValue: number
  ): Promise<RewardEvent | null> {
    try {
      // Check if referree has been referred before
      const existingReferral = await ReferralModel.findOne({ referreeAddress });
      if (existingReferral) {
        return null; // Already referred, no reward
      }

      // Check cooldown period for referrer
      const recentReferrals = await ReferralModel.find({
        referrerAddress,
        createdAt: { $gte: new Date(Date.now() - this.rewardConfig.cooldownPeriod) }
      });

              if (recentReferrals.length >= this.rewardConfig.maxReferralsPerCooldownPeriod) {
        return null; // Too many referrals in cooldown period
      }

      // Get referrer's current referral count
      const referralCount = await ReferralModel.countDocuments({
        referrerAddress,
        status: 'confirmed'
      });

      // Calculate reward
      const rewardAmount = this.calculateReward(referralCount + 1, actionValue);
      
      if (rewardAmount === 0) {
        return null; // No reward for this action
      }

      // Create reward event
      const rewardEvent: RewardEvent = {
        referrerAddress,
        referreeAddress,
        actionType,
        actionValue,
        rewardAmount,
        timestamp: new Date()
      };

      // Update referrer's total rewards
      await ReferralCodeModel.findOneAndUpdate(
        { walletAddress: referrerAddress },
        { $inc: { totalRewards: rewardAmount } }
      );

      // Distribute reward on-chain
      try {
        await this.referralProgramService.distributeReward(
          referrerAddress,
          rewardAmount
        );
      } catch (error) {
        console.error('Failed to distribute reward on-chain:', error);
        // Continue with off-chain reward tracking
      }

      return rewardEvent;

    } catch (error) {
      console.error('Failed to process reward without transaction:', error);
      return null;
    }
  }

  /**
   * Get reward statistics for a wallet
   */
  async getRewardStats(walletAddress: string): Promise<{
    totalRewards: number;
    totalReferrals: number;
    averageReward: number;
    recentRewards: RewardEvent[];
  }> {
    const referralCode = await ReferralCodeModel.findOne({ walletAddress });
    const referrals = await ReferralModel.find({
      referrerAddress: walletAddress,
      status: 'confirmed'
    });

    const totalRewards = referralCode?.totalRewards || 0;
    const totalReferrals = referrals.length;
    const averageReward = totalReferrals > 0 ? totalRewards / totalReferrals : 0;

    return {
      totalRewards,
      totalReferrals,
      averageReward,
      recentRewards: [] // Would need to track reward events separately
    };
  }

  /**
   * Update reward configuration
   */
  updateRewardConfig(newConfig: Partial<RewardConfig>): void {
    this.rewardConfig = { ...this.rewardConfig, ...newConfig };
  }

  /**
   * Get current reward configuration
   */
  getRewardConfig(): RewardConfig {
    return { ...this.rewardConfig };
  }
} 