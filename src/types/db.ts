import type { Types } from 'mongoose'
import type { ForgeSubmissionProcessingStatus } from './index.ts'

export interface DBDemonstrationSubmission {
  _id?: string
  address: string
  meta: any
  status?: ForgeSubmissionProcessingStatus
  files?: Array<{
    file?: string
    storageKey?: string
    size?: number
  }>
  grade_result?: {
    summary?: string
    observations?: string
    reasoning?: string
    score?: number
    confidence?: number
    outcomeAchievement?: number
    processQuality?: number
    efficiency?: number
  }
  grading_metrics?: any
  error?: string
  reward?: number
  maxReward?: number
  clampedScore?: number
  onChainReward?: {
    tokenAddress?: string
    poolAddress?: string
    amount?: number
    taskId?: string
    txHash?: string
    timestamp?: number
  }
  createdAt?: Date
  updatedAt?: Date
}

export interface DBWalletConnection {
  _id?: Types.ObjectId
  token: string
  address: string
  nickname?: string
  createdAt: Date
}
