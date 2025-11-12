import { type Document, model, Schema, Types } from 'mongoose'
import { type DatasetHolder } from '../types/datamarketplace.ts'

// Mongoose document interface with Decimal128 fields
export interface IDatasetHolderDocument extends Document, Omit<DatasetHolder, 'id' | 'balance' | 'percentage'> {
  _id: string
  balance: Types.Decimal128
  percentage: Types.Decimal128
}

// Main DatasetHolder schema
const datasetHolderSchema = new Schema<IDatasetHolderDocument>(
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
    holderAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    balance: {
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
    percentage: {
      type: Schema.Types.Decimal128,
      required: true,
      min: 0,
      max: 100,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    lastUpdated: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    }
  },
  {
    _id: false,
    timestamps: false, // Using lastUpdated instead
    collection: 'datasetHolders',
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
datasetHolderSchema.virtual('id').get(function () {
  return this._id
})

// Unique constraint on dataset + holder combination
datasetHolderSchema.index({ datasetId: 1, holderAddress: 1 }, { unique: true })

// Compound indexes for performance
datasetHolderSchema.index({ datasetId: 1, balance: -1 }) // Top holders by dataset
datasetHolderSchema.index({ datasetId: 1, percentage: -1 }) // Top holders by percentage
datasetHolderSchema.index({ holderAddress: 1, balance: -1 }) // Holdings by address
datasetHolderSchema.index({ balance: -1 }) // Global top holders

export const DatasetHolderModel = model<IDatasetHolderDocument>('DatasetHolder', datasetHolderSchema)