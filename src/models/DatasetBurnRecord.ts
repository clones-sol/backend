import { type Document, model, Schema, Types } from 'mongoose'
import { type DatasetBurnRecord } from '../types/datamarketplace.ts'

// Mongoose document interface with Decimal128 fields
export interface IDatasetBurnRecordDocument extends Document, Omit<DatasetBurnRecord, 'id' | 'tokenAmount'> {
  _id: string
  tokenAmount: Types.Decimal128
}

// Main DatasetBurnRecord schema
const datasetBurnRecordSchema = new Schema<IDatasetBurnRecordDocument>(
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
    burnerAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    txHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    tokenAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      min: 0,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    timestamp: {
      type: Date,
      required: true,
      index: true
    },
    downloadUrl: {
      type: String,
      maxlength: 2000
    },
    downloadExpiry: {
      type: Date,
      index: true
    }
  },
  {
    _id: false,
    timestamps: true,
    collection: 'datasetBurnRecords',
    toJSON: {
      virtuals: true,
      getters: true,
      transform: (_doc, ret) => {
        const { _id, __v, ...rest } = ret
        return { id: _id, ...rest }
      }
    }
  }
)

// Virtual 'id' property mapping to '_id'
datasetBurnRecordSchema.virtual('id').get(function () {
  return this._id
})

// Unique constraint - one burn per address per dataset
datasetBurnRecordSchema.index({ datasetId: 1, burnerAddress: 1 }, { unique: true })

// Compound indexes for performance
datasetBurnRecordSchema.index({ datasetId: 1, timestamp: -1 })
datasetBurnRecordSchema.index({ burnerAddress: 1, timestamp: -1 })
datasetBurnRecordSchema.index({ timestamp: -1 })
datasetBurnRecordSchema.index({ downloadExpiry: 1 }) // For cleanup of expired URLs

export const DatasetBurnRecordModel = model<IDatasetBurnRecordDocument>('DatasetBurnRecord', datasetBurnRecordSchema)