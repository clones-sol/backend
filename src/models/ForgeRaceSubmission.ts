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
        observations: String,
        reasoning: String,
        score: Number,
        confidence: Number,
        outcomeAchievement: Number,
        processQuality: Number,
        efficiency: Number
      },
      required: false
    },
    grading_metrics: { type: mongoose.Schema.Types.Mixed, required: false },
    error: { type: String, required: false },
    reward: { type: Number, required: false },
    maxReward: { type: Number, required: false },
    clampedScore: { type: Number, required: false },
    onChainReward: {
      type: {
        tokenAddress: String,
        poolAddress: String,
        amount: Number,
        taskId: String,
        txHash: String,
        timestamp: Number
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

export const ForgeRaceSubmission = mongoose.model('ForgeRaceSubmission', forgeRaceSubmissionSchema);
