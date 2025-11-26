/**
 * Apps seed service - Auto-seeds apps and app relations collections on server startup
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { AppModel, type AppCategory } from '../models/App.ts'
import { AppRelationModel, generateRelationId } from '../models/AppRelation.ts'
import { logger } from './logger.ts'

// Resolve data directory - works in both dev and production
// Production uses environment variable or fallback to build/data
// Dev uses src/data relative to cwd
function getDataPath(filename: string): string {
  // Try production path first (set by Dockerfile or process.cwd())
  const prodPath = join(process.cwd(), 'build/data', filename)
  if (existsSync(prodPath)) {
    return prodPath
  }

  // Fallback to dev path
  const devPath = join(process.cwd(), 'src/data', filename)
  if (existsSync(devPath)) {
    return devPath
  }

  // If neither exists, return prod path for error message clarity
  return prodPath
}

interface AppSeedData {
  _id: string
  name: string
  domain: string
  description: string
  categories: AppCategory[]
}

interface AppRelationSeedData {
  _id: string
  appId: string
  alternativeId: string
  relevanceScore: number
  bidirectional: boolean
}

interface AppsSeedFile {
  apps: AppSeedData[]
  metadata?: {
    version: string
    format: string
    generated: string
    totalApps: number
  }
}

interface RelationsSeedFile {
  relations: AppRelationSeedData[]
  metadata?: {
    version: string
    format: string
    generated: string
    totalRelations: number
  }
}

/**
 * Loads and seeds the apps collection from JSON file
 * Uses upsert operations to be idempotent - safe to run on each server start
 */
async function seedApps(): Promise<number> {
  const jsonPath = getDataPath('apps-seed.json')

  let jsonData: string
  try {
    jsonData = readFileSync(jsonPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read apps seed file at ${jsonPath}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let seedData: AppsSeedFile
  try {
    seedData = JSON.parse(jsonData)
  } catch (error) {
    throw new Error(`Failed to parse apps seed JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!seedData.apps || !Array.isArray(seedData.apps)) {
    throw new Error(`Invalid apps seed data: missing or invalid 'apps' array`)
  }

  logger.info(`Loaded ${seedData.apps.length} apps from JSON (v${seedData.metadata?.version || 'unknown'})`)

  // Ensure indexes are created first (idempotent operation)
  try {
    await AppModel.createIndexes()
  } catch (error) {
    // If index already exists with different options, log warning but continue
    // MongoDB doesn't allow recreating an index with different options
    if (error instanceof Error && error.message.includes('An existing index has the same name')) {
      logger.warn(`Index conflict detected - existing indexes will be used: ${error.message}`)
      // Continue with seed - indexes exist but may have different options
    } else {
      throw new Error(`Failed to create App indexes: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let upsertedCount = 0
  let updatedCount = 0
  let skippedCount = 0

  for (const app of seedData.apps) {
    const appData = {
      name: app.name,
      nameLowercase: app.name.toLowerCase(),
      domain: app.domain.toLowerCase(),
      description: app.description,
      categories: app.categories
      // Note: usageCount is NOT updated to preserve existing usage stats
    }

    try {
      // Upsert: update if exists, insert if not
      const result = await AppModel.updateOne(
        { _id: app._id },
        {
          $set: appData,
          $setOnInsert: { usageCount: 0 } // Only set usageCount on insert
        },
        { upsert: true }
      )

      if (result.upsertedCount > 0) {
        upsertedCount++
      } else if (result.modifiedCount > 0) {
        updatedCount++
      } else {
        skippedCount++
      }
    } catch (error) {
      throw new Error(`Failed to upsert app ${app._id} (${app.name}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  logger.info(`Apps seed: ${upsertedCount} inserted, ${updatedCount} updated, ${skippedCount} unchanged`)
  return seedData.apps.length
}

/**
 * Loads and seeds the app relations collection from JSON file
 * Creates bidirectional relations when specified
 */
async function seedAppRelations(): Promise<number> {
  const jsonPath = getDataPath('app-relations-seed.json')

  let jsonData: string
  try {
    jsonData = readFileSync(jsonPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read relations seed file at ${jsonPath}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let seedData: RelationsSeedFile
  try {
    seedData = JSON.parse(jsonData)
  } catch (error) {
    throw new Error(`Failed to parse relations seed JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!seedData.relations || !Array.isArray(seedData.relations)) {
    throw new Error(`Invalid relations seed data: missing or invalid 'relations' array`)
  }

  logger.info(`Loaded ${seedData.relations.length} relations from JSON (v${seedData.metadata?.version || 'unknown'})`)

  // Ensure indexes are created first
  try {
    await AppRelationModel.createIndexes()
  } catch (error) {
    // If index already exists with different options, log warning but continue
    if (error instanceof Error && error.message.includes('An existing index has the same name')) {
      logger.warn(`Index conflict detected - existing indexes will be used: ${error.message}`)
    } else {
      throw new Error(`Failed to create AppRelation indexes: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let upsertedCount = 0
  let updatedCount = 0
  let skippedCount = 0

  for (const relation of seedData.relations) {
    try {
      // Upsert primary relation
      const result = await AppRelationModel.updateOne(
        { _id: relation._id },
        {
          $set: {
            appId: relation.appId,
            alternativeId: relation.alternativeId,
            relevanceScore: relation.relevanceScore,
            bidirectional: relation.bidirectional
          }
        },
        { upsert: true }
      )

      if (result.upsertedCount > 0) {
        upsertedCount++
      } else if (result.modifiedCount > 0) {
        updatedCount++
      } else {
        skippedCount++
      }

      // Create reverse relation if bidirectional
      if (relation.bidirectional) {
        const reverseId = generateRelationId(relation.alternativeId, relation.appId)
        const reverseResult = await AppRelationModel.updateOne(
          { _id: reverseId },
          {
            $set: {
              appId: relation.alternativeId,
              alternativeId: relation.appId,
              relevanceScore: relation.relevanceScore,
              bidirectional: false // Only primary relation controls bidirectionality
            }
          },
          { upsert: true }
        )

        if (reverseResult.upsertedCount > 0) {
          upsertedCount++
        } else if (reverseResult.modifiedCount > 0) {
          updatedCount++
        } else {
          skippedCount++
        }
      }
    } catch (error) {
      throw new Error(`Failed to upsert relation ${relation._id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  logger.info(`Relations seed: ${upsertedCount} inserted, ${updatedCount} updated, ${skippedCount} unchanged`)
  return seedData.relations.length
}

/**
 * Main seed function - seeds both apps and relations
 */
export async function seedAppsFromJson(): Promise<void> {
  try {
    logger.info('Starting apps and relations seed from JSON...')

    const [appsCount, relationsCount] = await Promise.all([
      seedApps(),
      seedAppRelations()
    ])

    logger.info(`✓ Seed complete: ${appsCount} apps, ${relationsCount} base relations`)

    // Log statistics
    const [categoryStats, relationStats] = await Promise.all([
      AppModel.aggregate([
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      AppRelationModel.aggregate([
        { $group: { _id: '$appId', count: { $sum: 1 } } },
        { $group: { _id: null, avgAlternatives: { $avg: '$count' }, maxAlternatives: { $max: '$count' } } }
      ])
    ])

    logger.info('Category distribution:')
    categoryStats.forEach((stat) => {
      logger.info(`  ${stat._id}: ${stat.count} apps`)
    })

    if (relationStats.length > 0) {
      logger.info(`Avg alternatives per app: ${relationStats[0].avgAlternatives.toFixed(1)}`)
      logger.info(`Max alternatives: ${relationStats[0].maxAlternatives}`)
    }
  } catch (error) {
    logger.error('Failed to seed apps/relations from JSON:', error)
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`)
      logger.error(`Error stack: ${error.stack}`)
    }
    throw error
  }
}
