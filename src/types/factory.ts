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
  demonstrations: number // Total demonstrations completed
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
  sortBy?: 'createdAt' | 'demonstrations' | 'totalEarned'
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
  totalEarned: number
  averageFactorySize: number
  topSkills: Array<{ skill: string; count: number }>
  topTokens: Array<{ token: string; balance: number }>
}
