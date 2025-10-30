import { ethers } from 'ethers'
import { getTokenContractAddress } from '../blockchain/tokens.ts'
import BlockchainService from '../blockchain/index.ts'
import { logger } from "../logger.ts"

/**
 * Commission Tier Service
 * 
 * Manages commission percentages based on $CLONES token holdings.
 * Commission ranges from 1% to 5% based on amount of $CLONES tokens held in wallet.
 * 
 * Queries the blockchain directly to get actual token balances.
 */

export interface CommissionTier {
  minHoldingAmount: number // $CLONES tokens held in wallet
  maxHoldingAmount: number | null // null = unlimited
  commissionBps: number // basis points (100 = 1%)
  tierName: string
}

// Commission tiers based on $CLONES token holdings in wallet
// Total Supply: 1,000,000,000 $CLONES - tiers based on supply percentage
export const COMMISSION_TIERS: CommissionTier[] = [
  { minHoldingAmount: 1000000, maxHoldingAmount: 1999999, commissionBps: 100, tierName: 'Tier 1' }, // 1% - 0.1% supply (1M tokens)
  { minHoldingAmount: 2000000, maxHoldingAmount: 2999999, commissionBps: 200, tierName: 'Tier 2' }, // 2% - 0.2% supply (2M tokens)
  { minHoldingAmount: 3000000, maxHoldingAmount: 3999999, commissionBps: 300, tierName: 'Tier 3' }, // 3% - 0.3% supply (3M tokens)
  { minHoldingAmount: 4000000, maxHoldingAmount: 4999999, commissionBps: 400, tierName: 'Tier 4' }, // 4% - 0.4% supply (4M tokens)
  { minHoldingAmount: 5000000, maxHoldingAmount: null, commissionBps: 500, tierName: 'Tier 5' } // 5% - 0.5%+ supply (5M+ tokens)
]

export class CommissionTierService {
  private blockchainService: BlockchainService
  private clonesTokenAddress: string

  constructor(rpcUrl: string) {
    this.blockchainService = new BlockchainService(rpcUrl)
    this.clonesTokenAddress = getTokenContractAddress('CLONES')
  }

  /**
   * Get commission tier for a user based on their $CLONES token holdings
   * Returns Tier 0 if user doesn't hold enough tokens for any tier
   */
  async getCommissionTier(userAddress: string): Promise<CommissionTier> {
    const holdingAmount = await this.getClonesBalance(userAddress)

    for (const tier of COMMISSION_TIERS) {
      const minMet = holdingAmount >= tier.minHoldingAmount
      const maxMet = tier.maxHoldingAmount === null || holdingAmount <= tier.maxHoldingAmount

      if (minMet && maxMet) {
        return tier
      }
    }

    // Return Tier 0 if user doesn't hold enough tokens for any tier
    return {
      minHoldingAmount: 0,
      maxHoldingAmount: 999999, // Less than 1M tokens
      commissionBps: 0, // 0% commission
      tierName: 'Tier 0'
    }
  }


  /**
   * Get commission percentage (0-5%) for a user
   * Returns 0 if user doesn't hold enough tokens for any tier
   */
  async getCommissionPercentage(userAddress: string): Promise<number> {
    const tier = await this.getCommissionTier(userAddress)
    return tier.commissionBps / 100 // Convert basis points to percentage
  }

  /**
   * Get complete tier information for a user including balance and tier details
   * Returns Tier 0 info if user doesn't hold enough tokens for any tier
   * 
   * @param userAddress - User's wallet address
   * @returns Complete tier information for UI display
   */
  async getUserTierInfo(userAddress: string): Promise<{
    tierName: string
    tierCode: string // Simple code like "T0", "T1", "T2", etc.
    commissionPercentage: number
    clonesBalance: number
    minHolding: number
    maxHolding: number | null
    nextTierMinHolding?: number
  }> {
    const balance = await this.getClonesBalance(userAddress)
    const tier = await this.getCommissionTier(userAddress)

    // Find next tier for progression info
    let nextTier: CommissionTier | undefined

    if (tier.tierName === 'Tier 0') {
      // For Tier 0, next tier is always Tier 1 (first in COMMISSION_TIERS)
      nextTier = COMMISSION_TIERS[0]
    } else {
      // For other tiers, find the next one in the array
      const currentTierIndex = COMMISSION_TIERS.findIndex(t => t.tierName === tier.tierName)
      nextTier = currentTierIndex < COMMISSION_TIERS.length - 1 ? COMMISSION_TIERS[currentTierIndex + 1] : undefined
    }

    return {
      tierName: tier.tierName,
      tierCode: tier.tierName.replace('Tier ', 'T'), // "Tier 1" -> "T1", "Tier 0" -> "T0"
      commissionPercentage: tier.commissionBps / 100,
      clonesBalance: balance,
      minHolding: tier.minHoldingAmount,
      maxHolding: tier.maxHoldingAmount,
      nextTierMinHolding: nextTier?.minHoldingAmount
    }
  }

  /**
   * Calculate referral rewards based on farmer's total reward and commission tiers
   * Platform fee adjusts dynamically: baseFee(10%) - total commissions
   * 
   * @param farmerReward - Total reward amount earned by the farmer
   * @param farmerReferrer - Address of farmer's referrer (optional)
   * @param factoryReferrer - Address of factory creator's referrer (optional)
   * @returns Distribution: referrer rewards and remaining platform fee
   */
  async calculateReferralDistribution(
    farmerReward: number,
    farmerReferrer?: string,
    factoryReferrer?: string
  ): Promise<{
    farmerReferrerReward: number
    factoryReferrerReward: number
    protocolKeeps: number
  }> {
    let farmerReferrerReward = 0
    let factoryReferrerReward = 0

    // Calculate farmer referrer commission (% of farmer's total reward)
    if (farmerReferrer) {
      const farmerCommissionPct = await this.getCommissionPercentage(farmerReferrer)
      farmerReferrerReward = (farmerReward * farmerCommissionPct) / 100
    }

    // Calculate factory referrer commission (% of farmer's total reward)
    if (factoryReferrer) {
      const factoryCommissionPct = await this.getCommissionPercentage(factoryReferrer)
      factoryReferrerReward = (farmerReward * factoryCommissionPct) / 100
    }

    // Total commissions paid to referrers
    const totalReferrerRewards = farmerReferrerReward + factoryReferrerReward

    // Platform fee = base fee (10% of farmer reward) - total commissions
    const basePlatformFee = (farmerReward * 10) / 100 // 10% base platform fee
    const protocolKeeps = basePlatformFee - totalReferrerRewards

    // Ensure protocol keeps is not negative (safety check - should never happen with max 5% tiers)
    if (protocolKeeps < 0) {
      logger.warn(`Protocol keeps negative: ${protocolKeeps}. Total commissions: ${totalReferrerRewards}, Base fee: ${basePlatformFee}`)
    }

    return {
      farmerReferrerReward,
      factoryReferrerReward,
      protocolKeeps: Math.max(0, protocolKeeps) // Ensure non-negative
    }
  }

  /**
   * Calculate referral rewards using wei arithmetic to avoid floating point precision errors
   * 
   * @param farmerRewardWei - Total reward amount earned by the farmer (in wei)
   * @param decimals - Token decimals for conversions
   * @param farmerReferrer - Address of farmer's referrer (optional)
   * @param factoryReferrer - Address of factory creator's referrer (optional)
   * @returns Distribution with wei amounts for precise calculations
   */
  async calculateReferralDistributionWei(
    farmerRewardWei: bigint,
    decimals: number,
    farmerReferrer?: string,
    factoryReferrer?: string
  ): Promise<{
    farmerReferrerRewardWei: bigint
    factoryReferrerRewardWei: bigint
    protocolKeepsWei: bigint
  }> {
    let farmerReferrerRewardWei = 0n
    let factoryReferrerRewardWei = 0n

    // Calculate farmer referrer commission (% of farmer's total reward in wei)
    if (farmerReferrer) {
      const farmerCommissionPct = await this.getCommissionPercentage(farmerReferrer)
      if (farmerCommissionPct > 0) {
        farmerReferrerRewardWei = (farmerRewardWei * BigInt(Math.round(farmerCommissionPct * 100))) / 10000n
      }
    }

    // Calculate factory referrer commission (% of farmer's total reward in wei)
    if (factoryReferrer) {
      const factoryCommissionPct = await this.getCommissionPercentage(factoryReferrer)
      if (factoryCommissionPct > 0) {
        factoryReferrerRewardWei = (farmerRewardWei * BigInt(Math.round(factoryCommissionPct * 100))) / 10000n
      }
    }

    // Total commissions paid to referrers (in wei)
    const totalReferrerRewardsWei = farmerReferrerRewardWei + factoryReferrerRewardWei

    // Platform fee = base fee (10% of farmer reward) - total commissions (in wei)
    const basePlatformFeeWei = (farmerRewardWei * 1000n) / 10000n // 10% base platform fee
    const protocolKeepsWei = basePlatformFeeWei - totalReferrerRewardsWei

    // Safety check - should never happen with max 5% tiers
    if (protocolKeepsWei < 0n) {
      const totalCommissionsTokens = parseFloat(ethers.formatUnits(totalReferrerRewardsWei, decimals))
      const baseFeeTokens = parseFloat(ethers.formatUnits(basePlatformFeeWei, decimals))
      logger.warn(`Protocol keeps negative: ${protocolKeepsWei}. Total commissions: ${totalCommissionsTokens}, Base fee: ${baseFeeTokens}`)
    }

    return {
      farmerReferrerRewardWei,
      factoryReferrerRewardWei,
      protocolKeepsWei: protocolKeepsWei > 0n ? protocolKeepsWei : 0n // Ensure non-negative
    }
  }

  /**
   * Get user's $CLONES token balance from their wallet
   * 
   * Uses the existing blockchain service with token cache
   */
  private async getClonesBalance(userAddress: string): Promise<number> {
    try {
      if (!ethers.isAddress(userAddress)) {
        logger.warn(`Invalid address for CLONES balance query: ${userAddress}`)
        return 0
      }

      // Use existing blockchain service with token cache
      const balanceFormatted = await this.blockchainService.getTokenBalance(
        this.clonesTokenAddress,
        userAddress
      )

      logger.info(`CLONES holdings for ${userAddress}: ${balanceFormatted} tokens (tier: ${this.getCommissionPercentageFromAmount(balanceFormatted)}%)`)
      return balanceFormatted

    } catch (error) {
      logger.error(`Failed to fetch CLONES balance for ${userAddress}:`, error)
      // Return 0 on error to default to minimum commission (Tier 1)
      return 0
    }
  }

  /**
   * Helper function to get commission percentage from holdings amount (for logging)
   */
  private getCommissionPercentageFromAmount(amount: number): number {
    for (const tier of COMMISSION_TIERS) {
      const minMet = amount >= tier.minHoldingAmount
      const maxMet = tier.maxHoldingAmount === null || amount <= tier.maxHoldingAmount

      if (minMet && maxMet) {
        return tier.commissionBps / 100
      }
    }
    return 0 // Default to 0% if no tier qualifies
  }
}

// Factory function
export function createCommissionTierService(): CommissionTierService {
  const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org'
  return new CommissionTierService(rpcUrl)
}

export default CommissionTierService