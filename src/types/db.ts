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
    s3Key?: string;
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
  treasuryTransfer?: {
    tokenAddress?: string;
    treasuryWallet?: string;
    amount?: number;
    timestamp?: number;
    txHash?: string;
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
    type: 'SOL' | 'VIRAL' | 'CUSTOM';
    symbol: string;
    address: string;
  };
  skills: string;
  ownerEmail?: string;
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
