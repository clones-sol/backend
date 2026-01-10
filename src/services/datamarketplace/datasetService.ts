import { randomUUID } from 'crypto'
import {
  DatasetPhase,
  DatasetTransactionType,
  type DatasetToken,
  type DatasetTransaction,
  type DatasetHolder,
  type DatasetPricePoint,
  type DatasetBurnRecord,
  type DatasetDemonstration,
  type GetDatasetsRequest,
  type GetDatasetsResponse,
  type GetDatasetTransactionsRequest,
  type GetDatasetHoldersRequest,
  type GetPriceHistoryRequest,
  type BurnDownloadRequest,
  type BurnDownloadResponse,
  type GetDatasetDemonstrationsRequest,
  type AddDemonstrationToDatasetRequest,
  type RemoveDemonstrationFromDatasetRequest
} from '../../types/datamarketplace.ts'
import { ApiError } from '../../middleware/types/errors.ts'
import { logger } from '../logger.ts'
import { Dataset } from '../../models/Dataset.ts'
import { dataMarketplaceBlockchainService } from './blockchainService.ts'

/**
 * Service for data marketplace operations
 * Manages dataset lifecycle with MongoDB persistence
 * Note: Blockchain token deployment will be added in future iterations
 */
export class DatasetService {
  private transactions: DatasetTransaction[] = []
  private holders: Map<string, DatasetHolder[]> = new Map()
  private priceHistory: Map<string, DatasetPricePoint[]> = new Map()
  private burnRecords: DatasetBurnRecord[] = []
  private datasetDemonstrations: DatasetDemonstration[] = []

  constructor() {
    // No initialization needed - datasets are in MongoDB
  }

  /**
   * Convert MongoDB document to DatasetToken format
   */
  private toDatasetToken(doc: any): DatasetToken {
    return {
      id: doc._id,
      name: doc.name,
      symbol: doc.symbol,
      description: doc.description,
      category: doc.category,
      contractAddress: doc.contractAddress,
      creatorAddress: doc.creatorAddress,
      factoryId: doc.factoryId,
      totalSupply: doc.totalSupply,
      currentPrice: doc.currentPrice,
      marketCap: doc.marketCap,
      volume24h: doc.volume24h,
      qualityScore: doc.qualityScore,
      demonstrationCount: doc.demonstrationCount,
      burnThresholdPercentage: doc.burnThresholdPercentage,
      totalBurned: doc.totalBurned,
      burnCount: doc.burnCount,
      phase: doc.phase,
      bondingCurve: doc.bondingCurve,
      graduationInfo: doc.graduationInfo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    }
  }

  /**
   * Calculate bonding curve price based on phase
   */
  private calculateBondingCurvePrice(isGraduated: boolean): number {
    if (isGraduated) {
      // Graduated datasets have higher, more stable prices
      return 0.00008 + Math.random() * 0.00005
    } else {
      // Bonding curve datasets have lower, more volatile prices
      return 0.000001 + Math.random() * 0.00002
    }
  }

  /**
   * Generate mock transaction history for a dataset
   */
  private generateMockTransactions(datasetId: string): void {
    if (this.transactions.some(t => t.datasetId === datasetId)) return

    const transactionCount = 50 + Math.floor(Math.random() * 100)
    const now = Date.now()

    for (let i = 0; i < transactionCount; i++) {
      const timestamp = new Date(now - Math.random() * 30 * 24 * 60 * 60 * 1000)
      const type = Math.random() < 0.6 ? DatasetTransactionType.buy :
                   Math.random() < 0.8 ? DatasetTransactionType.sell :
                   DatasetTransactionType.burn

      const tokenAmount = 1000 + Math.random() * 100000
      const pricePerToken = this.calculateBondingCurvePrice(Math.random() < 0.5)
      const ethAmount = tokenAmount * pricePerToken

      this.transactions.push({
        id: randomUUID(),
        datasetId,
        txHash: `0x${randomUUID().replace(/-/g, '')}`,
        blockNumber: 12000000 + Math.floor(Math.random() * 100000),
        timestamp,
        fromAddress: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
        type,
        tokenAmount,
        ethAmount,
        pricePerToken,
        createdAt: timestamp
      })
    }
  }

  /**
   * Generate mock holders for a dataset
   */
  private generateMockHolders(datasetId: string): void {
    if (this.holders.has(datasetId)) return

    const holderCount = 20 + Math.floor(Math.random() * 80)
    const holders: DatasetHolder[] = []
    let totalBalance = 0

    for (let i = 0; i < holderCount; i++) {
      // Generate realistic distribution - few large holders, many small holders
      const balance = Math.pow(Math.random(), 3) * 50000000 + 1000
      totalBalance += balance

      holders.push({
        id: randomUUID(),
        datasetId,
        holderAddress: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
        balance,
        percentage: 0, // Will be calculated after we know total
        lastUpdated: new Date()
      })
    }

    // Calculate percentages based on total balance
    holders.forEach(holder => {
      holder.percentage = (holder.balance / totalBalance) * 100
    })

    // Sort by balance descending
    holders.sort((a, b) => b.balance - a.balance)

    this.holders.set(datasetId, holders)
  }

  /**
   * Generate mock price history for a dataset
   */
  private generateMockPriceHistory(datasetId: string): void {
    const pricePoints: DatasetPricePoint[] = []
    const now = Date.now()
    const basePrice = this.calculateBondingCurvePrice(Math.random() < 0.5)

    // Generate 30 days of daily price points
    for (let i = 30; i >= 0; i--) {
      const timestamp = new Date(now - i * 24 * 60 * 60 * 1000)
      const open = basePrice * (0.8 + Math.random() * 0.4)
      const volatility = 0.1 + Math.random() * 0.2
      const high = open * (1 + volatility)
      const low = open * (1 - volatility)
      const close = low + Math.random() * (high - low)
      const volume = Math.random() * 10000

      pricePoints.push({
        id: randomUUID(),
        datasetId,
        timestamp,
        open,
        high,
        low,
        close,
        volume,
        period: '1d',
        createdAt: timestamp
      })
    }

    this.priceHistory.set(datasetId, pricePoints)
  }

  /**
   * Generate mock demonstrations for a dataset
   */
  private generateMockDemonstrations(datasetId: string): void {
    const demonstrationCount = 50 + Math.floor(Math.random() * 200) // 50-250 demos per dataset
    const now = Date.now()

    for (let i = 0; i < demonstrationCount; i++) {
      // Generate realistic demoHash (similar to what's used in DemonstrationSubmission)
      const demoHash = `demo_${randomUUID().replace(/-/g, '').slice(0, 16)}`
      
      const addedAt = new Date(now - Math.random() * 60 * 24 * 60 * 60 * 1000) // Last 60 days
      const addedBy = Math.random() < 0.7 ? 'automatic' : 'manual' // 70% automatic, 30% manual
      
      // Quality score - use default base quality for mock demonstrations
      const baseQuality = 80
      const qualityScore = Math.max(30, Math.min(100, baseQuality + (Math.random() - 0.5) * 30))

      this.datasetDemonstrations.push({
        id: randomUUID(),
        datasetId,
        demoHash,
        addedAt,
        addedBy,
        qualityScore: Math.round(qualityScore),
        notes: addedBy === 'manual' ? `Manual curation - ${Math.random() < 0.5 ? 'high quality' : 'meets criteria'}` : undefined
      })
    }
  }

  /**
   * Get datasets with filtering and pagination
   */
  async getDatasets(request: GetDatasetsRequest): Promise<GetDatasetsResponse> {
    const query: any = {}

    // Apply filters
    if (request.filter && request.filter !== 'all') {
      switch (request.filter) {
        case 'trending':
          query.volume24h = { $gt: 15000 }
          break
        case 'graduated':
          query.phase = DatasetPhase.graduated
          break
        case 'new':
          const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
          query.createdAt = { $gt: threeDaysAgo }
          break
        case 'high-quality':
          query.qualityScore = { $gte: 90 }
          break
      }
    }

    // Apply category filter
    if (request.category) {
      query.category = request.category
    }

    // Apply factoryId filter
    if (request.factoryId) {
      query.factoryId = request.factoryId
    }

    // Apply search filter
    if (request.search) {
      const searchRegex = new RegExp(request.search, 'i')
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { category: searchRegex }
      ]
    }

    // Count total matching documents
    const total = await Dataset.countDocuments(query)

    // Apply pagination
    const page = request.page || 1
    const limit = request.limit || 20
    const skip = (page - 1) * limit

    // Fetch datasets with pagination
    const docs = await Dataset
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec()

    const datasets = docs.map(doc => this.toDatasetToken(doc))

    return {
      datasets,
      total,
      page,
      limit
    }
  }

  /**
   * Get dataset by ID
   */
  async getDatasetById(datasetId: string): Promise<DatasetToken | null> {
    const doc = await Dataset.findById(datasetId).lean().exec()
    return doc ? this.toDatasetToken(doc) : null
  }

  /**
   * Get dataset transactions
   */
  async getDatasetTransactions(request: GetDatasetTransactionsRequest): Promise<DatasetTransaction[]> {
    let filteredTransactions = this.transactions.filter(t => t.datasetId === request.datasetId)

    // Apply filters
    if (request.type) {
      filteredTransactions = filteredTransactions.filter(t => t.type === request.type)
    }

    if (request.address) {
      filteredTransactions = filteredTransactions.filter(t => 
        t.fromAddress.toLowerCase() === request.address!.toLowerCase()
      )
    }

    // Sort by timestamp descending
    filteredTransactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Apply pagination
    const page = request.page || 1
    const limit = request.limit || 50
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit

    return filteredTransactions.slice(startIndex, endIndex)
  }

  /**
   * Get dataset holders
   */
  async getDatasetHolders(request: GetDatasetHoldersRequest): Promise<DatasetHolder[]> {
    const holders = this.holders.get(request.datasetId) || []
    const limit = request.limit || 20

    return holders.slice(0, limit)
  }

  /**
   * Get price history
   */
  async getPriceHistory(request: GetPriceHistoryRequest): Promise<DatasetPricePoint[]> {
    const allPricePoints = this.priceHistory.get(request.datasetId) || []
    const now = Date.now()

    let cutoffTime: number
    switch (request.period) {
      case '1h':
        cutoffTime = now - 60 * 60 * 1000
        break
      case '24h':
        cutoffTime = now - 24 * 60 * 60 * 1000
        break
      case '7d':
        cutoffTime = now - 7 * 24 * 60 * 60 * 1000
        break
      case '30d':
        cutoffTime = now - 30 * 24 * 60 * 60 * 1000
        break
      default:
        cutoffTime = now - 24 * 60 * 60 * 1000
    }

    return allPricePoints
      .filter(p => p.timestamp.getTime() >= cutoffTime)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  /**
   * Process burn download request (mock)
   */
  async processBurnDownload(request: BurnDownloadRequest): Promise<BurnDownloadResponse> {
    // Find the dataset
    const dataset = await this.getDatasetById(request.datasetId)
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is graduated
    if (dataset.phase !== DatasetPhase.graduated) {
      throw ApiError.badRequest('Burns only allowed for graduated datasets')
    }

    // Mock transaction verification
    const transaction = this.transactions.find(t => t.txHash === request.txHash)
    if (!transaction) {
      throw ApiError.badRequest('Transaction not found')
    }

    if (transaction.type !== DatasetTransactionType.burn) {
      throw ApiError.badRequest('Transaction is not a burn transaction')
    }

    if (transaction.fromAddress.toLowerCase() !== request.address.toLowerCase()) {
      throw ApiError.badRequest('Transaction address mismatch')
    }

    // Check burn threshold
    const requiredBurnAmount = (dataset.totalSupply * dataset.burnThresholdPercentage) / 100
    if (transaction.tokenAmount < requiredBurnAmount) {
      throw ApiError.badRequest(`Insufficient burn amount. Required: ${requiredBurnAmount}, provided: ${transaction.tokenAmount}`)
    }

    // Check if user already burned for this dataset
    const existingBurn = this.burnRecords.find(b => 
      b.datasetId === request.datasetId && 
      b.burnerAddress.toLowerCase() === request.address.toLowerCase()
    )

    if (existingBurn) {
      throw ApiError.badRequest('Address has already burned tokens for this dataset')
    }

    // Create burn record
    const burnRecord: DatasetBurnRecord = {
      id: randomUUID(),
      datasetId: request.datasetId,
      burnerAddress: request.address,
      txHash: request.txHash,
      tokenAmount: transaction.tokenAmount,
      timestamp: new Date(),
      downloadUrl: `https://mock-storage.example.com/datasets/${dataset.id}/download?token=${randomUUID()}`,
      downloadExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour expiry
      createdAt: new Date()
    }

    this.burnRecords.push(burnRecord)

    // Update dataset burn stats
    dataset.totalBurned += transaction.tokenAmount
    dataset.burnCount += 1

    logger.info('Burn download processed', { 
      datasetId: request.datasetId,
      burnerAddress: request.address,
      tokenAmount: transaction.tokenAmount 
    })

    return {
      downloadUrl: burnRecord.downloadUrl!,
      expiresAt: burnRecord.downloadExpiry!
    }
  }

  /**
   * Get demonstrations for a dataset
   */
  async getDatasetDemonstrations(request: GetDatasetDemonstrationsRequest): Promise<DatasetDemonstration[]> {
    let filteredDemonstrations = this.datasetDemonstrations.filter(d => d.datasetId === request.datasetId)

    // Apply filters
    if (request.addedBy) {
      filteredDemonstrations = filteredDemonstrations.filter(d => d.addedBy === request.addedBy)
    }

    // Sort by addedAt descending
    filteredDemonstrations.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())

    // Apply pagination
    const page = request.page || 1
    const limit = request.limit || 50
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit

    return filteredDemonstrations.slice(startIndex, endIndex)
  }

  /**
   * Add demonstration to dataset
   */
  async addDemonstrationToDataset(request: AddDemonstrationToDatasetRequest): Promise<DatasetDemonstration> {
    // Check if dataset exists
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if demonstration is already in dataset
    const existingDemo = this.datasetDemonstrations.find(d =>
      d.datasetId === request.datasetId && d.demoHash === request.demoHash
    )

    if (existingDemo) {
      throw ApiError.conflict('Demonstration already exists in this dataset')
    }

    // Create new demonstration link
    const demonstration: DatasetDemonstration = {
      id: randomUUID(),
      datasetId: request.datasetId,
      demoHash: request.demoHash,
      addedAt: new Date(),
      addedBy: request.addedBy,
      qualityScore: request.qualityScore,
      notes: request.notes
    }

    this.datasetDemonstrations.push(demonstration)

    // Update dataset demonstration count
    dataset.demonstrationCount += 1
    await dataset.save()

    logger.info('Demonstration added to dataset', {
      datasetId: request.datasetId,
      demoHash: request.demoHash,
      addedBy: request.addedBy
    })

    return demonstration
  }

  /**
   * Remove demonstration from dataset
   */
  async removeDemonstrationFromDataset(request: RemoveDemonstrationFromDatasetRequest): Promise<void> {
    const demonstrationIndex = this.datasetDemonstrations.findIndex(d =>
      d.datasetId === request.datasetId && d.demoHash === request.demoHash
    )

    if (demonstrationIndex === -1) {
      throw ApiError.notFound('Demonstration not found in this dataset')
    }

    this.datasetDemonstrations.splice(demonstrationIndex, 1)

    // Update dataset demonstration count in MongoDB
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (dataset) {
      dataset.demonstrationCount = Math.max(0, dataset.demonstrationCount - 1)
      await dataset.save()
    }

    logger.info('Demonstration removed from dataset', {
      datasetId: request.datasetId,
      demoHash: request.demoHash
    })
  }

  /**
   * Create a new dataset in draft phase
   */
  async createDataset(request: {
    name: string
    symbol: string
    description?: string
    category?: string
    demoHashes?: string[]
    factoryId?: string
    burnThresholdPercentage?: number
    creatorAddress: string
  }): Promise<DatasetToken> {
    // Check for duplicate name or symbol
    const existingDataset = await Dataset.findOne({
      $or: [
        { name: new RegExp(`^${request.name}$`, 'i') },
        { symbol: new RegExp(`^${request.symbol}$`, 'i') }
      ]
    }).lean().exec()

    if (existingDataset) {
      throw ApiError.conflict('Dataset with same name or symbol already exists')
    }

    // Calculate quality score from demonstrations if provided
    let qualityScore = 0
    if (request.demoHashes?.length) {
      // Import DemonstrationSubmission model
      const { DemonstrationSubmission } = await import('../../models/DemonstrationSubmission.ts')

      // Fetch all demonstrations by their IDs (not demoHash)
      // The frontend passes submission IDs (which are stored in _id field)
      const demonstrations = await DemonstrationSubmission.find({
        _id: { $in: request.demoHashes }
      }).exec()

      // Calculate average clampedScore from valid demonstrations
      const validScores = demonstrations
        .map(d => d.clampedScore)
        .filter((score): score is number => score !== null && score !== undefined && !isNaN(score))

      if (validScores.length > 0) {
        qualityScore = validScores.reduce((sum, score) => sum + score, 0) / validScores.length
        // Round to 2 decimal places
        qualityScore = Math.round(qualityScore * 100) / 100
      }

      logger.info('Calculated quality score', {
        requestedDemos: request.demoHashes.length,
        foundDemos: demonstrations.length,
        validScores: validScores.length,
        qualityScore
      })
    }

    // Generate mock contract address for draft
    const contractAddress = `0x${Math.random().toString(16).substr(2, 40)}`
    const datasetId = `dataset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Create MongoDB document
    const doc = new Dataset({
      _id: datasetId,
      name: request.name,
      symbol: request.symbol,
      description: request.description,
      category: request.category,
      contractAddress,
      creatorAddress: request.creatorAddress.toLowerCase(),
      factoryId: request.factoryId,
      totalSupply: 0,
      currentPrice: 0,
      marketCap: 0,
      volume24h: 0,
      qualityScore,
      demonstrationCount: request.demoHashes?.length || 0,
      burnThresholdPercentage: request.burnThresholdPercentage || 5,
      totalBurned: 0,
      burnCount: 0,
      phase: DatasetPhase.draft,
      bondingCurve: {
        virtualETH: 0,
        virtualTokens: 0,
        k: 0
      }
    })

    await doc.save()
    const savedDataset = this.toDatasetToken(doc.toObject())

    // Add demonstrations if provided (still in memory for now)
    if (request.demoHashes?.length) {
      for (const demoHash of request.demoHashes) {
        const demonstration: DatasetDemonstration = {
          id: `demo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          datasetId: savedDataset.id,
          demoHash,
          addedAt: new Date(),
          addedBy: 'manual'
        }
        this.datasetDemonstrations.push(demonstration)
      }
    }

    logger.info('Dataset created in draft phase', {
      datasetId: savedDataset.id,
      name: savedDataset.name,
      symbol: savedDataset.symbol,
      creatorAddress: request.creatorAddress,
      demoCount: request.demoHashes?.length || 0,
      qualityScore
    })

    return savedDataset
  }

  /**
   * Update dataset metadata (only in draft phase)
   */
  async updateDataset(request: {
    datasetId: string
    updateData: Partial<{
      name: string
      symbol: string
      description: string
      category: string
      burnThresholdPercentage: number
    }>
    updaterAddress: string
  }): Promise<DatasetToken> {
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is in draft phase
    if (dataset.phase !== DatasetPhase.draft) {
      throw ApiError.forbidden('Dataset can only be modified in draft phase')
    }

    // Check if user is the creator
    if (dataset.creatorAddress.toLowerCase() !== request.updaterAddress.toLowerCase()) {
      throw ApiError.forbidden('Only dataset creator can modify dataset')
    }

    // Check for name/symbol conflicts if updating these fields
    if (request.updateData.name || request.updateData.symbol) {
      const conflictQuery: any = { _id: { $ne: request.datasetId } }
      const orConditions: any[] = []

      if (request.updateData.name) {
        orConditions.push({ name: new RegExp(`^${request.updateData.name}$`, 'i') })
      }
      if (request.updateData.symbol) {
        orConditions.push({ symbol: new RegExp(`^${request.updateData.symbol}$`, 'i') })
      }

      if (orConditions.length > 0) {
        conflictQuery.$or = orConditions
      }

      const existingDataset = await Dataset.findOne(conflictQuery).lean().exec()
      if (existingDataset) {
        throw ApiError.conflict('Dataset with same name or symbol already exists')
      }
    }

    // Apply updates
    Object.assign(dataset, request.updateData)
    dataset.updatedAt = new Date()
    await dataset.save()

    logger.info('Dataset metadata updated', {
      datasetId: request.datasetId,
      updatedFields: Object.keys(request.updateData),
      updaterAddress: request.updaterAddress
    })

    return this.toDatasetToken(dataset.toObject())
  }

  /**
   * Update dataset demonstrations (only in draft phase)
   */
  async updateDatasetDemos(request: {
    datasetId: string
    demoHashesToAdd?: string[]
    demoHashesToRemove?: string[]
    updaterAddress: string
  }): Promise<{
    dataset: DatasetToken
    addedCount: number
    removedCount: number
  }> {
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is in draft phase
    if (dataset.phase !== DatasetPhase.draft) {
      throw ApiError.forbidden('Demonstrations can only be modified in draft phase')
    }

    // Check if user is the creator
    if (dataset.creatorAddress.toLowerCase() !== request.updaterAddress.toLowerCase()) {
      throw ApiError.forbidden('Only dataset creator can modify demonstrations')
    }

    let addedCount = 0
    let removedCount = 0

    // Add new demonstrations (still in memory for now)
    if (request.demoHashesToAdd?.length) {
      for (const demoHash of request.demoHashesToAdd) {
        // Check if demonstration already exists
        const existingDemo = this.datasetDemonstrations.find(d =>
          d.datasetId === request.datasetId && d.demoHash === demoHash
        )

        if (!existingDemo) {
          const demonstration: DatasetDemonstration = {
            id: `demo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            datasetId: request.datasetId,
            demoHash,
            addedAt: new Date(),
            addedBy: 'manual'
          }
          this.datasetDemonstrations.push(demonstration)
          addedCount++
        }
      }
    }

    // Remove demonstrations
    if (request.demoHashesToRemove?.length) {
      for (const demoHash of request.demoHashesToRemove) {
        const demoIndex = this.datasetDemonstrations.findIndex(d =>
          d.datasetId === request.datasetId && d.demoHash === demoHash
        )

        if (demoIndex !== -1) {
          this.datasetDemonstrations.splice(demoIndex, 1)
          removedCount++
        }
      }
    }

    // Update demonstration count
    const currentDemoCount = this.datasetDemonstrations.filter(d => d.datasetId === request.datasetId).length
    dataset.demonstrationCount = currentDemoCount
    dataset.updatedAt = new Date()
    await dataset.save()

    logger.info('Dataset demonstrations updated', {
      datasetId: request.datasetId,
      addedCount,
      removedCount,
      totalDemos: currentDemoCount,
      updaterAddress: request.updaterAddress
    })

    return {
      dataset: this.toDatasetToken(dataset.toObject()),
      addedCount,
      removedCount
    }
  }

  /**
   * Validate dataset and transition from draft to bonding phase
   */
  async validateDataset(request: {
    datasetId: string
    validatorAddress: string
  }): Promise<{
    dataset: DatasetToken
    transactionHash: string
  }> {
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is in draft phase
    if (dataset.phase !== DatasetPhase.draft) {
      throw ApiError.badRequest('Dataset not in draft phase')
    }

    // Check if user is the creator
    if (dataset.creatorAddress.toLowerCase() !== request.validatorAddress.toLowerCase()) {
      throw ApiError.forbidden('Only dataset creator can validate dataset')
    }

    // Validate dataset has required data
    if (!dataset.name || !dataset.symbol) {
      throw ApiError.badRequest('Dataset must have name and symbol')
    }

    // Check if dataset has at least one demonstration
    const demoCount = this.datasetDemonstrations.filter(d => d.datasetId === request.datasetId).length
    if (demoCount === 0) {
      throw ApiError.badRequest('Dataset must have at least one demonstration')
    }

    // Initialize financial fields for bonding curve
    const initialPrice = 0.001 // Starting price in ETH
    const totalSupply = 1000000 // 1M tokens
    const initialMarketCap = initialPrice * totalSupply
    const k = 1000 // Bonding curve constant

    // Update dataset to bonding phase
    dataset.phase = DatasetPhase.bonding
    dataset.totalSupply = totalSupply
    dataset.currentPrice = initialPrice
    dataset.marketCap = initialMarketCap
    dataset.volume24h = 0
    dataset.qualityScore = Math.min(85, 50 + (demoCount * 5)) // Basic quality score based on demo count
    dataset.bondingCurve = {
      virtualETH: k / totalSupply,
      virtualTokens: totalSupply,
      k
    }
    dataset.contractAddress = `0x${Math.random().toString(16).substr(2, 40)}` // New contract address
    dataset.updatedAt = new Date()

    await dataset.save()
    const updatedDataset = this.toDatasetToken(dataset.toObject())

    // Generate mock transaction hash
    const transactionHash = `0x${Math.random().toString(16).substr(2, 64)}`

    logger.info('Dataset validated and transitioned to bonding phase', {
      datasetId: request.datasetId,
      validatorAddress: request.validatorAddress,
      transactionHash,
      demoCount,
      qualityScore: updatedDataset.qualityScore
    })

    return {
      dataset: updatedDataset,
      transactionHash
    }
  }

  /**
   * Prepare dataset deployment transaction (blockchain integration)
   * Prepares transaction data for client-side signing and broadcasting
   */
  async prepareDatasetDeployment(request: {
    datasetId: string
    deployerAddress: string
  }): Promise<{
    transactionData: {
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
    }
    approvalData: {
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
    }
    dataset: DatasetToken
  }> {
    // Check if blockchain service is configured
    if (!dataMarketplaceBlockchainService) {
      throw ApiError.serviceUnavailable('Blockchain service not configured')
    }

    // Fetch dataset from MongoDB
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is in draft phase
    if (dataset.phase !== DatasetPhase.draft) {
      throw ApiError.badRequest('Dataset must be in draft phase for deployment')
    }

    // Check if user is the creator
    if (dataset.creatorAddress.toLowerCase() !== request.deployerAddress.toLowerCase()) {
      throw ApiError.forbidden('Only dataset creator can deploy dataset')
    }

    // Validate dataset has required data
    if (!dataset.name || !dataset.symbol) {
      throw ApiError.badRequest('Dataset must have name and symbol')
    }

    // Validate burnThresholdPercentage
    if (!dataset.burnThresholdPercentage || dataset.burnThresholdPercentage < 1 || dataset.burnThresholdPercentage > 10) {
      throw ApiError.badRequest('Dataset burnThresholdPercentage must be between 1 and 10')
    }

    // Prepare CLONES approval transaction
    const approvalData = await dataMarketplaceBlockchainService.prepareClonesApprovalTransaction(
      request.deployerAddress
    )

    // Prepare dataset creation transaction
    const transactionData = await dataMarketplaceBlockchainService.prepareCreateDatasetTransaction({
      name: dataset.name,
      symbol: dataset.symbol,
      burnThresholdPercentage: dataset.burnThresholdPercentage,
      creatorAddress: request.deployerAddress
    })

    logger.info('Dataset deployment prepared', {
      datasetId: request.datasetId,
      predictedDatasetToken: transactionData.validations.predictedDatasetToken,
      predictedBondingCurve: transactionData.validations.predictedBondingCurve,
      ethFee: transactionData.validations.ethFee,
      clonesFee: transactionData.validations.clonesFee,
      burnThresholdPercentage: dataset.burnThresholdPercentage
    })

    return {
      transactionData,
      approvalData,
      dataset: this.toDatasetToken(dataset.toObject())
    }
  }

  /**
   * Confirm dataset deployment (blockchain integration)
   * Monitors transaction, parses events, and updates dataset to bonding phase
   */
  async confirmDatasetDeployment(request: {
    datasetId: string
    txHash: string
    deployerAddress: string
  }): Promise<{
    dataset: DatasetToken
    onChainData: {
      datasetTokenAddress: string
      bondingCurveAddress: string
      blockNumber: number
      transactionHash: string
    }
  }> {
    // Check if blockchain service is configured
    if (!dataMarketplaceBlockchainService) {
      throw ApiError.serviceUnavailable('Blockchain service not configured')
    }

    // Fetch dataset from MongoDB
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is in draft phase
    if (dataset.phase !== DatasetPhase.draft) {
      throw ApiError.badRequest('Dataset must be in draft phase')
    }

    // Check if user is the creator
    if (dataset.creatorAddress.toLowerCase() !== request.deployerAddress.toLowerCase()) {
      throw ApiError.forbidden('Only dataset creator can confirm deployment')
    }

    logger.info('Waiting for dataset creation transaction', {
      datasetId: request.datasetId,
      txHash: request.txHash,
      deployerAddress: request.deployerAddress
    })

    // Wait for transaction confirmation and parse events
    const creationEvent = await dataMarketplaceBlockchainService.waitForDatasetCreation(
      request.txHash,
      request.deployerAddress
    )

    // Verify name and symbol match
    if (creationEvent.name !== dataset.name || creationEvent.symbol !== dataset.symbol) {
      throw ApiError.badRequest('Dataset name/symbol mismatch with on-chain data')
    }

    // Fetch complete on-chain data
    const onChainData = await dataMarketplaceBlockchainService.fetchDatasetOnChainData(
      creationEvent.datasetTokenAddress
    )

    // Update dataset to bonding phase with real on-chain data
    dataset.phase = DatasetPhase.bonding
    dataset.contractAddress = creationEvent.datasetTokenAddress
    dataset.totalSupply = parseFloat(onChainData.totalSupply)
    dataset.currentPrice = parseFloat(onChainData.bondingCurve.currentPrice)
    dataset.marketCap = parseFloat(onChainData.bondingCurve.marketCap)
    dataset.volume24h = 0
    dataset.bondingCurve = {
      virtualETH: parseFloat(onChainData.bondingCurve.virtualETH),
      virtualTokens: parseFloat(onChainData.bondingCurve.virtualTokens),
      k: parseFloat(onChainData.bondingCurve.k)
    }
    dataset.updatedAt = new Date()

    await dataset.save()

    const updatedDataset = this.toDatasetToken(dataset.toObject())

    logger.info('Dataset deployed and transitioned to bonding phase', {
      datasetId: request.datasetId,
      contractAddress: creationEvent.datasetTokenAddress,
      bondingCurveAddress: creationEvent.bondingCurveAddress,
      blockNumber: creationEvent.blockNumber,
      transactionHash: request.txHash,
      totalSupply: onChainData.totalSupply,
      currentPrice: onChainData.bondingCurve.currentPrice
    })

    return {
      dataset: updatedDataset,
      onChainData: {
        datasetTokenAddress: creationEvent.datasetTokenAddress,
        bondingCurveAddress: creationEvent.bondingCurveAddress,
        blockNumber: creationEvent.blockNumber,
        transactionHash: request.txHash
      }
    }
  }

  /**
   * Get deployment info (fees and predicted address)
   * Used by frontend before initiating deployment
   */
  async getDeploymentInfo(request: {
    datasetId: string
    creatorAddress: string
  }): Promise<{
    ethFee: string
    clonesFee: string
    clonesTokenAddress: string
    predictedAddress: string
    dataset: DatasetToken
  }> {
    // Check if blockchain service is configured
    if (!dataMarketplaceBlockchainService) {
      throw ApiError.serviceUnavailable('Blockchain service not configured')
    }

    // Fetch dataset from MongoDB
    const dataset = await Dataset.findById(request.datasetId).exec()
    if (!dataset) {
      throw ApiError.notFound('Dataset not found')
    }

    // Check if dataset is in draft phase
    if (dataset.phase !== DatasetPhase.draft) {
      throw ApiError.badRequest('Dataset must be in draft phase')
    }

    // Check if user is the creator
    if (dataset.creatorAddress.toLowerCase() !== request.creatorAddress.toLowerCase()) {
      throw ApiError.forbidden('Only dataset creator can view deployment info')
    }

    // Get launch fee
    const feeInfo = await dataMarketplaceBlockchainService.getLaunchFee()

    // Get CLONES token address
    const clonesTokenAddress = await dataMarketplaceBlockchainService.getClonesTokenAddress()

    // Predict dataset address
    const { predicted } = await dataMarketplaceBlockchainService.predictDatasetAddress(
      request.creatorAddress,
      dataset.name,
      dataset.symbol
    )

    logger.info('Deployment info retrieved', {
      datasetId: request.datasetId,
      ethFee: feeInfo.ethFee,
      clonesFee: feeInfo.clonesFee,
      predictedAddress: predicted
    })

    return {
      ethFee: feeInfo.ethFee,
      clonesFee: feeInfo.clonesFee,
      clonesTokenAddress,
      predictedAddress: predicted,
      dataset: this.toDatasetToken(dataset.toObject())
    }
  }
}