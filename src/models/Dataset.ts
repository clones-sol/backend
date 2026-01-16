import mongoose from 'mongoose'
import { DatasetPhase } from '../types/datamarketplace.ts'

const bondingCurveSchema = new mongoose.Schema({
  virtualETH: { type: Number, required: true },
  virtualTokens: { type: Number, required: true },
  k: { type: Number, required: true }
}, { _id: false })

const graduationInfoSchema = new mongoose.Schema({
  timestamp: { type: Date, required: true },
  finalPrice: { type: Number, required: true },
  lpPairAddress: { type: String }
}, { _id: false })

const datasetSchema = new mongoose.Schema({
  _id: { type: String },
  name: { type: String, required: true, index: true },
  symbol: { type: String, required: true, unique: true, index: true },
  description: { type: String },
  category: { type: String, index: true },
  contractAddress: { type: String, required: true, unique: true },
  creatorAddress: {
    type: String,
    required: true,
    set: (v: string) => v.toLowerCase(),
    index: true
  },
  factoryId: { type: String, index: true },

  // Token economics
  totalSupply: { type: Number, default: 0 },
  currentPrice: { type: Number, default: 0 },
  marketCap: { type: Number, default: 0 },
  volume24h: { type: Number, default: 0 },

  // Quality metrics
  qualityScore: { type: Number, default: 0 },
  demonstrationCount: { type: Number, default: 0 },

  // Burn mechanics
  burnThresholdPercentage: { type: Number, required: true, default: 5 },
  totalBurned: { type: Number, default: 0 },
  burnCount: { type: Number, default: 0 },

  // Lifecycle
  phase: {
    type: String,
    enum: Object.values(DatasetPhase),
    default: DatasetPhase.draft,
    index: true
  },

  // Bonding curve parameters
  bondingCurve: { type: bondingCurveSchema, required: true },

  // Graduation info (if applicable)
  graduationInfo: { type: graduationInfoSchema },

  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, {
  collection: 'datasets',
  timestamps: true
})

// Compound indexes for common queries
datasetSchema.index({ phase: 1, createdAt: -1 })
datasetSchema.index({ factoryId: 1, createdAt: -1 })
datasetSchema.index({ creatorAddress: 1, createdAt: -1 })
datasetSchema.index({ qualityScore: -1 })
datasetSchema.index({ volume24h: -1 })

export const Dataset = mongoose.model('Dataset', datasetSchema)
