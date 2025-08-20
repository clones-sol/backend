import mongoose from 'mongoose';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_REGEX = /^0x([A-Fa-f0-9]{64})$/;

export interface IReferral {
  _id?: mongoose.Types.ObjectId;
  referrerAddress: string;        // EVM wallet (0x...)
  referreeAddress: string;        // EVM wallet (0x...)
  onChainTxHash?: string;         // 0x-prefixed tx hash
  onChainBlockNumber?: number;    // EVM block number
  createdAt: Date;
  updatedAt?: Date;
}

const ReferralSchema = new mongoose.Schema<IReferral>(
  {
    referrerAddress: {
      type: String,
      required: true,
      index: true,
      match: [EVM_ADDRESS_REGEX, 'referrerAddress must be a valid EVM address']
    },
    referreeAddress: {
      type: String,
      required: true,
      index: true,
      unique: true, // each wallet can only be referred once
      match: [EVM_ADDRESS_REGEX, 'referreeAddress must be a valid EVM address']
    },
    onChainTxHash: {
      type: String,
      match: [TX_HASH_REGEX, 'onChainTxHash must be a valid EVM tx hash'],
      required: false
    },
    onChainBlockNumber: {
      type: Number,
      required: false
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
