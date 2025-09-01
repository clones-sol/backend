// Define interface for extended app object with limit information
export interface AppWithLimitInfo {
  _id: any;
  name: string;
  domain: string;
  description?: string | null;
  categories?: string[];
  pool_id: any;
  tasks: any[];
  createdAt?: Date;
  updatedAt?: Date;
  gymLimitReached: boolean;
  gymSubmissions: number;
  gymLimitType?: UploadLimitType;
  gymLimitValue?: number;
}



export enum FactoryPoolStatus {
  active = 'active',
  paused = 'paused',
  error = 'error',
  noFunds = 'no-funds',
}

export enum UploadLimitType {
  perTask = 'per-task',
  perDay = 'per-day',
  total = 'total'
}

// Define interface for task with limit information
export interface TaskWithLimitInfo {
  _id: any;
  prompt: string;
  uploadLimit?: number;
  rewardLimit?: number;
  uploadLimitReached: boolean;
  currentSubmissions: number;
  limitReason: string | null;
}

export interface ConnectBody {
  token: string;
  address: string;
  signature?: string;
  timestamp?: number;
  referralCode?: string;
}

export interface CreatePoolBody {
  name: string;
  skills: string;
  token: {
    type: 'ETH' | 'ERC20';
    symbol: string;
  };
  ownerAddress?: string; // Now optional since we get it from the token
  pricePerDemo?: number;
  uploadLimit?: {
    type: number;
    limitType: UploadLimitType;
  };
  apps?: {
    name: string;
    domain: string;
    description?: string;
    categories?: string[];
    tasks: {
      prompt: string;
      uploadLimit?: number;
      rewardLimit?: number;
    }[];
  }[];
}

export interface UpdatePoolBody {
  id: string;
  name?: string;
  status?: FactoryPoolStatus.active | FactoryPoolStatus.paused;
  skills?: string;
  pricePerDemo?: number;
  uploadLimit?: {
    type: number;
    limitType: UploadLimitType;
  };
  apps?: {
    name: string;
    domain: string;
    description?: string;
    categories?: string[];
    tasks: {
      prompt: string;
      uploadLimit?: number;
      rewardLimit?: number;
    }[];
  }[];
}

export interface AppInfo {
  type: 'executable' | 'website';
  name: string;
  path?: string;
  url?: string;
}

export enum ForgeSubmissionProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface ForgeSubmissionMetaData {
  id: string;
  timestamp: string;
  duration_seconds: number;
  status: string;
  reason: string;
  title: string;
  description: string;
  platform: string;
  arch: string;
  version: string;
  locale: string;
  primary_monitor: {
    width: number;
    height: number;
  };
  quest: {
    title: string;
    app: string;
    icon_url: string;
    objectives: string[];
    content: string;
  };
}

export interface ForgeSubmissionGradeResult {
  summary: string;
  observations: string;
  reasoning: string;
  score: number;
  confidence: number;
  outcomeAchievement: number;
  processQuality: number;
  efficiency: number;
}

// Interface for on-chain reward details
export interface OnChainReward {
  tokenAddress: string;
  poolAddress: string;
  amount: number; // Individual reward for this submission
  submissionId: string; // Submission ID (previously incorrectly named taskId)
  txHash: string;
  timestamp: number;
  cumulativeAmount?: number; // Total cumulative amount user can claim
}

export interface UploadChunk {
  chunkIndex: number;
  path: string;
  size: number;
  checksum: string;
}

export interface UploadSession {
  id: string;
  address: string;
  totalChunks: number;
  receivedChunks: Map<number, UploadChunk>;
  metadata: any;
  tempDir: string;
  createdAt: Date;
  lastUpdated: Date;
}

export interface RequestMetrics {
  responseId?: string;
  systemFingerprint?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timing: {
    startTime: number;
    endTime: number;
    durationMs: number;
    retryCount: number;
    retryDelays: number[];
  };
  context: {
    sessionId: string;
    chunkIndex?: number;
    totalChunks?: number;
    isFinal: boolean;
    model: string;
  };
  outcome: 'success' | 'permanent_error' | 'transient_error' | 'timeout';
  error?: {
    type: string;
    message: string;
    statusCode?: number;
  };
}
