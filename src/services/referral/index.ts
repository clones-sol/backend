import crypto from 'node:crypto'
import mongoose from 'mongoose'
import {
  MAX_REFERRAL_CODE_ATTEMPTS,
  REFERRAL_CODE_CHARS,
  REFERRAL_CODE_LENGTH
} from '../../constants/referral.ts'
import { ApiError } from '../../middleware/types/errors.ts'
import { type IReferral, ReferralModel } from '../../models/Referral.ts'
import { type IReferralCode, ReferralCodeModel } from '../../models/ReferralCode.ts'
import { ContentFilterService } from '../validation/contentFilter.ts'
import { ReferralCleanupService } from './cleanupService.ts'
import { logger } from "../logger.ts"

export class ReferralService {
  private cleanupService: ReferralCleanupService

  constructor() {
    this.cleanupService = new ReferralCleanupService()
  }

  /**
   * Generate a unique referral code for a wallet address
   */
  async generateReferralCode(
    walletAddress: string
  ): Promise<{ referralCode: string; createdAt: Date }> {
    // Check if user already has a referral code
    const existingCode = await ReferralCodeModel.findOne({ walletAddress })
    if (existingCode) {
      return {
        referralCode: existingCode.referralCode,
        createdAt: existingCode.createdAt
      }
    }

    // Generate a unique 6-character alphanumeric referral code with collision handling
    const maxRetries = MAX_REFERRAL_CODE_ATTEMPTS
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Generate 6-character alphanumeric code (uppercase letters and numbers)
        // Excluding visually similar characters: O, 0, L, 1, I to avoid human transcription errors
        const chars = REFERRAL_CODE_CHARS
        let referralCode = ''
        const randomBytes = crypto.randomBytes(REFERRAL_CODE_LENGTH)
        for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
          referralCode += chars.charAt(randomBytes[i] % chars.length)
        }

        // Validate the generated code against the content filter
        if (!(await ContentFilterService.isReferralCodeAcceptable(referralCode))) {
          logger.warn(`Generated referral code "${referralCode}" is not acceptable. Retrying...`)
          lastError = new Error('Generated code failed content filter.')
          continue // Retry with a new code
        }

        // Attempt to create the referral code record
        // This will fail with a duplicate key error if the code already exists
        const newCode = await ReferralCodeModel.create({
          walletAddress,
          referralCode,
          isActive: true,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 365 days from now (1 year)
        })

        // If we get here, the code was successfully created
        return {
          referralCode: newCode.referralCode,
          createdAt: newCode.createdAt
        }
      } catch (error: any) {
        lastError = error

        // Check if this is a duplicate key error (MongoDB error code 11000)
        if (error.code === 11000) {
          // Check if it's a duplicate wallet address (user already has a code)
          if (error.keyPattern?.walletAddress) {
            // User already has a referral code, fetch and return it
            const existingCode = await ReferralCodeModel.findOne({
              walletAddress
            })
            if (existingCode) {
              return {
                referralCode: existingCode.referralCode,
                createdAt: existingCode.createdAt
              }
            }
          }

          // This is a collision - the generated code already exists
          // We'll retry with a new code on the next iteration
          logger.warn(`Referral code collision detected on attempt ${attempt + 1}, retrying...`)
          continue
        }

        // For any other error, throw it immediately
        throw error
      }
    }

    // If we've exhausted all retries, throw an error
    throw new Error(
      `Failed to generate unique referral code after ${maxRetries} attempts. Last error: ${lastError?.message}`
    )
  }

  async validateReferralCode(referralCode: string): Promise<string | null> {
    const normalizedCode = referralCode.trim().toUpperCase()

    if (!normalizedCode) {
      return null
    }

    const referralDoc = await ReferralCodeModel.findOne({ referralCode: normalizedCode, isActive: true }).exec()

    if (!referralDoc) {
      return null
    }

    if (referralDoc.expiresAt && referralDoc.expiresAt.getTime() < Date.now()) {
      return null
    }

    return referralDoc.walletAddress
  }

  /**
   * Get referral code for a wallet address
   */
  async getReferralCode(walletAddress: string): Promise<IReferralCode | null> {
    const doc = await ReferralCodeModel.findOne({ walletAddress, isActive: true }).exec()
    if (!doc) return null

    return doc.toJSON() as IReferralCode
  }

  /**
   * Create a referral relationship when a user performs their first action
   */
  async createReferral(
    referrerAddress: string,
    referreeAddress: string,
    referralCode: string
  ): Promise<IReferral> {
    if (referrerAddress === referreeAddress) {
      throw ApiError.badRequest('You cannot refer yourself.')
    }

    // Validate referral code
    const validReferrer = await this.validateReferralCode(referralCode)
    if (!validReferrer || validReferrer !== referrerAddress) {
      throw ApiError.badRequest('Invalid or expired referral code.')
    }

    try {
      // Try to use transactions if available (replica set or mongos)
      const session = await mongoose.startSession()

      try {
        const result = await session.withTransaction(async () => {
          // Create referral relationship within transaction
          const referral = await ReferralModel.create([{ referrerAddress, referreeAddress }], {
            session
          })
          return referral[0]
        })

        return result
      } finally {
        await session.endSession()
      }
    } catch (error: any) {
      // Handle transaction not supported (standalone MongoDB)
      if (error.message?.includes('Transaction numbers are only allowed')) {
        try {
          // Fallback to direct creation without transaction
          const referral = await ReferralModel.create({
            referrerAddress,
            referreeAddress
          })
          return referral
        } catch (fallbackError: any) {
          if (fallbackError.code === 11000) {
            throw ApiError.badRequest('This wallet has already been referred.')
          }
          throw fallbackError
        }
      }

      // Handle duplicate key error from transaction
      if (error.code === 11000) {
        throw ApiError.badRequest('This wallet has already been referred.')
      }

      throw error
    }
  }

  /**
   * Get referral statistics for a wallet
   */
  async getReferralStats(walletAddress: string): Promise<{
    referralInfo: (IReferralCode & { totalReferrals: number; totalRewards: number }) | null
    referrals: IReferral[]
  }> {
    const [referralCode, referrals] = await Promise.all([
      this.getReferralCode(walletAddress),
      ReferralModel.find({
        referrerAddress: walletAddress
      }).sort({ createdAt: -1 })
    ])

    if (!referralCode) {
      return {
        referralInfo: null,
        referrals
      }
    }

    // Calculate total referrals from actual referral records
    const totalReferrals = await ReferralModel.countDocuments({
      referrerAddress: walletAddress
    })

    // Calculate total rewards by analyzing DemonstrationSubmission table
    // Sum up amounts from referrals array where address matches walletAddress (case-insensitive)
    // Group by token and convert to USD
    const { DemonstrationSubmission } = await import('../../models/DemonstrationSubmission.ts')
    const BlockchainService = (await import('../blockchain/index.ts')).default
    const normalizedWalletAddress = walletAddress.toLowerCase()

    const rewardsByTokenResult = await DemonstrationSubmission.aggregate([
      // Early filtering to reduce document set - check both original and lowercase versions
      {
        $match: {
          'claimAuthorization.referrals': { 
            $exists: true, 
            $ne: [],
            $elemMatch: {
              address: { 
                $in: [walletAddress, walletAddress.toLowerCase(), walletAddress.toUpperCase()] 
              }
            }
          }
        }
      },
      {
        $unwind: '$claimAuthorization.referrals'
      },
      {
        $addFields: {
          'claimAuthorization.referrals.addressLower': {
            $toLower: '$claimAuthorization.referrals.address'
          }
        }
      },
      {
        $match: {
          'claimAuthorization.referrals.addressLower': normalizedWalletAddress
        }
      },
      // Join with Factory collection to get token information
      {
        $lookup: {
          from: 'factories',
          localField: 'meta.quest.pool_id',
          foreignField: '_id',
          as: 'factory'
        }
      },
      {
        $unwind: {
          path: '$factory',
          preserveNullAndEmptyArrays: true
        }
      },
      // Group by token symbol and sum amounts
      {
        $group: {
          _id: '$factory.token.symbol',
          totalAmount: { $sum: '$claimAuthorization.referrals.amount' }
        }
      }
    ])

    // Convert each token amount to USD and sum - fetch prices in parallel
    let totalRewards = 0
    const validTokenRewards = rewardsByTokenResult.filter(
      tokenReward => tokenReward._id && tokenReward.totalAmount
    )

    if (validTokenRewards.length > 0) {
      const pricePromises = validTokenRewards.map(tokenReward => 
        BlockchainService.getTokenPriceUSD(tokenReward._id)
      )

      const priceResults = await Promise.allSettled(pricePromises)
      
      for (let i = 0; i < validTokenRewards.length; i++) {
        const tokenReward = validTokenRewards[i]
        const priceResult = priceResults[i]
        
        if (priceResult.status === 'fulfilled') {
          const amount = parseFloat(tokenReward.totalAmount.toString())
          totalRewards += amount * priceResult.value
        } else {
          logger.warn(`Failed to get price for token ${tokenReward._id}: ${priceResult.reason?.message || 'Unknown error'}`)
        }
      }
    }

    const referralInfo: IReferralCode & { totalReferrals: number; totalRewards: number } = {
      ...referralCode,
      totalReferrals,
      totalRewards
    }

    return {
      referralInfo,
      referrals
    }
  }

  /**
   * Check if a wallet has been referred
   */
  async hasBeenReferred(walletAddress: string): Promise<boolean> {
    const referral = await ReferralModel.findOne({
      referreeAddress: walletAddress
    })
    return !!referral
  }

  /**
   * Get referrer for a wallet
   */
  async getReferrer(
    walletAddress: string
  ): Promise<{ walletAddress: string; referralCode: string | null } | null> {
    const referral = await ReferralModel.findOne({
      referreeAddress: walletAddress
    })
    if (!referral) {
      return null
    }

    const referrerCodeDoc = await this.getReferralCode(referral.referrerAddress)

    return {
      walletAddress: referral.referrerAddress,
      referralCode: referrerCodeDoc?.referralCode || null
    }
  }

  /**
   * Cleanup methods
   */
  async cleanupExpiredCodes(): Promise<number> {
    return await this.cleanupService.cleanupExpiredCodes()
  }

  async getCleanupStats() {
    return await this.cleanupService.getExpiredCodeStats()
  }

  async extendExpiration(walletAddress: string, extensionDays: number = 30): Promise<boolean> {
    return await this.cleanupService.extendExpiration(walletAddress, extensionDays)
  }

  async regenerateExpiredCode(walletAddress: string): Promise<string | null> {
    return await this.cleanupService.regenerateExpiredCode(walletAddress)
  }
}

export const referralService = new ReferralService()
