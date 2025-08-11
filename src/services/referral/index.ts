import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import { ReferralCleanupService } from './cleanupService.ts';
import { handleTransactionError } from '../../utils/transactionUtils.ts';
import { REFERRAL_CODE_CHARS, REFERRAL_CODE_LENGTH, MAX_REFERRAL_CODE_ATTEMPTS } from '../../constants/referral.ts';
import { ApiError } from '../../middleware/types/errors.ts';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ContentFilterService } from '../validation/contentFilter.ts';

export class ReferralService {
  private cleanupService: ReferralCleanupService;

  constructor() {
    this.cleanupService = new ReferralCleanupService();
  }

  /**
   * Generate a unique referral code for a wallet address
   */
  async generateReferralCode(
    walletAddress: string
  ): Promise<{ referralCode: string; createdAt: Date }> {
    // Check if user already has a referral code
    const existingCode = await ReferralCodeModel.findOne({ walletAddress });
    if (existingCode) {
      return {
        referralCode: existingCode.referralCode,
        createdAt: existingCode.createdAt
      };
    }

    // Generate a unique 6-character alphanumeric referral code with collision handling
    const maxRetries = MAX_REFERRAL_CODE_ATTEMPTS;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Generate 6-character alphanumeric code (uppercase letters and numbers)
        // Excluding visually similar characters: O, 0, L, 1, I to avoid human transcription errors
        const chars = REFERRAL_CODE_CHARS;
        let referralCode = '';
        const randomBytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
        for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
          referralCode += chars.charAt(randomBytes[i] % chars.length);
        }

        // Validate the generated code against the content filter
        if (!(await ContentFilterService.isReferralCodeAcceptable(referralCode))) {
          console.warn(`Generated referral code "${referralCode}" is not acceptable. Retrying...`);
          lastError = new Error('Generated code failed content filter.');
          continue; // Retry with a new code
        }

        // Attempt to create the referral code record
        // This will fail with a duplicate key error if the code already exists
        const newCode = await ReferralCodeModel.create({
          walletAddress,
          referralCode,
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        });

        // If we get here, the code was successfully created
        return {
          referralCode: newCode.referralCode,
          createdAt: newCode.createdAt
        };

      } catch (error: any) {
        lastError = error;

        // Check if this is a duplicate key error (MongoDB error code 11000)
        if (error.code === 11000) {
          // Check if it's a duplicate wallet address (user already has a code)
          if (error.keyPattern?.walletAddress) {
            // User already has a referral code, fetch and return it
            const existingCode = await ReferralCodeModel.findOne({ walletAddress });
            if (existingCode) {
              return {
                referralCode: existingCode.referralCode,
                createdAt: existingCode.createdAt
              };
            }
          }

          // This is a collision - the generated code already exists
          // We'll retry with a new code on the next iteration
          console.warn(`Referral code collision detected on attempt ${attempt + 1}, retrying...`);
          continue;
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
    return await ReferralCodeModel.findOne({ walletAddress, isActive: true }).lean().exec();
  }

  /**
   * Validate a referral code and get the referrer's wallet address
   */
  async validateReferralCode(referralCode: string): Promise<string | null> {
    const codeRecord = await ReferralCodeModel.findOne({
      referralCode: { $regex: new RegExp(`^${referralCode}$`, 'i') }, // Case-insensitive
      isActive: true
    }).lean();

    if (!codeRecord) {
      return null;
    }

    // Check content filter on validation, just in case a code was created before the filter was in place
    if (!(await ContentFilterService.isReferralCodeAcceptable(referralCode))) {
      console.warn(`Attempt to use unacceptable referral code "${referralCode}".`);
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
    referralCode: string
  ): Promise<IReferral> {
    try {
      // Try to use transactions if available (replica set)
      const session = await mongoose.startSession();

      try {
        const result = await session.withTransaction(async () => {
          // Check if referree has already been referred (atomic within transaction)
          const existingReferral = await ReferralModel.findOne({ referreeAddress }).session(session);
          if (existingReferral) {
            throw ApiError.conflict('User has already been referred');
          }

          // Validate referral code
          const validReferrer = await this.validateReferralCode(referralCode);
          if (!validReferrer || validReferrer !== referrerAddress) {
            throw ApiError.badRequest('Invalid referral code');
          }

          // Prevent self-referral
          if (referrerAddress === referreeAddress) {
            throw ApiError.conflict('Cannot refer yourself');
          }

          // Create referral record (atomic within transaction)
          const referral = await ReferralModel.create([{
            referrerAddress,
            referreeAddress
          }], { session });


          return referral[0];
        });


        return result;

      } finally {
        await session.endSession();
      }

    } catch (error: any) {
      return await handleTransactionError(
        error,
        () => this.createReferralWithoutTransaction(
          referrerAddress,
          referreeAddress,
          referralCode
        )
      );
    }
  }

  /**
   * Fallback method for creating referrals without transactions (for standalone MongoDB)
   */
  private async createReferralWithoutTransaction(
    referrerAddress: string,
    referreeAddress: string,
    referralCode: string
  ): Promise<IReferral> {
    // Check if referree has already been referred
    const existingReferral = await ReferralModel.findOne({ referreeAddress });
    if (existingReferral) {
      throw ApiError.conflict('User has already been referred');
    }

    // Validate referral code
    const validReferrer = await this.validateReferralCode(referralCode);
    if (!validReferrer || validReferrer !== referrerAddress) {
      throw ApiError.badRequest('Invalid referral code');
    }

    // Prevent self-referral
    if (referrerAddress === referreeAddress) {
      throw ApiError.conflict('Cannot refer yourself');
    }

    // Create referral record
    const referral = await ReferralModel.create({
      referrerAddress,
      referreeAddress
    });


    return referral;
  }

  /**
   * Get referral statistics for a wallet
   */
  async getReferralStats(walletAddress: string): Promise<{
    referralInfo: (IReferralCode & { totalReferrals: number }) | null;
    referrals: IReferral[];
  }> {
    const [referralCode, referrals] = await Promise.all([
      this.getReferralCode(walletAddress),
      ReferralModel.find({
        referrerAddress: walletAddress
      }).sort({ createdAt: -1 })
    ]);

    if (!referralCode) {
      return {
        referralInfo: null,
        referrals
      };
    }

    // Calculate total referrals from actual referral records
    const totalReferrals = await ReferralModel.countDocuments({
      referrerAddress: walletAddress
    });

    const referralInfo: IReferralCode & { totalReferrals: number } = {
      ...referralCode,
      totalReferrals
    };

    return {
      referralInfo,
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
  async getReferrer(walletAddress: string): Promise<{ walletAddress: string; referralCode: string | null } | null> {
    const referral = await ReferralModel.findOne({ referreeAddress: walletAddress });
    if (!referral) {
      return null;
    }

    const referrerCodeDoc = await this.getReferralCode(referral.referrerAddress);

    return {
      walletAddress: referral.referrerAddress,
      referralCode: referrerCodeDoc?.referralCode || null
    };
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