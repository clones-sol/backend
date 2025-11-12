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
    reward: {
      type: mongoose.Schema.Types.Decimal128,
      required: false,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
      }
    },
    maxReward: {
      type: mongoose.Schema.Types.Decimal128,
      required: false,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
      }
    },
    clampedScore: { type: Number, required: false },
    onChainReward: {
      type: {
        poolAddress: String,
        amount: Number,
        grossAmount: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        },
        feeAmount: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        },
        netAmount: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        },
        taskId: String,
        txHash: String,
        timestamp: Number,
        cumulativeAmount: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        }
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
        alreadyClaimed: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        },
        newClaimableAmount: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        },
        feePercentage: {
          type: mongoose.Schema.Types.Decimal128,
          get: function (value: any) {
            return value ? parseFloat(value.toString()) : value
          },
          set: function (value: any) {
            return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
          }
        },
        // Referral data for multi-recipient payouts
        referrals: [{
          address: String,
          amount: {
            type: mongoose.Schema.Types.Decimal128,
            get: function (value: any) {
              return value ? parseFloat(value.toString()) : value
            },
            set: function (value: any) {
              return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
            }
          },
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
    timestamps: true,
    toJSON: {
      getters: true
    }
  }
)

// Index to help with querying pending submissions
demonstrationSubmissionSchema.index({ status: 1, createdAt: 1 })

// Index to help with referral rewards aggregation
demonstrationSubmissionSchema.index({ 'claimAuthorization.referrals.address': 1 })

export const DemonstrationSubmission = mongoose.model(
  'DemonstrationSubmission',
  demonstrationSubmissionSchema
)
