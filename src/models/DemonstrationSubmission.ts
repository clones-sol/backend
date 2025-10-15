import mongoose from 'mongoose'
import { type DBDemonstrationSubmission, ForgeSubmissionProcessingStatus } from '../types/index.ts'

export const demonstrationSubmissionSchema = new mongoose.Schema<DBDemonstrationSubmission>(
  {
    _id: { type: String },
    address: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: Object.values(ForgeSubmissionProcessingStatus),
      default: ForgeSubmissionProcessingStatus.PENDING
    },
    demoHash: { type: String, index: true },
    fileManifest: {
      recording: {
        size: { type: Number, required: false },
        hash: { type: String, required: false }
      },
      meta: {
        size: { type: Number, required: false },
        hash: { type: String, required: false }
      },
      input_log: {
        size: { type: Number, required: false },
        hash: { type: String, required: false }
      },
      sft: {
        size: { type: Number, required: false },
        hash: { type: String, required: false }
      }
    },
    integrityVerified: { type: Boolean, default: false },
    integrityLastCheck: { type: Date },
    grade_result: {
      type: {
        version: String,
        summary: String,
        observations: String,
        reasoning: String,
        score: Number,
        confidence: Number,
        outcomeAchievement: Number,
        processQuality: Number,
        efficiency: Number,
        confidenceReasoning: String,
        outcomeAchievementReasoning: String,
        processQualityReasoning: String,
        efficiencyReasoning: String,
        programmaticResults: mongoose.Schema.Types.Mixed
      },
      required: false
    },
    grading_metrics: { type: mongoose.Schema.Types.Mixed, required: false },
    error: { type: String, required: false },
    reward: { type: Number, required: false },
    maxReward: { type: Number, required: false },
    clampedScore: { type: Number, required: false },
    onChainReward: {
      type: {
        tokenAddress: String,
        poolAddress: String,
        amount: Number,
        grossAmount: Number,
        feeAmount: Number,
        netAmount: Number,
        taskId: String,
        txHash: String,
        timestamp: Number,
        cumulativeAmount: Number
      },
      required: false
    },
    claimAuthorization: {
      type: {
        // Smart contract parameters
        account: String,
        cumulativeAmount: String,
        nonce: Number,
        signature: String,
        // Additional context
        publisherUsed: String,
        poolAddress: String,
        tokenAddress: String,
        alreadyClaimed: Number,
        newClaimableAmount: Number,
        feePercentage: Number,
        // Referral data for multi-recipient payouts
        referrals: [{
          address: String,
          amount: Number,
          type: { type: String, enum: ['farmer_referrer', 'factory_referrer'] }
        }]
      },
      required: false
    },
    
    // Referral snapshot - captured at submission processing time
    farmerReferrerAddress: { type: String, required: false },
    factoryReferrerAddress: { type: String, required: false },
    cqaModel: { type: String, required: false },
    cqaEvaluationModel: { type: String, required: false }
  },
  {
    collection: 'demonstration_submissions',
    timestamps: true
  }
)

// Index to help with querying pending submissions
demonstrationSubmissionSchema.index({ status: 1, createdAt: 1 })

export const DemonstrationSubmission = mongoose.model(
  'DemonstrationSubmission',
  demonstrationSubmissionSchema
)
