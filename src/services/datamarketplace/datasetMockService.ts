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

/**
 * Mock service for data marketplace operations
 * Simulates blockchain interactions without real Web3 calls
 */
export class DatasetMockService {
  private datasets: DatasetToken[] = []
  private transactions: DatasetTransaction[] = []
  private holders: Map<string, DatasetHolder[]> = new Map()
  private priceHistory: Map<string, DatasetPricePoint[]> = new Map()
  private burnRecords: DatasetBurnRecord[] = []
  private datasetDemonstrations: DatasetDemonstration[] = []

  constructor() {
    this.initializeMockData()
  }

  /**
   * Initialize mock datasets with realistic data
   */
  private initializeMockData(): void {
    // Create 8 diverse datasets with different phases and quality scores
    const mockDatasets: Partial<DatasetToken>[] = [
      {
        name: 'E-commerce Customer Service',
        symbol: 'ECUSTOM',
        description: 'High-quality customer service interactions from major e-commerce platforms',
        category: 'customer-service',
        qualityScore: 92,
        demonstrationCount: 1247,
        phase: DatasetPhase.graduated,
        burnThresholdPercentage: 5,
        burnCount: 3,
        totalBurned: 150000000
      },
      {
        name: 'Financial Trading Assistant',
        symbol: 'FTRADE',
        description: 'Professional trading workflows and market analysis demonstrations',
        category: 'finance',
        qualityScore: 89,
        demonstrationCount: 856,
        phase: DatasetPhase.bonding,
        burnThresholdPercentage: 3,
        burnCount: 0,
        totalBurned: 0
      },
      {
        name: 'Healthcare Documentation',
        symbol: 'HEALTH',
        description: 'Medical record processing and healthcare administrative tasks',
        category: 'healthcare',
        qualityScore: 95,
        demonstrationCount: 2134,
        phase: DatasetPhase.graduated,
        burnThresholdPercentage: 7,
        burnCount: 8,
        totalBurned: 560000000
      },
      {
        name: 'Software Development',
        symbol: 'DEVOPS',
        description: 'Code review, debugging, and development workflow demonstrations',
        category: 'technology',
        qualityScore: 87,
        demonstrationCount: 1892,
        phase: DatasetPhase.bonding,
        burnThresholdPercentage: 4,
        burnCount: 0,
        totalBurned: 0
      },
      {
        name: 'Legal Document Analysis',
        symbol: 'LEGAL',
        description: 'Contract review and legal research workflow demonstrations',
        category: 'legal',
        qualityScore: 93,
        demonstrationCount: 743,
        phase: DatasetPhase.graduated,
        burnThresholdPercentage: 6,
        burnCount: 2,
        totalBurned: 120000000
      },
      {
        name: 'Creative Content Creation',
        symbol: 'CREATIVE',
        description: 'Design, writing, and creative workflow demonstrations',
        category: 'creative',
        qualityScore: 78,
        demonstrationCount: 567,
        phase: DatasetPhase.bonding,
        burnThresholdPercentage: 2,
        burnCount: 0,
        totalBurned: 0
      },
      {
        name: 'Real Estate Management',
        symbol: 'REALESTATE',
        description: 'Property management and real estate workflow demonstrations',
        category: 'real-estate',
        qualityScore: 91,
        demonstrationCount: 934,
        phase: DatasetPhase.bonding,
        burnThresholdPercentage: 5,
        burnCount: 0,
        totalBurned: 0
      },
      {
        name: 'Educational Content',
        symbol: 'EDU',
        description: 'Teaching and educational workflow demonstrations',
        category: 'education',
        qualityScore: 85,
        demonstrationCount: 1456,
        phase: DatasetPhase.graduated,
        burnThresholdPercentage: 4,
        burnCount: 5,
        totalBurned: 200000000
      }
    ]

    this.datasets = mockDatasets.map((dataset, index) => {
      const basePrice = this.calculateBondingCurvePrice(dataset.phase === DatasetPhase.graduated)
      const marketCap = basePrice * 1000000000 // 1B total supply
      
      return {
        id: `dataset_${index + 1}`,
        contractAddress: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
        creatorAddress: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
        totalSupply: 1000000000,
        currentPrice: basePrice * (0.8 + Math.random() * 0.4), // Add price variation
        marketCap,
        volume24h: Math.random() * 50000,
        bondingCurve: {
          virtualETH: 1.3,
          virtualTokens: 1073000000,
          k: 1.3 * 1073000000
        },
        graduationInfo: dataset.phase === DatasetPhase.graduated ? {
          timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
          finalPrice: basePrice,
          lpPairAddress: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`
        } : undefined,
        createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
        ...dataset
      } as DatasetToken
    })

    // Generate mock transactions, holders, price history, and demonstrations for each dataset
    this.datasets.forEach(dataset => {
      this.generateMockTransactions(dataset.id)
      this.generateMockHolders(dataset.id)
      this.generateMockPriceHistory(dataset.id)
      this.generateMockDemonstrations(dataset.id)
    })

    logger.info('Mock data initialized', { 
      datasets: this.datasets.length,
      transactions: this.transactions.length,
      demonstrations: this.datasetDemonstrations.length
    })
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
      
      // Quality score - higher datasets tend to have higher quality demos
      const dataset = this.datasets.find(d => d.id === datasetId)
      const baseQuality = dataset ? dataset.qualityScore : 80
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
    let filteredDatasets = [...this.datasets]

    // Apply filters
    if (request.filter && request.filter !== 'all') {
      switch (request.filter) {
        case 'trending':
          filteredDatasets = filteredDatasets.filter(d => d.volume24h > 15000)
          break
        case 'graduated':
          filteredDatasets = filteredDatasets.filter(d => d.phase === DatasetPhase.graduated)
          break
        case 'new':
          const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
          filteredDatasets = filteredDatasets.filter(d => d.createdAt.getTime() > threeDaysAgo)
          break
        case 'high-quality':
          filteredDatasets = filteredDatasets.filter(d => d.qualityScore >= 90)
          break
      }
    }

    // Apply category filter
    if (request.category) {
      filteredDatasets = filteredDatasets.filter(d => d.category === request.category)
    }

    // Apply search filter
    if (request.search) {
      const searchLower = request.search.toLowerCase()
      filteredDatasets = filteredDatasets.filter(d => 
        d.name.toLowerCase().includes(searchLower) ||
        d.description?.toLowerCase().includes(searchLower) ||
        d.category?.toLowerCase().includes(searchLower)
      )
    }

    // Apply pagination
    const page = request.page || 1
    const limit = request.limit || 20
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit

    const paginatedDatasets = filteredDatasets.slice(startIndex, endIndex)

    return {
      datasets: paginatedDatasets,
      total: filteredDatasets.length,
      page,
      limit
    }
  }

  /**
   * Get dataset by ID
   */
  async getDatasetById(datasetId: string): Promise<DatasetToken | null> {
    return this.datasets.find(d => d.id === datasetId) || null
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
    const dataset = await this.getDatasetById(request.datasetId)
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
    const datasetIndex = this.datasets.findIndex(d => d.id === request.datasetId)
    if (datasetIndex !== -1) {
      this.datasets[datasetIndex].demonstrationCount += 1
    }

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

    // Update dataset demonstration count
    const datasetIndex = this.datasets.findIndex(d => d.id === request.datasetId)
    if (datasetIndex !== -1) {
      this.datasets[datasetIndex].demonstrationCount = Math.max(0, this.datasets[datasetIndex].demonstrationCount - 1)
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
    burnThresholdPercentage?: number
    creatorAddress: string
  }): Promise<DatasetToken> {
    // Check for duplicate name or symbol
    const existingDataset = this.datasets.find(d => 
      d.name.toLowerCase() === request.name.toLowerCase() || 
      d.symbol.toLowerCase() === request.symbol.toLowerCase()
    )

    if (existingDataset) {
      throw ApiError.conflict('Dataset with same name or symbol already exists')
    }

    // Generate mock contract address for draft
    const contractAddress = `0x${Math.random().toString(16).substr(2, 40)}`
    
    const dataset: DatasetToken = {
      id: `dataset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: request.name,
      symbol: request.symbol,
      description: request.description,
      category: request.category,
      contractAddress,
      creatorAddress: request.creatorAddress.toLowerCase(),
      
      // Financial fields are null/undefined in draft phase
      totalSupply: 0,
      currentPrice: 0,
      marketCap: 0,
      volume24h: 0,
      
      // Quality metrics
      qualityScore: 0,
      demonstrationCount: request.demoHashes?.length || 0,
      
      // Burn mechanics
      burnThresholdPercentage: request.burnThresholdPercentage || 5,
      totalBurned: 0,
      burnCount: 0,
      
      // Lifecycle - starts in draft phase
      phase: DatasetPhase.draft,
      
      // Bonding curve will be set during validation
      bondingCurve: {
        virtualETH: 0,
        virtualTokens: 0,
        k: 0
      },
      
      createdAt: new Date(),
      updatedAt: new Date()
    }

    this.datasets.push(dataset)

    // Add demonstrations if provided
    if (request.demoHashes?.length) {
      for (const demoHash of request.demoHashes) {
        const demonstration: DatasetDemonstration = {
          id: `demo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          datasetId: dataset.id,
          demoHash,
          addedAt: new Date(),
          addedBy: 'manual'
        }
        this.datasetDemonstrations.push(demonstration)
      }
    }

    logger.info('Dataset created in draft phase', { 
      datasetId: dataset.id,
      name: dataset.name,
      symbol: dataset.symbol,
      creatorAddress: request.creatorAddress,
      demoCount: request.demoHashes?.length || 0
    })

    return dataset
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
    const datasetIndex = this.datasets.findIndex(d => d.id === request.datasetId)
    if (datasetIndex === -1) {
      throw ApiError.notFound('Dataset not found')
    }

    const dataset = this.datasets[datasetIndex]

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
      const existingDataset = this.datasets.find(d => 
        d.id !== request.datasetId && (
          (request.updateData.name && d.name.toLowerCase() === request.updateData.name.toLowerCase()) ||
          (request.updateData.symbol && d.symbol.toLowerCase() === request.updateData.symbol.toLowerCase())
        )
      )

      if (existingDataset) {
        throw ApiError.conflict('Dataset with same name or symbol already exists')
      }
    }

    // Apply updates
    Object.assign(dataset, request.updateData, { updatedAt: new Date() })
    this.datasets[datasetIndex] = dataset

    logger.info('Dataset metadata updated', { 
      datasetId: request.datasetId,
      updatedFields: Object.keys(request.updateData),
      updaterAddress: request.updaterAddress
    })

    return dataset
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
    const datasetIndex = this.datasets.findIndex(d => d.id === request.datasetId)
    if (datasetIndex === -1) {
      throw ApiError.notFound('Dataset not found')
    }

    const dataset = this.datasets[datasetIndex]

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

    // Add new demonstrations
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
    this.datasets[datasetIndex].demonstrationCount = currentDemoCount
    this.datasets[datasetIndex].updatedAt = new Date()

    logger.info('Dataset demonstrations updated', { 
      datasetId: request.datasetId,
      addedCount,
      removedCount,
      totalDemos: currentDemoCount,
      updaterAddress: request.updaterAddress
    })

    return {
      dataset: this.datasets[datasetIndex],
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
    const datasetIndex = this.datasets.findIndex(d => d.id === request.datasetId)
    if (datasetIndex === -1) {
      throw ApiError.notFound('Dataset not found')
    }

    const dataset = this.datasets[datasetIndex]

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
    const updatedDataset: DatasetToken = {
      ...dataset,
      phase: DatasetPhase.bonding,
      totalSupply,
      currentPrice: initialPrice,
      marketCap: initialMarketCap,
      volume24h: 0,
      qualityScore: Math.min(85, 50 + (demoCount * 5)), // Basic quality score based on demo count
      bondingCurve: {
        virtualETH: k / totalSupply,
        virtualTokens: totalSupply,
        k
      },
      contractAddress: `0x${Math.random().toString(16).substr(2, 40)}`, // New contract address
      updatedAt: new Date()
    }

    this.datasets[datasetIndex] = updatedDataset

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
}