import express, { type Response, type Router } from 'express'
import type { AuthenticatedRequest } from '../middleware/types/request.ts'
import { errorHandlerAsync } from '../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../middleware/types/errors.ts'
import { validateBody, validateParams, validateQuery } from '../middleware/validator.ts'
import { authRateLimit, generalRateLimit, strictRateLimit } from '../middleware/rateLimiter.ts'
import { requireWalletAddress } from '../middleware/auth.ts'
import {
  getDatasetsSchema,
  datasetIdParamSchema,
  getDatasetTransactionsQuerySchema,
  getDatasetHoldersQuerySchema,
  getPriceHistoryQuerySchema,
  burnDownloadSchema,
  getDatasetDemonstrationsQuerySchema,
  addDemonstrationToDatasetBodySchema,
  removeDemonstrationFromDatasetParamsSchema,
  createDatasetSchema,
  updateDatasetSchema,
  updateDatasetDemosSchema,
  prepareDeploymentSchema,
  confirmDeploymentSchema
} from './schemas/datamarketplace.ts'
import { DatasetService } from '../services/datamarketplace/datasetService.ts'
import { logger } from '../services/logger.ts'

const router: Router = express.Router()
const datasetService = new DatasetService()

/**
 * @swagger
 * tags:
 *   name: Data Marketplace
 *   description: Dataset token trading and burn-to-download functionality
 */

/**
 * @swagger
 * /api/v1/datamarketplace/datasets:
 *   get:
 *     summary: Get list of datasets with filtering
 *     tags: [Data Marketplace]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of datasets per page
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [all, trending, graduated, new, high-quality]
 *           default: all
 *         description: Filter datasets by category
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by dataset category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in dataset names and descriptions
 *     responses:
 *       200:
 *         description: List of datasets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     datasets:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/DatasetToken'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/datasets',
  generalRateLimit,
  validateQuery(getDatasetsSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { page = 1, limit = 20, filter = 'all', category, search, factoryId } = req.query

    logger.info('Fetching datasets', {
      page: Number(page),
      limit: Number(limit),
      filter,
      category,
      search,
      factoryId
    })

    const result = await datasetService.getDatasets({
      page: Number(page),
      limit: Number(limit),
      filter: filter as any,
      category: category as string,
      search: search as string,
      factoryId: factoryId as string
    })

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}:
 *   get:
 *     summary: Get dataset details by ID
 *     tags: [Data Marketplace]
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     responses:
 *       200:
 *         description: Dataset details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DatasetToken'
 *       404:
 *         description: Dataset not found
 */
router.get('/datasets/:datasetId',
  generalRateLimit,
  validateParams(datasetIdParamSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params

    logger.info('Fetching dataset details', { datasetId })

    const dataset = await datasetService.getDatasetById(datasetId)
    
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    res.json(successResponse(dataset))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/transactions:
 *   get:
 *     summary: Get transaction history for a dataset
 *     tags: [Data Marketplace]
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of transactions per page
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [buy, sell, burn]
 *         description: Filter by transaction type
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Filter by user address
 *     responses:
 *       200:
 *         description: Transaction history
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
 *                     $ref: '#/components/schemas/DatasetTransaction'
 */
router.get('/datasets/:datasetId/transactions',
  generalRateLimit,
  validateParams(datasetIdParamSchema),
  validateQuery(getDatasetTransactionsQuerySchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { page = 1, limit = 50, type, address } = req.query

    logger.info('Fetching dataset transactions', { 
      datasetId, 
      page: Number(page), 
      limit: Number(limit), 
      type, 
      address 
    })

    const transactions = await datasetService.getDatasetTransactions({
      datasetId,
      page: Number(page),
      limit: Number(limit),
      type: type as any,
      address: address as string
    })

    res.json(successResponse(transactions))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/holders:
 *   get:
 *     summary: Get top token holders for a dataset
 *     tags: [Data Marketplace]
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of top holders to return
 *     responses:
 *       200:
 *         description: Top token holders
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
 *                     $ref: '#/components/schemas/DatasetHolder'
 */
router.get('/datasets/:datasetId/holders',
  generalRateLimit,
  validateParams(datasetIdParamSchema),
  validateQuery(getDatasetHoldersQuerySchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { limit = 20 } = req.query

    logger.info('Fetching dataset holders', { datasetId, limit: Number(limit) })

    const holders = await datasetService.getDatasetHolders({
      datasetId,
      limit: Number(limit)
    })

    res.json(successResponse(holders))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/price-history:
 *   get:
 *     summary: Get price history (OHLC) for a dataset
 *     tags: [Data Marketplace]
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *       - in: query
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d, 30d]
 *         description: Time period for price history
 *     responses:
 *       200:
 *         description: Price history data
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
 *                     $ref: '#/components/schemas/DatasetPricePoint'
 */
router.get('/datasets/:datasetId/price-history',
  generalRateLimit,
  validateParams(datasetIdParamSchema),
  validateQuery(getPriceHistoryQuerySchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { period } = req.query

    logger.info('Fetching price history', { datasetId, period })

    const priceHistory = await datasetService.getPriceHistory({
      datasetId,
      period: period as any
    })

    res.json(successResponse(priceHistory))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/burn-download:
 *   post:
 *     summary: Verify burn transaction and generate download link
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - datasetId
 *               - txHash
 *               - address
 *             properties:
 *               datasetId:
 *                 type: string
 *                 description: Dataset ID
 *               txHash:
 *                 type: string
 *                 description: Burn transaction hash
 *               address:
 *                 type: string
 *                 description: Burner wallet address
 *     responses:
 *       200:
 *         description: Download link generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     downloadUrl:
 *                       type: string
 *                       description: Signed download URL
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       description: Download URL expiry time
 *       400:
 *         description: Invalid burn transaction
 *       403:
 *         description: Insufficient burn amount or unauthorized access
 */
router.post('/burn-download',
  strictRateLimit, // Use strict rate limiting for burn operations
  requireWalletAddress, // Require wallet authentication
  validateBody(burnDownloadSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId, txHash, address } = req.body

    logger.info('Processing burn download request', { datasetId, txHash, address })

    // Verify the user is authenticated and owns the address
    if (req.walletAddress?.toLowerCase() !== address.toLowerCase()) {
      throw ApiError.forbidden('Address mismatch with authenticated wallet')
    }

    const result = await datasetService.processBurnDownload({
      datasetId,
      txHash,
      address
    })

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/demonstrations:
 *   get:
 *     summary: Get demonstrations for a dataset
 *     tags: [Data Marketplace]
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of demonstrations per page
 *       - in: query
 *         name: addedBy
 *         schema:
 *           type: string
 *           enum: [automatic, manual]
 *         description: Filter by how demonstration was added
 *     responses:
 *       200:
 *         description: List of demonstrations
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
 *                     $ref: '#/components/schemas/DatasetDemonstration'
 */
router.get('/datasets/:datasetId/demonstrations',
  generalRateLimit,
  validateParams(datasetIdParamSchema),
  validateQuery(getDatasetDemonstrationsQuerySchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { page = 1, limit = 50, addedBy } = req.query

    logger.info('Fetching dataset demonstrations', { 
      datasetId, 
      page: Number(page), 
      limit: Number(limit), 
      addedBy 
    })

    const demonstrations = await datasetService.getDatasetDemonstrations({
      datasetId,
      page: Number(page),
      limit: Number(limit),
      addedBy: addedBy as any
    })

    res.json(successResponse(demonstrations))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/demonstrations:
 *   post:
 *     summary: Add demonstration to dataset
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - demoHash
 *               - addedBy
 *             properties:
 *               demoHash:
 *                 type: string
 *                 description: Demonstration hash
 *               addedBy:
 *                 type: string
 *                 enum: [automatic, manual]
 *                 description: How the demonstration was added
 *               qualityScore:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Quality score of the demonstration
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional notes about the demonstration
 *     responses:
 *       200:
 *         description: Demonstration added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DatasetDemonstration'
 *       409:
 *         description: Demonstration already exists in dataset
 */
router.post('/datasets/:datasetId/demonstrations',
  authRateLimit, // Use auth rate limiting for modifications
  requireWalletAddress, // Require wallet authentication
  validateParams(datasetIdParamSchema),
  validateBody(addDemonstrationToDatasetBodySchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { demoHash, addedBy, qualityScore, notes } = req.body

    logger.info('Adding demonstration to dataset', { 
      datasetId, 
      demoHash, 
      addedBy,
      walletAddress: req.walletAddress 
    })

    const demonstration = await datasetService.addDemonstrationToDataset({
      datasetId,
      demoHash,
      addedBy,
      qualityScore,
      notes
    })

    res.json(successResponse(demonstration))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/demonstrations/{demoHash}:
 *   delete:
 *     summary: Remove demonstration from dataset
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *       - in: path
 *         name: demoHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Demonstration hash
 *     responses:
 *       200:
 *         description: Demonstration removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *       404:
 *         description: Demonstration not found in dataset
 */
router.delete('/datasets/:datasetId/demonstrations/:demoHash',
  authRateLimit, // Use auth rate limiting for modifications
  requireWalletAddress, // Require wallet authentication
  validateParams(removeDemonstrationFromDatasetParamsSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId, demoHash } = req.params

    logger.info('Removing demonstration from dataset', { 
      datasetId, 
      demoHash,
      walletAddress: req.walletAddress 
    })

    await datasetService.removeDemonstrationFromDataset({
      datasetId,
      demoHash
    })

    res.json(successResponse({ message: 'Demonstration removed successfully' }))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets:
 *   post:
 *     summary: Create a new dataset in draft phase
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - symbol
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 100
 *                 description: Dataset name
 *               symbol:
 *                 type: string
 *                 maxLength: 10
 *                 description: Dataset symbol
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Dataset description
 *               category:
 *                 type: string
 *                 maxLength: 50
 *                 description: Dataset category
 *               demoHashes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of demonstration hashes to include
 *               burnThresholdPercentage:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 10
 *                 default: 5
 *                 description: Burn threshold percentage for downloads
 *     responses:
 *       201:
 *         description: Dataset created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *       409:
 *         description: Dataset with same name or symbol already exists
 */
router.post('/datasets',
  authRateLimit,
  requireWalletAddress,
  validateBody(createDatasetSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { name, symbol, description, category, demoHashes = [], factoryId, burnThresholdPercentage = 5 } = req.body

    logger.info('Creating new dataset', {
      name,
      symbol,
      creatorAddress: req.walletAddress,
      demoCount: demoHashes.length,
      demoHashes,
      factoryId
    })

    const dataset = await datasetService.createDataset({
      name,
      symbol,
      description,
      category,
      demoHashes,
      factoryId,
      burnThresholdPercentage,
      creatorAddress: req.walletAddress!
    })

    res.status(201).json(successResponse({ dataset }))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}:
 *   patch:
 *     summary: Update dataset metadata (only in draft phase)
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 100
 *                 description: Dataset name
 *               symbol:
 *                 type: string
 *                 maxLength: 10
 *                 description: Dataset symbol
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Dataset description
 *               category:
 *                 type: string
 *                 maxLength: 50
 *                 description: Dataset category
 *               burnThresholdPercentage:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 10
 *                 description: Burn threshold percentage for downloads
 *     responses:
 *       200:
 *         description: Dataset updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *       403:
 *         description: Dataset not in draft phase or user not owner
 *       404:
 *         description: Dataset not found
 */
router.patch('/datasets/:datasetId',
  authRateLimit,
  requireWalletAddress,
  validateParams(datasetIdParamSchema),
  validateBody(updateDatasetSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const updateData = req.body

    logger.info('Updating dataset metadata', { 
      datasetId,
      updaterAddress: req.walletAddress,
      fields: Object.keys(updateData)
    })

    const dataset = await datasetService.updateDataset({
      datasetId,
      updateData,
      updaterAddress: req.walletAddress!
    })

    res.json(successResponse({ dataset }))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/demos:
 *   patch:
 *     summary: Update demonstration list for dataset (only in draft phase)
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               demoHashesToAdd:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Demonstration hashes to add to the dataset
 *               demoHashesToRemove:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Demonstration hashes to remove from the dataset
 *     responses:
 *       200:
 *         description: Demonstration list updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *                     addedCount:
 *                       type: number
 *                       description: Number of demonstrations added
 *                     removedCount:
 *                       type: number
 *                       description: Number of demonstrations removed
 *       403:
 *         description: Dataset not in draft phase or user not owner
 *       404:
 *         description: Dataset not found
 */
router.patch('/datasets/:datasetId/demos',
  authRateLimit,
  requireWalletAddress,
  validateParams(datasetIdParamSchema),
  validateBody(updateDatasetDemosSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { demoHashesToAdd = [], demoHashesToRemove = [] } = req.body

    logger.info('Updating dataset demonstrations', { 
      datasetId,
      updaterAddress: req.walletAddress,
      toAdd: demoHashesToAdd.length,
      toRemove: demoHashesToRemove.length
    })

    const result = await datasetService.updateDatasetDemos({
      datasetId,
      demoHashesToAdd,
      demoHashesToRemove,
      updaterAddress: req.walletAddress!
    })

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/validate:
 *   post:
 *     summary: Validate dataset and transition from draft to bonding phase
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     responses:
 *       200:
 *         description: Dataset validated and token created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *                     transactionHash:
 *                       type: string
 *                       description: Mock transaction hash for token creation
 *       400:
 *         description: Dataset validation failed (missing required data)
 *       403:
 *         description: Dataset not in draft phase or user not owner
 *       404:
 *         description: Dataset not found
 */
router.post('/datasets/:datasetId/validate',
  authRateLimit,
  requireWalletAddress,
  validateParams(datasetIdParamSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params

    logger.info('Validating dataset for blockchain creation', {
      datasetId,
      validatorAddress: req.walletAddress
    })

    const result = await datasetService.validateDataset({
      datasetId,
      validatorAddress: req.walletAddress!
    })

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/deployment-info:
 *   get:
 *     summary: Get deployment info (fees and predicted address)
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     responses:
 *       200:
 *         description: Deployment information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     ethFee:
 *                       type: string
 *                       description: ETH launch fee (in ETH)
 *                     clonesFee:
 *                       type: string
 *                       description: CLONES token launch fee (in CLONES)
 *                     clonesTokenAddress:
 *                       type: string
 *                       description: CLONES token contract address
 *                     predictedAddress:
 *                       type: string
 *                       description: Predicted dataset contract address (CREATE2)
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *       403:
 *         description: User not dataset creator
 *       404:
 *         description: Dataset not found
 *       503:
 *         description: Blockchain service not configured
 */
router.get('/datasets/:datasetId/deployment-info',
  authRateLimit,
  requireWalletAddress,
  validateParams(datasetIdParamSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params

    logger.info('Fetching deployment info', {
      datasetId,
      creatorAddress: req.walletAddress
    })

    const result = await datasetService.getDeploymentInfo({
      datasetId,
      creatorAddress: req.walletAddress!
    })

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/prepare-deployment:
 *   post:
 *     summary: Prepare dataset deployment transaction
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     responses:
 *       200:
 *         description: Transaction data prepared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionData:
 *                       type: object
 *                       properties:
 *                         to:
 *                           type: string
 *                           description: Factory contract address
 *                         data:
 *                           type: string
 *                           description: Encoded transaction data
 *                         value:
 *                           type: string
 *                           description: ETH value to send (in wei)
 *                         predictedAddress:
 *                           type: string
 *                           description: Predicted dataset token address
 *                         ethFee:
 *                           type: string
 *                           description: ETH launch fee
 *                         clonesFee:
 *                           type: string
 *                           description: CLONES token launch fee
 *                         clonesTokenAddress:
 *                           type: string
 *                           description: CLONES token address for approval
 *                     approvalData:
 *                       type: object
 *                       properties:
 *                         to:
 *                           type: string
 *                           description: CLONES token address
 *                         data:
 *                           type: string
 *                           description: Encoded approval transaction data
 *                         value:
 *                           type: string
 *                           description: Always "0" for approval
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *       400:
 *         description: Dataset validation failed
 *       403:
 *         description: User not dataset creator
 *       404:
 *         description: Dataset not found
 *       503:
 *         description: Blockchain service not configured
 */
router.post('/datasets/:datasetId/prepare-deployment',
  authRateLimit,
  requireWalletAddress,
  validateParams(datasetIdParamSchema),
  validateBody(prepareDeploymentSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params

    logger.info('Preparing dataset deployment', {
      datasetId,
      deployerAddress: req.walletAddress
    })

    const result = await datasetService.prepareDatasetDeployment({
      datasetId,
      deployerAddress: req.walletAddress!
    })

    res.json(successResponse(result))
  })
)

/**
 * @swagger
 * /api/v1/datamarketplace/datasets/{datasetId}/confirm-deployment:
 *   post:
 *     summary: Confirm dataset deployment after transaction broadcast
 *     tags: [Data Marketplace]
 *     security:
 *       - WalletAuth: []
 *     parameters:
 *       - in: path
 *         name: datasetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *             properties:
 *               txHash:
 *                 type: string
 *                 description: Transaction hash from blockchain
 *     responses:
 *       200:
 *         description: Deployment confirmed and dataset updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dataset:
 *                       $ref: '#/components/schemas/DatasetToken'
 *                     onChainData:
 *                       type: object
 *                       properties:
 *                         datasetTokenAddress:
 *                           type: string
 *                           description: Deployed dataset token address
 *                         bondingCurveAddress:
 *                           type: string
 *                           description: Bonding curve contract address
 *                         blockNumber:
 *                           type: number
 *                           description: Block number of deployment
 *                         transactionHash:
 *                           type: string
 *                           description: Transaction hash
 *       400:
 *         description: Transaction failed or data mismatch
 *       403:
 *         description: User not dataset creator
 *       404:
 *         description: Dataset not found
 *       503:
 *         description: Blockchain service not configured
 */
router.post('/datasets/:datasetId/confirm-deployment',
  authRateLimit,
  requireWalletAddress,
  validateParams(datasetIdParamSchema),
  validateBody(confirmDeploymentSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { datasetId } = req.params
    const { txHash } = req.body

    logger.info('Confirming dataset deployment', {
      datasetId,
      txHash,
      deployerAddress: req.walletAddress
    })

    const result = await datasetService.confirmDatasetDeployment({
      datasetId,
      txHash,
      deployerAddress: req.walletAddress!
    })

    res.json(successResponse(result))
  })
)

export default router