import type { Types } from 'mongoose'
import type { ForgeSubmissionProcessingStatus, OnChainReward } from './index.ts'

export interface DBDemonstrationSubmission {
  _id?: string
  address: string
  meta: any
  status?: ForgeSubmissionProcessingStatus
  demoHash?: string
  fileManifest?: {
    recording?: { size?: number; hash?: string }
    meta?: { size?: number; hash?: string }
    input_log?: { size?: number; hash?: string }
    sft?: { size?: number; hash?: string }
  }
  integrityVerified?: boolean
  integrityLastCheck?: Date
  grade_result?: {
    version?: string
    summary?: string
    observations?: string
    reasoning?: string
    score?: number
    confidence?: number
    outcomeAchievement?: number
    processQuality?: number
    efficiency?: number
    confidenceReasoning?: string
    outcomeAchievementReasoning?: string
    processQualityReasoning?: string
    efficiencyReasoning?: string
    programmaticResults?: any
  }
  grading_metrics?: any
  error?: string
  reward?: number
  maxReward?: number
  clampedScore?: number
  onChainReward?: OnChainReward
  claimAuthorization?: {
    account: string
    cumulativeAmount: string
    signature: string
    publisherUsed: string
    poolAddress: string
    tokenAddress: string
    alreadyClaimed: number
    newClaimableAmount: number
  }
  cqaModel?: string
  cqaEvaluationModel?: string
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
