import mongoose from 'mongoose'
import { type DBDemonstrationSubmission, ForgeSubmissionProcessingStatus } from '../types/index.ts'

// Schema for referral entries in claimAuthorization
const referralEntrySchema = new mongoose.Schema({
  address: {
    type: String,
    set: (v: string | undefined) => v ? v.toLowerCase() : v
  },
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
}, { _id: false })

// Schema for onChainReward
const onChainRewardSchema = new mongoose.Schema({
  poolAddress: {
    type: String,
    set: (v: string | undefined) => v ? v.toLowerCase() : v
  },
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
}, { _id: false })

// Schema for claimAuthorization
const claimAuthorizationSchema = new mongoose.Schema({
  // Smart contract parameters
  account: {
    type: String,
    set: (v: string | undefined) => v ? v.toLowerCase() : v
  },
  cumulativeAmount: String,
  nonce: Number,
  signature: String,
  // Additional context
  publisherUsed: String,
  poolAddress: {
    type: String,
    set: (v: string | undefined) => v ? v.toLowerCase() : v
  },
  tokenAddress: {
    type: String,
    set: (v: string | undefined) => v ? v.toLowerCase() : v
  },
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
  referrals: [referralEntrySchema]
}, { _id: false })

export const demonstrationSubmissionSchema = new mongoose.Schema<DBDemonstrationSubmission>(
  {
    _id: { type: String },
    address: {
      type: String,
      required: true,
      set: (v: string) => v.toLowerCase() // Always store addresses in lowercase
    },
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
      type: onChainRewardSchema,
      required: false
    },
    claimAuthorization: {
      type: claimAuthorizationSchema,
      required: false
    },

    // Referral snapshot - captured at submission processing time
    farmerReferrerAddress: {
      type: String,
      required: false,
      set: (v: string | undefined) => v ? v.toLowerCase() : v // Always store addresses in lowercase
    },
    factoryReferrerAddress: {
      type: String,
      required: false,
      set: (v: string | undefined) => v ? v.toLowerCase() : v // Always store addresses in lowercase
    },
    cqaModel: { type: String, required: false }
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

// Index for user submissions queries (optimized for pagination)
demonstrationSubmissionSchema.index({ address: 1, createdAt: -1 })

// Optimized compound index for referral rewards aggregation with factory lookup
demonstrationSubmissionSchema.index({
  'claimAuthorization.referrals.address': 1,
  'meta.quest.pool_id': 1
})

export const DemonstrationSubmission = mongoose.model(
  'DemonstrationSubmission',
  demonstrationSubmissionSchema
)
