import { Schema, model, Document } from 'mongoose';
import {
  Factory,
  FactoryStatus,
  TokenType,
  UploadLimitType,
  FactoryToken,
  FactoryUploadLimit,
  FactoryTask,
  FactoryApp
} from '../types/factory.ts';

// Mongoose document interface extending Factory
export interface IFactoryDocument extends Document, Omit<Factory, 'id'> {
  _id: string;
}

// Token schema
const factoryTokenSchema = new Schema<FactoryToken>({
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
}, { _id: false });

// Upload limit schema  
const factoryUploadLimitSchema = new Schema<FactoryUploadLimit>({
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
}, { _id: false });

// Task schema
const factoryTaskSchema = new Schema<FactoryTask>({
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
    type: Number,
    min: 0
  }
}, { _id: false });

// App schema
const factoryAppSchema = new Schema<FactoryApp>({
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
  categories: [{
    type: String,
    maxlength: 50
  }],
  tasks: [factoryTaskSchema]
}, { _id: false });

// Main Factory schema
const factorySchema = new Schema<IFactoryDocument>({
  _id: {
    type: String,
    required: true
  },
  poolAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
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

  // Status & lifecycle
  status: {
    type: String,
    enum: Object.values(FactoryStatus),
    default: FactoryStatus.active,
    index: true
  },

  // Skills & categorization - unified approach
  skills: [{
    type: String,
    maxlength: 50,
    index: true
  }],

  // Economic model
  token: {
    type: factoryTokenSchema,
    required: true
  },
  pricePerDemo: {
    type: Number,
    required: true,
  },

  // Statistics
  demonstrations: {
    type: Number,
    default: 0,
    min: 0
  },
  totalEarned: {
    type: Number,
    default: 0,
    min: 0
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
}, {
  _id: false,
  timestamps: true,
  collection: 'factories',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => {
      const { _id, __v, ...rest } = ret;
      return { id: _id, ...rest };
    }
  }
});

// Virtual 'id' property mapping to '_id'  
factorySchema.virtual('id').get(function () {
  return this._id;
});

// Indexes for performance
factorySchema.index({ ownerAddress: 1, status: 1 });
factorySchema.index({ skills: 1, status: 1 });
factorySchema.index({ createdAt: -1 });
factorySchema.index({ demonstrations: -1 });
// Apps-specific indexes
factorySchema.index({ 'apps.categories': 1 });
factorySchema.index({ 'apps.name': 'text', 'apps.tasks.prompt': 'text' });

// Pre-save middleware to update search text
factorySchema.pre('save', function (next) {
  const searchParts: string[] = [
    this.name?.toLowerCase() || '',
    this.description?.toLowerCase() || '',
    ...(this.skills || []).map(s => s.toLowerCase()),
    ...(this.apps || []).flatMap(app => [
      app.name?.toLowerCase() || '',
      app.description?.toLowerCase() || '',
      ...(app.categories || []).map(c => c.toLowerCase())
    ])
  ].filter(Boolean);

  this.searchText = searchParts.join(' ');
  next();
});

export const FactoryModel = model<IFactoryDocument>('Factory', factorySchema);