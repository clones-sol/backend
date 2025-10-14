import { ethers } from 'ethers'
import express, { type Request, type Response, type Router } from 'express'
import mongoose from 'mongoose'
import { authRateLimit } from '../middleware/rateLimiter.ts'
import { v4 as uuidv4 } from 'uuid'
import ClaimRouterABI from '../contracts/abis/ClaimRouter.json' with { type: 'json' }
import RewardPoolImplementationABI from '../contracts/abis/RewardPoolImplementation.json' with { type: 'json' }
import { errorHandlerAsync } from '../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../middleware/types/errors.ts'
import { validateBody, validateQuery } from '../middleware/validator.ts'
import { TransactionSessionModel, WalletConnectionModel } from '../models/Models.ts'
import { createFactoryService } from '../services/blockchain/factoryTransactionService.ts'
import { createGasEstimationService } from '../services/blockchain/gasEstimationService.ts'
import { calculateFeeAmounts, getContractFeeConfig } from '../services/blockchain/contractConfigService.ts'
import { getTokenContractAddress, getTokenInfo } from '../services/blockchain/tokens.ts'
import { createFactory } from '../services/factory/factoryDatabaseService.ts'
import { TransactionSessionService } from '../services/transactionSession.ts'
import { ContentFilterService } from '../services/validation/contentFilter.ts'
import { validateAddress } from '../utils/addressValidation.js'
import { AmountValidator } from '../utils/amountValidation.ts'
import { CircuitBreakerManager } from '../utils/circuitBreaker.ts'
import {
  completeTransactionSchema,
  estimateGasSchema,
  prepareTransactionSchema,
  transactionStatusSchema,
  validateTransactionSchema
} from './schemas/transaction.ts'

interface PreparedTransactionData {
  contractAddress: string | undefined
  abi: unknown
  functionName: string
  args: unknown[]
  tokenInfo?: {
    address: string
    decimals: number
    symbol: string
    amountWei?: string
  }
  validations?: {
    approved?: boolean
    hasBalance?: boolean
    allowance?: string
    tokenAllowed?: boolean
    currentNonce?: number
    sufficientBalance?: boolean
    sufficientAllowance?: boolean
    currentBalance?: string
    currentAllowance?: string
    requiredAmount?: string
    alreadyClaimed?: number
    newClaimableAmount?: number
  }
}

interface TransactionParams {
  type: string
  creator?: string
  token?: string
  amount?: string
  poolAddress?: string
  tokenAddress?: string
  submissionId?: string
}

const router: Router = express.Router()

// Rate limiting for transaction endpoints

const CLAIM_ROUTER_ABI = ClaimRouterABI

const CONTRACT_ADDRESSES = {
  REWARD_POOL_FACTORY: process.env.REWARD_POOL_FACTORY_ADDRESS,
  CLAIM_ROUTER: process.env.CLAIM_ROUTER_ADDRESS
}

/**
 * @swagger
 * tags:
 *   name: Transaction
 *   description: Transaction endpoints for creating, validating, and managing transactions
 */

/**
 * @swagger
 * /transaction/validate-tx:
 *   post:
 *     summary: Validate transaction parameters
 *     description: Validates transaction parameters against user session and blockchain state
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - sessionToken
 *               - timestamp
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [createFactory, fundPool, claimRewards]
 *               sessionToken:
 *                 type: string
 *               userAddress:
 *                 type: string
 *                 description: Optional. If provided, must match the session token's address
 *               creator:
 *                 type: string
 *               token:
 *                 type: string
 *               amount:
 *                 type: string
 *               poolAddress:
 *                 type: string
 *               timestamp:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transaction parameters validated successfully
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Invalid session
 *       403:
 *         description: Unauthorized
 */
router.post(
  '/validate-tx',
  authRateLimit,
  validateBody(validateTransactionSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionToken, userAddress, type, creator, token, amount, poolAddress, timestamp } =
      req.body

    // Validate timestamp (within last 5 minutes)
    const now = Date.now()
    if (now - timestamp > 5 * 60 * 1000) {
      throw ApiError.badRequest('Transaction request has expired')
    }

    // Validate session token exists and get the associated user address
    const connection = await WalletConnectionModel.findOne({
      token: sessionToken
    })

    if (!connection || !connection.address) {
      throw ApiError.unauthorized('Invalid session token')
    }

    // Validate that the provided userAddress matches the session token
    if (userAddress && userAddress.toLowerCase() !== connection.address.toLowerCase()) {
      throw ApiError.forbidden('User address does not match session')
    }

    // Use the address from the session token as the authenticated user
    const authenticatedAddress = connection.address

    // Type-specific validations
    switch (type) {
      case 'createFactory': {
        if (!token) {
          throw ApiError.badRequest('Token required for createFactory')
        }
        // Validate token is supported
        const tokenAddress = getTokenContractAddress(token)
        if (!tokenAddress) {
          throw ApiError.badRequest(`Unsupported token: ${token}`)
        }
        break
      }

      case 'createAndFundPool': {
        if (!token || !amount) {
          throw ApiError.badRequest('Token and amount required for createAndFundPool')
        }
        // Validate token is supported
        const tokenAddressForFund = getTokenContractAddress(token)
        if (!tokenAddressForFund) {
          throw ApiError.badRequest(`Unsupported token: ${token}`)
        }
        // Validate amount format (basic validation only - proper decimals handled in service)
        try {
          AmountValidator.validateBasicAmount(amount)
        } catch (error) {
          throw ApiError.badRequest(
            error instanceof Error ? error.message : 'Invalid amount format'
          )
        }
        break
      }

      case 'fundPool':
        if (!token || !amount) {
          throw ApiError.badRequest('Token and amount required for fundPool')
        }
        validateAddress(poolAddress, 'poolAddress')
        // Validate amount format (basic validation only - proper decimals handled in service)
        try {
          AmountValidator.validateBasicAmount(amount)
        } catch (error) {
          throw ApiError.badRequest(
            error instanceof Error ? error.message : 'Invalid amount format'
          )
        }
        break

      case 'withdrawPool':
        if (!amount || !poolAddress) {
          throw ApiError.badRequest('Amount and pool address required for withdrawPool')
        }
        validateAddress(poolAddress, 'poolAddress')
        // Validate amount format (basic validation only - proper decimals handled in service)
        try {
          AmountValidator.validateBasicAmount(amount)
        } catch (error) {
          throw ApiError.badRequest(
            error instanceof Error ? error.message : 'Invalid amount format'
          )
        }
        break

      case 'claimRewards':
        validateAddress(poolAddress, 'poolAddress')
        break

      default:
        throw ApiError.badRequest(`Unsupported transaction type: ${type}`)
    }

    // Additional security validation - ensure creator matches session user for creator-required operations
    if (
      (type === 'createFactory' || type === 'createAndFundPool' || type === 'fundPool' || type === 'withdrawPool') &&
      creator
    ) {
      if (creator.toLowerCase() !== authenticatedAddress.toLowerCase()) {
        throw ApiError.forbidden('Creator must match authenticated wallet address')
      }
    }

    res.status(200).json(
      successResponse({
        valid: true,
        type,
        sessionToken,
        userAddress: authenticatedAddress,
        validatedAt: Date.now()
      })
    )
  })
)

/**
 * @swagger
 * /transaction/estimate-gas:
 *   post:
 *     summary: Estimate gas for transaction
 *     description: Provides gas estimation for the specified transaction type
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [createFactory, fundPool, claimRewards]
 *               creator:
 *                 type: string
 *               token:
 *                 type: string
 *               amount:
 *                 type: string
 *               poolAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Gas estimation provided
 */
router.post(
  '/estimate-gas',
  validateBody(estimateGasSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { type, creator, token, amount, poolAddress } = req.body

    try {
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
      const factoryService = createFactoryService()
      const gasService = createGasEstimationService()
      const gasBreaker = CircuitBreakerManager.getGasEstimationBreaker()

      let gasLimit: bigint
      let gasPrice: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

      // Get gas price with circuit breaker protection
      gasPrice = await gasBreaker.execute(
        async () => await gasService.getGasPrice(),
        async () => ({
          maxFeePerGas: ethers.parseUnits('1', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei')
        })
      )

      // Dynamic gas estimation based on transaction type
      switch (type) {
        case 'createFactory':
          gasLimit = await gasBreaker.execute(
            async () => {
              if (creator && token) {
                const tokenAddr = getTokenContractAddress(token)
                if (tokenAddr) {
                  const txData = await factoryService.prepareCreatePoolTransaction(
                    tokenAddr,
                    creator
                  )
                  const contract = new ethers.Contract(txData.contractAddress, txData.abi, provider)
                  const estimated = await contract.createPool.estimateGas(...txData.args, {
                    from: creator
                  })
                  return (estimated * 120n) / 100n // 20% buffer
                }
              }
              return BigInt(200000) // Fallback
            },
            async () => BigInt(200000) // Circuit breaker fallback
          )
          break

        case 'createAndFundPool':
          // Combined operation - harder to estimate without actual execution
          // TODO: Using static estimate to avoid allowance issues
          gasLimit = BigInt(280000)
          break

        case 'fundPool':
          gasLimit = await gasBreaker.execute(
            async () => {
              if (poolAddress && amount) {
                try {
                  const amountNum = AmountValidator.validateBasicAmount(amount)
                  const txData = await factoryService.prepareFundPoolTransaction(
                    poolAddress,
                    amountNum,
                    creator || '0x0000000000000000000000000000000000000000'
                  )
                  const contract = new ethers.Contract(txData.contractAddress, txData.abi, provider)
                  const estimated = await contract.fund.estimateGas(...txData.args)
                  return (estimated * 120n) / 100n // 20% buffer
                } catch (error) {
                  // Expected error: User hasn't approved token yet
                  // Return fallback gas limit instead of throwing
                  if (error instanceof Error && error.message.includes('allowance')) {
                    console.log('Gas estimation for fundPool failed (allowance not granted), using fallback')
                    return BigInt(120000)
                  }
                  throw error // Re-throw unexpected errors
                }
              }
              return BigInt(120000) // Fallback
            },
            async () => BigInt(120000) // Circuit breaker fallback
          )
          break

        case 'withdrawPool':
          gasLimit = await gasBreaker.execute(
            async () => {
              if (poolAddress && amount && creator) {
                const amountNum = AmountValidator.validateBasicAmount(amount)
                const txData = await factoryService.prepareWithdrawPoolTransaction(
                  poolAddress,
                  amountNum,
                  creator
                )
                const contract = new ethers.Contract(txData.contractAddress, txData.abi, provider)
                const estimated = await contract.withdraw.estimateGas(...txData.args, {
                  from: creator
                })
                return (estimated * 120n) / 100n // 20% buffer
              }
              return BigInt(80000) // Fallback
            },
            async () => BigInt(80000) // Circuit breaker fallback
          )
          break

        case 'claimRewards':
          gasLimit = BigInt(150000) // Single claim estimate - batch claims use separate endpoint
          break

        default:
          throw ApiError.badRequest(`Unsupported transaction type for gas estimation: ${type}`)
      }

      const totalCost = gasLimit * gasPrice.maxFeePerGas
      const totalCostEth = ethers.formatEther(totalCost)
      const gasPriceGwei = ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei')

      // Flag as expensive if > 0.001 ETH (per PRD anti-dust threshold)
      const isExpensive = parseFloat(totalCostEth) > 0.001

      res.status(200).json(
        successResponse({
          gasLimit: gasLimit.toString(),
          gasPrice: gasPriceGwei,
          maxFeePerGas: ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei'),
          maxPriorityFeePerGas: ethers.formatUnits(gasPrice.maxPriorityFeePerGas, 'gwei'),
          totalCost: totalCostEth,
          isExpensive,
          estimationType: gasLimit > BigInt(200000) ? 'dynamic' : 'fallback',
          estimatedAt: Date.now()
        })
      )
    } catch (error) {
      console.error('Gas estimation error:', error)
      throw ApiError.internalError('Failed to estimate gas')
    }
  })
)

/**
 * @swagger
 * /transaction/prepare-tx:
 *   post:
 *     summary: Prepare transaction data
 *     description: Prepares contract interaction data for frontend execution and creates a transaction session
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - sessionToken
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [createFactory, fundPool, claimRewards]
 *               sessionToken:
 *                 type: string
 *               creator:
 *                 type: string
 *               token:
 *                 type: string
 *               amount:
 *                 type: string
 *               poolAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction data prepared successfully with session ID
 */
router.post(
  '/prepare-tx',
  authRateLimit,
  validateBody(prepareTransactionSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { type, sessionToken, creator, token, amount, poolAddress, submissionId } = req.body

    // Validate session token and get user address
    const connection = await WalletConnectionModel.findOne({
      token: sessionToken
    })
    if (!connection) {
      throw ApiError.unauthorized('Invalid session token')
    }

    const userAddress = connection.address
    let transactionData: Partial<PreparedTransactionData>

    // Use factoryService to prepare transaction data with proper validation
    const factoryService = createFactoryService()

    switch (type) {
      case 'createFactory': {
        if (!token || !creator) {
          throw ApiError.badRequest('Token and creator required for createFactory')
        }

        const tokenAddress = getTokenContractAddress(token)
        if (!tokenAddress) {
          throw ApiError.badRequest(`Unsupported token: ${token}`)
        }

        transactionData = await factoryService.prepareCreatePoolTransaction(tokenAddress, creator)
        break
      }

      case 'createAndFundPool': {
        if (!token || !creator || !amount) {
          throw ApiError.badRequest('Token, creator, and amount required for createAndFundPool')
        }

        const tokenAddressForFund = getTokenContractAddress(token)
        if (!tokenAddressForFund) {
          throw ApiError.badRequest(`Unsupported token: ${token}`)
        }

        const amountNumberForCreateFund = AmountValidator.validateBasicAmount(amount)

        transactionData = await factoryService.prepareCreateAndFundTransaction(
          tokenAddressForFund,
          creator,
          amountNumberForCreateFund
        )
        break
      }

      case 'fundPool': {
        if (!amount || !poolAddress) {
          throw ApiError.badRequest('Amount and pool address required for fundPool')
        }

        const amountNumber = AmountValidator.validateBasicAmount(amount)

        transactionData = await factoryService.prepareFundPoolTransaction(
          poolAddress,
          amountNumber,
          userAddress
        )
        break
      }

      case 'withdrawPool': {
        if (!amount || !poolAddress) {
          throw ApiError.badRequest('Amount and pool address required for withdrawPool')
        }

        const amountNumber = AmountValidator.validateBasicAmount(amount)

        transactionData = await factoryService.prepareWithdrawPoolTransaction(
          poolAddress,
          amountNumber,
          userAddress
        )
        break
      }

      case 'claimRewards': {
        if (!poolAddress) {
          throw ApiError.badRequest('Pool address required for claimRewards')
        }
        if (!amount) {
          throw ApiError.badRequest('Reward amount required for claimRewards')
        }

        // SECURITY: Verify this submission hasn't already been claimed
        const { DemonstrationSubmission } = await import('../models/Models.ts')
        const amountNumber = AmountValidator.validateBasicAmount(amount)

        // Get submission ID from request if provided (preferred method)
        let submission
        if (submissionId) {
          // Verify submission exists and belongs to user with FRESH read from DB
          submission = await DemonstrationSubmission.findById(submissionId)
          if (!submission) {
            throw ApiError.notFound(`Submission ${submissionId} not found`)
          }
          if (submission.address.toLowerCase() !== userAddress.toLowerCase()) {
            throw ApiError.forbidden('Submission does not belong to authenticated user')
          }
        } else {
          // Fallback: Find submission by pool, user, and amount (less precise)
          submission = await DemonstrationSubmission.findOne({
            address: userAddress.toLowerCase(),
            'claimAuthorization.poolAddress': poolAddress,
            reward: amountNumber,
            $or: [
              { 'onChainReward.txHash': { $exists: false } },
              { 'onChainReward.txHash': null },
              { 'onChainReward.txHash': '' },
              { 'onChainReward.txHash': { $regex: /^CLAIMING_/ } } // Also include pending claims
            ]
          }).sort({ createdAt: -1 }) // Get most recent if multiple
        }

        if (!submission) {
          throw ApiError.notFound('No claimable submission found for this reward')
        }

        // CRITICAL: Check if this submission has already been claimed
        // Ignore CLAIMING_ markers - those are temporary locks, not actual on-chain claims
        if (
          submission.onChainReward?.txHash &&
          !submission.onChainReward.txHash.startsWith('CLAIMING_')
        ) {
          throw ApiError.badRequest(
            `This reward has already been claimed on-chain (tx: ${submission.onChainReward.txHash.substring(0, 10)}...)`
          )
        }

        // RACE CONDITION PROTECTION: Mark submission as "claiming" to prevent concurrent claims
        // Use cryptographically secure UUID to prevent predictable patterns and exploitation
        const claimingMarker = `CLAIMING_${uuidv4()}`


        const lockResult = await DemonstrationSubmission.findOneAndUpdate(
          {
            _id: submission._id,
            $or: [
              { 'onChainReward.txHash': { $exists: false } }, // Not set
              { 'onChainReward.txHash': null }, // Explicitly null
              { 'onChainReward.txHash': '' }, // Empty string
              { 'onChainReward.txHash': { $regex: /^CLAIMING_/ } } // Already has a CLAIMING_ marker (allow retry)
            ]
          },
          {
            $set: {
              'onChainReward.txHash': claimingMarker, // Temporary marker
              'onChainReward.timestamp': Date.now()
            }
          },
          { new: true }
        )
        console.log('lockResult:', lockResult ? 'SUCCESS' : 'FAILED')
        if (!lockResult) {
          throw ApiError.conflict(
            'This reward is currently being claimed or has already been claimed. Please check your claim status.'
          )
        }

        console.log(`Locked submission ${submission._id} for claiming with marker: ${claimingMarker}`)

        try {
          // Import claim auth service
          const { createClaimAuthService } = await import('../services/blockchain/claimAuthService.ts')
          const claimAuthService = createClaimAuthService()

          // Generate EIP-712 signature for claim
          const claimAuthorization = await claimAuthService.generateClaimAuthorization(
            poolAddress,
            userAddress,
            amountNumber
          )

          // Prepare transaction data for payWithSig call
          transactionData = {
            contractAddress: poolAddress,
            abi: RewardPoolImplementationABI,
            functionName: 'payWithSig',
            args: [
              claimAuthorization.account,
              claimAuthorization.cumulativeAmount,
              claimAuthorization.nonce,
              claimAuthorization.signature
            ],
            validations: {
              approved: true,
              alreadyClaimed: claimAuthorization.alreadyClaimed,
              newClaimableAmount: claimAuthorization.newClaimableAmount
            },
            tokenInfo: {
              address: claimAuthorization.tokenAddress,
              symbol: '',
              decimals: 0
            }
          }
        } catch (error) {
          // CRITICAL: If signature generation fails, unlock the submission
          console.error(`Claim authorization failed for ${submission._id}, unlocking...`, error)

          await DemonstrationSubmission.findOneAndUpdate(
            {
              _id: submission._id,
              'onChainReward.txHash': claimingMarker // Only unlock if it's our marker
            },
            {
              $set: {
                'onChainReward.txHash': null,
                'onChainReward.timestamp': null
              }
            }
          )

          console.log(`Unlocked submission ${submission._id} after authorization failure`)

          // Re-throw the error with user-friendly message
          if (error instanceof Error && error.message.includes('timeout')) {
            throw ApiError.serviceUnavailable(
              'Blockchain network timeout. Please try again in a few moments.'
            )
          }
          throw error
        }
        break
      }

      default:
        throw ApiError.badRequest(`Unsupported transaction type: ${type}`)
    }

    // Create a transaction session for polling
    const sessionId = uuidv4()

    // For fundPool and createAndFundPool, include token address for allowance checks
    const transactionParams: TransactionParams = {
      type,
      creator,
      token,
      amount,
      poolAddress
    }
    if ((type === 'fundPool' || type === 'createAndFundPool') && token) {
      const tokenContractAddress = getTokenContractAddress(token)
      transactionParams.tokenAddress = tokenContractAddress
    }
    // For claimRewards, include submissionId for validation
    if (type === 'claimRewards' && submissionId) {
      transactionParams.submissionId = submissionId
    }

    const transactionSession = new TransactionSessionModel({
      sessionId,
      sessionToken,
      transactionType: type,
      status: 'pending',
      transactionParams,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000) // 3 minutes for security
    })

    await transactionSession.save()

    res.status(200).json(
      successResponse({
        ...transactionData,
        type,
        sessionId,
        preparedAt: Date.now()
      })
    )
  })
)

/**
 * @swagger
 * /transaction/status:
 *   get:
 *     summary: Get transaction status
 *     description: Gets the current status of a transaction session for polling
 *     tags: [Transaction]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         required: true
 *         description: The transaction session ID
 *     responses:
 *       200:
 *         description: Transaction status retrieved successfully
 *       404:
 *         description: Transaction session not found
 */
router.get(
  '/status',
  validateQuery(transactionStatusSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionId } = req.query

    const session = await TransactionSessionModel.findOne({ sessionId })
    if (!session) {
      throw ApiError.notFound('Transaction session not found')
    }

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      // Update status to expired if still pending
      if (session.status === 'pending') {
        session.status = 'failed'
        session.error = 'Transaction session expired'
        await session.save()
      }
    }

    res.status(200).json(
      successResponse({
        sessionId: session.sessionId,
        status: session.status,
        transactionType: session.transactionType,
        txHash: session.txHash,
        error: session.error,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt
      })
    )
  })
)

/**
 * @swagger
 * /transaction/complete:
 *   post:
 *     summary: Complete transaction session
 *     description: Marks a transaction session as completed (used by website after successful transaction)
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - status
 *             properties:
 *               sessionId:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [completed, failed, cancelled]
 *               txHash:
 *                 type: string
 *               error:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction session updated successfully
 */
router.post(
  '/complete',
  validateBody(completeTransactionSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionId, status, txHash, error } = req.body

    const session = await TransactionSessionModel.findOne({ sessionId })
    if (!session) {
      throw ApiError.notFound('Transaction session not found')
    }

    // Update session status
    session.status = status

    if (txHash) session.txHash = txHash
    if (error) session.error = error

    await session.save()

    // If this is a claim transaction, update the submission with txHash or clean up lock
    if (
      session.transactionType === 'claimRewards' &&
      session.transactionParams?.submissionId
    ) {
      const { DemonstrationSubmission } = await import('../models/Models.ts')
      const submissionId = session.transactionParams.submissionId

      try {
        if (status === 'completed' && txHash) {
          const grossAmount = parseFloat(session.transactionParams.amount || '0')
          const poolAddress = session.transactionParams.poolAddress || ''

          const feeConfig = await getContractFeeConfig(poolAddress)
          const { feeAmount, netAmount } = calculateFeeAmounts(
            grossAmount,
            feeConfig.feeBps,
            feeConfig.feeDenominator
          )

          // SUCCESS: Replace the CLAIMING_ marker with actual txHash
          const result = await DemonstrationSubmission.findOneAndUpdate(
            {
              _id: submissionId,
              // Accept either CLAIMING_ marker or no txHash (for backwards compatibility)
              $or: [
                { 'onChainReward.txHash': { $regex: /^CLAIMING_/ } },
                { 'onChainReward.txHash': { $exists: false } }
              ]
            },
            {
              $set: {
                'onChainReward.txHash': txHash,
                'onChainReward.timestamp': Date.now(),
                'onChainReward.poolAddress': poolAddress,
                'onChainReward.amount': grossAmount,
                'onChainReward.tokenAddress':
                  session.transactionParams.tokenAddress || '',
                'onChainReward.grossAmount': grossAmount,
                'onChainReward.feeAmount': feeAmount,
                'onChainReward.netAmount': netAmount
              }
            },
            { new: true }
          )

          if (!result) {
            console.warn(
              `Submission ${submissionId} was already claimed or not found during txHash update`
            )
          } else {
            console.log(`Successfully recorded claim for submission ${submissionId}: ${txHash}`)
          }
        } else if (status === 'failed' || status === 'cancelled') {
          // FAILURE: Remove the CLAIMING_ lock to allow retry
          const result = await DemonstrationSubmission.findOneAndUpdate(
            {
              _id: submissionId,
              'onChainReward.txHash': { $regex: /^CLAIMING_/ }
            },
            {
              $set: {
                'onChainReward.txHash': null, // Set to null to allow retry
                'onChainReward.timestamp': null
              }
            },
            { new: true }
          )

          if (result) {
            console.log(
              `Unlocked submission ${submissionId} after ${status} transaction (user can retry)`
            )
          }
        }
      } catch (updateError) {
        // Log but don't fail the request - session was already updated
        console.error('Failed to update submission with txHash:', updateError)
      }
    }

    res.status(200).json(
      successResponse({
        sessionId: session.sessionId,
        status: session.status,
        updatedAt: session.updatedAt
      })
    )
  })
)

/**
 * @swagger
 * /transaction/finalize-factory:
 *   post:
 *     summary: Finalize factory creation and save metadata
 *     description: Verifies transaction on-chain and saves factory metadata to MongoDB
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *               - sessionId
 *               - metadata
 *             properties:
 *               txHash:
 *                 type: string
 *               sessionId:
 *                 type: string
 *               metadata:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   skills:
 *                     type: string
 *                   apps:
 *                     type: array
 *                   token:
 *                     type: string
 *                   fundingAmount:
 *                     type: string
 *     responses:
 *       200:
 *         description: Factory finalized successfully
 */
router.post(
  '/finalize-factory',
  authRateLimit,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { txHash, sessionId, metadata } = req.body

    if (!txHash || !sessionId || !metadata) {
      throw ApiError.badRequest('Missing required fields: txHash, sessionId, metadata')
    }

    try {
      // Verify transaction on-chain
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
      const receipt = await provider.getTransactionReceipt(txHash)

      if (!receipt || receipt.status !== 1) {
        throw ApiError.badRequest('Transaction not found or failed on-chain')
      }

      // Extract pool address from PoolCreated or PoolCreatedAndFunded events
      const factoryInterface = new ethers.Interface([
        'event PoolCreated(address indexed creator, address indexed pool, address indexed token, bytes32 salt, uint256 nonce)',
        'event PoolCreatedAndFunded(address indexed creator, address indexed pool, address indexed token, bytes32 salt, uint256 nonce, uint256 fundingAmount)'
      ])

      let poolAddress: string | null = null
      let creatorAddress: string | null = null
      let tokenAddress: string | null = null

      for (const log of receipt.logs) {
        try {
          const parsedLog = factoryInterface.parseLog({
            topics: log.topics,
            data: log.data
          })

          if (
            parsedLog &&
            (parsedLog.name === 'PoolCreated' || parsedLog.name === 'PoolCreatedAndFunded')
          ) {
            poolAddress = parsedLog.args.pool
            creatorAddress = parsedLog.args.creator
            tokenAddress = parsedLog.args.token
            break
          }
        } catch (_e) { }
      }

      if (!poolAddress || !creatorAddress || !tokenAddress) {
        throw ApiError.badRequest('Could not extract pool information from transaction logs')
      }

      // Get token info
      const tokenSymbol = metadata.token
      const expectedTokenAddress = getTokenContractAddress(tokenSymbol)

      if (tokenAddress.toLowerCase() !== expectedTokenAddress?.toLowerCase()) {
        throw ApiError.badRequest('Token address mismatch in transaction')
      }

      // Validate and sanitize metadata using existing services
      if (!metadata.name || typeof metadata.name !== 'string') {
        throw ApiError.badRequest('Factory name is required')
      }

      const sanitizedName = ContentFilterService.sanitizeInput(metadata.name)
      if (sanitizedName.length === 0) {
        throw ApiError.badRequest('Factory name cannot be empty after sanitization')
      }

      if (!metadata.skills || typeof metadata.skills !== 'string') {
        throw ApiError.badRequest('Skills are required')
      }

      const skills = metadata.skills
        .split(',')
        .map((s: string) => ContentFilterService.sanitizeInput(s))
        .filter((s: string) => s.length > 0)

      if (skills.length === 0) {
        throw ApiError.badRequest('At least one valid skill is required')
      }

      if (!metadata.apps || !Array.isArray(metadata.apps) || metadata.apps.length === 0) {
        throw ApiError.badRequest('At least one app is required')
      }

      let nbTasks = 0
      for (const app of metadata.apps) {
        if (!app.tasks || !Array.isArray(app.tasks)) {
          throw ApiError.badRequest('Each app must have a tasks array')
        }
        nbTasks += app.tasks.length
      }
      if (nbTasks === 0) {
        throw ApiError.badRequest('No tasks found in apps')
      }
      const pricePerDemo = metadata.fundingAmount
        ? AmountValidator.validateBasicAmount(metadata.fundingAmount) / nbTasks
        : 1.0

      // Use MongoDB transaction for atomicity
      const dbSession = await mongoose.startSession()
      dbSession.startTransaction()

      let factory
      try {
        const tokenInfo = getTokenInfo(tokenSymbol)
        factory = await createFactory(
          poolAddress,
          creatorAddress,
          sanitizedName,
          skills,
          metadata.apps,
          {
            type: 'ERC20',
            symbol: tokenSymbol,
            address: tokenAddress.toLowerCase(),
            decimals: tokenInfo.decimals
          },
          pricePerDemo
        )

        await dbSession.commitTransaction()
      } catch (error: unknown) {
        await dbSession.abortTransaction()
        throw error
      } finally {
        dbSession.endSession()
      }

      res.status(200).json(
        successResponse({
          poolAddress,
          creatorAddress,
          tokenAddress,
          factoryId: factory.id,
          name: sanitizedName,
          skills: skills,
          txHash,
          createdAt: new Date().toISOString()
        })
      )
    } catch (error: unknown) {
      console.error('Factory finalization error:', error)

      if (error instanceof ApiError) {
        throw error
      }

      throw ApiError.internalError(
        `Failed to finalize factory: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /transaction/session:
 *   get:
 *     summary: Get transaction session details for website
 *     description: Gets transaction session details including parameters for website display
 *     tags: [Transaction]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         required: true
 *         description: The transaction session ID
 *     responses:
 *       200:
 *         description: Transaction session details retrieved successfully
 *       404:
 *         description: Transaction session not found
 */
router.get(
  '/session',
  validateQuery(transactionStatusSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionId } = req.query

    try {
      const sessionDetails = await TransactionSessionService.validateSessionForWebsite(
        sessionId as string
      )

      res.status(200).json(
        successResponse({
          ...sessionDetails,
          // Additional context for website display
          isExpired: new Date() > new Date(sessionDetails.expiresAt),
          timeRemaining: Math.max(0, new Date(sessionDetails.expiresAt).getTime() - Date.now())
        })
      )
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === 'Transaction session not found') {
          throw ApiError.notFound('Transaction session not found')
        } else if (error.message === 'Transaction session is not pending') {
          throw ApiError.badRequest('Transaction session is no longer pending')
        }
      }
      throw ApiError.internalError('Failed to retrieve transaction session')
    }
  })
)

/**
 * @swagger
 * /transaction/health:
 *   get:
 *     summary: Get circuit breaker health status
 *     description: Returns the status of all circuit breakers for monitoring
 *     tags: [Transaction]
 *     responses:
 *       200:
 *         description: Circuit breaker status retrieved successfully
 */
router.get(
  '/health',
  errorHandlerAsync(async (_req: Request, res: Response) => {
    const circuitBreakerStatus = CircuitBreakerManager.getAllStatus()

    const overallHealth = Object.values(circuitBreakerStatus).every((status) => status.isHealthy)

    res.status(200).json(
      successResponse({
        healthy: overallHealth,
        circuitBreakers: circuitBreakerStatus,
        timestamp: Date.now()
      })
    )
  })
)

export { router as transactionApi }
