import mongoose from 'mongoose'

export interface IReferralCode {
  _id?: mongoose.Types.ObjectId
  walletAddress: string // Wallet address that owns this referral code
  referralCode: string // Unique referral code
  isActive: boolean // Whether this referral code is active
  expiresAt?: Date // When the referral code expires
  createdAt: Date
  updatedAt?: Date
}

const ReferralCodeSchema = new mongoose.Schema<IReferralCode>(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true, // Creates unique index automatically
      set: (v: string) => v.toLowerCase() // Always store addresses in lowercase
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

export const ReferralCodeModel = mongoose.model<IReferralCode>('ReferralCode', ReferralCodeSchema)
