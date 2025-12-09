#!/usr/bin/env node

/**
 * Migration script to import old viralmind data into new factory structure
 * 
 * Usage: npx tsx scripts/migrate-viralmind-data.ts [environment]
 * Environment: development (default), test, production
 */

import { readFileSync } from 'fs'
import mongoose, { Types } from 'mongoose'
import { FactoryModel, type IFactoryDocument } from '../../src/models/Factory.ts'
import { FactoryStatus } from '../../src/types/factory.ts'

// Get environment from command line or default to development
const environment = process.argv[2] || 'development'
const validEnvironments = ['development', 'test', 'production']

if (!validEnvironments.includes(environment)) {
  console.error(`❌ Invalid environment: ${environment}`)
  console.error(`Valid environments: ${validEnvironments.join(', ')}`)
  process.exit(1)
}

console.log(`🚀 Running migration for environment: ${environment}`)

// Paths to data files
const TRAINING_POOLS_PATH = '/Users/SSe/SSe/app/Clones-workspace/clones-quality-agent/data/stats_viralmind/viralmind.training_pools.json'
const FORGE_APPS_PATH = '/Users/SSe/SSe/app/Clones-workspace/clones-quality-agent/data/stats_viralmind/viralmind.forge_apps.json'

// Owner address based on environment
const OWNER_ADDRESS = '0x6E60D7b7b1587863dE6D2078C020d61F65781d7e'

// Note: For archived factories, we don't set poolAddress or token

// MongoDB connection
const MONGODB_URI = process.env.DB_URI || 'mongodb://admin:admin@localhost:27017/dev?authSource=admin'

/**
 * Format skills: split by \n and capitalize after each newline
 */
function formatSkills(skillsText) {
  if (!skillsText) return []

  return skillsText
    .split('\n')
    .map(skill => skill.trim())
    .filter(skill => skill.length > 0)
    .map(skill => skill.charAt(0).toUpperCase() + skill.slice(1))
}

function transformTrainingPool(pool: any, appsMap: Map<string, any[]>) {
  const poolId = pool._id.$oid
  const factoryId = `factory_${poolId}`

  // Get associated apps for this pool
  const poolApps = appsMap.get(poolId) || []

  // Transform to tasks-centric structure
  // For each app, create tasks with that app in apps_used
  const tasks: any[] = []

  poolApps.forEach((app: any) => {
    const taskApp = {
      name: app.name,
      domain: app.domain,
      description: app.description || ''
    }

    // Each task from the app becomes a workflow task
    if (app.tasks && Array.isArray(app.tasks)) {
      app.tasks.forEach((task: any) => {
        // Generate a task name from prompt if not available
        const taskName = task.name || task.prompt?.substring(0, 50) || app.name

        tasks.push({
          id: task._id.$oid,
          prompt: task.prompt,
          categories: app.categories || [],
          task_name: taskName,
          apps_used: [taskApp], // App is used by this task
          uploadLimit: undefined,
          rewardLimit: undefined
        })
      })
    }
  })

  return {
    _id: factoryId,
    // poolAddress and token are optional for archived factories
    name: pool.name,
    description: undefined,
    ownerAddress: OWNER_ADDRESS.toLowerCase(),
    status: FactoryStatus.archived,
    skills: formatSkills(pool.skills),
    totalEarned: Types.Decimal128.fromString('0'),
    tasks: tasks,
    createdAt: new Date(pool.createdAt.$date),
    updatedAt: new Date(pool.updatedAt.$date)
  }
}

/**
 * Load and parse JSON files
 */
function loadData() {
  console.log('Loading data files...')

  const trainingPoolsData = JSON.parse(readFileSync(TRAINING_POOLS_PATH, 'utf8'))
  const forgeAppsData = JSON.parse(readFileSync(FORGE_APPS_PATH, 'utf8'))

  console.log(`Loaded ${trainingPoolsData.length} training pools`)
  console.log(`Loaded ${forgeAppsData.length} forge apps`)

  // Create map of apps by pool_id for efficient lookup
  const appsMap = new Map()

  forgeAppsData.forEach((app: any) => {
    const poolId = app.pool_id?.$oid
    if (poolId) {
      if (!appsMap.has(poolId)) {
        appsMap.set(poolId, [])
      }
      appsMap.get(poolId).push(app)
    }
  })

  console.log(`Apps mapped to ${appsMap.size} pools`)

  return { trainingPoolsData, appsMap }
}

/**
 * Connect to MongoDB
 */
async function connectToMongo() {
  console.log(`Connecting to MongoDB: ${MONGODB_URI}`)
  await mongoose.connect(MONGODB_URI)
  console.log('Connected to MongoDB')
}

/**
 * Main migration function
 */
async function migrate() {
  try {
    // Load data
    const { trainingPoolsData, appsMap } = loadData()

    // Connect to database
    await connectToMongo()

    console.log('Starting migration...')

    const factories: Partial<IFactoryDocument>[] = []
    let processed = 0
    let errors = 0

    for (const pool of trainingPoolsData) {
      try {
        const factory = transformTrainingPool(pool, appsMap)
        factories.push(factory)
        processed++

        if (processed % 10 === 0) {
          console.log(`Processed ${processed}/${trainingPoolsData.length} pools`)
        }
      } catch (error) {
        console.error(`Error processing pool ${pool._id.$oid}:`, error.message)
        errors++
      }
    }

    console.log(`\nTransformation complete:`)
    console.log(`- Processed: ${processed} pools`)
    console.log(`- Errors: ${errors}`)
    console.log(`- Ready to insert: ${factories.length} factories`)

    // Debug: show first factory
    if (factories.length > 0) {
      console.log('\nFirst factory sample:')
      console.log(JSON.stringify(factories[0], null, 2))
    }

    if (factories.length > 0) {
      console.log('\nChecking for existing factories...')

      // Check for existing factories
      const existingIds = await FactoryModel.find(
        { _id: { $in: factories.map(f => f._id) } },
        { _id: 1 }
      ).lean()

      if (existingIds.length > 0) {
        console.log(`ℹ️  Found ${existingIds.length} existing factories that will be skipped:`)
        existingIds.slice(0, 5).forEach(f => console.log(`  - ${f._id}`))
        if (existingIds.length > 5) {
          console.log(`  - ... and ${existingIds.length - 5} more`)
        }
      }

      // Filter out existing factories
      const newFactories = factories.filter(f =>
        !existingIds.some(existing => existing._id === f._id)
      )

      console.log(`📊 Migration summary:`)
      console.log(`  - Total processed: ${factories.length}`)
      console.log(`  - Already exist: ${existingIds.length}`)
      console.log(`  - New to insert: ${newFactories.length}`)

      if (newFactories.length === 0) {
        console.log('\n✅ All factories already exist in database. Migration complete!')
        return
      }

      try {
        const result = await FactoryModel.insertMany(newFactories, {
          ordered: false // Continue on errors
        })

        console.log(`✅ Successfully inserted ${result.length} factories`)
      } catch (error: any) {
        if (error.writeErrors && error.writeErrors.length > 0) {
          console.log(`❌ ${error.writeErrors.length} insertion errors:`)
          error.writeErrors.slice(0, 5).forEach((err: any, index: number) => {
            console.log(`  ${index + 1}. Factory: ${err.err.op._id}`)
            console.log(`     Error: ${err.err.errmsg}`)
            if (err.err.errInfo && err.err.errInfo.details) {
              console.log(`     Details: ${JSON.stringify(err.err.errInfo.details)}`)
            }
          })
          const insertedCount = error.result ? error.result.insertedCount : 0
          console.log(`✅ Successfully inserted ${insertedCount} factories despite errors`)
        } else {
          console.log('❌ Insertion error:', error.message)
          throw error
        }
      }
    }

    console.log('\n🎉 Migration completed successfully!')

  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { migrate }