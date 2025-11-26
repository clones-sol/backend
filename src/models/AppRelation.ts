/**
 * AppRelation model - Manages relationships between apps with relevance scores
 * This normalized approach avoids duplication and simplifies maintenance
 */

import { Schema, model, type Document } from 'mongoose'

export interface IAppRelation extends Document {
  _id: string // Format: "{appId}__{alternativeId}"
  appId: string // Reference to App._id
  alternativeId: string // Reference to App._id
  relevanceScore: number // 0-100 relevance score
  bidirectional: boolean // If true, creates inverse relation automatically
  createdAt: Date
  updatedAt: Date
}

const appRelationSchema = new Schema<IAppRelation>(
  {
    _id: {
      type: String,
      required: true
    },
    appId: {
      type: String,
      required: true,
      index: true // Index for fast lookups by appId
    },
    alternativeId: {
      type: String,
      required: true,
      index: true // Index for reverse lookups
    },
    relevanceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50
    },
    bidirectional: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    _id: false // We provide custom _id
  }
)

// Compound index for efficient relation queries
appRelationSchema.index({ appId: 1, relevanceScore: -1 })

// Ensure unique relations (prevent duplicates)
appRelationSchema.index({ appId: 1, alternativeId: 1 }, { unique: true })

/**
 * Generate deterministic relation ID
 */
export function generateRelationId(appId: string, alternativeId: string): string {
  return `${appId}__${alternativeId}`
}

export const AppRelationModel = model<IAppRelation>('AppRelation', appRelationSchema)
