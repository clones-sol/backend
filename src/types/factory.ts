/**
 * Factory Types - Canonical data structures for Factory system
 *
 * These interfaces define the standardized structure used across:
 * - MongoDB storage
 * - API responses
 * - Desktop client
 * - Smart contract integration
 */

export enum FactoryStatus {
  active = 'active',
  paused = 'paused',
  error = 'error',
  noFunds = 'no-funds'
}

export enum TokenType {
  ETH = 'ETH',
  ERC20 = 'ERC20'
}

export enum UploadLimitType {
  perTask = 'per-task',
  perDay = 'per-day',
  total = 'total'
}

// Core Factory token interface
export interface FactoryToken {
  type: TokenType
  symbol: string
  address: string
  decimals: number
}

// Factory upload limit configuration
export interface FactoryUploadLimit {
  value: number
  type: UploadLimitType
}

// Factory task definition
export interface FactoryTask {
  id: string
  prompt: string
  uploadLimit?: number
  rewardLimit?: number
}

// Factory app definition (integrated within Factory)
export interface FactoryApp {
  id: string
  name: string
  domain: string
  description?: string
  categories: string[]
  tasks: FactoryTask[]
}

// Main Factory interface - canonical structure
export interface Factory {
  // Core identity
  id: string // factory_{poolAddress}
  poolAddress: string // Smart contract address
  name: string
  description?: string

  // Ownership & permissions
  ownerAddress: string

  // Status & lifecycle
  status: FactoryStatus
  createdAt: Date
  updatedAt: Date

  // Skills & categorization
  skills: string[] // Primary skills array

  // Economic model
  token: FactoryToken
  pricePerDemo: number // Reward per demonstration

  // Statistics
  totalEarned: number // Total rewards paid out

  // Configuration
  uploadLimit?: FactoryUploadLimit

  // Apps & tasks (integrated, not separate table)
  apps: FactoryApp[]

  // Search optimization
  searchText: string // Computed search string
}

// Factory creation input
export interface CreateFactoryRequest {
  name: string
  skills: string[]
  description?: string
  token: {
    type: TokenType
    symbol: string
  }
  pricePerDemo?: number
  uploadLimit?: FactoryUploadLimit
  apps?: Omit<FactoryApp, 'id'>[] // Apps without IDs (will be generated)
}

// Factory update input
export interface UpdateFactoryRequest {
  id: string
  name?: string
  description?: string
  skills?: string[]
  status?: FactoryStatus
  pricePerDemo?: number
  uploadLimit?: FactoryUploadLimit
  apps?: Omit<FactoryApp, 'id'>[]
}

// Factory search/filter criteria
export interface FactorySearchCriteria {
  skills?: string[]
  searchTerm?: string
  ownerAddress?: string
  token?: string
  minBalance?: number
  maxBalance?: number
  status?: FactoryStatus
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'totalEarned'
  sortOrder?: 'asc' | 'desc'
}

// Factory search result
export interface FactorySearchResult {
  factories: Factory[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

// Factory analytics
export interface FactoryAnalytics {
  totalFactories: number
  activeFactories: number
  totalBalance: number
  totalDemonstrations: number
  averageFactorySize: number
  topSkills: Array<{ skill: string; count: number }>
  topTokens: Array<{ token: string; balance: number }>
}

// Extended app interface with limit information (from forge.ts)
export interface AppWithLimitInfo {
  _id: any
  name: string
  domain: string
  description?: string | null
  categories?: string[]
  pool_id: any
  tasks: any[]
  createdAt?: Date
  updatedAt?: Date
  gymLimitReached: boolean
  gymSubmissions: number
  gymLimitType?: UploadLimitType
  gymLimitValue?: number
}

// Task interface with limit information (from forge.ts)
export interface TaskWithLimitInfo {
  _id: any
  prompt: string
  uploadLimit?: number
  rewardLimit?: number
  uploadLimitReached: boolean
  currentSubmissions: number
  limitReason: string | null
}

// Connection body interface (from forge.ts)
export interface ConnectBody {
  token: string
  address: string
  signature?: string
  timestamp?: number
  referralCode?: string
}

// Pool creation body interface (from forge.ts)
export interface CreatePoolBody {
  name: string
  skills: string
  token: {
    type: 'ETH' | 'ERC20'
    symbol: string
  }
  ownerAddress?: string
  pricePerDemo?: number
  uploadLimit?: {
    type: number
    limitType: UploadLimitType
  }
  apps?: {
    name: string
    domain: string
    description?: string
    categories?: string[]
    tasks: {
      prompt: string
      uploadLimit?: number
      rewardLimit?: number
    }[]
  }[]
}

// Pool update body interface (from forge.ts)
export interface UpdatePoolBody {
  id: string
  name?: string
  status?: FactoryStatus
  skills?: string
  pricePerDemo?: number
  uploadLimit?: {
    type: number
    limitType: UploadLimitType
  }
  apps?: {
    name: string
    domain: string
    description?: string
    categories?: string[]
    tasks: {
      prompt: string
      uploadLimit?: number
      rewardLimit?: number
    }[]
  }[]
}

// App info interface (from forge.ts)
export interface AppInfo {
  type: 'executable' | 'website'
  name: string
  path?: string
  url?: string
}

// Forge submission processing status (from forge.ts)
export enum ForgeSubmissionProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

// Forge submission metadata (from forge.ts)
export interface ForgeSubmissionMetaData {
  id: string
  timestamp: string
  duration_seconds: number
  status: string
  reason: string
  title: string
  description: string
  platform: string
  arch: string
  version: string
  locale: string
  primary_monitor: {
    width: number
    height: number
  }
  quest: {
    title: string
    app: string
    icon_url: string
    objectives: string[]
    content: string
  }
}

// Forge submission grade result (from forge.ts)
export interface ForgeSubmissionGradeResult {
  summary: string
  observations: string
  reasoning: string
  score: number
  confidence: number
  outcomeAchievement: number
  processQuality: number
  efficiency: number
}

// On-chain reward interface (from forge.ts)
export interface OnChainReward {
  tokenAddress: string
  poolAddress: string
  amount: number
  submissionId: string
  txHash: string
  timestamp: number
  cumulativeAmount?: number
}

// Upload chunk interface (from forge.ts)
export interface UploadChunk {
  chunkIndex: number
  path: string
  size: number
  checksum: string
}

// Upload session interface (from forge.ts)
export interface UploadSession {
  id: string
  address: string
  totalChunks: number
  receivedChunks: Map<number, UploadChunk>
  metadata: any
  tempDir: string
  createdAt: Date
  lastUpdated: Date
}

// Request metrics interface (from forge.ts)
export interface RequestMetrics {
  responseId?: string
  systemFingerprint?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  timing: {
    startTime: number
    endTime: number
    durationMs: number
    retryCount: number
    retryDelays: number[]
  }
  context: {
    sessionId: string
    chunkIndex?: number
    totalChunks?: number
    isFinal: boolean
    model: string
  }
  outcome: 'success' | 'permanent_error' | 'transient_error' | 'timeout'
  error?: {
    type: string
    message: string
    statusCode?: number
  }
}
