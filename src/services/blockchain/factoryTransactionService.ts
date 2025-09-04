import { ethers } from 'ethers'
import ClaimRouterABI from '../../contracts/abis/ClaimRouter.json' with { type: 'json' }
import erc20ABI from '../../contracts/abis/ERC20.json' with { type: 'json' }
import RewardPoolFactoryABI from '../../contracts/abis/RewardPoolFactory.json' with { type: 'json' }
import RewardPoolImplementationABI from '../../contracts/abis/RewardPoolImplementation.json' with {
  type: 'json'
}
import { ApiError } from '../../middleware/types/errors.ts'
import { CircuitBreakerManager } from '../../utils/circuitBreaker.ts'
import { tokenCache } from '../../utils/tokenCache.js'

/**
 * @title FactoryService
 * @notice Service for preparing blockchain transactions and signatures for EIP-1167 RewardPoolFactory
 * @dev Transaction preparation service - no private key operations, user signs via MetaMask
 */

// Use imported ABI from artifacts
const FACTORY_ABI = RewardPoolFactoryABI

const VAULT_ABI = RewardPoolImplementationABI

const CLAIM_ROUTER_ABI = ClaimRouterABI

const ERC20_ABI = erc20ABI

interface NetworkConfig {
  factoryAddress: string
  claimRouterAddress: string
  publisherAddress: string
  rpcUrl: string
}

interface ClaimData {
  vault: string
  account: string
  cumulativeAmount: string
  signature: string
}

interface EIP712Domain {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

class FactoryService {
  private provider: ethers.JsonRpcProvider
  private config: NetworkConfig
  private chainId: Promise<number>

  constructor(config: NetworkConfig) {
    this.config = config
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)
    this.chainId = this.provider.getNetwork().then((network) => Number(network.chainId))
  }

  /**
   * Predict the deterministic address of a pool before creation
   * CRITICAL: Must match Solidity CREATE2 implementation exactly
   */
  async predictPoolAddress(
    creator: string,
    token: string
  ): Promise<{ predicted: string; salt: string }> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const [predicted, salt] = await factory.predictPoolAddress(creator, token)
    return { predicted, salt }
  }

  /**
   * Prepare a createPool transaction for client-side execution
   * @param token Token contract address
   * @param creator Creator's wallet address
   */
  async prepareCreatePoolTransaction(
    token: string,
    creator: string
  ): Promise<{
    contractAddress: string
    abi: any[]
    functionName: string
    args: any[]
    validations: {
      tokenAllowed: boolean
      currentNonce: number
    }
  }> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const breaker = CircuitBreakerManager.getBlockchainBreaker()

    // Check if token is allowed with circuit breaker protection
    const isAllowed = await breaker.execute(
      async () => await factory.allowedTokens(token),
      async () => false // Fallback: assume not allowed
    )

    if (!isAllowed) {
      throw ApiError.badRequest(`Token ${token} is not in the factory allowlist`)
    }

    // Get current nonce for this creator/token pair (multiple pools allowed)
    const currentNonce = await breaker.execute(
      async () => await factory.poolNonce(creator, token),
      async () => BigInt(0) // Fallback: assume nonce 0
    )

    return {
      contractAddress: this.config.factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'createPool',
      args: [token],
      validations: {
        tokenAllowed: isAllowed,
        currentNonce: Number(currentNonce)
      }
    }
  }

  /**
   * Prepare a createAndFundPool transaction for client-side execution
   * @param token Token contract address
   * @param creator Creator's wallet address
   * @param amount Amount to fund (in human-readable units)
   */
  async prepareCreateAndFundTransaction(
    token: string,
    creator: string,
    amount: number
  ): Promise<{
    contractAddress: string
    abi: any[]
    functionName: string
    args: any[]
    tokenInfo: {
      address: string
      decimals: number
      symbol: string
      amountWei: string
    }
    validations: {
      tokenAllowed: boolean
      currentNonce: number
      sufficientBalance: boolean
      sufficientAllowance: boolean
      currentBalance: string
      currentAllowance: string
      requiredAmount: string
    }
  }> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)

    // Check if token is allowed
    const isAllowed = await factory.allowedTokens(token)
    if (!isAllowed) {
      throw ApiError.badRequest(`Token ${token} is not in the factory allowlist`)
    }

    // Get current nonce for this creator/token pair
    const currentNonce = await factory.poolNonce(creator, token)

    // Get token metadata with caching and validate amount
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.provider)
    const { amountWei, metadata } = await tokenCache.validateAndParseAmountWithMetadata(
      amount.toString(),
      token,
      this.provider
    )

    // Check balance and allowance
    const [balance, allowance] = await Promise.all([
      tokenContract.balanceOf(creator),
      tokenContract.allowance(creator, this.config.factoryAddress)
    ])

    const sufficientBalance = balance.gte(amountWei)
    const sufficientAllowance = allowance.gte(amountWei)

    return {
      contractAddress: this.config.factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'createAndFundPool',
      args: [token, amountWei.toString()],
      tokenInfo: {
        address: token,
        decimals: metadata.decimals,
        symbol: metadata.symbol,
        amountWei: amountWei.toString()
      },
      validations: {
        tokenAllowed: isAllowed,
        currentNonce: Number(currentNonce),
        sufficientBalance,
        sufficientAllowance,
        currentBalance: balance.toString(),
        currentAllowance: allowance.toString(),
        requiredAmount: amountWei.toString()
      }
    }
  }

  /**
   * Prepare a fundPool transaction for client-side execution
   * @param poolAddress Address of the pool to fund
   * @param amount Amount to fund (in human-readable units)
   * @param funderAddress Address of the funder
   */
  async prepareFundPoolTransaction(
    poolAddress: string,
    amount: number,
    funderAddress: string
  ): Promise<{
    contractAddress: string
    abi: any[]
    functionName: string
    args: any[]
    tokenInfo: {
      address: string
      decimals: number
      symbol: string
      amountWei: string
    }
    validations: {
      sufficientAllowance: boolean
      currentAllowance: string
      requiredAmount: string
    }
  }> {
    const vault = new ethers.Contract(poolAddress, VAULT_ABI, this.provider)

    // Get token details
    const tokenAddress = await vault.token()
    const { amountWei, metadata } = await tokenCache.validateAndParseAmountWithMetadata(
      amount.toString(),
      tokenAddress,
      this.provider
    )

    // Check current allowance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider)
    const allowance = await tokenContract.allowance(funderAddress, poolAddress)
    const sufficientAllowance = allowance >= amountWei

    return {
      contractAddress: poolAddress,
      abi: VAULT_ABI,
      functionName: 'fund',
      args: [amountWei.toString()],
      tokenInfo: {
        address: tokenAddress,
        decimals: metadata.decimals,
        symbol: metadata.symbol,
        amountWei: amountWei.toString()
      },
      validations: {
        sufficientAllowance,
        currentAllowance: allowance.toString(),
        requiredAmount: amountWei.toString()
      }
    }
  }

  /**
   * Prepare EIP-712 claim data for publisher signing
   * CRITICAL: Must match the exact domain and types used in smart contracts
   */
  async prepareClaimSignatureData(
    vaultAddress: string,
    account: string,
    cumulativeAmount: number
  ): Promise<{
    domain: EIP712Domain
    types: any
    message: any
    publisherAddress: string
  }> {
    // EIP-712 domain - must match RewardPoolImplementation exactly
    const domain: EIP712Domain = {
      name: 'FactoryVault',
      version: '1',
      chainId: await this.chainId,
      verifyingContract: vaultAddress
    }

    // EIP-712 types - must match RewardPoolImplementation exactly
    const types = {
      Claim: [
        { name: 'account', type: 'address' },
        { name: 'cumulativeAmount', type: 'uint256' }
      ]
    }

    // Get token decimals for proper amount formatting
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, this.provider)
    const tokenAddress = await vault.token()
    const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider)
    const cumulativeAmountWei = ethers.parseUnits(cumulativeAmount.toString(), metadata.decimals)

    const message = {
      account,
      cumulativeAmount: cumulativeAmountWei
    }

    return {
      domain,
      types,
      message,
      publisherAddress: this.config.publisherAddress
    }
  }

  /**
   * Prepare batch claim data for ClaimRouter (signature generation needed client-side)
   * @param claims Array of claim requests
   */
  async prepareBatchClaimData(
    claims: Array<{
      vaultAddress: string
      account: string
      cumulativeAmount: number
    }>
  ): Promise<{
    claimDataForSigning: Array<{
      domain: EIP712Domain
      types: any
      message: any
      vaultAddress: string
      account: string
      cumulativeAmount: string
    }>
    maxBatchSize: number
  }> {
    const claimRouter = new ethers.Contract(
      this.config.claimRouterAddress,
      CLAIM_ROUTER_ABI,
      this.provider
    )
    const maxBatchSize = await claimRouter.maxBatchSize()

    if (claims.length > maxBatchSize) {
      throw new Error(`Batch size ${claims.length} exceeds maximum ${maxBatchSize}`)
    }

    const claimDataForSigning = []

    for (const claim of claims) {
      // Prepare EIP-712 data for this claim
      const signatureData = await this.prepareClaimSignatureData(
        claim.vaultAddress,
        claim.account,
        claim.cumulativeAmount
      )

      // Get token decimals for proper amount formatting
      const vault = new ethers.Contract(claim.vaultAddress, VAULT_ABI, this.provider)
      const tokenAddress = await vault.token()
      const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider)
      const cumulativeAmountWei = ethers.parseUnits(
        claim.cumulativeAmount.toString(),
        metadata.decimals
      )

      claimDataForSigning.push({
        ...signatureData,
        vaultAddress: claim.vaultAddress,
        account: claim.account,
        cumulativeAmount: cumulativeAmountWei.toString()
      })
    }

    return {
      claimDataForSigning,
      maxBatchSize: Number(maxBatchSize)
    }
  }

  /**
   * Get pool information including balance and claim status
   */
  async getPoolInfo(
    poolAddress: string,
    account?: string
  ): Promise<{
    tokenAddress: string
    tokenBalance: string
    alreadyClaimed?: string
    factory: string
  }> {
    const vault = new ethers.Contract(poolAddress, VAULT_ABI, this.provider)
    const tokenAddress = await vault.token()
    const factory = await vault.getFactory()

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider)
    const [balance, metadata] = await Promise.all([
      tokenContract.balanceOf(poolAddress),
      tokenCache.getTokenMetadata(tokenAddress, this.provider)
    ])

    const result: any = {
      tokenAddress,
      tokenSymbol: metadata.symbol,
      tokenBalance: ethers.formatUnits(balance, metadata.decimals),
      factory
    }

    if (account) {
      const claimed = await vault.alreadyClaimed(account)
      result.alreadyClaimed = ethers.formatUnits(claimed, metadata.decimals)
    }

    return result
  }

  /**
   * Validate that a factory is approved in the ClaimRouter
   */
  async isFactoryApproved(factoryAddress: string): Promise<boolean> {
    const claimRouter = new ethers.Contract(
      this.config.claimRouterAddress,
      CLAIM_ROUTER_ABI,
      this.provider
    )
    return await claimRouter.approvedFactories(factoryAddress)
  }

  /**
   * Prepare a withdrawPool transaction for client-side execution
   * @param poolAddress Address of the pool to withdraw from
   * @param amount Amount to withdraw (in human-readable units)
   * @param withdrawerAddress Address of the withdrawer (must be creator)
   */
  async prepareWithdrawPoolTransaction(
    poolAddress: string,
    amount: number,
    withdrawerAddress: string
  ): Promise<{
    contractAddress: string
    abi: any[]
    functionName: string
    args: any[]
    tokenInfo: {
      address: string
      decimals: number
      symbol: string
      amountWei: string
    }
    validations: {
      isCreator: boolean
      sufficientBalance: boolean
      currentBalance: string
      requiredAmount: string
    }
  }> {
    const vault = new ethers.Contract(poolAddress, VAULT_ABI, this.provider)

    // Check if withdrawer is the creator
    const creator = await vault.creator()
    const isCreator = creator.toLowerCase() === withdrawerAddress.toLowerCase()

    if (!isCreator) {
      throw ApiError.forbidden('Only the pool creator can withdraw funds')
    }

    // Get token details
    const tokenAddress = await vault.token()
    const { amountWei, metadata } = await tokenCache.validateAndParseAmountWithMetadata(
      amount.toString(),
      tokenAddress,
      this.provider
    )

    // Check pool balance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider)
    const balance = await tokenContract.balanceOf(poolAddress)
    const sufficientBalance = balance.gte(amountWei)

    return {
      contractAddress: poolAddress,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [amountWei.toString()],
      tokenInfo: {
        address: tokenAddress,
        decimals: metadata.decimals,
        symbol: metadata.symbol,
        amountWei: amountWei.toString()
      },
      validations: {
        isCreator,
        sufficientBalance,
        currentBalance: balance.toString(),
        requiredAmount: amountWei.toString()
      }
    }
  }

  /**
   * Get current publisher information from factory
   */
  async getPublisherInfo(): Promise<{
    current: string
    old: string
    graceEnd: number
  }> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const [current, old, graceEnd] = await factory.getPublisherInfo()
    return { current, old, graceEnd: Number(graceEnd) }
  }
}

// Network configuration factory
export function createFactoryService(): FactoryService {
  const config = {
    factoryAddress: process.env.REWARD_POOL_FACTORY_ADDRESS || '',
    claimRouterAddress: process.env.CLAIM_ROUTER_ADDRESS || '',
    publisherAddress: process.env.PUBLISHER_ADDRESS || '',
    rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org'
  }

  const missingVars = []
  if (!config.factoryAddress) missingVars.push('REWARD_POOL_FACTORY_ADDRESS')
  if (!config.claimRouterAddress) missingVars.push('CLAIM_ROUTER_ADDRESS')
  if (!config.publisherAddress) missingVars.push('PUBLISHER_ADDRESS')
  if (missingVars.length > 0) {
    throw ApiError.internalError(
      `Missing blockchain configuration environment variable(s): ${missingVars.join(', ')}`
    )
  }

  return new FactoryService(config)
}

export default FactoryService
export { FactoryService }
export type { NetworkConfig, ClaimData }
