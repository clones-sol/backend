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
      required: true,
      index: true
    },
    nameLowercase: {
      type: String,
      required: true,
      lowercase: true
    },
    domain: {
      type: String,
      required: true,
      lowercase: true
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
appSchema.index({ name: 'text', domain: 'text', description: 'text' })
appSchema.index({ categories: 1, usageCount: -1 })
appSchema.index({ domain: 1 })
appSchema.index({ nameLowercase: 1 }, { unique: true })

export const AppModel = model<IAppDocument>('App', appSchema)
