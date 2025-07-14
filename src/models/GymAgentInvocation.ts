import mongoose, { Document, Schema } from 'mongoose';

export interface IGymAgentInvocation extends Document {
    agentId: mongoose.Types.ObjectId;
    versionTag: string;
    timestamp: Date;
    durationMs: number;
    isSuccess: boolean;
    httpStatus?: number;
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

export const GymAgentInvocationModel = mongoose.model<IGymAgentInvocation>('GymAgentInvocation', GymAgentInvocationSchema); 