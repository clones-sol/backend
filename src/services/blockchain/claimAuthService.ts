import { ethers } from 'ethers'
import { ApiError } from '../../middleware/types/errors.ts'
import { validatePrivateKey } from '../../utils/addressValidation.js'
import { tokenCache } from '../../utils/tokenCache.js'
import { createCommissionTierService } from '../referral/commissionTierService.ts'

/**
 * Service for generating EIP-712 claim authorization signatures
 * Generates signatures that can be used directly with RewardPoolImplementation.payWithSig()
 * Supports publisher rotation with graceful fallback during transition periods
 * NO DATABASE STORAGE - signatures are returned directly to frontend
 */
class ClaimAuthService {
  private currentPublisher: ethers.Wallet
  private oldPublisher: ethers.Wallet | null = null
  private provider: ethers.JsonRpcProvider
  private chainId: Promise<number>
  private factoryAddress: string

  constructor(
    rpcUrl: string,
    publisherPrivateKey: string,
    factoryAddress: string,
    oldPublisherPrivateKey?: string
  ) {
    if (!publisherPrivateKey) {
      throw ApiError.internalError(
        'PUBLISHER_PRIVATE_KEY is required for claim authorization signatures'
      )
    }

    // Validate private key format
    validatePrivateKey(publisherPrivateKey, 'PUBLISHER_PRIVATE_KEY')
    if (oldPublisherPrivateKey) {
      validatePrivateKey(oldPublisherPrivateKey, 'OLD_PUBLISHER_PRIVATE_KEY')
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl)
    this.currentPublisher = new ethers.Wallet(publisherPrivateKey, this.provider)
    this.factoryAddress = factoryAddress
    this.chainId = this.provider.getNetwork().then((network) => Number(network.chainId))

    // Support for old publisher during rotation grace period
    if (oldPublisherPrivateKey) {
      this.oldPublisher = new ethers.Wallet(oldPublisherPrivateKey, this.provider)
    }
  }

  /**
   * Get publisher info from factory contract to determine which publisher to use
   */
  private async getPublisherInfo(): Promise<{
    current: string
    old: string
    graceEnd: number
    isInGracePeriod: boolean
  }> {
    const factory = new ethers.Contract(
      this.factoryAddress,
      [
        'function getPublisherInfo() external view returns (address current, address old, uint256 graceEnd)'
      ],
      this.provider
    )

    const [current, old, graceEnd] = await factory.getPublisherInfo()
    const now = Math.floor(Date.now() / 1000)
    const isInGracePeriod = graceEnd > 0 && now < graceEnd

    return {
      current,
      old,
      graceEnd: Number(graceEnd),
      isInGracePeriod
    }
  }

  /**
   * Query already claimed amount from the smart contract
   * Returns both wei (bigint) and human-readable amount
   */
  async getAlreadyClaimedAmount(poolAddress: string, userAddress: string): Promise<{
    alreadyClaimedWei: bigint
    alreadyClaimedTokens: number
    decimals: number
    tokenAddress: string
  }> {
    try {
      const poolContract = new ethers.Contract(
        poolAddress,
        [
          'function alreadyClaimed(address) external view returns (uint256)',
          'function token() external view returns (address)'
        ],
        this.provider
      )

      const [alreadyClaimedWei, tokenAddress] = await Promise.all([
        poolContract.alreadyClaimed(userAddress),
        poolContract.token()
      ])

      // Get token decimals from cache
      const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider)
      const alreadyClaimedTokens = parseFloat(ethers.formatUnits(alreadyClaimedWei, metadata.decimals))

      console.log(`User ${userAddress} already claimed: ${alreadyClaimedTokens} tokens (${alreadyClaimedWei} wei)`)

      return {
        alreadyClaimedWei: BigInt(alreadyClaimedWei),
        alreadyClaimedTokens,
        decimals: metadata.decimals,
        tokenAddress
      }
    } catch (error) {
      console.error('Error querying already claimed amount:', error)
      throw ApiError.internalError(
        `Failed to query already claimed amount from smart contract: ${error instanceof Error ? error.message : 'Unknown error'}. Cannot authorize claim without verifying existing claims.`
      )
    }
  }

  /**
   * Query current nonce for replay protection
   */
  async getCurrentNonce(poolAddress: string, userAddress: string): Promise<number> {
    try {
      const poolContract = new ethers.Contract(
        poolAddress,
        ['function claimNonce(address) external view returns (uint256)'],
        this.provider
      )

      const nonce = await poolContract.claimNonce(userAddress)
      console.log(`User ${userAddress} current nonce: ${nonce}`)
      return Number(nonce)
    } catch (error) {
      console.error('Error querying nonce:', error)
      throw ApiError.internalError(
        `Failed to query nonce from smart contract: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Generate EIP-712 signature for payWithSig() smart contract function
   * Returns signature data that can be used directly with RewardPoolImplementation
   *
   * IMPORTANT: This function queries the smart contract for already claimed amounts
   * and calculates the new cumulative amount by adding the individual reward
   *
   * @param poolAddress - Address of the reward pool contract
   * @param farmerAddress - Address of the farmer to authorize
   * @param individualReward - Individual reward amount to add to already claimed
   * @param farmerReferrer - Optional farmer referrer address
   * @param factoryReferrer - Optional factory creator referrer address
   * @returns Signature data ready for smart contract interaction
   */
  async generateClaimAuthorization(
    poolAddress: string,
    farmerAddress: string,
    individualReward: number,
    farmerReferrer?: string,
    factoryReferrer?: string
  ): Promise<{
    // Smart contract parameters
    account: string
    cumulativeAmount: string
    nonce: number
    signature: string
    // Additional context
    publisherUsed: string
    poolAddress: string
    tokenAddress: string
    alreadyClaimed: number
    newClaimableAmount: number
    feePercentage?: number
    // Referral data
    referrals?: Array<{
      address: string
      amount: number
      type: 'farmer_referrer' | 'factory_referrer'
    }>
  }> {
    // Get publisher info to determine which signer to use
    const publisherInfo = await this.getPublisherInfo()
    console.log('Publisher info:', publisherInfo)

    // Select the appropriate publisher for signing
    let signerWallet: ethers.Wallet
    let publisherUsed: string
    console.log('Old publisher:', this.oldPublisher)
    console.log('Current publisher:', this.currentPublisher)

    if (publisherInfo.isInGracePeriod && this.oldPublisher) {
      // During grace period, prefer old publisher if available
      if (this.oldPublisher.address.toLowerCase() === publisherInfo.old.toLowerCase()) {
        signerWallet = this.oldPublisher
        publisherUsed = publisherInfo.old
      } else {
        // Fallback to current publisher
        signerWallet = this.currentPublisher
        publisherUsed = publisherInfo.current
      }
    } else {
      // Use current publisher (normal operation)
      signerWallet = this.currentPublisher
      publisherUsed = publisherInfo.current
    }

    // Validate that we have the correct private key
    console.log('Signer wallet:', signerWallet)
    console.log('Publisher used:', publisherUsed)
    if (signerWallet.address.toLowerCase() !== publisherUsed.toLowerCase()) {
      throw ApiError.internalError(
        `Publisher key mismatch. Expected ${publisherUsed}, got ${signerWallet.address}`
      )
    }

    console.log(
      `Using publisher ${publisherUsed} for signing (grace period: ${publisherInfo.isInGracePeriod})`
    )

    // Query already claimed amount and current nonce from smart contract (source of truth)
    const [claimedInfo, currentNonce] = await Promise.all([
      this.getAlreadyClaimedAmount(poolAddress, farmerAddress),
      this.getCurrentNonce(poolAddress, farmerAddress)
    ])

    const { alreadyClaimedWei, alreadyClaimedTokens, decimals, tokenAddress } = claimedInfo

    // Validate individual reward
    if (individualReward <= 0) {
      throw ApiError.badRequest(`Invalid individual reward: ${individualReward}. Must be positive.`)
    }

    // Convert individual reward to wei (working in wei prevents precision errors)
    const individualRewardWei = ethers.parseUnits(individualReward.toString(), decimals)

    // Calculate new cumulative amount in wei (BigInt arithmetic - no precision loss)
    const newCumulativeAmountWei = alreadyClaimedWei + individualRewardWei

    // Convert back to tokens for display/validation
    const newCumulativeAmountTokens = parseFloat(ethers.formatUnits(newCumulativeAmountWei, decimals))

    // Validate new cumulative amount is greater than already claimed
    if (newCumulativeAmountWei <= alreadyClaimedWei) {
      throw ApiError.badRequest(
        `New cumulative amount (${newCumulativeAmountTokens}) must be greater than already claimed (${alreadyClaimedTokens})`
      )
    }

    const newClaimableAmount = individualReward // This transaction's claimable amount

    // Calculate referral rewards if referrers exist
    let referrals: Array<{ address: string, amount: number, type: 'farmer_referrer' | 'factory_referrer' }> = []
    console.log('referrals:', referrals)

    console.log('farmerReferrer:', farmerReferrer)
    console.log('factoryReferrer:', factoryReferrer)
    if (farmerReferrer || factoryReferrer) {
      const commissionService = createCommissionTierService()

      // Use wei calculations to avoid floating point precision errors
      const distribution = await commissionService.calculateReferralDistributionWei(
        individualRewardWei,
        decimals,
        farmerReferrer,
        factoryReferrer
      )
      console.log('distribution:', distribution)

      // Add farmer referrer reward if exists
      if (farmerReferrer && distribution.farmerReferrerRewardWei > 0n) {
        const amount = parseFloat(ethers.formatUnits(distribution.farmerReferrerRewardWei, decimals))
        referrals.push({
          address: farmerReferrer,
          amount: amount,
          type: 'farmer_referrer'
        })
      }

      // Add factory referrer reward if exists  
      if (factoryReferrer && distribution.factoryReferrerRewardWei > 0n) {
        const amount = parseFloat(ethers.formatUnits(distribution.factoryReferrerRewardWei, decimals))
        referrals.push({
          address: factoryReferrer,
          amount: amount,
          type: 'factory_referrer'
        })
      }
    }

    console.log(
      `Generating signature: alreadyClaimed=${alreadyClaimedTokens}, individualReward=${individualReward}, newCumulative=${newCumulativeAmountTokens}, nonce=${currentNonce}`
    )
    console.log(
      `Wei values: alreadyClaimedWei=${alreadyClaimedWei}, individualRewardWei=${individualRewardWei}, newCumulativeWei=${newCumulativeAmountWei}`
    )
    console.log(`Referrals:`, referrals)

    // EIP-712 domain - must match RewardPoolImplementation contract
    const domain = {
      name: 'FactoryVault',
      version: '1',
      chainId: await this.chainId,
      verifyingContract: poolAddress
    }

    // EIP-712 types - must match RewardPoolImplementation contract (including nonce for replay protection)
    const types = {
      Claim: [
        { name: 'account', type: 'address' },
        { name: 'cumulativeAmount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }
      ]
    }

    // Use the precise wei value (no rounding errors)
    const cumulativeAmountWei = newCumulativeAmountWei
    console.log('Cumulative amount wei:', cumulativeAmountWei)

    const message = {
      account: farmerAddress,
      cumulativeAmount: cumulativeAmountWei,
      nonce: currentNonce
    }
    console.log('Message:', message)
    // Sign the structured data with the selected publisher
    const signature = await signerWallet.signTypedData(domain, types, message)
    console.log('Signature:', signature)
    return {
      // Smart contract parameters (exact format for payWithSig call)
      account: farmerAddress,
      cumulativeAmount: cumulativeAmountWei.toString(),
      nonce: currentNonce,
      signature,
      // Additional context for frontend
      publisherUsed,
      poolAddress,
      tokenAddress,
      alreadyClaimed: alreadyClaimedTokens,
      newClaimableAmount,
      // Referral data for multi-recipient claims
      referrals: referrals.length > 0 ? referrals : undefined
    }
  }

  /**
   * Get the current publisher address
   */
  getCurrentPublisherAddress(): string {
    return this.currentPublisher.address
  }

  /**
   * Get publisher info from factory
   */
  async getPublisherStatus(): Promise<{
    current: string
    old: string
    graceEnd: number
    isInGracePeriod: boolean
  }> {
    return await this.getPublisherInfo()
  }
}

// Factory function to create the service with environment variables
export function createClaimAuthService(): ClaimAuthService {
  const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org'
  const publisherPrivateKey = process.env.PUBLISHER_PRIVATE_KEY
  const factoryAddress = process.env.REWARD_POOL_FACTORY_ADDRESS
  const oldPublisherPrivateKey = process.env.OLD_PUBLISHER_PRIVATE_KEY // Optional during rotation

  if (!publisherPrivateKey) {
    throw ApiError.internalError('PUBLISHER_PRIVATE_KEY environment variable is required')
  }

  if (!factoryAddress) {
    throw ApiError.internalError('REWARD_POOL_FACTORY_ADDRESS environment variable is required')
  }

  return new ClaimAuthService(rpcUrl, publisherPrivateKey, factoryAddress, oldPublisherPrivateKey)
}

export default ClaimAuthService
export { ClaimAuthService }
