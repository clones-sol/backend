import { type Document, model, Schema } from 'mongoose'

export enum AppCategory {
  openSource = 'open_source',
  webapp = 'webapp',
  desktop = 'desktop',
  api = 'api' // Added for API-based apps
}

export interface App {
  id: string
  name: string
  nameLowercase: string
  domain: string
  description: string
  categories: AppCategory[]
  usageCount: number // Track popularity for ranking
  createdAt: Date
  updatedAt: Date
}

export interface IAppDocument extends Document, Omit<App, 'id'> {
  _id: string
}

const appSchema = new Schema<IAppDocument>(
  {
    _id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
      // No index here - we query via nameLowercase instead
    },
    nameLowercase: {
      type: String,
      required: true,
      lowercase: true,
      index: true // Regular index for fast lookups
    },
    domain: {
      type: String,
      required: true,
      lowercase: true,
      index: true // Regular index for domain lookups
    },
    description: {
      type: String,
      required: true,
      maxlength: 500
    },
    categories: [
      {
        type: String,
        enum: Object.values(AppCategory),
        index: true
      }
    ],
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true
    }
  },
  {
    _id: false,
    timestamps: true,
    collection: 'apps',
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
appSchema.virtual('id').get(function () {
  return this._id
})

// Indexes for performance
// Text search index for full-text search across name, domain, description
appSchema.index({ name: 'text', domain: 'text', description: 'text' })

// Composite index for filtering by category and sorting by popularity
appSchema.index({ categories: 1, usageCount: -1 })

// Unique index for case-insensitive name lookups (primary lookup method)
appSchema.index({ nameLowercase: 1 }, { unique: true })

// Note: domain and nameLowercase already have regular indexes defined inline above

export const AppModel = model<IAppDocument>('App', appSchema)
