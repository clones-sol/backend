import express, { type Request, type Response, type Router } from 'express'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../../middleware/types/errors.ts'
import {
  ValidationRules,
  validateBody,
  validateParams,
  validateQuery
} from '../../middleware/validator.ts'
import { FactoryModel } from '../../models/Factory.ts'
import { createFactoryService } from '../../services/blockchain/factoryTransactionService.ts'
import BlockchainService from '../../services/blockchain/index.ts'
import { getTokenContractAddress, supportedTokens } from '../../services/blockchain/tokens.ts'
import { getFactoryDemonstrationCount, getFactoriesDemonstrationCounts } from '../../utils/factoryStats.ts'
import telegramService from '../../services/telegram.js'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import {
  type Factory,
  type FactorySearchCriteria,
  type FactorySearchResult,
  type FactoryWithDemonstrations,
  FactoryStatus,
} from '../../types/factory.ts'
import { logger } from "../../services/logger.ts"
import {
  batchClaimSchema,
  createPoolSchema,
  fundPoolSchema,
  generateClaimSchema,
  getUserFactoriesSchema,
  poolAddressParamSchema,
  poolInfoQuerySchema,
  predictPoolSchema,
  searchFactoriesSchema,
  withdrawPoolSchema
} from '../schemas/forgeFactory.ts'

// MongoDB query and sort types
interface MongoQuery {
  [key: string]: unknown
  $and?: Array<Record<string, unknown>>
  ownerAddress?: string
  status?: FactoryStatus
}

interface MongoSort {
  [key: string]: 1 | -1
}

interface PredictPoolQuery {
  creator: string
  token: string
}

interface PoolInfoQuery {
  account: string
}

const router: Router = express.Router()
const blockchainService = new BlockchainService(process.env.RPC_URL || '')

/**
 * @swagger
 * tags:
 *   name: Factories
 *   description: Factories management and search
 */

/**
 * @swagger
 * /forge/factories/supported-tokens:
 *   get:
 *     summary: Get the list of supported reward tokens
 *     tags: [Factories]
 *     responses:
 *       '200':
 *         description: A list of supported tokens.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       symbol:
 *                         type: string
 *                       name:
 *                         type: string
 */
router.get(
  '/supported-tokens',
  errorHandlerAsync(async (_req: Request, res: Response) => {
    const tokens = Object.entries(supportedTokens).map(([symbol, { name }]) => ({
      symbol,
      name
    }))
    res.status(200).json(successResponse(tokens))
  })
)

/**
 * @swagger
 * /forge/factories:
 *   post:
 *     summary: Search factories with advanced filtering
 *     tags: [Factories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skills:
 *                 type: array
 *                 items: { type: string }
 *               searchTerm:
 *                 type: string
 *               creator:
 *                 type: string
 *                 format: hex
 *               token:
 *                 type: string
 *                 format: hex
 *               status:
 *                 type: string
 *                 enum: [active, paused, error, no-funds]
 *               tags:
 *                 type: array
 *                 items: { type: string }
 *               limit:
 *                 type: integer
 *                 default: 20
 *               offset:
 *                 type: integer
 *                 default: 0
 *               sortBy:
 *                 type: string
 *                 enum: [createdAt, totalEarned]
 *                 default: createdAt
 *               sortOrder:
 *                 type: string
 *                 enum: [asc, desc]
 *                 default: desc
 *     responses:
 *       '200':
 *         description: Factory search results
 *       '400':
 *         description: Invalid search criteria
 */
router.post(
  '/search',
  validateBody(searchFactoriesSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const criteria: FactorySearchCriteria = {
      skills: req.body.skills,
      searchTerm: req.body.searchTerm,
      ownerAddress: req.body.creator?.toLowerCase(),
      token: req.body.token?.toLowerCase(),
      status: req.body.status,
      limit: req.body.limit || 20,
      offset: req.body.offset || 0,
      sortBy: req.body.sortBy || 'createdAt',
      sortOrder: req.body.sortOrder || 'desc'
    }

    // Build MongoDB query
    const query: MongoQuery = {}
    const andConditions: Array<Record<string, unknown>> = []

    if (criteria.skills && criteria.skills.length > 0) {
      andConditions.push({ skills: { $in: criteria.skills } })
    }

    if (criteria.searchTerm) {
      andConditions.push({
        $or: [
          { searchText: { $regex: criteria.searchTerm, $options: 'i' } },
          { name: { $regex: criteria.searchTerm, $options: 'i' } },
          { description: { $regex: criteria.searchTerm, $options: 'i' } }
        ]
      })
    }

    if (criteria.ownerAddress) {
      andConditions.push({ ownerAddress: criteria.ownerAddress })
    }

    if (criteria.token) {
      andConditions.push({ 'token.address': criteria.token })
    }

    if (criteria.status) {
      andConditions.push({ status: criteria.status })
    }

    if (andConditions.length > 0) {
      query.$and = andConditions
    }

    // Build sort
    const sortField = criteria.sortBy || 'createdAt'
    const sortDirection = criteria.sortOrder === 'asc' ? 1 : -1
    const sort: MongoSort = {}
    sort[sortField] = sortDirection

    // Execute query with guaranteed non-null values
    const limit = criteria.limit ?? 20
    const offset = criteria.offset ?? 0

    const factories = await FactoryModel.find(query)
      .skip(offset)
      .limit(limit)
      .sort(sort)

    const total = await FactoryModel.countDocuments(query)

    // Add demonstration counts to factories
    const factoryIds = factories.map(f => (f as any)._id.toString())
    const demonstrationCounts = await getFactoriesDemonstrationCounts(factoryIds)

    const factoriesWithDemonstrations = factories.map(factory => ({
      ...factory.toJSON(),
      id: (factory as any)._id.toString(),
      demonstrations: demonstrationCounts.get((factory as any)._id.toString()) ?? 0
    })) as FactoryWithDemonstrations[]

    const result: FactorySearchResult = {
      factories: factoriesWithDemonstrations,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /forge/factories:
 *   get:
 *     summary: Get factories for authenticated user
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, paused, error, no-funds]
 *     responses:
 *       '200':
 *         description: User's factories
 */
router.get(
  '/',
  requireWalletAddress,
  validateQuery(getUserFactoriesSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-expect-error
    const ownerAddress = req.walletAddress.toLowerCase()
    const limit = parseInt(req.query.limit as string, 10) || 20
    const offset = parseInt(req.query.offset as string, 10) || 0
    const status = req.query.status as FactoryStatus

    const query: MongoQuery = { ownerAddress }
    if (status) {
      query.status = status
    }

    const factories = await FactoryModel.find(query)
      .skip(offset)
      .limit(limit)
      .sort({ createdAt: -1 })

    const total = await FactoryModel.countDocuments(query)

    // Add demonstration counts to factories
    const factoryIds = factories.map(f => (f as any)._id.toString())
    const demonstrationCounts = await getFactoriesDemonstrationCounts(factoryIds)

    const factoriesWithDemonstrations = factories.map(factory => ({
      ...factory.toJSON(),
      id: (factory as any)._id.toString(),
      demonstrations: demonstrationCounts.get((factory as any)._id.toString()) ?? 0
    })) as FactoryWithDemonstrations[]

    const result: FactorySearchResult = {
      factories: factoriesWithDemonstrations,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /forge/factories/{id}:
 *   get:
 *     summary: Get factory by ID
 *     tags: [Factories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Factory ID
 *     responses:
 *       '200':
 *         description: Factory details
 *       '404':
 *         description: Factory not found
 */
router.get(
  '/:id',
  validateParams({
    id: { required: true, rules: [ValidationRules.isString()] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id } = req.params

    const factory = await FactoryModel.findById(id)

    if (!factory) {
      throw ApiError.notFound('Factory not found')
    }

    const [balance, demonstrations] = await Promise.all([
      blockchainService.getTokenBalance(factory.token.address, factory.poolAddress),
      getFactoryDemonstrationCount(id)
    ])

    res.json(
      successResponse({
        ...factory.toJSON(),
        balance,
        demonstrations
      })
    )
  })
)

/**
 * @swagger
 * /forge/factories/pools/{poolAddress}/balance:
 *   get:
 *     summary: Get pool balance
 *     tags: [Factories]
 *     parameters:
 *       - in: path
 *         name: poolAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: Pool address
 *     responses:
 *       '200':
 *         description: Pool balance
 *       '400':
 *         description: Invalid pool address
 *       '500':
 *         description: Internal server error
 */
router.get(
  '/pools/:poolAddress/balance',
  validateParams({
    poolAddress: { required: true, rules: [ValidationRules.isString()] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { poolAddress } = req.params

    try {
      const factoryService = createFactoryService()
      const poolInfo = await factoryService.getPoolInfo(poolAddress)

      res.json(
        successResponse({
          balance: poolInfo.tokenBalance,
          tokenAddress: poolInfo.tokenAddress,
          tokenSymbol: poolInfo.tokenSymbol
        })
      )
    } catch (error) {
      logger.error('Failed to get pool balance:', error)
      throw ApiError.internalError(
        `Failed to get pool balance: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/{id}:
 *   put:
 *     summary: Update factory
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items: { type: string }
 *               status:
 *                 type: string
 *                 enum: [active, paused]
 *               tags:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       '200':
 *         description: Factory updated successfully
 *       '403':
 *         description: Not authorized to update this factory
 *       '404':
 *         description: Factory not found
 */
router.put(
  '/:id',
  requireWalletAddress,
  validateParams({
    id: { required: true, rules: [ValidationRules.isString()] }
  }),
  validateBody({
    name: {
      required: false,
      rules: [
        ValidationRules.isString(),
        ValidationRules.minLength(1),
        ValidationRules.maxLength(100)
      ]
    },
    description: {
      required: false,
      rules: [ValidationRules.isString(), ValidationRules.maxLength(1000)]
    },
    skills: { required: false, rules: [ValidationRules.isArray()] },
    status: {
      required: false,
      rules: [ValidationRules.isIn([FactoryStatus.active, FactoryStatus.paused])]
    },
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id } = req.params
    // @ts-expect-error
    const ownerAddress = req.walletAddress.toLowerCase()

    const factory = await FactoryModel.findById(id)

    if (!factory) {
      throw ApiError.notFound('Factory not found')
    }

    if (factory.ownerAddress !== ownerAddress) {
      throw ApiError.forbidden('Not authorized to update this factory')
    }

    // Store original status to detect activation
    const originalStatus = factory.status


    // Update fields
    if (req.body.name !== undefined) factory.name = req.body.name
    if (req.body.description !== undefined) factory.description = req.body.description
    if (req.body.skills !== undefined) factory.skills = req.body.skills
    if (req.body.status !== undefined) factory.status = req.body.status

    await factory.save()

    // Send Telegram notification if factory was activated
    if (originalStatus === FactoryStatus.paused && factory.status === FactoryStatus.active) {
      telegramService.sendFactoryActivationNotification({
        factoryId: factory._id.toString(),
        factoryName: factory.name,
        ownerAddress: factory.ownerAddress
      }).catch(error => {
        logger.error('Failed to send factory activation notification:', error)
      })
    }

    const updatedFactory = await FactoryModel.findById(id)
    res.json(successResponse(updatedFactory?.toJSON()))
  })
)

/**
 * @swagger
 * /forge/factories/pools:
 *   post:
 *     summary: Create a new reward pool
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 format: hex
 *               creator:
 *                 type: string
 *                 format: hex
 *     responses:
 *       '200':
 *         description: Pool creation transaction data
 *       '403':
 *         description: Not authorized to create this pool
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/pools',
  requireWalletAddress,
  validateBody(createPoolSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { token, creator } = req.body
    const authenticatedAddress = (req as Request & { walletAddress: string }).walletAddress

    if (authenticatedAddress.toLowerCase() !== creator.toLowerCase()) {
      throw ApiError.forbidden('Authenticated user does not match creator address')
    }

    try {
      const factoryService = createFactoryService()
      const tokenAddress = getTokenContractAddress(token)

      const transactionData = await factoryService.prepareCreatePoolTransaction(
        tokenAddress,
        creator
      )

      res.status(200).json(
        successResponse({
          ...transactionData,
          creator,
          token
        })
      )
    } catch (error) {
      logger.error('Pool creation preparation failed:', error)
      throw ApiError.internalError(
        `Pool creation preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/pools/predict-address:
 *   post:
 *     summary: Predict reward pool address
 *     tags: [Factories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - creator
 *               - token
 *             properties:
 *               creator:
 *                 type: string
 *                 format: hex
 *               token:
 *                 type: string
 *                 format: hex
 *     responses:
 *       '200':
 *         description: Pool prediction data
 *       '400':
 *         description: Invalid parameters
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/pools/predict-address',
  validateBody(predictPoolSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { creator, token } = req.body as PredictPoolQuery

    try {
      const factoryService = createFactoryService()
      const tokenAddress = getTokenContractAddress(token)
      const result = await factoryService.predictPoolAddress(creator, tokenAddress)

      res.status(200).json(
        successResponse({
          predicted: result.predicted,
          salt: result.salt,
          creator,
          token
        })
      )
    } catch (error) {
      logger.error('Pool prediction failed:', error)
      throw ApiError.internalError(
        `Pool prediction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/pools/{poolAddress}:
 *   get:
 *     summary: Get reward pool information
 *     tags: [Factories]
 *     parameters:
 *       - in: path
 *         name: poolAddress
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: account
 *         required: false
 *         schema:
 *           type: string
 *           format: hex
 *     responses:
 *       '200':
 *         description: Pool information
 *       '400':
 *         description: Invalid parameters
 *       '500':
 *         description: Internal server error
 */
router.get(
  '/pools/:poolAddress',
  validateParams(poolAddressParamSchema),
  validateQuery(poolInfoQuerySchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { poolAddress } = req.params
    const { account } = req.query as unknown as PoolInfoQuery

    try {
      const factoryService = createFactoryService()
      const poolInfo = await factoryService.getPoolInfo(poolAddress, account)

      res.status(200).json(
        successResponse({
          poolAddress,
          ...poolInfo
        })
      )
    } catch (error) {
      logger.error('Failed to get pool info:', error)
      throw ApiError.internalError(
        `Failed to get pool info: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/{id}/grading-results:
 *   get:
 *     summary: Get a list of grading results for a factory's completed demonstrations
 *     tags: [Factories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Factory ID
 *     responses:
 *       '200':
 *         description: A list of grading results for the factory
 *       '404':
 *         description: Factory not found
 */
router.get(
  '/:id/grading-results',
  validateParams({
    id: { required: true, rules: [ValidationRules.isString()] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id: factoryId } = req.params

    const factory = await FactoryModel.findById(factoryId)
    if (!factory) {
      throw ApiError.notFound('Factory not found')
    }

    const submissions = await DemonstrationSubmission.find(
      {
        'meta.quest.pool_id': factoryId,
        status: 'completed',
        'grade_result.score': { $exists: true, $ne: null }
      },
      {
        'grade_result.score': 1,
        'grade_result.confidence': 1,
        'grade_result.outcomeAchievement': 1,
        'grade_result.processQuality': 1,
        'grade_result.efficiency': 1,
        createdAt: 1,
        _id: 1
      }
    )
      .sort({ createdAt: -1 })
      .lean()

    const results = submissions
      .filter(sub => sub.grade_result)
      .map(sub => ({
        submissionId: sub._id,
        createdAt: sub.createdAt,
        score: sub.grade_result!.score,
        confidence: sub.grade_result!.confidence,
        outcomeAchievement: sub.grade_result!.outcomeAchievement,
        processQuality: sub.grade_result!.processQuality,
        efficiency: sub.grade_result!.efficiency
      }))

    res.json(successResponse(results))
  })
)

/**
 * @swagger
 * /forge/factories/pools/fund:
 *   post:
 *     summary: Fund a reward pool
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               poolAddress:
 *                 type: string
 *                 format: hex
 *               amount:
 *                 type: number
 *     responses:
 *       '200':
 *         description: Pool funding transaction data
 *       '403':
 *         description: Not authorized to fund this pool
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/pools/fund',
  requireWalletAddress,
  validateBody(fundPoolSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { poolAddress, amount } = req.body

    try {
      const factoryService = createFactoryService()
      const authenticatedAddress = (req as Request & { walletAddress: string }).walletAddress

      const transactionData = await factoryService.prepareFundPoolTransaction(
        poolAddress,
        amount,
        authenticatedAddress
      )

      res.status(200).json(
        successResponse({
          ...transactionData,
          poolAddress,
          amount,
          funderAddress: authenticatedAddress
        })
      )
    } catch (error) {
      logger.error('Pool funding preparation failed:', error)
      throw ApiError.internalError(
        `Pool funding preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/claims:
 *   post:
 *     summary: Generate a single claim signature
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vaultAddress:
 *                 type: string
 *                 format: hex
 *               account:
 *                 type: string
 *                 format: hex
 *               cumulativeAmount:
 *                 type: number
 *     responses:
 *       '200':
 *         description: Claim signature data
 *       '400':
 *         description: Invalid parameters
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/claims',
  requireWalletAddress,
  validateBody(generateClaimSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { vaultAddress, account, cumulativeAmount } = req.body

    try {
      const factoryService = createFactoryService()

      const signatureData = await factoryService.prepareClaimSignatureData(
        vaultAddress,
        account,
        cumulativeAmount
      )

      res.status(200).json(
        successResponse({
          vaultAddress,
          account,
          cumulativeAmount,
          ...signatureData
        })
      )
    } catch (error) {
      logger.error('Claim signature preparation failed:', error)
      throw ApiError.internalError(
        `Claim signature preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/claims/batch:
 *   post:
 *     summary: Generate batch claim data
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               claims:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     vaultAddress:
 *                       type: string
 *                       format: hex
 *                     account:
 *                       type: string
 *                       format: hex
 *                     cumulativeAmount:
 *                       type: number
 *     responses:
 *       '200':
 *         description: Batch claim data
 *       '400':
 *         description: Invalid parameters
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/claims/batch',
  requireWalletAddress,
  validateBody(batchClaimSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { claims } = req.body

    try {
      const factoryService = createFactoryService()
      const batchData = await factoryService.prepareBatchClaimData(claims)

      res.status(200).json(
        successResponse({
          ...batchData,
          count: batchData.claimDataForSigning.length
        })
      )
    } catch (error) {
      logger.error('Batch claim preparation failed:', error)
      throw ApiError.internalError(
        `Batch claim preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/publisher:
 *   get:
 *     summary: Get current publisher information
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     responses:
 *       '200':
 *         description: Publisher information
 *       '500':
 *         description: Internal server error
 */
router.get(
  '/publisher',
  errorHandlerAsync(async (_req: Request, res: Response) => {
    try {
      const factoryService = createFactoryService()
      const publisherInfo = await factoryService.getPublisherInfo()

      res.status(200).json(
        successResponse({
          ...publisherInfo
        })
      )
    } catch (error) {
      logger.error('Failed to get publisher info:', error)
      throw ApiError.internalError(
        `Failed to get publisher info: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

/**
 * @swagger
 * /forge/factories/pools/withdraw:
 *   post:
 *     summary: Withdraw funds from a reward pool (creator only)
 *     tags: [Factories]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               poolAddress:
 *                 type: string
 *                 format: hex
 *               amount:
 *                 type: number
 *     responses:
 *       '200':
 *         description: Pool withdrawal transaction data
 *       '403':
 *         description: Not authorized to withdraw from this pool
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/pools/withdraw',
  requireWalletAddress,
  validateBody(withdrawPoolSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { poolAddress, amount } = req.body

    try {
      const factoryService = createFactoryService()

      const authenticatedAddress = (req as Request & { walletAddress: string }).walletAddress

      const transactionData = await factoryService.prepareWithdrawPoolTransaction(
        poolAddress,
        amount,
        authenticatedAddress
      )

      res.status(200).json(
        successResponse({
          ...transactionData,
          poolAddress,
          amount,
          withdrawerAddress: authenticatedAddress
        })
      )
    } catch (error) {
      logger.error('Pool withdrawal preparation failed:', error)
      throw ApiError.internalError(
        `Pool withdrawal preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })
)

export { router as factoriesApi }
