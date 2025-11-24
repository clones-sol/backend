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
    nonce: number
    signature: string
    publisherUsed: string
    poolAddress: string
    tokenAddress: string
    alreadyClaimed: number
    newClaimableAmount: number
    feePercentage: number
    referrals?: Array<{
      address: string
      amount: number
      type: 'farmer_referrer' | 'factory_referrer'
    }>
  }
  // Referral snapshot data
  farmerReferrerAddress?: string
  factoryReferrerAddress?: string
  cqaModel?: string
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
