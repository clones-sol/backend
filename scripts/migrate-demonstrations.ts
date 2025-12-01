#!/usr/bin/env node

/**
 * Migration script to import ViralMind demonstration submissions into new DemonstrationSubmission collection
 * 
 * Usage: npx tsx scripts/migrate-demonstrations.ts [environment]
 * Environment: development (default), test, production
 */

import { readFileSync } from 'fs'
import mongoose from 'mongoose'
import { FactoryModel } from '../src/models/Factory.ts'
import { DemonstrationSubmission } from '../src/models/DemonstrationSubmission.ts'
import { ForgeSubmissionProcessingStatus } from '../src/types/index.ts'
import { generateDemoHash } from '../src/services/demo-storage/hash.ts'

// Get environment from command line or default to development
const environment = process.argv[2] || 'development'
const validEnvironments = ['development', 'test', 'production']

if (!validEnvironments.includes(environment)) {
  console.error(`❌ Invalid environment: ${environment}`)
  console.error(`Valid environments: ${validEnvironments.join(', ')}`)
  process.exit(1)
}

console.log(`🚀 Running demonstration migration for environment: ${environment}`)

// Path to submissions data file
const SUBMISSIONS_PATH = '/Users/SSe/SSe/app/Clones-workspace/clones-quality-agent/data/stats_viralmind/viralmind.forge_race_submissions.json'

// Owner address based on environment
const OWNER_ADDRESS = environment === 'development'
  ? '0x243eDd6b1F48636568476c8167CBe63C7Fe0ac8D'
  : '0x6E60D7b7b1587863dE6D2078C020d61F65781d7e'

// MongoDB connection
const MONGODB_URI = process.env.DB_URI || 'mongodb://admin:admin@localhost:27017/dev?authSource=admin'

/**
 * Load archived factories and create pool_id mapping
 */
async function getPoolIdMapping(): Promise<Map<string, string>> {
  console.log('Loading archived factories for pool_id mapping...')

  const archivedFactories = await FactoryModel.find(
    { status: 'archived' },
    { _id: 1 }
  ).lean()

  const poolIdMap = new Map<string, string>()

  archivedFactories.forEach(factory => {
    // Extract pool_id from factory._id (format: "factory_{pool_id}")
    const poolId = factory._id.replace('factory_', '')
    poolIdMap.set(poolId, factory._id)
  })

  console.log(`Found ${poolIdMap.size} archived factories with pool_id mapping`)
  return poolIdMap
}

/**
 * Transform ViralMind submission to DemonstrationSubmission format
 */
function transformSubmission(submission: any, poolIdMap: Map<string, string>) {
  const poolId = submission.meta?.quest?.pool_id
  const taskId = submission.meta?.quest?.task_id

  if (!poolId || !poolIdMap.has(poolId)) {
    throw new Error(`Pool ID ${poolId} not found in archived factories`)
  }

  if (!taskId) {
    throw new Error(`Task ID missing in submission ${submission._id}`)
  }

  // Generate demo hash using submission ID, address, and timestamp
  const timestamp = submission.meta?.timestamp ? new Date(submission.meta.timestamp).getTime() : Date.now()
  const demoHash = generateDemoHash(submission._id, OWNER_ADDRESS, timestamp)

  // Create meta object with task_id properly set
  const meta = {
    ...submission.meta,
    quest: {
      ...submission.meta.quest,
      task_id: taskId
    },
    schema_version: {
      major: 1,
      minor: 0,
      patch: 0
    }
  }

  // Handle dates properly - use meta.timestamp or current time
  const createdDate = submission.createdAt
    ? new Date(submission.createdAt)
    : submission.meta?.timestamp
      ? new Date(submission.meta.timestamp)
      : new Date()

  const updatedDate = submission.updatedAt
    ? new Date(submission.updatedAt)
    : submission.meta?.timestamp
      ? new Date(submission.meta.timestamp)
      : new Date()

  // Validate dates
  const validCreatedDate = isNaN(createdDate.getTime()) ? new Date() : createdDate
  const validUpdatedDate = isNaN(updatedDate.getTime()) ? new Date() : updatedDate

  return {
    _id: submission._id,
    address: OWNER_ADDRESS.toLowerCase(),
    meta: meta,
    status: ForgeSubmissionProcessingStatus.COMPLETED,
    demoHash: demoHash,
    fileManifest: null,
    integrityVerified: false,
    integrityLastCheck: null,
    grade_result: null,
    grading_metrics: null,
    error: null,
    reward: 0,
    maxReward: 0,
    clampedScore: null,
    onChainReward: null,
    claimAuthorization: null,
    farmerReferrerAddress: null,
    factoryReferrerAddress: null,
    cqaModel: null,
    createdAt: validCreatedDate,
    updatedAt: validUpdatedDate
  }
}

/**
 * Load and parse submissions JSON file
 */
function loadSubmissions() {
  console.log('Loading submissions data file...')

  const submissionsData = JSON.parse(readFileSync(SUBMISSIONS_PATH, 'utf8'))
  console.log(`Loaded ${submissionsData.length} submissions`)

  return submissionsData
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
    // Connect to database
    await connectToMongo()

    // Get pool_id mapping from archived factories
    const poolIdMap = await getPoolIdMapping()

    if (poolIdMap.size === 0) {
      console.log('⚠️  No archived factories found. Please run factory migration first.')
      return
    }

    // Load submissions data
    const submissionsData = loadSubmissions()

    console.log('Starting demonstration migration...')

    const demonstrations: any[] = []
    let processed = 0
    let errors = 0
    let skippedNoPool = 0
    const errorStats = new Map<string, number>() // Track error types

    for (const submission of submissionsData) {
      try {
        const poolId = submission.meta?.quest?.pool_id

        // Skip submissions without valid pool_id mapping
        if (!poolId || !poolIdMap.has(poolId)) {
          skippedNoPool++
          continue
        }

        const demonstration = transformSubmission(submission, poolIdMap)
        demonstrations.push(demonstration)
        processed++

        if (processed % 100 === 0) {
          console.log(`Processed ${processed} submissions...`)
        }
      } catch (error: any) {
        const errorType = error.message.includes('Pool ID') ? 'pool_not_found' :
          error.message.includes('Task ID') ? 'task_id_missing' :
            'transformation_error'

        errorStats.set(errorType, (errorStats.get(errorType) || 0) + 1)
        console.error(`Error processing submission ${submission._id}:`, error.message)
        errors++
      }
    }

    console.log(`\nTransformation complete:`)
    console.log(`- Total submissions: ${submissionsData.length}`)
    console.log(`- Processed: ${processed}`)
    console.log(`- Skipped (no pool mapping): ${skippedNoPool}`)
    console.log(`- Errors: ${errors}`)

    // Error breakdown
    if (errorStats.size > 0) {
      console.log(`\nError breakdown:`)
      errorStats.forEach((count, type) => {
        console.log(`  - ${type}: ${count}`)
      })
    }

    console.log(`- Ready to insert: ${demonstrations.length}`)

    // Debug: show first demonstration
    if (demonstrations.length > 0) {
      console.log('\nFirst demonstration sample:')
      console.log(JSON.stringify(demonstrations[0], null, 2))

      // Test single insert first
      console.log('\nTesting single demonstration insert...')
      try {
        const testDemo = new DemonstrationSubmission(demonstrations[0])
        await testDemo.validate()
        console.log('✅ Validation passed for first demonstration')
      } catch (validationError: any) {
        console.error('❌ Validation failed:', validationError.message)
        console.error('Validation errors:', validationError.errors)
      }
    }

    if (demonstrations.length > 0) {
      console.log('\nChecking for existing demonstrations...')

      // Check for existing demonstrations
      const existingIds = await DemonstrationSubmission.find(
        { _id: { $in: demonstrations.map(d => d._id) } },
        { _id: 1 }
      ).lean()

      if (existingIds.length > 0) {
        console.log(`ℹ️  Found ${existingIds.length} existing demonstrations that will be skipped:`)
        existingIds.slice(0, 5).forEach((d: any) => console.log(`  - ${d._id}`))
        if (existingIds.length > 5) {
          console.log(`  - ... and ${existingIds.length - 5} more`)
        }
      }

      // Filter out existing demonstrations
      const newDemonstrations = demonstrations.filter(d =>
        !existingIds.some((existing: any) => existing._id === d._id)
      )

      console.log(`📊 Migration summary:`)
      console.log(`  - Total processed: ${demonstrations.length}`)
      console.log(`  - Already exist: ${existingIds.length}`)
      console.log(`  - New to insert: ${newDemonstrations.length}`)

      if (newDemonstrations.length === 0) {
        console.log('\n✅ All demonstrations already exist in database. Migration complete!')
        return
      }

      try {
        console.log(`\nInserting ${newDemonstrations.length} demonstrations...`)
        const result = await DemonstrationSubmission.insertMany(newDemonstrations, {
          ordered: false // Continue on errors
        })

        console.log(`✅ Successfully inserted ${result.length} demonstrations`)
      } catch (error: any) {
        if (error.writeErrors && error.writeErrors.length > 0) {
          console.log(`❌ ${error.writeErrors.length} insertion errors:`)
          error.writeErrors.slice(0, 5).forEach((err: any, index: number) => {
            console.log(`  ${index + 1}. Demonstration: ${err.err.op._id}`)
            console.log(`     Error: ${err.err.errmsg}`)
            if (err.err.errInfo && err.err.errInfo.details) {
              console.log(`     Details: ${JSON.stringify(err.err.errInfo.details)}`)
            }
          })
          const insertedCount = error.result ? error.result.insertedCount : 0
          console.log(`✅ Successfully inserted ${insertedCount} demonstrations despite errors`)
        } else {
          console.log('❌ Insertion error:', error.message)
          throw error
        }
      }
    }

    // Final verification
    const finalCount = await DemonstrationSubmission.countDocuments()
    console.log(`\n📊 Final verification: ${finalCount} demonstrations in database`)

    console.log('\n🎉 Demonstration migration completed successfully!')

  } catch (error) {
    console.error('❌ Demonstration migration failed:', error)
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