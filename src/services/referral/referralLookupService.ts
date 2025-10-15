import { ReferralModel } from '../../models/Models.ts'
import { FactoryModel } from '../../models/Factory.ts'

export interface ReferralInfo {
  farmerReferrer?: string
  factoryReferrer?: string
}

/**
 * Referral Lookup Service
 * 
 * Efficiently retrieves referral information for farmers and factory creators.
 * Used during reward processing to determine referral commissions.
 */
export class ReferralLookupService {

  /**
   * Get complete referral information for a demonstration submission
   * 
   * @param farmerAddress - Address of the farmer who submitted the demo
   * @param factoryId - Factory ID where the demo was submitted
   * @returns Referral addresses for both farmer and factory creator
   */
  async getReferralInfo(farmerAddress: string, factoryId: string): Promise<ReferralInfo> {
    // Execute both queries in parallel for better performance
    const [farmerReferral, factory] = await Promise.all([
      this.getFarmerReferrer(farmerAddress),
      this.getFactoryWithReferrer(factoryId)
    ])

    return {
      farmerReferrer: farmerReferral,
      factoryReferrer: factory?.referrerAddress
    }
  }

  /**
   * Get farmer's referrer address
   * 
   * @param farmerAddress - Address of the farmer
   * @returns Referrer address or undefined if not referred
   */
  async getFarmerReferrer(farmerAddress: string): Promise<string | undefined> {
    const referral = await ReferralModel.findOne({
      referreeAddress: { $regex: new RegExp(`^${farmerAddress}$`, 'i') }
    }).lean()

    return referral?.referrerAddress
  }

  /**
   * Get factory with referrer information
   * 
   * @param factoryId - Factory ID
   * @returns Factory with referrer info or null if not found
   */
  async getFactoryWithReferrer(factoryId: string): Promise<{ referrerAddress?: string } | null> {
    const factory = await FactoryModel.findById(factoryId)
      .select('referrerAddress')
      .lean()

    return factory
  }

  /**
   * Check if an address has any referrals (either as farmer or factory creator)
   * Useful for optimization - skip referral processing if no referrals exist
   * 
   * @param farmerAddress - Address to check
   * @param factoryId - Factory ID to check
   * @returns True if any referrals exist
   */
  async hasAnyReferrals(farmerAddress: string, factoryId: string): Promise<boolean> {
    const [farmerHasReferrer, factoryHasReferrer] = await Promise.all([
      ReferralModel.exists({ referreeAddress: { $regex: new RegExp(`^${farmerAddress}$`, 'i') } }),
      FactoryModel.exists({ _id: factoryId, referrerAddress: { $exists: true, $ne: null } })
    ])

    return !!(farmerHasReferrer || factoryHasReferrer)
  }

  /**
   * Batch lookup for multiple farmer addresses
   * Useful for processing multiple submissions efficiently
   * 
   * @param farmerAddresses - Array of farmer addresses
   * @returns Map of farmer address to referrer address
   */
  async batchGetFarmerReferrers(farmerAddresses: string[]): Promise<Map<string, string>> {
    // Create case-insensitive regex for each address
    const addressRegexes = farmerAddresses.map(addr => new RegExp(`^${addr}$`, 'i'))
    
    const referrals = await ReferralModel.find({
      referreeAddress: { $in: addressRegexes }
    }).lean()

    const referrerMap = new Map<string, string>()
    
    for (const referral of referrals) {
      // Find the original address from the input array that matches
      const matchingAddress = farmerAddresses.find(addr => 
        addr.toLowerCase() === referral.referreeAddress.toLowerCase()
      )
      if (matchingAddress) {
        referrerMap.set(matchingAddress, referral.referrerAddress)
      }
    }

    return referrerMap
  }
}

// Factory function
export function createReferralLookupService(): ReferralLookupService {
  return new ReferralLookupService()
}

export default ReferralLookupService