import mongoose from 'mongoose';

export interface IReferralCode {
  _id?: mongoose.Types.ObjectId;
  walletAddress: string; // Wallet address that owns this referral code
  referralCode: string; // Unique referral code
  isActive: boolean; // Whether this referral code is active
  totalReferrals: number; // Total number of successful referrals
  totalRewards: number; // Total rewards earned from referrals
  createdAt: Date;
  updatedAt: Date;
}

const ReferralCodeSchema = new mongoose.Schema<IReferralCode>(
  {
    walletAddress: { 
      type: String, 
      required: true, 
      unique: true,
      index: true 
    },
    referralCode: { 
      type: String, 
      required: true, 
      unique: true,
      index: true 
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
    }
  },
  {
    collection: 'referral_codes',
    timestamps: true
  }
);

export const ReferralCodeModel = mongoose.model<IReferralCode>('ReferralCode', ReferralCodeSchema); 