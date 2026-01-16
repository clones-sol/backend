import { ethers } from 'ethers'
import DatasetFactoryABI from '../../contracts/abis/DatasetFactory.json' with { type: 'json' }
import DatasetTokenABI from '../../contracts/abis/DatasetToken.json' with { type: 'json' }
import BondingCurveABI from '../../contracts/abis/BondingCurve.json' with { type: 'json' }
import ERC20ABI from '../../contracts/abis/ERC20.json' with { type: 'json' }
import { ApiError } from '../../middleware/types/errors.ts'
import { logger } from '../logger.ts'
import { CircuitBreakerManager } from '../../utils/circuitBreaker.ts'

/**
 * @title DataMarketplaceBlockchainService
 * @notice Service for preparing blockchain transactions for EIP-1167 DatasetFactory
 * @dev Transaction preparation service - no private key operations, user signs via MetaMask
 */

// Use imported ABIs from artifacts
const FACTORY_ABI = DatasetFactoryABI
const TOKEN_ABI = DatasetTokenABI
const BONDING_CURVE_ABI = BondingCurveABI
const ERC20_ABI = ERC20ABI

interface NetworkConfig {
  factoryAddress: string
  rpcUrl: string
}

interface DatasetCreationEvent {
  datasetTokenAddress: string
  bondingCurveAddress: string
  name: string
  symbol: string
  demoHashes: string[]
  blockNumber: number
  transactionHash: string
}

class DataMarketplaceBlockchainService {
  private provider: ethers.JsonRpcProvider
  private config: NetworkConfig
  private chainId: Promise<number>

  constructor(config: NetworkConfig) {
    this.config = config
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)
    this.chainId = this.provider.getNetwork().then((network) => Number(network.chainId))
  }

  /**
   * Predict the deterministic address of a dataset using CREATE2
   * CRITICAL: Must match Solidity CREATE2 implementation exactly
   */
  async predictDatasetAddress(
    creator: string,
    name: string,
    symbol: string
  ): Promise<{ predicted: string; salt: string }> {
    if (!ethers.isAddress(creator)) {
      throw ApiError.badRequest('Invalid creator address')
    }

    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const breaker = CircuitBreakerManager.getBlockchainBreaker()

    const predicted = await breaker.execute(
      async () => await factory.predictDatasetAddress(creator, name, symbol),
      async () => {
        throw ApiError.internalError('Failed to predict dataset address')
      }
    )

    // Generate salt for logging (matches Solidity: keccak256(creator, name, symbol))
    const salt = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'string', 'string'],
        [creator, name, symbol]
      )
    )

    logger.info('Dataset address predicted', {
      creator,
      name,
      symbol,
      predicted,
      salt
    })

    return { predicted, salt }
  }

  /**
   * Get current launch fee from factory contract
   * @returns ETH fee (0.02 ETH fixed for liquidity) + CLONES fee (dynamic ~$50 USD)
   */
  async getLaunchFee(): Promise<{
    ethFee: string
    clonesFee: string
    ethFeeWei: bigint
    clonesFeeWei: bigint
  }> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const breaker = CircuitBreakerManager.getBlockchainBreaker()

    // Get LIQUIDITY_CONTRIBUTION constant (0.02 ETH)
    const LIQUIDITY_CONTRIBUTION = ethers.parseEther('0.02')

    // Get dynamic CLONES fee from factory
    const clonesFeeWei = await breaker.execute(
      async () => await factory.getCurrentLaunchFee(),
      async () => {
        throw ApiError.internalError('Failed to get CLONES launch fee')
      }
    )

    const ethFee = ethers.formatEther(LIQUIDITY_CONTRIBUTION)
    const clonesFee = ethers.formatEther(clonesFeeWei)

    logger.info('Launch fee retrieved', {
      ethFee,
      clonesFee,
      ethFeeWei: LIQUIDITY_CONTRIBUTION.toString(),
      clonesFeeWei: clonesFeeWei.toString()
    })

    return {
      ethFee,
      clonesFee,
      ethFeeWei: LIQUIDITY_CONTRIBUTION,
      clonesFeeWei
    }
  }

  /**
   * Get CLONES token address from factory
   */
  async getClonesTokenAddress(): Promise<string> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const breaker = CircuitBreakerManager.getBlockchainBreaker()

    const clonesTokenAddress = await breaker.execute(
      async () => await factory.CLONES_TOKEN(),
      async () => {
        throw ApiError.internalError('Failed to get CLONES token address')
      }
    )

    return clonesTokenAddress
  }

  /**
   * Prepare CLONES token approval transaction for client-side execution
   * @param userAddress User's wallet address
   * @param amount Optional amount to approve (defaults to launch fee)
   */
  async prepareClonesApprovalTransaction(
    userAddress: string,
    amount?: string
  ): Promise<{
    contractAddress: string
    abi: any[]
    functionName: string
    args: any[]
    validations: {
      clonesTokenAddress: string
      spenderAddress: string
      approvalAmount: string
      currentAllowance: string
      sufficientAllowance: boolean
    }
  }> {
    if (!ethers.isAddress(userAddress)) {
      throw ApiError.badRequest('Invalid user address')
    }

    // Get CLONES token address
    const clonesTokenAddress = await this.getClonesTokenAddress()

    // Get launch fee if amount not specified
    let approvalAmount: bigint
    if (amount) {
      approvalAmount = ethers.parseEther(amount)
    } else {
      const feeInfo = await this.getLaunchFee()
      approvalAmount = feeInfo.clonesFeeWei
    }

    // Check current allowance
    const clonesToken = new ethers.Contract(clonesTokenAddress, ERC20_ABI, this.provider)
    const currentAllowance = await clonesToken.allowance(userAddress, this.config.factoryAddress)
    const sufficientAllowance = currentAllowance >= approvalAmount

    logger.info('CLONES approval transaction prepared', {
      clonesTokenAddress,
      spender: this.config.factoryAddress,
      approvalAmount: ethers.formatEther(approvalAmount),
      currentAllowance: ethers.formatEther(currentAllowance),
      sufficientAllowance,
      userAddress
    })

    return {
      contractAddress: clonesTokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [this.config.factoryAddress, approvalAmount.toString()],
      validations: {
        clonesTokenAddress,
        spenderAddress: this.config.factoryAddress,
        approvalAmount: approvalAmount.toString(),
        currentAllowance: currentAllowance.toString(),
        sufficientAllowance
      }
    }
  }

  /**
   * Prepare dataset creation transaction for client-side execution
   * @param name Dataset name
   * @param symbol Dataset symbol
   * @param burnThresholdPercentage Percentage of supply required to burn (1-10%)
   * @param creatorAddress Creator's wallet address
   */
  async prepareCreateDatasetTransaction(request: {
    name: string
    symbol: string
    burnThresholdPercentage: number
    creatorAddress: string
  }): Promise<{
    contractAddress: string
    abi: any[]
    functionName: string
    args: any[]
    value: string
    validations: {
      predictedDatasetToken: string
      predictedBondingCurve: string
      ethFee: string
      clonesFee: string
      clonesTokenAddress: string
      sufficientClonesAllowance: boolean
      currentClonesAllowance: string
      requiredClonesAmount: string
      burnThresholdPercentage: number
      isFactoryReady: boolean
    }
  }> {
    // Validate inputs
    if (!ethers.isAddress(request.creatorAddress)) {
      throw ApiError.badRequest('Invalid creator address')
    }

    if (!request.name || !request.symbol) {
      throw ApiError.badRequest('Name and symbol are required')
    }

    if (!request.burnThresholdPercentage || request.burnThresholdPercentage < 1 || request.burnThresholdPercentage > 10) {
      throw ApiError.badRequest('Burn threshold percentage must be between 1 and 10')
    }

    // Check if factory is ready for dataset creation
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const isFactoryReady = await factory.isReadyForDatasetCreation()

    if (!isFactoryReady) {
      throw ApiError.badRequest('Factory is not ready for dataset creation. Graduation manager and burn portal must be configured.')
    }

    // Get launch fee (ETH + CLONES)
    const feeInfo = await this.getLaunchFee()

    // Validate ETH liquidity contribution (0.02 ETH minimum)
    const LIQUIDITY_CONTRIBUTION = ethers.parseEther('0.02')
    if (BigInt(feeInfo.ethFeeWei) < LIQUIDITY_CONTRIBUTION) {
      // This shouldn't happen, but safety check
      logger.warn('ETH fee less than liquidity contribution', {
        ethFee: feeInfo.ethFee,
        liquidityContribution: ethers.formatEther(LIQUIDITY_CONTRIBUTION)
      })
    }

    // Get CLONES token address
    const clonesTokenAddress = await this.getClonesTokenAddress()

    // Check CLONES token allowance
    const clonesToken = new ethers.Contract(clonesTokenAddress, ERC20_ABI, this.provider)
    const currentAllowance = await clonesToken.allowance(
      request.creatorAddress,
      this.config.factoryAddress
    )
    const sufficientAllowance = currentAllowance >= feeInfo.clonesFeeWei

    // Predict dataset addresses (token + bonding curve)
    const predicted = await factory.predictDatasetAddress(
      request.creatorAddress,
      request.name,
      request.symbol
    )

    logger.info('Dataset creation transaction prepared', {
      contractAddress: this.config.factoryAddress,
      ethValue: feeInfo.ethFee,
      clonesFee: feeInfo.clonesFee,
      predictedDatasetToken: predicted[0],
      predictedBondingCurve: predicted[1],
      creatorAddress: request.creatorAddress,
      burnThresholdPercentage: request.burnThresholdPercentage,
      sufficientClonesAllowance: sufficientAllowance,
      isFactoryReady
    })

    return {
      contractAddress: this.config.factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'createDataset',
      args: [request.name, request.symbol, request.burnThresholdPercentage],
      value: feeInfo.ethFeeWei.toString(),
      validations: {
        predictedDatasetToken: predicted[0],
        predictedBondingCurve: predicted[1],
        ethFee: feeInfo.ethFee,
        clonesFee: feeInfo.clonesFee,
        clonesTokenAddress,
        sufficientClonesAllowance: sufficientAllowance,
        currentClonesAllowance: currentAllowance.toString(),
        requiredClonesAmount: feeInfo.clonesFeeWei.toString(),
        burnThresholdPercentage: request.burnThresholdPercentage,
        isFactoryReady
      }
    }
  }

  /**
   * Wait for dataset creation transaction and parse events
   * @param txHash Transaction hash
   * @param expectedCreator Expected creator address for validation
   * @param timeout Timeout in milliseconds (default: 5 minutes)
   */
  async waitForDatasetCreation(
    txHash: string,
    expectedCreator: string,
    timeout: number = 300000
  ): Promise<DatasetCreationEvent> {
    logger.info('Waiting for dataset creation transaction', {
      txHash,
      expectedCreator,
      timeout
    })

    // Wait for transaction with timeout
    const receipt = await Promise.race([
      this.provider.waitForTransaction(txHash, 1),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Transaction timeout')), timeout)
      )
    ])

    if (!receipt) {
      throw ApiError.internalError('Transaction receipt not found')
    }

    if (receipt.status !== 1) {
      throw ApiError.badRequest('Transaction failed on-chain')
    }

    // Parse DatasetCreated event
    const factoryInterface = new ethers.Interface(FACTORY_ABI)
    let datasetCreatedEvent = null

    for (const log of receipt.logs) {
      try {
        const parsed = factoryInterface.parseLog({
          topics: log.topics as string[],
          data: log.data
        })

        if (parsed && parsed.name === 'DatasetCreated') {
          // Verify creator matches
          if (parsed.args.creator.toLowerCase() === expectedCreator.toLowerCase()) {
            datasetCreatedEvent = parsed
            break
          }
        }
      } catch {
        // Not a DatasetCreated event, continue
        continue
      }
    }

    if (!datasetCreatedEvent) {
      throw ApiError.internalError('DatasetCreated event not found in transaction')
    }

    const result: DatasetCreationEvent = {
      datasetTokenAddress: datasetCreatedEvent.args.datasetToken,
      bondingCurveAddress: datasetCreatedEvent.args.bondingCurve,
      name: datasetCreatedEvent.args.name,
      symbol: datasetCreatedEvent.args.symbol,
      demoHashes: datasetCreatedEvent.args.demoHashes.map((hash: string) => hash),
      blockNumber: receipt.blockNumber,
      transactionHash: receipt.hash
    }

    logger.info('Dataset creation confirmed on-chain', result)

    return result
  }

  /**
   * Fetch dataset on-chain data after deployment
   * @param datasetTokenAddress Deployed dataset token address
   */
  async fetchDatasetOnChainData(datasetTokenAddress: string): Promise<{
    name: string
    symbol: string
    totalSupply: string
    bondingCurveAddress: string
    demoHashes: string[]
    demonstrationCount: number
    bondingCurve: {
      virtualETH: string
      virtualTokens: string
      k: string
      currentPrice: string
      marketCap: string
      isGraduated: boolean
    }
  }> {
    // Validate address
    if (!ethers.isAddress(datasetTokenAddress)) {
      throw ApiError.badRequest('Invalid dataset token address')
    }

    // Check if contract exists
    const code = await this.provider.getCode(datasetTokenAddress)
    if (code === '0x') {
      throw ApiError.badRequest(`No contract found at address: ${datasetTokenAddress}`)
    }

    // Create contract instances
    const tokenContract = new ethers.Contract(datasetTokenAddress, TOKEN_ABI, this.provider)
    const breaker = CircuitBreakerManager.getBlockchainBreaker()

    // Fetch token data with circuit breaker
    const [name, symbol, totalSupply, bondingCurveAddress, demonstrationCount] =
      await breaker.execute(
        async () =>
          await Promise.all([
            tokenContract.name(),
            tokenContract.symbol(),
            tokenContract.totalSupply(),
            tokenContract.bondingCurve(),
            tokenContract.demonstrationCount()
          ]),
        async () => {
          throw ApiError.internalError('Failed to fetch dataset token data')
        }
      )

    // Fetch all demo hashes
    const demoHashesPromises = []
    for (let i = 0; i < Number(demonstrationCount); i++) {
      demoHashesPromises.push(tokenContract.demoHashes(i))
    }
    const demoHashes = await Promise.all(demoHashesPromises)

    // Fetch bonding curve data
    const bondingCurveContract = new ethers.Contract(
      bondingCurveAddress,
      BONDING_CURVE_ABI,
      this.provider
    )

    const [virtualETH, virtualTokens, k, currentPrice, marketCap, isGraduated] =
      await breaker.execute(
        async () =>
          await Promise.all([
            bondingCurveContract.virtualETH(),
            bondingCurveContract.virtualTokens(),
            bondingCurveContract.k(),
            bondingCurveContract.getCurrentPrice(),
            bondingCurveContract.getMarketCap(),
            bondingCurveContract.isGraduated()
          ]),
        async () => {
          throw ApiError.internalError('Failed to fetch bonding curve data')
        }
      )

    const result = {
      name,
      symbol,
      totalSupply: ethers.formatEther(totalSupply),
      bondingCurveAddress,
      demoHashes: demoHashes.map((hash: string) => hash),
      demonstrationCount: Number(demonstrationCount),
      bondingCurve: {
        virtualETH: ethers.formatEther(virtualETH),
        virtualTokens: ethers.formatEther(virtualTokens),
        k: k.toString(),
        currentPrice: ethers.formatEther(currentPrice),
        marketCap: ethers.formatEther(marketCap),
        isGraduated
      }
    }

    logger.info('Dataset on-chain data fetched', {
      datasetTokenAddress,
      name,
      symbol,
      isGraduated
    })

    return result
  }

  /**
   * Get factory information
   */
  async getFactoryInfo(): Promise<{
    factoryAddress: string
    clonesTokenAddress: string
    graduationManagerAddress: string
    burnPortalAddress: string
  }> {
    const factory = new ethers.Contract(this.config.factoryAddress, FACTORY_ABI, this.provider)
    const breaker = CircuitBreakerManager.getBlockchainBreaker()

    const [clonesTokenAddress, graduationManagerAddress, burnPortalAddress] =
      await breaker.execute(
        async () =>
          await Promise.all([
            factory.CLONES_TOKEN(),
            factory.graduationManager(),
            factory.burnPortal()
          ]),
        async () => {
          throw ApiError.internalError('Failed to get factory info')
        }
      )

    return {
      factoryAddress: this.config.factoryAddress,
      clonesTokenAddress,
      graduationManagerAddress,
      burnPortalAddress
    }
  }
}

// Network configuration factory
export function createDataMarketplaceBlockchainService(): DataMarketplaceBlockchainService {
  const config = {
    factoryAddress: process.env.DATASET_FACTORY_ADDRESS || '',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
  }

  const missingVars = []
  if (!config.factoryAddress) missingVars.push('DATASET_FACTORY_ADDRESS')
  if (missingVars.length > 0) {
    throw ApiError.internalError(
      `Missing data marketplace blockchain configuration environment variable(s): ${missingVars.join(', ')}`
    )
  }

  return new DataMarketplaceBlockchainService(config)
}

// Export singleton instance (but prefer using factory function)
export let dataMarketplaceBlockchainService: DataMarketplaceBlockchainService | null = null

try {
  dataMarketplaceBlockchainService = createDataMarketplaceBlockchainService()
} catch (error) {
  logger.warn('Data marketplace blockchain service not configured', {
    error: error instanceof Error ? error.message : 'Unknown error'
  })
}

export default DataMarketplaceBlockchainService
export { DataMarketplaceBlockchainService }
export type { NetworkConfig, DatasetCreationEvent }
