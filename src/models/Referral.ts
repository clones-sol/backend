import mongoose from 'mongoose';

export interface IReferral {
  _id?: mongoose.Types.ObjectId;
  referrerAddress: string; // Wallet address of the person who referred
  referreeAddress: string; // Wallet address of the person who was referred
  onChainTxHash?: string; // Transaction hash when stored on-chain
  onChainSlot?: number; // Solana slot when stored on-chain
  createdAt: Date;
  updatedAt: Date | null;
}

const ReferralSchema = new mongoose.Schema<IReferral>(
  {
    referrerAddress: {
      type: String,
      required: true,
      index: true
    },
    referreeAddress: {
      type: String,
      required: true,
      index: true,
      unique: true // Each wallet can only be referred once
    },
    onChainTxHash: {
      type: String
    },
    onChainSlot: {
      type: Number
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
    collection: 'referrals'
  }
);



export const ReferralModel = mongoose.model<IReferral>('Referral', ReferralSchema); 