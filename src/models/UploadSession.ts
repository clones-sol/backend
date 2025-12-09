import { logger } from "../services/logger.ts"
import { type Document, model, Schema } from 'mongoose'
import type { UploadChunk, UploadSession } from '../types/factory.ts'

// Interface for the Mongoose document, omitting 'id' from the base UploadSession to avoid conflict with Mongoose's 'id'
export interface IUploadSessionDocument
  extends Document,
  Omit<UploadSession, 'id' | 'receivedChunks'> {
  _id: string // Mongoose uses _id
  receivedChunks: Map<string, UploadChunk> // Mongoose Map requires string keys
  updatedAt: Date
  isProcessing?: boolean // Prevent TTL cleanup during active processing
}

const chunkSchema = new Schema<UploadChunk>(
  {
    chunkIndex: { type: Number, required: true },
    path: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true }
  },
  { _id: false, collection: 'upload_chunks' }
)

const uploadSessionSchema = new Schema<IUploadSessionDocument>(
  {
    _id: { type: String, required: true },
    address: {
      type: String,
      required: true,
      set: (v: string) => v.toLowerCase() // Always store addresses in lowercase
    },
    totalChunks: { type: Number, required: true },
    receivedChunks: {
      type: Map,
      of: chunkSchema,
      default: new Map()
    },
    metadata: { type: Schema.Types.Mixed, required: true },
    tempDir: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    isProcessing: { type: Boolean, default: false } // Prevent TTL cleanup during processing
  },
  {
    _id: false, // We are providing our own _id
    timestamps: false, // Manually define createdAt with TTL for better control
    toJSON: {
      virtuals: true,
      // Transform the output to return 'id' instead of '_id'
      transform: (_doc, ret) => {
        const { _id, __v, ...rest } = ret
        return { id: _id, ...rest }
      }
    },
    collection: 'upload_sessions'
  }
)

// Add middleware to log when sessions are deleted (including TTL cleanup)
uploadSessionSchema.pre('deleteOne', function() {
  logger.info(`[TTL-CLEANUP] UploadSession deleteOne triggered at ${new Date().toISOString()} for filter:`, this.getFilter())
})

uploadSessionSchema.pre('deleteMany', function() {
  logger.info(`[TTL-CLEANUP] UploadSession deleteMany triggered at ${new Date().toISOString()} for filter:`, this.getFilter())
})

uploadSessionSchema.pre('findOneAndDelete', async function() {
  const doc = await this.model.findOne(this.getFilter())
  if (doc) {
    logger.info(`[TTL-CLEANUP] UploadSession findOneAndDelete triggered at ${new Date().toISOString()}. Session ID: ${doc._id}, isProcessing: ${doc.isProcessing}`)
  }
})

// Create a virtual 'id' property that gets the '_id'
uploadSessionSchema.virtual('id').get(function () {
  return this._id
})

// TTL index on the `createdAt` field to automatically delete sessions after 24 hours (86400 seconds)
uploadSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 })

export const UploadSessionModel = model<IUploadSessionDocument>(
  'UploadSession',
  uploadSessionSchema
)
