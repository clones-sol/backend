#!/usr/bin/env node

/**
 * Migration script to import ViralMind demonstration submissions into new DemonstrationSubmission collection
 *
 * Usage: npx tsx scripts/migrate-demonstrations.ts [environment]
 * Environment: development (default), test, production
 *
 * COMPATIBILITY NOTE (task-centric model):
 * This script remains compatible with the new Factory.tasks[] structure because:
 * - Task IDs are preserved during factory migration (Task.id field)
 * - This script only references task IDs from submission metadata
 * - No factory structure modifications are performed here
 * - The meta.quest.task_id field is passed through as-is
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'

// Load environment variables from .env file
config()
import mongoose from 'mongoose'
import { FactoryModel } from '../../src/models/Factory.ts'
import { DemonstrationSubmission } from '../../src/models/DemonstrationSubmission.ts'
import { ForgeSubmissionProcessingStatus } from '../../src/types/index.ts'
import { generateDemoHash } from '../../src/services/demo-storage/hash.ts'
import { ObjectStorageService } from '../../src/services/storage/index.ts'

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
const OWNER_ADDRESS = '0x6E60D7b7b1587863dE6D2078C020d61F65781d7e'

// MongoDB connection
const MONGODB_URI = process.env.DB_URI || 'mongodb://admin:admin@localhost:27017/dev?authSource=admin'

// ViralMind Tigris storage configuration
const VIRAL_ACCESS_KEY = process.env.VIRAL_ACCESS_KEY
const VIRAL_SECRET_ACCESS_KEY = process.env.VIRAL_SECRET_ACCESS_KEY
const VIRAL_ENDPOINT = process.env.VIRAL_ENDPOINT
const VIRAL_BUCKET = 'clones-bucket-prod'
const VIRAL_REGION = 'auto'

// Initialize ViralMind storage service
let viralStorageService: ObjectStorageService | null = null

function getViralStorageService(): ObjectStorageService {
  if (!viralStorageService) {
    if (!VIRAL_ACCESS_KEY || !VIRAL_SECRET_ACCESS_KEY || !VIRAL_ENDPOINT) {
      throw new Error('ViralMind Tigris credentials not configured. Please set VIRAL_ACCESS_KEY, VIRAL_SECRET_ACCESS_KEY, and VIRAL_ENDPOINT environment variables.')
    }
    viralStorageService = new ObjectStorageService(
      VIRAL_ACCESS_KEY,
      VIRAL_SECRET_ACCESS_KEY,
      VIRAL_ENDPOINT,
      VIRAL_REGION,
      VIRAL_BUCKET
    )
  }
  return viralStorageService
}

/**
 * Build fileManifest from ViralMind files array
 * Checks file existence on ViralMind Tigris and populates size
 */
async function buildFileManifest(files: any[]): Promise<{
  fileManifest: any
  legacyStoragePaths: Record<string, string>
  missingFiles: string[]
}> {
  const fileManifest: any = {}
  const legacyStoragePaths: Record<string, string> = {}
  const missingFiles: string[] = []

  if (!files || files.length === 0) {
    return { fileManifest, legacyStoragePaths, missingFiles }
  }

  const storage = getViralStorageService()

  for (const file of files) {
    const fileName = file.file
    const s3Key = file.s3Key
    const sizeFromJson = file.size

    // Map file names to fileManifest keys
    let manifestKey: string | null = null
    if (fileName === 'input_log.jsonl') {
      manifestKey = 'input_log'
    } else if (fileName === 'meta.json') {
      manifestKey = 'meta'
    } else if (fileName === 'recording.mp4') {
      manifestKey = 'recording'
    }

    if (!manifestKey) {
      console.warn(`⚠️  Unknown file type: ${fileName}, skipping`)
      continue
    }

    // Store legacy path
    legacyStoragePaths[manifestKey] = s3Key

    try {
      // Check if file exists on ViralMind Tigris
      const fileInfo = await storage.checkFileExists({ name: s3Key })

      if (fileInfo.exists) {
        fileManifest[manifestKey] = {
          size: fileInfo.size || sizeFromJson,
          hash: null // Hash will be calculated in future migration phase
        }
      } else {
        missingFiles.push(`${fileName} (${s3Key})`)
        console.warn(`⚠️  File not found in ViralMind storage: ${s3Key}`)
      }
    } catch (error: any) {
      missingFiles.push(`${fileName} (${s3Key})`)
      console.error(`❌ Error checking file ${s3Key}:`, error.message)
    }
  }

  return { fileManifest, legacyStoragePaths, missingFiles }
}

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
function transformSubmission(
  submission: any,
  _poolIdMap: Map<string, string>,
  fileManifest: any,
  legacyStoragePaths: Record<string, string>
) {
  const taskId = submission.meta?.quest?.task_id

  // Note: poolId and taskId are already validated by caller

  // Generate demo hash using submission ID, address, and timestamp
  const timestamp = submission.meta?.timestamp ? new Date(submission.meta.timestamp).getTime() : Date.now()
  const demoHash = generateDemoHash(submission._id, OWNER_ADDRESS, timestamp)

  // Create meta object with task_id properly set and legacy storage paths
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
    },
    legacy_storage_paths: legacyStoragePaths
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
    fileManifest: Object.keys(fileManifest).length > 0 ? fileManifest : null,
    integrityVerified: false, // Files not yet migrated to new paths
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
    console.log('Initializing ViralMind storage service...')

    // Initialize storage service early to validate credentials
    try {
      getViralStorageService()
      console.log('✅ ViralMind storage service initialized successfully')
    } catch (error: any) {
      console.error('❌ Failed to initialize ViralMind storage service:', error.message)
      console.error('Migration aborted. Please configure VIRAL_ACCESS_KEY, VIRAL_SECRET_ACCESS_KEY, and VIRAL_ENDPOINT environment variables.')
      process.exit(1)
    }

    const demonstrations: any[] = []
    let processed = 0
    let errors = 0
    let skippedNoPool = 0
    let totalMissingFiles = 0
    let submissionsWithMissingFiles = 0
    const errorStats = new Map<string, number>() // Track error types

    for (const submission of submissionsData) {
      try {
        const poolId = submission.meta?.quest?.pool_id
        const taskId = submission.meta?.quest?.task_id

        // Skip submissions without valid pool_id mapping
        if (!poolId || !poolIdMap.has(poolId)) {
          skippedNoPool++
          continue
        }

        // Validate task_id exists BEFORE making network calls
        if (!taskId) {
          throw new Error(`Task ID missing in submission ${submission._id}`)
        }

        // Build file manifest from ViralMind files (makes network calls)
        const { fileManifest, legacyStoragePaths, missingFiles } = await buildFileManifest(submission.files || [])

        if (missingFiles.length > 0) {
          submissionsWithMissingFiles++
          totalMissingFiles += missingFiles.length
          console.warn(`⚠️  Submission ${submission._id}: ${missingFiles.length} missing file(s)`)
        }

        const demonstration = transformSubmission(submission, poolIdMap, fileManifest, legacyStoragePaths)
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

        // Only log first 10 errors of each type to avoid spam
        const errorCount = errorStats.get(errorType) || 0
        if (errorCount <= 10) {
          console.error(`Error processing submission ${submission._id}:`, error.message)
        }
        errors++
      }
    }

    console.log(`\nTransformation complete:`)
    console.log(`- Total submissions: ${submissionsData.length}`)
    console.log(`- Processed: ${processed}`)
    console.log(`- Skipped (no pool mapping): ${skippedNoPool}`)
    console.log(`- Errors: ${errors}`)
    console.log(`- Submissions with missing files: ${submissionsWithMissingFiles}`)
    console.log(`- Total missing files: ${totalMissingFiles}`)

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