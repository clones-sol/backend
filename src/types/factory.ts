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
  noFunds = 'no-funds',
  archived = 'archived'
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

// Factory task definition (legacy - keeping for compatibility)
export interface FactoryTask {
  id: string
  prompt: string
  uploadLimit?: number
  rewardLimit?: number
}

// Factory app definition (legacy - keeping for compatibility)
export interface FactoryApp {
  id: string
  name: string
  domain: string
  description?: string
  categories: string[]
  tasks: FactoryTask[]
}

// NEW TASK-FIRST STRUCTURE

// Simplified app definition for use within tasks
export interface TaskApp {
  name: string
  domain: string // "desktop" for native apps, or actual domain for web apps
  description: string
}

// Workflow task definition (tasks-first approach)
export interface WorkflowTask {
  id: string
  prompt: string
  task_name: string
  categories: string[]
  apps_used: TaskApp[]
  uploadLimit?: number
  rewardLimit?: number
}

// Main Factory interface - canonical structure
export interface Factory {
  // Core identity
  id: string // factory_{poolAddress}
  poolAddress?: string // Smart contract address (optional for archived factories)
  name: string
  description?: string

  // Ownership & permissions
  ownerAddress: string
  referrerAddress?: string // Captured at factory creation time

  // Status & lifecycle
  status: FactoryStatus
  createdAt: Date
  updatedAt: Date

  // Skills & categorization
  skills: string[] // Primary skills array

  // Economic model
  token?: FactoryToken // Optional for archived factories

  // Statistics
  totalEarned: number // Total rewards paid out

  // Configuration
  uploadLimit?: FactoryUploadLimit

  // Tasks
  tasks: WorkflowTask[]

  // Search optimization
  searchText?: string // Computed search string
}

export interface FactoryWithDemonstrations extends Factory {
  demonstrations: number
}

// NEW: Workflow generation response from AI
export interface WorkflowGenerationResult {
  name: string
  tasks: Omit<WorkflowTask, 'id'>[] // Tasks without IDs (will be generated)
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
  uploadLimit?: FactoryUploadLimit
  // Legacy support
  apps?: Omit<FactoryApp, 'id'>[] // Apps without IDs (will be generated)
  // NEW: Tasks-first support
  tasks?: Omit<WorkflowTask, 'id'>[] // Tasks without IDs (will be generated)
}

// Factory update input
export interface UpdateFactoryRequest {
  id: string
  name?: string
  description?: string
  skills?: string[]
  status?: FactoryStatus
  uploadLimit?: FactoryUploadLimit
  // Legacy support
  apps?: Omit<FactoryApp, 'id'>[]
  // NEW: Tasks-first support
  tasks?: Omit<WorkflowTask, 'id'>[]
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
  factories: FactoryWithDemonstrations[]
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
  programmaticResults?: {
    videoAnalysis?: Array<{
      timestamp_seconds: number
      description: string
      status?: string
    }>
    [key: string]: any
  }
}

// On-chain reward interface (from forge.ts)
export interface OnChainReward {
  tokenAddress: string
  poolAddress: string
  amount: number
  grossAmount: number
  feeAmount: number
  netAmount: number
  submissionId: string
  txHash?: string
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
