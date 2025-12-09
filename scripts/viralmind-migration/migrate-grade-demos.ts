#!/usr/bin/env node

/**
 * Migration script to grade legacy demonstration submissions using CQA via API
 *
 * This script calls the backend API to grade demonstrations, which handles all CQA logic.
 * This approach works regardless of where the script is run (local macOS, Docker, etc.)
 *
 * Usage: npx tsx scripts/migrate-grade-demos-api.ts [environment] [--limit N] [--backend-url URL]
 * Environment: development (default), test, production
 * --limit N: Process only first N submissions (default: 1 for testing)
 * --backend-url URL: Backend URL (default: http://localhost:8001)
 */

import { config } from 'dotenv'

// Load environment variables from .env file
config()

import mongoose from 'mongoose'
import { DemonstrationSubmission } from '../../src/models/DemonstrationSubmission.ts'

// Parse command line arguments
const args = process.argv.slice(2)
const environment = args.find(arg => !arg.startsWith('--')) || 'development'
const limitArg = args.find(arg => arg.startsWith('--limit'))
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 1
const backendUrlArg = args.find(arg => arg.startsWith('--backend-url'))
const BACKEND_URL = backendUrlArg ? backendUrlArg.split('=')[1] : (process.env.BACKEND_URL || 'http://localhost:8001')

const validEnvironments = ['development', 'test', 'production']

if (!validEnvironments.includes(environment)) {
  console.error(`❌ Invalid environment: ${environment}`)
  console.error(`Valid environments: ${validEnvironments.join(', ')}`)
  process.exit(1)
}

console.log(`🚀 Running demonstration grading migration for environment: ${environment}`)
console.log(`📊 Processing limit: ${limit} submission(s)`)
console.log(`🌐 Backend URL: ${BACKEND_URL}`)

// MongoDB connection
const MONGODB_URI = process.env.DB_URI || 'mongodb://admin:admin@localhost:27017/dev?authSource=admin'

/**
 * Grade a submission via API
 */
async function gradeSubmissionViaAPI(submissionId: string): Promise<any> {
  const url = `${BACKEND_URL}/api/v1/forge/grading/grade-submission/${submissionId}`

  console.log(`📡 Calling API: POST ${url}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API request failed with status ${response.status}: ${errorText}`)
  }

  return await response.json()
}

/**
 * Process a single demonstration submission for grading
 */
async function processSubmission(submission: any): Promise<boolean> {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📝 Processing submission: ${submission._id}`)
  console.log(`${'='.repeat(80)}`)

  // Check if demoHash exists
  if (!submission.demoHash) {
    console.log(`⏭️  Skipping - no demoHash found (not migrated yet?)`)
    return false
  }

  // Check if already graded
  if (submission.grade_result && submission.grade_result.score !== null && submission.grade_result.score !== undefined) {
    console.log(`⏭️  Skipping - already graded (score: ${submission.grade_result.score})`)
    return false
  }

  console.log(`🔑 DemoHash: ${submission.demoHash}`)
  console.log(`👤 Address: ${submission.address}`)

  try {
    // Call API to grade submission
    const result = await gradeSubmissionViaAPI(submission._id)

    if (result.alreadyGraded) {
      console.log(`⏭️  Already graded (score: ${result.gradeResult.score})`)
      return false
    }

    console.log(`✅ Successfully graded submission ${submission._id}`)
    console.log(`   - grade_result.score: ${result.gradeResult.score}`)
    console.log(`   - clampedScore: ${result.clampedScore}`)
    console.log(`   - grading_metrics: ${result.gradingMetrics ? 'yes' : 'no'}`)

    return true

  } catch (error: any) {
    console.error(`\n❌ Failed to grade submission ${submission._id}:`, error.message)
    return false
  }
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
 * Main grading function
 */
async function grade() {
  try {
    // Connect to database
    await connectToMongo()

    console.log('\n🔍 Looking for demonstration submissions to grade...')

    // Find submissions with legacy_storage_paths and null grade_result
    const submissions = await DemonstrationSubmission.find({
      'meta.legacy_storage_paths': { $exists: true },
      demoHash: {
        $exists: true,
        $ne: null,
        $eq: "46cc5603156ccb88770570416dfdd642b9cfe21f0b11da6f3d5ed0a299bd8b78",
      },
      $or: [
        { grade_result: { $exists: false } },
        { grade_result: null },
        { 'grade_result.score': { $exists: false } },
        { 'grade_result.score': null }
      ]
    })
      .limit(limit)
      .lean()

    console.log(`📊 Found ${submissions.length} submission(s) to grade`)

    if (submissions.length === 0) {
      console.log('\n✅ No submissions to grade. All done!')
      return
    }

    let processed = 0
    let successful = 0
    let failed = 0

    for (const submission of submissions) {
      processed++
      console.log(`\n📊 Progress: ${processed}/${submissions.length}`)

      const success = await processSubmission(submission)
      if (success) {
        successful++
      } else {
        failed++
      }
    }

    console.log(`\n${'='.repeat(80)}`)
    console.log(`📊 Grading Summary:`)
    console.log(`   - Total processed: ${processed}`)
    console.log(`   - Successful: ${successful}`)
    console.log(`   - Failed: ${failed}`)
    console.log(`${'='.repeat(80)}`)

    console.log('\n🎉 Grading migration completed!')

  } catch (error) {
    console.error('❌ Grading migration failed:', error)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

// Run grading if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  grade().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { grade }

