import mongoose from 'mongoose';
import { DBDemonstrationSubmission, ForgeSubmissionProcessingStatus } from '../types/index.ts';

export const demonstrationSubmissionSchema = new mongoose.Schema<DBDemonstrationSubmission>(
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
    collection: 'demonstration_submissions',
    timestamps: true
  }
);

// Index to help with querying pending submissions
demonstrationSubmissionSchema.index({ status: 1, createdAt: 1 });

export const DemonstrationSubmission = mongoose.model('DemonstrationSubmission', demonstrationSubmissionSchema);
