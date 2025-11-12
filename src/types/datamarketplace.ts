export enum DatasetPhase {
  draft = 'draft',
  bonding = 'bonding',
  graduated = 'graduated'
}

export enum DatasetTransactionType {
  buy = 'buy',
  sell = 'sell',
  burn = 'burn'
}

export interface DatasetToken {
  id: string
  name: string
  symbol: string
  description?: string
  category?: string
  contractAddress: string
  creatorAddress: string
  
  // Token economics
  totalSupply: number
  currentPrice: number
  marketCap: number
  volume24h: number
  
  // Quality metrics
  qualityScore: number
  demonstrationCount: number
  
  // Burn mechanics
  burnThresholdPercentage: number
  totalBurned: number
  burnCount: number
  
  // Lifecycle
  phase: DatasetPhase
  
  // Bonding curve parameters
  bondingCurve: {
    virtualETH: number
    virtualTokens: number
    k: number
  }
  
  // Graduation info (if applicable)
  graduationInfo?: {
    timestamp: Date
    finalPrice: number
    lpPairAddress?: string
  }
  
  createdAt: Date
  updatedAt: Date
}

export interface DatasetTransaction {
  id: string
  datasetId: string
  txHash: string
  blockNumber: number
  timestamp: Date
  fromAddress: string
  type: DatasetTransactionType
  tokenAmount: number
  ethAmount: number
  pricePerToken: number
  createdAt: Date
}

export interface DatasetHolder {
  id: string
  datasetId: string
  holderAddress: string
  balance: number
  percentage: number
  lastUpdated: Date
}

export interface DatasetPricePoint {
  id: string
  datasetId: string
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  period: string // '1m' | '5m' | '1h' | '1d'
  createdAt: Date
}

export interface DatasetBurnRecord {
  id: string
  datasetId: string
  burnerAddress: string
  txHash: string
  tokenAmount: number
  timestamp: Date
  downloadUrl?: string
  downloadExpiry?: Date
  createdAt: Date
}

export interface DatasetDemonstration {
  id: string
  datasetId: string
  demoHash: string
  addedAt: Date
  addedBy: 'automatic' | 'manual'
  qualityScore?: number
  notes?: string
}

// API Request/Response interfaces
export interface GetDatasetsRequest {
  page?: number
  limit?: number
  filter?: 'all' | 'trending' | 'graduated' | 'new' | 'high-quality'
  category?: string
  search?: string
}

export interface GetDatasetsResponse {
  datasets: DatasetToken[]
  total: number
  page: number
  limit: number
}

export interface GetDatasetTransactionsRequest {
  datasetId: string
  page?: number
  limit?: number
  type?: DatasetTransactionType
  address?: string
}

export interface GetDatasetHoldersRequest {
  datasetId: string
  limit?: number
}

export interface GetPriceHistoryRequest {
  datasetId: string
  period: '1h' | '24h' | '7d' | '30d'
}

export interface BurnDownloadRequest {
  datasetId: string
  txHash: string
  address: string
}

export interface BurnDownloadResponse {
  downloadUrl: string
  expiresAt: Date
}

// API interfaces for dataset demonstrations
export interface GetDatasetDemonstrationsRequest {
  datasetId: string
  page?: number
  limit?: number
  addedBy?: 'automatic' | 'manual'
}

export interface AddDemonstrationToDatasetRequest {
  datasetId: string
  demoHash: string
  addedBy: 'automatic' | 'manual'
  qualityScore?: number
  notes?: string
}

export interface RemoveDemonstrationFromDatasetRequest {
  datasetId: string
  demoHash: string
}

// API interfaces for dataset creation and management
export interface CreateDatasetRequest {
  name: string
  symbol: string
  description?: string
  category?: string
  demoHashes?: string[]
  burnThresholdPercentage?: number
}

export interface CreateDatasetResponse {
  dataset: DatasetToken
}

export interface UpdateDatasetRequest {
  name?: string
  symbol?: string
  description?: string
  category?: string
  burnThresholdPercentage?: number
}

export interface UpdateDatasetDemosRequest {
  demoHashesToAdd?: string[]
  demoHashesToRemove?: string[]
}

export interface ValidateDatasetRequest {
  datasetId: string
}