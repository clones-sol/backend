import mongoose from 'mongoose';

export interface IReferral {
  _id?: mongoose.Types.ObjectId;
  referrerAddress: string; // Wallet address of the person who referred
  referreeAddress: string; // Wallet address of the person who was referred
  referralCode: string; // Unique referral code used
  referralLink: string; // Full referral link that was used
  firstActionType: string; // Type of first action that triggered attribution
  firstActionData?: any; // Additional data about the first action
  onChainTxHash?: string; // Transaction hash when stored on-chain
  onChainSlot?: number; // Solana slot when stored on-chain
  rewardAmount?: number; // Amount of reward distributed
  rewardProcessed?: boolean; // Whether reward has been processed
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
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
    referralCode: { 
      type: String, 
      required: true,
      index: true
    },
    referralLink: { 
      type: String, 
      required: true 
    },
    firstActionType: { 
      type: String, 
      required: true,
      enum: ['wallet_connect', 'first_task', 'first_submission', 'first_pool_creation']
    },
    firstActionData: { 
      type: mongoose.Schema.Types.Mixed 
    },
    onChainTxHash: { 
      type: String 
    },
    onChainSlot: { 
      type: Number 
    },
    rewardAmount: {
      type: Number,
      default: 0
    },
    rewardProcessed: {
      type: Boolean,
      default: false
    },
    status: { 
      type: String, 
      required: true, 
      enum: ['pending', 'confirmed', 'failed'],
      default: 'pending'
    }
  },
  {
    collection: 'referrals',
    timestamps: true
  }
);



export const ReferralModel = mongoose.model<IReferral>('Referral', ReferralSchema); 