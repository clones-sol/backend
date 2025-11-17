import { type Document, model, Schema, Types } from 'mongoose'
import {
  type Factory,
  type FactoryApp,
  FactoryStatus,
  type FactoryTask,
  type FactoryToken,
  type FactoryUploadLimit,
  TokenType,
  UploadLimitType
} from '../types/factory.ts'

// Mongoose-specific task interface with Decimal128
interface IFactoryTaskDocument extends Omit<FactoryTask, 'rewardLimit'> {
  rewardLimit?: Types.Decimal128
}

// Mongoose-specific app interface
interface IFactoryAppDocument extends Omit<FactoryApp, 'tasks'> {
  tasks: IFactoryTaskDocument[]
}

// Mongoose document interface with Decimal128 fields
export interface IFactoryDocument extends Document, Omit<Factory, 'id' | 'totalEarned' | 'apps'> {
  _id: string
  totalEarned: Types.Decimal128
  apps: IFactoryAppDocument[]
}

// Token schema
const factoryTokenSchema = new Schema<FactoryToken>(
  {
    type: {
      type: String,
      enum: Object.values(TokenType),
      required: true
    },
    symbol: {
      type: String,
      required: true,
      index: true
    },
    address: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    decimals: {
      type: Number,
      required: true,
      min: 0,
      max: 18
    }
  },
  { _id: false }
)

// Upload limit schema
const factoryUploadLimitSchema = new Schema<FactoryUploadLimit>(
  {
    value: {
      type: Number,
      required: true,
      min: 1
    },
    type: {
      type: String,
      enum: Object.values(UploadLimitType),
      required: true
    }
  },
  { _id: false }
)

// Task schema
const factoryTaskSchema = new Schema<FactoryTask>(
  {
    id: {
      type: String,
      required: true
    },
    prompt: {
      type: String,
      required: true,
      maxlength: 2000
    },
    uploadLimit: {
      type: Number,
      min: 1
    },
    rewardLimit: {
      type: Schema.Types.Decimal128,
      min: 0,
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

// App schema
const factoryAppSchema = new Schema<FactoryApp>(
  {
    id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
      maxlength: 100,
      index: true
    },
    domain: {
      type: String,
      required: true,
      maxlength: 200
    },
    description: {
      type: String,
      maxlength: 500
    },
    categories: [
      {
        type: String,
        maxlength: 500
      }
    ],
    tasks: [factoryTaskSchema]
  },
  { _id: false }
)

// Main Factory schema
const factorySchema = new Schema<IFactoryDocument>(
  {
    _id: {
      type: String,
      required: true
    },
    poolAddress: {
      type: String,
      required: function(this: IFactoryDocument) {
        // poolAddress is optional for archived factories
        return this.status !== FactoryStatus.archived
      },
      lowercase: true
    },
    name: {
      type: String,
      required: true,
      maxlength: 100,
      index: true
    },
    description: {
      type: String,
      maxlength: 1000
    },

    // Ownership
    ownerAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },

    // Referral tracking - captured at factory creation time
    referrerAddress: {
      type: String,
      lowercase: true,
      index: true
    },

    // Status & lifecycle
    status: {
      type: String,
      enum: Object.values(FactoryStatus),
      default: FactoryStatus.active,
      index: true
    },

    // Skills & categorization - unified approach
    skills: [
      {
        type: String,
        maxlength: 500,
        index: true
      }
    ],

    // Economic model
    token: {
      type: factoryTokenSchema,
      required: function(this: IFactoryDocument) {
        // token is optional for archived factories
        return this.status !== FactoryStatus.archived
      }
    },

    // Statistics
    totalEarned: {
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

    // Configuration
    uploadLimit: factoryUploadLimitSchema,

    // Apps integrated directly
    apps: [factoryAppSchema],

    // Search optimization
    searchText: {
      type: String,
      index: 'text'
    }
  },
  {
    _id: false,
    timestamps: true,
    collection: 'factories',
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
factorySchema.virtual('id').get(function () {
  return this._id
})

// Indexes for performance
factorySchema.index({ ownerAddress: 1, status: 1 })
factorySchema.index({ skills: 1, status: 1 })
factorySchema.index({ totalEarned: -1 })
// Apps-specific indexes
factorySchema.index({ 'apps.categories': 1 })
factorySchema.index({ 'apps.name': 'text', 'apps.tasks.prompt': 'text' })

// Pre-save middleware to update search text only if relevant fields changed
factorySchema.pre('save', function (next) {
  if (
    this.isModified('name') ||
    this.isModified('description') ||
    this.isModified('skills') ||
    this.isModified('apps')
  ) {
    const searchParts: string[] = [
      this.name?.toLowerCase() || '',
      this.description?.toLowerCase() || '',
      ...(this.skills || []).map((s) => s.toLowerCase()),
      ...(this.apps || []).flatMap((app) => [
        app.name?.toLowerCase() || '',
        app.description?.toLowerCase() || '',
        ...(app.categories || []).map((c) => c.toLowerCase())
      ])
    ].filter(Boolean)

    this.searchText = searchParts.join(' ')
  }
  next()
})

export const FactoryModel = model<IFactoryDocument>('Factory', factorySchema)

// Create unique partial index for poolAddress (only when not null)
FactoryModel.collection.createIndex(
  { poolAddress: 1 },
  { 
    unique: true,
    partialFilterExpression: { poolAddress: { $ne: null } }
  }
).catch(() => {
  // Index might already exist, ignore error
})
