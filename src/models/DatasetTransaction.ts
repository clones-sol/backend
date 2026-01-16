import { type Document, model, Schema, Types } from 'mongoose'
import { DatasetTransactionType, type DatasetTransaction } from '../types/datamarketplace.ts'

// Mongoose document interface with Decimal128 fields
export interface IDatasetTransactionDocument extends Document, Omit<DatasetTransaction, 'id' | 'tokenAmount' | 'ethAmount' | 'pricePerToken'> {
  _id: string
  tokenAmount: Types.Decimal128
  ethAmount: Types.Decimal128
  pricePerToken: Types.Decimal128
}

// Main DatasetTransaction schema
const datasetTransactionSchema = new Schema<IDatasetTransactionDocument>(
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
    txHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    blockNumber: {
      type: Number,
      required: true,
      index: true
    },
    timestamp: {
      type: Date,
      required: true,
      index: true
    },
    fromAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    type: {
      type: String,
      enum: Object.values(DatasetTransactionType),
      required: true,
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
    ethAmount: {
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
    pricePerToken: {
      type: Schema.Types.Decimal128,
      required: true,
      min: 0,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    }
  },
  {
    _id: false,
    timestamps: true,
    collection: 'datasetTransactions',
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
datasetTransactionSchema.virtual('id').get(function () {
  return this._id
})

// Compound indexes for performance
datasetTransactionSchema.index({ datasetId: 1, timestamp: -1 })
datasetTransactionSchema.index({ datasetId: 1, type: 1, timestamp: -1 })
datasetTransactionSchema.index({ fromAddress: 1, timestamp: -1 })
datasetTransactionSchema.index({ type: 1, timestamp: -1 })
datasetTransactionSchema.index({ timestamp: -1 })

export const DatasetTransactionModel = model<IDatasetTransactionDocument>('DatasetTransaction', datasetTransactionSchema)