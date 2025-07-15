import mongoose, { Document, Schema } from 'mongoose';

export interface IGymAgentInvocation extends Document {
    agentId: mongoose.Types.ObjectId;
    versionTag: string;
    timestamp: Date;
    durationMs: number;
    isSuccess: boolean;
    httpStatus?: number;
    createdAt: Date;
}

const GymAgentInvocationSchema = new Schema<IGymAgentInvocation>(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'GymAgent', required: true, index: true },
        versionTag: { type: String, required: true, index: true }, // The version of the agent model that was invoked.
        timestamp: { type: Date, required: true, index: true },
        durationMs: { type: Number, required: true },
        isSuccess: { type: Boolean, required: true },
        httpStatus: { type: Number, required: false }, // HTTP status from the external service
    },
    {
        collection: 'gym_agent_invocations',
        timestamps: { createdAt: true, updatedAt: false },
    },
);

// Automatically prune data older than 30 days
GymAgentInvocationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Additional compound indexes for metrics queries
GymAgentInvocationSchema.index({ agentId: 1, timestamp: -1 }); // For agent-specific metrics
GymAgentInvocationSchema.index({ agentId: 1, versionTag: 1, timestamp: -1 }); // For version-specific metrics
GymAgentInvocationSchema.index({ agentId: 1, isSuccess: 1, timestamp: -1 }); // For success/failure analysis
GymAgentInvocationSchema.index({ timestamp: -1, isSuccess: 1 }); // For global success metrics

export const GymAgentInvocationModel = mongoose.model<IGymAgentInvocation>('GymAgentInvocation', GymAgentInvocationSchema); 