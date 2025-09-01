import { ethers } from 'ethers';
import { tokenCache } from '../../utils/tokenCache.js';
import { ApiError } from '../../middleware/types/errors.ts';
import { validatePrivateKey } from '../../utils/addressValidation.js';

/**
 * Service for generating EIP-712 claim authorization signatures
 * Generates signatures that can be used directly with RewardPoolImplementation.payWithSig()
 * Supports publisher rotation with graceful fallback during transition periods
 * NO DATABASE STORAGE - signatures are returned directly to frontend
 */
class ClaimAuthService {
  private currentPublisher: ethers.Wallet;
  private oldPublisher: ethers.Wallet | null = null;
  private provider: ethers.JsonRpcProvider;
  private chainId: Promise<number>;
  private factoryAddress: string;

  constructor(rpcUrl: string, publisherPrivateKey: string, factoryAddress: string, oldPublisherPrivateKey?: string) {
    if (!publisherPrivateKey) {
      throw ApiError.internalError('PUBLISHER_PRIVATE_KEY is required for claim authorization signatures');
    }

    // Validate private key format
    validatePrivateKey(publisherPrivateKey, 'PUBLISHER_PRIVATE_KEY');
    if (oldPublisherPrivateKey) {
      validatePrivateKey(oldPublisherPrivateKey, 'OLD_PUBLISHER_PRIVATE_KEY');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.currentPublisher = new ethers.Wallet(publisherPrivateKey, this.provider);
    this.factoryAddress = factoryAddress;
    this.chainId = this.provider.getNetwork().then(network => Number(network.chainId));

    // Support for old publisher during rotation grace period
    if (oldPublisherPrivateKey) {
      this.oldPublisher = new ethers.Wallet(oldPublisherPrivateKey, this.provider);
    }
  }

  /**
   * Get publisher info from factory contract to determine which publisher to use
   */
  private async getPublisherInfo(): Promise<{
    current: string;
    old: string;
    graceEnd: number;
    isInGracePeriod: boolean;
  }> {
    const factory = new ethers.Contract(this.factoryAddress, [
      'function getPublisherInfo() external view returns (address current, address old, uint256 graceEnd)'
    ], this.provider);

    const [current, old, graceEnd] = await factory.getPublisherInfo();
    const now = Math.floor(Date.now() / 1000);
    const isInGracePeriod = graceEnd > 0 && now < graceEnd;

    return {
      current,
      old,
      graceEnd: Number(graceEnd),
      isInGracePeriod
    };
  }

  /**
   * Query already claimed amount from the smart contract
   */
  async getAlreadyClaimedAmount(poolAddress: string, userAddress: string): Promise<number> {
    try {
      const poolContract = new ethers.Contract(poolAddress, [
        'function alreadyClaimed(address) external view returns (uint256)',
        'function token() external view returns (address)'
      ], this.provider);

      const [alreadyClaimedWei, tokenAddress] = await Promise.all([
        poolContract.alreadyClaimed(userAddress),
        poolContract.token()
      ]);

      // Get token decimals from cache
      const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider);
      const alreadyClaimed = parseFloat(ethers.formatUnits(alreadyClaimedWei, metadata.decimals));

      console.log(`User ${userAddress} already claimed: ${alreadyClaimed} tokens`);
      return alreadyClaimed;
    } catch (error) {
      console.error('Error querying already claimed amount:', error);
      throw ApiError.internalError(`Failed to query already claimed amount from smart contract: ${error instanceof Error ? error.message : 'Unknown error'}. Cannot authorize claim without verifying existing claims.`);
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
   * @returns Signature data ready for smart contract interaction
   */
  async generateClaimAuthorization(
    poolAddress: string,
    farmerAddress: string,
    individualReward: number
  ): Promise<{
    // Smart contract parameters
    account: string;
    cumulativeAmount: string;
    signature: string;
    // Additional context
    publisherUsed: string;
    poolAddress: string;
    tokenAddress: string;
    alreadyClaimed: number;
    newClaimableAmount: number;
  }> {
    // Get publisher info to determine which signer to use
    const publisherInfo = await this.getPublisherInfo();
    console.log('Publisher info:', publisherInfo);

    // Select the appropriate publisher for signing
    let signerWallet: ethers.Wallet;
    let publisherUsed: string;
    console.log('Old publisher:', this.oldPublisher);
    console.log('Current publisher:', this.currentPublisher);

    if (publisherInfo.isInGracePeriod && this.oldPublisher) {
      // During grace period, prefer old publisher if available
      if (this.oldPublisher.address.toLowerCase() === publisherInfo.old.toLowerCase()) {
        signerWallet = this.oldPublisher;
        publisherUsed = publisherInfo.old;
      } else {
        // Fallback to current publisher
        signerWallet = this.currentPublisher;
        publisherUsed = publisherInfo.current;
      }
    } else {
      // Use current publisher (normal operation)
      signerWallet = this.currentPublisher;
      publisherUsed = publisherInfo.current;
    }

    // Validate that we have the correct private key
    console.log('Signer wallet:', signerWallet);
    console.log('Publisher used:', publisherUsed);
    if (signerWallet.address.toLowerCase() !== publisherUsed.toLowerCase()) {
      throw ApiError.internalError(`Publisher key mismatch. Expected ${publisherUsed}, got ${signerWallet.address}`);
    }

    console.log(`Using publisher ${publisherUsed} for signing (grace period: ${publisherInfo.isInGracePeriod})`);

    // Query already claimed amount from smart contract (source of truth)
    const alreadyClaimed = await this.getAlreadyClaimedAmount(poolAddress, farmerAddress);
    
    // Calculate new cumulative amount = already claimed + individual reward
    const newCumulativeAmount = alreadyClaimed + individualReward;

    // Validate individual reward
    if (individualReward <= 0) {
      throw ApiError.badRequest(`Invalid individual reward: ${individualReward}. Must be positive.`);
    }

    // Validate new cumulative amount is greater than already claimed
    if (newCumulativeAmount <= alreadyClaimed) {
      throw ApiError.badRequest(`New cumulative amount (${newCumulativeAmount}) must be greater than already claimed (${alreadyClaimed})`);
    }

    const newClaimableAmount = individualReward; // This transaction's claimable amount
    console.log(`Generating signature: alreadyClaimed=${alreadyClaimed}, individualReward=${individualReward}, newCumulative=${newCumulativeAmount}`);


    // EIP-712 domain - must match RewardPoolImplementation contract
    const domain = {
      name: "FactoryVault",
      version: "1",
      chainId: await this.chainId,
      verifyingContract: poolAddress
    };

    // EIP-712 types - must match RewardPoolImplementation contract
    const types = {
      Claim: [
        { name: "account", type: "address" },
        { name: "cumulativeAmount", type: "uint256" }
      ]
    };

    // Get token decimals to format amount properly
    const poolContract = new ethers.Contract(poolAddress, [
      'function token() external view returns (address)'
    ], this.provider);

    const tokenAddress = await poolContract.token();
    const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider);
    console.log('Decimals:', metadata.decimals);
    const cumulativeAmountWei = ethers.parseUnits(newCumulativeAmount.toString(), metadata.decimals);
    console.log('Cumulative amount wei:', cumulativeAmountWei);

    const message = {
      account: farmerAddress,
      cumulativeAmount: cumulativeAmountWei
    };
    console.log('Message:', message);
    // Sign the structured data with the selected publisher
    const signature = await signerWallet.signTypedData(domain, types, message);
    console.log('Signature:', signature);
    return {
      // Smart contract parameters (exact format for payWithSig call)
      account: farmerAddress,
      cumulativeAmount: cumulativeAmountWei.toString(),
      signature,
      // Additional context for frontend
      publisherUsed,
      poolAddress,
      tokenAddress,
      alreadyClaimed,
      newClaimableAmount
    };
  }

  /**
   * Get the current publisher address
   */
  getCurrentPublisherAddress(): string {
    return this.currentPublisher.address;
  }

  /**
   * Get publisher info from factory
   */
  async getPublisherStatus(): Promise<{
    current: string;
    old: string;
    graceEnd: number;
    isInGracePeriod: boolean;
  }> {
    return await this.getPublisherInfo();
  }
}

// Factory function to create the service with environment variables
export function createClaimAuthService(): ClaimAuthService {
  const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org';
  const publisherPrivateKey = process.env.PUBLISHER_PRIVATE_KEY;
  const factoryAddress = process.env.REWARD_POOL_FACTORY_ADDRESS;
  const oldPublisherPrivateKey = process.env.OLD_PUBLISHER_PRIVATE_KEY; // Optional during rotation

  if (!publisherPrivateKey) {
    throw ApiError.internalError('PUBLISHER_PRIVATE_KEY environment variable is required');
  }

  if (!factoryAddress) {
    throw ApiError.internalError('REWARD_POOL_FACTORY_ADDRESS environment variable is required');
  }

  return new ClaimAuthService(rpcUrl, publisherPrivateKey, factoryAddress, oldPublisherPrivateKey);
}

export default ClaimAuthService;
export { ClaimAuthService };