import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import BlockchainService from '../blockchain/index.ts';
import { ReferralProgramService } from '../blockchain/referralProgram.ts';
import { RewardService } from './rewardService.ts';
import { ReferralCleanupService } from './cleanupService.ts';
import crypto from 'crypto';
import mongoose from 'mongoose';

export class ReferralService {
  private blockchainService: BlockchainService;
  private referralProgramService: ReferralProgramService;
  private rewardService: RewardService;
  private cleanupService: ReferralCleanupService;

  constructor() {
    this.blockchainService = new BlockchainService(
      process.env.RPC_URL || '',
      ''
    );
    this.referralProgramService = new ReferralProgramService(
      process.env.RPC_URL || '',
      process.env.REFERRAL_PROGRAM_ID || '11111111111111111111111111111111'
    );
    this.rewardService = new RewardService(
      process.env.RPC_URL || '',
      process.env.REFERRAL_PROGRAM_ID || '11111111111111111111111111111111'
    );
    this.cleanupService = new ReferralCleanupService();
  }

  /**
   * Generate a unique referral code for a wallet address
   */
  async generateReferralCode(walletAddress: string): Promise<string> {
    // Check if user already has a referral code
    const existingCode = await ReferralCodeModel.findOne({ walletAddress });
    if (existingCode) {
      return existingCode.referralCode;
    }

    // Generate a unique 6-character alphanumeric referral code with collision handling
    const maxRetries = 10;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Generate 6-character alphanumeric code (uppercase letters and numbers)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let referralCode = '';
        const randomBytes = crypto.randomBytes(6);
        for (let i = 0; i < 6; i++) {
          referralCode += chars.charAt(randomBytes[i] % chars.length);
        }

        // Attempt to create the referral code record
        // This will fail with a duplicate key error if the code already exists
        await ReferralCodeModel.create({
          walletAddress,
          referralCode,
          isActive: true,
          totalReferrals: 0,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        });

        // If we get here, the code was successfully created
        return referralCode;

      } catch (error: any) {
        lastError = error;
        
        // Check if this is a duplicate key error (MongoDB error code 11000)
        if (error.code === 11000) {
          // This is a collision - the generated code already exists
          // We'll retry with a new code on the next iteration
          console.warn(`Referral code collision detected on attempt ${attempt + 1}, retrying...`);
          continue;
        }
        
        // If it's not a duplicate key error, it's a different issue
        // Check if it's a duplicate wallet address (user already has a code)
        if (error.code === 11000 && error.keyPattern?.walletAddress) {
          // User already has a referral code, fetch and return it
          const existingCode = await ReferralCodeModel.findOne({ walletAddress });
          if (existingCode) {
            return existingCode.referralCode;
          }
        }
        
        // For any other error, throw it immediately
        throw error;
      }
    }

    // If we've exhausted all retries, throw an error
    throw new Error(`Failed to generate unique referral code after ${maxRetries} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Get referral code for a wallet address
   */
  async getReferralCode(walletAddress: string): Promise<IReferralCode | null> {
    return await ReferralCodeModel.findOne({ walletAddress });
  }

  /**
   * Validate a referral code and get the referrer's wallet address
   */
  async validateReferralCode(referralCode: string): Promise<string | null> {
    const codeRecord = await ReferralCodeModel.findOne({ 
      referralCode: referralCode.toUpperCase(),
      isActive: true 
    });
    
    if (!codeRecord) {
      return null;
    }

    // Check if code has expired
    if (codeRecord.expiresAt && codeRecord.expiresAt < new Date()) {
      // Mark code as inactive
      await ReferralCodeModel.findByIdAndUpdate(codeRecord._id, { isActive: false });
      return null;
    }
    
    return codeRecord.walletAddress;
  }

  /**
   * Create a referral relationship when a user performs their first action
   */
  async createReferral(
    referrerAddress: string,
    referreeAddress: string,
    referralCode: string,
    referralLink: string,
    firstActionType: string,
    firstActionData?: any,
    actionValue?: number
  ): Promise<IReferral> {
    try {
      // Try to use transactions if available (replica set)
      const session = await mongoose.startSession();
      
      try {
        const result = await session.withTransaction(async () => {
          // Check if referree has already been referred (atomic within transaction)
          const existingReferral = await ReferralModel.findOne({ referreeAddress }).session(session);
          if (existingReferral) {
            throw new Error('User has already been referred');
          }

          // Validate referral code
          const validReferrer = await this.validateReferralCode(referralCode);
          if (!validReferrer || validReferrer !== referrerAddress) {
            throw new Error('Invalid referral code');
          }

          // Prevent self-referral
          if (referrerAddress === referreeAddress) {
            throw new Error('Cannot refer yourself');
          }

          // Create referral record (atomic within transaction)
          const referral = await ReferralModel.create([{
            referrerAddress,
            referreeAddress,
            referralCode: referralCode.toUpperCase(),
            referralLink,
            firstActionType,
            firstActionData,
            status: 'pending'
          }], { session });

          // Update referrer's stats (atomic within transaction)
          await ReferralCodeModel.findOneAndUpdate(
            { walletAddress: referrerAddress },
            { $inc: { totalReferrals: 1 } },
            { session }
          );

          return referral[0];
        });

        // Process reward if action value is provided (outside transaction for reliability)
        if (actionValue !== undefined) {
          try {
            const rewardEvent = await this.rewardService.processReward(
              referrerAddress,
              referreeAddress,
              firstActionType,
              actionValue
            );
            
            if (rewardEvent) {
              // Update referral with reward information
              await ReferralModel.findByIdAndUpdate(result._id, {
                rewardAmount: rewardEvent.rewardAmount,
                rewardProcessed: true
              });
            }
          } catch (error) {
            console.error('Failed to process reward:', error);
            // Continue without reward processing
          }
        }

        return result;

      } finally {
        await session.endSession();
      }

    } catch (error: any) {
      // If transactions are not supported (standalone MongoDB), fall back to non-transactional approach
      if (error.code === 20 || error.message?.includes('Transaction numbers are only allowed')) {
        console.warn('Transactions not supported, falling back to non-transactional approach');
        return await this.createReferralWithoutTransaction(
          referrerAddress,
          referreeAddress,
          referralCode,
          referralLink,
          firstActionType,
          firstActionData,
          actionValue
        );
      }
      
      console.error('Failed to create referral:', error);
      throw error;
    }
  }

  /**
   * Fallback method for creating referrals without transactions (for standalone MongoDB)
   */
  private async createReferralWithoutTransaction(
    referrerAddress: string,
    referreeAddress: string,
    referralCode: string,
    referralLink: string,
    firstActionType: string,
    firstActionData?: any,
    actionValue?: number
  ): Promise<IReferral> {
    // Check if referree has already been referred
    const existingReferral = await ReferralModel.findOne({ referreeAddress });
    if (existingReferral) {
      throw new Error('User has already been referred');
    }

    // Validate referral code
    const validReferrer = await this.validateReferralCode(referralCode);
    if (!validReferrer || validReferrer !== referrerAddress) {
      throw new Error('Invalid referral code');
    }

    // Prevent self-referral
    if (referrerAddress === referreeAddress) {
      throw new Error('Cannot refer yourself');
    }

    // Create referral record
    const referral = await ReferralModel.create({
      referrerAddress,
      referreeAddress,
      referralCode: referralCode.toUpperCase(),
      referralLink,
      firstActionType,
      firstActionData,
      status: 'pending'
    });

    // Update referrer's stats
    await ReferralCodeModel.findOneAndUpdate(
      { walletAddress: referrerAddress },
      { $inc: { totalReferrals: 1 } }
    );

    // Process reward if action value is provided
    if (actionValue !== undefined) {
      try {
        const rewardEvent = await this.rewardService.processReward(
          referrerAddress,
          referreeAddress,
          firstActionType,
          actionValue
        );
        
        if (rewardEvent) {
          // Update referral with reward information
          await ReferralModel.findByIdAndUpdate(referral._id, {
            rewardAmount: rewardEvent.rewardAmount,
            rewardProcessed: true
          });
        }
      } catch (error) {
        console.error('Failed to process reward:', error);
        // Continue without reward processing
      }
    }

    return referral;
  }

  /**
   * Store referral relationship on-chain
   */
  async storeReferralOnChain(referralId: string): Promise<{ txHash: string; slot: number }> {
    const referral = await ReferralModel.findById(referralId);
    if (!referral) {
      throw new Error('Referral not found');
    }

    try {
      // Store referral data on-chain
      const referralData = {
        referrerAddress: referral.referrerAddress,
        referreeAddress: referral.referreeAddress,
        referralCode: referral.referralCode,
        timestamp: Math.floor(referral.createdAt.getTime() / 1000),
        rewardAmount: 0 // Will be set when rewards are distributed
      };

      const onChainResult = await this.referralProgramService.storeReferral(referralData);

      // Update referral with on-chain data
      await ReferralModel.findByIdAndUpdate(referralId, {
        onChainTxHash: onChainResult.txHash,
        onChainSlot: onChainResult.slot,
        status: 'confirmed'
      });

      return onChainResult;
    } catch (error) {
      // Update referral status to failed
      await ReferralModel.findByIdAndUpdate(referralId, {
        status: 'failed'
      });
      throw error;
    }
  }

  /**
   * Get referral statistics for a wallet
   */
  async getReferralStats(walletAddress: string): Promise<{
    totalReferrals: number;
    totalRewards: number;
    referralCode: string;
    referrals: IReferral[];
  }> {
    const referralCode = await this.getReferralCode(walletAddress);
    const referrals = await ReferralModel.find({ 
      referrerAddress: walletAddress,
      status: 'confirmed'
    }).sort({ createdAt: -1 });

    return {
      totalReferrals: referralCode?.totalReferrals || 0,
      totalRewards: referralCode?.totalRewards || 0,
      referralCode: referralCode?.referralCode || '',
      referrals
    };
  }

  /**
   * Check if a wallet has been referred
   */
  async hasBeenReferred(walletAddress: string): Promise<boolean> {
    const referral = await ReferralModel.findOne({ referreeAddress: walletAddress });
    return !!referral;
  }

  /**
   * Get referrer for a wallet
   */
  async getReferrer(walletAddress: string): Promise<string | null> {
    const referral = await ReferralModel.findOne({ referreeAddress: walletAddress });
    return referral ? referral.referrerAddress : null;
  }

  /**
   * Get reward statistics for a wallet
   */
  async getRewardStats(walletAddress: string) {
    return await this.rewardService.getRewardStats(walletAddress);
  }

  /**
   * Get reward configuration
   */
  async getRewardConfig() {
    return this.rewardService.getRewardConfig();
  }

  /**
   * Update reward configuration
   */
  async updateRewardConfig(newConfig: any) {
    this.rewardService.updateRewardConfig(newConfig);
    return this.rewardService.getRewardConfig();
  }

  /**
   * Process reward for a specific action
   */
  async processReward(
    referrerAddress: string,
    referreeAddress: string,
    actionType: string,
    actionValue: number
  ) {
    return await this.rewardService.processReward(
      referrerAddress,
      referreeAddress,
      actionType,
      actionValue
    );
  }

  /**
   * Cleanup methods
   */
  async cleanupExpiredCodes(): Promise<number> {
    return await this.cleanupService.cleanupExpiredCodes();
  }

  async getCleanupStats() {
    return await this.cleanupService.getExpiredCodeStats();
  }

  async extendExpiration(walletAddress: string, extensionDays: number = 30): Promise<boolean> {
    return await this.cleanupService.extendExpiration(walletAddress, extensionDays);
  }

  async regenerateExpiredCode(walletAddress: string): Promise<string | null> {
    return await this.cleanupService.regenerateExpiredCode(walletAddress);
  }
}

export const referralService = new ReferralService(); 