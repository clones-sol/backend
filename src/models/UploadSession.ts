import { Schema, model, Document } from 'mongoose';
import { UploadChunk, UploadSession } from '../types/forge.ts';

// Interface for the Mongoose document, omitting 'id' from the base UploadSession to avoid conflict with Mongoose's 'id'
export interface IUploadSessionDocument extends Document, Omit<UploadSession, 'id' | 'receivedChunks'> {
    _id: string; // Mongoose uses _id
    receivedChunks: Map<string, UploadChunk>; // Mongoose Map requires string keys
}

const chunkSchema = new Schema<UploadChunk>(
    {
        chunkIndex: { type: Number, required: true },
        path: { type: String, required: true },
        size: { type: Number, required: true },
        checksum: { type: String, required: true },
    },
    { _id: false, collection: 'upload_chunks' }
);

const uploadSessionSchema = new Schema<IUploadSessionDocument>(
    {
        _id: { type: String, required: true },
        address: { type: String, required: true },
        totalChunks: { type: Number, required: true },
        receivedChunks: {
            type: Map,
            of: chunkSchema,
            default: new Map(),
        },
        metadata: { type: Schema.Types.Mixed, required: true },
        tempDir: { type: String, required: true },
    },
    {
        _id: false, // We are providing our own _id
        timestamps: true, // This will add createdAt and updatedAt timestamps
        toJSON: {
            virtuals: true,
            // Transform the output to return 'id' instead of '_id'
            transform: (_doc, ret) => {
                const { _id, __v, ...rest } = ret;
                return { id: _id, ...rest };
            },
        },
        collection: 'upload_sessions',
    },
);

// Create a virtual 'id' property that gets the '_id'
uploadSessionSchema.virtual('id').get(function () {
    return this._id;
});

// Create a TTL index on the `createdAt` field to automatically delete sessions after 24 hours (86400 seconds)
uploadSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const UploadSessionModel = model<IUploadSessionDocument>('UploadSession', uploadSessionSchema); 