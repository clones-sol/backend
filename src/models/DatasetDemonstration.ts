import { type Document, model, Schema, Types } from 'mongoose'

export interface DatasetDemonstration {
  id: string
  datasetId: string
  demoHash: string
  addedAt: Date
  addedBy: 'automatic' | 'manual'
  qualityScore?: number
  notes?: string
}

// Mongoose document interface
export interface IDatasetDemonstrationDocument extends Document, Omit<DatasetDemonstration, 'id'> {
  _id: string
}

// Main DatasetDemonstration schema
const datasetDemonstrationSchema = new Schema<IDatasetDemonstrationDocument>(
  {
    _id: {
      type: String,
      required: true
    },
    datasetId: {
      type: String,
      required: true,
      ref: 'DatasetToken',
      index: true
    },
    demoHash: {
      type: String,
      required: true,
      index: true
    },
    addedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    addedBy: {
      type: String,
      enum: ['automatic', 'manual'],
      required: true,
      index: true
    },
    qualityScore: {
      type: Number,
      min: 0,
      max: 100
    },
    notes: {
      type: String,
      maxlength: 500
    }
  },
  {
    _id: false,
    timestamps: false, // Using addedAt instead
    collection: 'datasetDemonstrations',
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const { _id, __v, ...rest } = ret
        return { id: _id, ...rest }
      }
    }
  }
)

// Virtual 'id' property mapping to '_id'
datasetDemonstrationSchema.virtual('id').get(function () {
  return this._id
})

// Unique constraint - one demo can only be added once per dataset
datasetDemonstrationSchema.index({ datasetId: 1, demoHash: 1 }, { unique: true })

// Compound indexes for performance
datasetDemonstrationSchema.index({ datasetId: 1, addedAt: -1 })
datasetDemonstrationSchema.index({ demoHash: 1 })
datasetDemonstrationSchema.index({ addedBy: 1, addedAt: -1 })

export const DatasetDemonstrationModel = model<IDatasetDemonstrationDocument>('DatasetDemonstration', datasetDemonstrationSchema)