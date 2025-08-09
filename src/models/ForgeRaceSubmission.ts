import mongoose from 'mongoose';
import { DBForgeRaceSubmission, ForgeSubmissionProcessingStatus } from '../types/index.ts';

export const forgeRaceSubmissionSchema = new mongoose.Schema<DBForgeRaceSubmission>(
  {
    _id: { type: String },
    address: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: Object.values(ForgeSubmissionProcessingStatus),
      default: ForgeSubmissionProcessingStatus.PENDING
    },
    files: [
      {
        file: String,
        storageKey: String,
        size: Number
      }
    ],
    grade_result: {
      type: {
        summary: String,
        score: Number,
        reasoning: String
      },
      required: false
    },
    error: { type: String, required: false },
    reward: { type: Number, required: false },
    maxReward: { type: Number, required: false },
    clampedScore: { type: Number, required: false },

    // New fields for smart contract reward system
    smartContractReward: {
      type: {
        taskId: String, // Unique identifier for the task
        rewardAmount: Number, // Calculated reward amount
        tokenMint: String, // Token mint address
        poolId: String, // Pool ID
        isRecorded: { type: Boolean, default: false }, // Whether recorded on smart contract
        recordSignature: String, // Transaction signature when recorded
        recordSlot: Number, // Slot when recorded
        isWithdrawn: { type: Boolean, default: false }, // Whether farmer has withdrawn
        withdrawalSignature: String, // Transaction signature when withdrawn
        withdrawalSlot: Number, // Slot when withdrawn
        platformFeeAmount: Number, // Platform fee amount (10%)
        farmerRewardAmount: Number // Actual amount farmer receives (90%)
      },
      required: false
    }
  },
  {
    collection: 'forge_race_submissions',
    timestamps: true
  }
);

// Index to help with querying pending submissions
forgeRaceSubmissionSchema.index({ status: 1, createdAt: 1 });

// New indexes for smart contract reward system
forgeRaceSubmissionSchema.index({ 'smartContractReward.isRecorded': 1, createdAt: 1 });
forgeRaceSubmissionSchema.index({ 'smartContractReward.isWithdrawn': 1, createdAt: 1 });
forgeRaceSubmissionSchema.index({ address: 1, 'smartContractReward.isWithdrawn': 1 });

export const ForgeRaceSubmission = mongoose.model('ForgeRaceSubmission', forgeRaceSubmissionSchema);
