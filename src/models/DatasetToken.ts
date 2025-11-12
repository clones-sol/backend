import { type Document, model, Schema, Types } from 'mongoose'
import { DatasetPhase, type DatasetToken } from '../types/datamarketplace.ts'

// Mongoose document interface with Decimal128 fields
export interface IDatasetTokenDocument extends Document, Omit<DatasetToken, 'id' | 'currentPrice' | 'marketCap' | 'volume24h' | 'totalBurned' | 'bondingCurve'> {
  _id: string
  currentPrice: Types.Decimal128
  marketCap: Types.Decimal128
  volume24h: Types.Decimal128
  totalBurned: Types.Decimal128
  bondingCurve: {
    virtualETH: Types.Decimal128
    virtualTokens: Types.Decimal128
    k: Types.Decimal128
  }
}

// Bonding curve schema
const bondingCurveSchema = new Schema(
  {
    virtualETH: {
      type: Schema.Types.Decimal128,
      required: true,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    virtualTokens: {
      type: Schema.Types.Decimal128,
      required: true,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    k: {
      type: Schema.Types.Decimal128,
      required: true,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    }
  },
  { _id: false }
)

// Graduation info schema
const graduationInfoSchema = new Schema(
  {
    timestamp: {
      type: Date,
      required: true
    },
    finalPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    lpPairAddress: {
      type: String,
      lowercase: true
    }
  },
  { _id: false }
)

// Main DatasetToken schema
const datasetTokenSchema = new Schema<IDatasetTokenDocument>(
  {
    _id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
      maxlength: 100,
      index: true
    },
    symbol: {
      type: String,
      required: true,
      maxlength: 10,
      index: true
    },
    description: {
      type: String,
      maxlength: 1000
    },
    category: {
      type: String,
      maxlength: 50,
      index: true
    },
    contractAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true
    },
    creatorAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    
    // Token economics
    totalSupply: {
      type: Number,
      required: false,
      min: 1
    },
    currentPrice: {
      type: Schema.Types.Decimal128,
      required: false,
      min: 0,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    marketCap: {
      type: Schema.Types.Decimal128,
      required: false,
      min: 0,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    volume24h: {
      type: Schema.Types.Decimal128,
      default: 0,
      min: 0,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    
    // Quality metrics
    qualityScore: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
      index: true
    },
    demonstrationCount: {
      type: Number,
      required: false,
      default: 0,
      min: 0
    },
    
    // Burn mechanics
    burnThresholdPercentage: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    },
    totalBurned: {
      type: Schema.Types.Decimal128,
      default: 0,
      min: 0,
      get: function (value: any) {
        return value ? parseFloat(value.toString()) : value
      },
      set: function (value: any) {
        return value === null || value === undefined ? value : Types.Decimal128.fromString(value.toString())
      }
    },
    burnCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    // Lifecycle
    phase: {
      type: String,
      enum: Object.values(DatasetPhase),
      default: DatasetPhase.draft,
      index: true
    },
    
    // Bonding curve parameters
    bondingCurve: {
      type: bondingCurveSchema,
      required: false
    },
    
    // Graduation info (if applicable)
    graduationInfo: graduationInfoSchema
  },
  {
    _id: false,
    timestamps: true,
    collection: 'datasetTokens',
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
datasetTokenSchema.virtual('id').get(function () {
  return this._id
})

// Indexes for performance
datasetTokenSchema.index({ phase: 1, qualityScore: -1 })
datasetTokenSchema.index({ volume24h: -1 })
datasetTokenSchema.index({ marketCap: -1 })
datasetTokenSchema.index({ createdAt: -1 })
datasetTokenSchema.index({ qualityScore: -1 })
datasetTokenSchema.index({ burnCount: -1 })

// Text search index
datasetTokenSchema.index({ 
  name: 'text', 
  description: 'text', 
  category: 'text' 
})

export const DatasetTokenModel = model<IDatasetTokenDocument>('DatasetToken', datasetTokenSchema)