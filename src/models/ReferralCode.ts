import mongoose from 'mongoose'

export interface IReferralCode {
  _id?: mongoose.Types.ObjectId
  walletAddress: string // Wallet address that owns this referral code
  referralCode: string // Unique referral code
  isActive: boolean // Whether this referral code is active
  totalRewards: number // Total rewards earned from referrals
  expiresAt?: Date // When the referral code expires
  createdAt: Date
  updatedAt?: Date
}

interface IReferralCodeDocument extends Omit<IReferralCode, 'totalRewards'> {
  totalRewards: mongoose.Types.Decimal128
}

const ReferralCodeSchema = new mongoose.Schema<IReferralCodeDocument>(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true // Creates unique index automatically
    },
    referralCode: {
      type: String,
      required: true,
      unique: true // Creates unique index automatically
    },
    isActive: {
      type: Boolean,
      default: true
    },

    totalRewards: {
      type: mongoose.Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0'),
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : mongoose.Types.Decimal128.fromString(value.toString())
      }
    },
    expiresAt: {
      type: Date
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true
    },
    updatedAt: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'referral_codes',
    toJSON: {
      getters: true
    }
  }
)

// Define indexes after schema creation for better clarity and performance
// Single-field indexes for common queries
ReferralCodeSchema.index({ expiresAt: 1 }) // For cleanup operations

// Compound indexes for common query patterns
ReferralCodeSchema.index({ isActive: 1, expiresAt: 1 }) // For finding active, non-expired codes
ReferralCodeSchema.index({ walletAddress: 1, isActive: 1 }) // For finding active codes by wallet
ReferralCodeSchema.index({ totalRewards: -1 }) // For sorting by rewards (descending)

export const ReferralCodeModel = mongoose.model<IReferralCodeDocument>('ReferralCode', ReferralCodeSchema)
