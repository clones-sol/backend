import mongoose from 'mongoose';

export interface IReferralCode {
  _id?: mongoose.Types.ObjectId;
  walletAddress: string; // Wallet address that owns this referral code
  referralCode: string; // Unique referral code
  isActive: boolean; // Whether this referral code is active
  totalReferrals: number; // Total number of successful referrals
  totalRewards: number; // Total rewards earned from referrals
  expiresAt?: Date; // When the referral code expires
  createdAt: Date;
  updatedAt: Date;
}

const ReferralCodeSchema = new mongoose.Schema<IReferralCode>(
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
    totalReferrals: { 
      type: Number, 
      default: 0 
    },
    totalRewards: { 
      type: Number, 
      default: 0 
    },
    expiresAt: {
      type: Date
    }
  },
  {
    collection: 'referral_codes',
    timestamps: true
  }
);

// Define indexes after schema creation for better clarity and performance
// Single-field indexes for common queries
ReferralCodeSchema.index({ expiresAt: 1 }); // For cleanup operations

// Compound indexes for common query patterns
ReferralCodeSchema.index({ isActive: 1, expiresAt: 1 }); // For finding active, non-expired codes
ReferralCodeSchema.index({ walletAddress: 1, isActive: 1 }); // For finding active codes by wallet
ReferralCodeSchema.index({ totalReferrals: -1 }); // For sorting by referral count (descending)
ReferralCodeSchema.index({ totalRewards: -1 }); // For sorting by rewards (descending)

export const ReferralCodeModel = mongoose.model<IReferralCode>('ReferralCode', ReferralCodeSchema); 