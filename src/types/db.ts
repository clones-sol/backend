import { Types } from 'mongoose';
import {
  TrainingPoolStatus,
  UploadLimitType,
  ForgeSubmissionProcessingStatus
} from './index.ts';

export interface DBForgeApp {
  _id?: Types.ObjectId;
  name: string;
  domain: string;
  description?: string;
  categories: string[];
  pool_id: Types.ObjectId;
  tasks: {
    _id: Types.ObjectId;
    prompt: string;
    uploadLimit?: number;
    rewardLimit?: number;
  }[];
}

export interface DBForgeRaceSubmission {
  _id?: string;
  address: string;
  meta: any;
  status?: ForgeSubmissionProcessingStatus;
  files?: Array<{
    file?: string;
    storageKey?: string;
    size?: number;
  }>;
  grade_result?: {
    summary?: string;
    score?: number;
    reasoning?: string;
  };
  error?: string;
  reward?: number;
  maxReward?: number;
  clampedScore?: number;
  // New fields for smart contract reward system
  smartContractReward?: {
    taskId?: string; // Unique identifier for the task
    rewardAmount?: number; // Calculated reward amount
    tokenMint?: string; // Token mint address
    poolId?: string; // Pool ID
    isRecorded?: boolean; // Whether recorded on smart contract
    recordSignature?: string; // Transaction signature when recorded
    recordSlot?: number; // Slot when recorded
    isWithdrawn?: boolean; // Whether farmer has withdrawn
    withdrawalSignature?: string; // Transaction signature when withdrawn
    withdrawalSlot?: number; // Slot when withdrawn
    platformFeeAmount?: number; // Platform fee amount
    farmerRewardAmount?: number; // Actual amount farmer receives
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DBGymSession {
  _id?: Types.ObjectId;
  address: string;
  status: 'active' | 'completed' | 'expired';
  preview?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DBTrainingPool {
  _id?: Types.ObjectId;
  id: string;
  name: string;
  status: TrainingPoolStatus;
  demonstrations: number;
  funds: number;
  pricePerDemo: number;
  token: {
    type: 'SOL' | 'SPL';
    symbol: string;
  };
  skills: string;
  ownerAddress: string;
  depositAddress: string;
  depositPrivateKey: string; // Store private key securely
  uploadLimit?: {
    type: number;
    limitType: UploadLimitType;
  };
}
export interface DBTrainingEvent {
  _id?: Types.ObjectId;
  session: Types.ObjectId | string;
  type:
  | 'task'
  | 'mouse'
  | 'keyboard'
  | 'scroll'
  | 'system'
  | 'hint'
  | 'quest'
  | 'error'
  | 'reasoning'
  | 'reward';
  message: string;
  frame: number;
  timestamp: number; // Milliseconds since session start
  coordinates?: {
    x?: number;
    y?: number;
  };
  trajectory?: Array<{
    x?: number;
    y?: number;
    timestamp?: number;
    velocity?: {
      x?: number;
      y?: number;
      magnitude?: number;
    };
    acceleration?: {
      x?: number;
      y?: number;
      magnitude?: number;
    };
  }>;
  created_at?: Date;
  metadata?: any;
}

export interface DBWalletConnection {
  _id?: Types.ObjectId;
  token: string;
  address: string;
  nickname?: string;
  createdAt: Date;
}
