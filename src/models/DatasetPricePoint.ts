import { type Document, model, Schema, Types } from 'mongoose'
import { type DatasetPricePoint } from '../types/datamarketplace.ts'

// Mongoose document interface with Decimal128 fields
export interface IDatasetPricePointDocument extends Document, Omit<DatasetPricePoint, 'id' | 'open' | 'high' | 'low' | 'close' | 'volume'> {
  _id: string
  open: Types.Decimal128
  high: Types.Decimal128
  low: Types.Decimal128
  close: Types.Decimal128
  volume: Types.Decimal128
}

// Main DatasetPricePoint schema
const datasetPricePointSchema = new Schema<IDatasetPricePointDocument>(
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
    timestamp: {
      type: Date,
      required: true,
      index: true
    },
    open: {
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
    high: {
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
    low: {
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
    close: {
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
    volume: {
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
    period: {
      type: String,
      required: true,
      enum: ['1m', '5m', '1h', '1d'],
      index: true
    }
  },
  {
    _id: false,
    timestamps: true,
    collection: 'datasetPricePoints',
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
datasetPricePointSchema.virtual('id').get(function () {
  return this._id
})

// Compound indexes for performance
datasetPricePointSchema.index({ datasetId: 1, period: 1, timestamp: -1 })
datasetPricePointSchema.index({ timestamp: -1 })
datasetPricePointSchema.index({ period: 1, timestamp: -1 })

// Unique constraint to prevent duplicate price points
datasetPricePointSchema.index({ datasetId: 1, period: 1, timestamp: 1 }, { unique: true })

export const DatasetPricePointModel = model<IDatasetPricePointDocument>('DatasetPricePoint', datasetPricePointSchema)