#!/usr/bin/env node

/**
 * Migration script to generate sft.json files for legacy demonstration submissions
 *
 * This script:
 * 1. Reads demonstration_submissions with legacy_storage_paths
 * 2. Downloads files from ViralMind Tigris storage to temp directory
 * 3. Runs CQA (Clones Quality Agent) to generate sft.json
 * 4. Saves sft.json to project directory with recording ID structure
 * 5. Updates legacy_storage_paths with sft.json path
 *
 * Usage: npx tsx scripts/migrate-generate-sft.ts [environment] [--limit N]
 * Environment: development (default), test, production
 * --limit N: Process only first N submissions (default: 1 for testing)
 * 
 * DB_URI="mongodb://admin:admin@localhost:27017/dev?authSource=admin" CONNECT_TOKEN="" BACKEND_URL="http://localhost:8001" npx tsx scripts/migrate-generate-sft.ts development
 */

import { config } from 'dotenv'
import { promises as fs } from 'fs'
import * as path from 'path'
import FormData from 'form-data'
import axios from 'axios'

// Load environment variables from .env file
config()

import mongoose from 'mongoose'
import { DemonstrationSubmission } from '../../src/models/DemonstrationSubmission.ts'
import { ObjectStorageService } from '../../src/services/storage/index.ts'
import { generateDemoHash, calculateFileHash, calculateOverallHash, getDemoStoragePath } from '../../src/services/demo-storage/hash.ts'

// Parse command line arguments
const args = process.argv.slice(2)
const environment = args.find(arg => !arg.startsWith('--')) || 'development'
const limitArg = args.find(arg => arg.startsWith('--limit'))
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 1

const validEnvironments = ['development', 'test', 'production']

if (!validEnvironments.includes(environment)) {
  console.error(`❌ Invalid environment: ${environment}`)
  console.error(`Valid environments: ${validEnvironments.join(', ')}`)
  process.exit(1)
}

console.log(`🚀 Running SFT generation migration for environment: ${environment}`)
console.log(`📊 Processing limit: ${limit} submission(s)`)

// MongoDB connection
const MONGODB_URI = process.env.DB_URI || 'mongodb://admin:admin@localhost:27017/dev?authSource=admin'

// ViralMind Tigris storage configuration (legacy data source)
const VIRAL_ACCESS_KEY = process.env.VIRAL_ACCESS_KEY
const VIRAL_SECRET_ACCESS_KEY = process.env.VIRAL_SECRET_ACCESS_KEY
const VIRAL_ENDPOINT = process.env.VIRAL_ENDPOINT
const VIRAL_BUCKET = 'clones-bucket-prod'
const VIRAL_REGION = 'auto'

// Clones Tigris storage configuration (new data destination)
const CLONES_ACCESS_KEY = process.env.CLONES_BUCKET_ACCESS_KEY
const CLONES_SECRET_ACCESS_KEY = process.env.CLONES_BUCKET_SECRET_ACCESS_KEY
const CLONES_ENDPOINT = process.env.CLONES_BUCKET_ENDPOINT
const CLONES_BUCKET = process.env.CLONES_BUCKET_NAME || 'clones-storage-prod'
const CLONES_REGION = 'auto'

// Backend API configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const CONNECT_TOKEN = process.env.CONNECT_TOKEN // Authentication token for API

// Output directory for generated sft.json files (local backup)
const SFT_OUTPUT_DIR = path.join(process.cwd(), 'data', 'sft_files')

// Initialize ViralMind storage service (legacy source)
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

// Initialize Clones storage service (new destination)
let clonesStorageService: ObjectStorageService | null = null

function getClonesStorageService(): ObjectStorageService {
  if (!clonesStorageService) {
    if (!CLONES_ACCESS_KEY || !CLONES_SECRET_ACCESS_KEY || !CLONES_ENDPOINT) {
      throw new Error('Clones Tigris credentials not configured. Please set CLONES_BUCKET_ACCESS_KEY, CLONES_BUCKET_SECRET_ACCESS_KEY, and CLONES_BUCKET_ENDPOINT environment variables.')
    }
    clonesStorageService = new ObjectStorageService(
      CLONES_ACCESS_KEY,
      CLONES_SECRET_ACCESS_KEY,
      CLONES_ENDPOINT,
      CLONES_REGION,
      CLONES_BUCKET
    )
  }
  return clonesStorageService
}

/**
 * Download recording files from ViralMind Tigris to a temporary directory
 */
async function downloadRecordingFiles(
  legacyStoragePaths: Record<string, string>,
  tempDir: string
): Promise<void> {
  const storage = getViralStorageService()

  // Files we need for CQA processing
  const requiredFiles = ['recording', 'meta', 'input_log']
  const fileMapping = {
    'recording': 'recording.mp4',
    'meta': 'meta.json',
    'input_log': 'input_log.jsonl'
  }

  for (const [key, filename] of Object.entries(fileMapping)) {
    const s3Key = legacyStoragePaths[key]

    if (!s3Key) {
      console.warn(`⚠️  Missing ${key} in legacy_storage_paths, skipping`)
      continue
    }

    try {
      console.log(`📥 Downloading ${filename} from ${s3Key}...`)

      // Download file from Tigris
      const fileBuffer = await storage.getItem({ name: s3Key })

      // Save to temp directory
      const targetPath = path.join(tempDir, filename)
      await fs.writeFile(targetPath, fileBuffer)

      const stats = await fs.stat(targetPath)
      console.log(`✅ Downloaded ${filename} (${stats.size} bytes)`)

    } catch (error: any) {
      console.error(`❌ Failed to download ${filename}:`, error.message)
      throw error
    }
  }

  // Patch meta.json to add schema_version if missing (legacy data compatibility)
  const metaPath = path.join(tempDir, 'meta.json')
  try {
    console.log(`🔧 Patching meta.json to add schema_version...`)
    const metaContent = await fs.readFile(metaPath, 'utf8')
    const metaJson = JSON.parse(metaContent)

    // Add schema_version if missing or invalid
    if (!metaJson.schema_version || typeof metaJson.schema_version !== 'object') {
      metaJson.schema_version = { major: 1, minor: 0, patch: 0 }
      await fs.writeFile(metaPath, JSON.stringify(metaJson, null, 2))
      console.log(`✅ Added schema_version to meta.json`)
    } else {
      console.log(`✅ meta.json already has schema_version`)
    }
  } catch (error: any) {
    console.warn(`⚠️  Failed to patch meta.json: ${error.message}`)
  }

  // Create input_log_meta.json if it doesn't exist
  const inputLogMetaPath = path.join(tempDir, 'input_log_meta.json')
  try {
    await fs.access(inputLogMetaPath)
  } catch {
    console.log(`📝 Creating input_log_meta.json...`)
    const inputLogMeta = {
      schema_version: { major: 1, minor: 0, patch: 0 },
      format: "jsonl",
      event_count: 0,
      timestamp_type: "relative",
      created_at: new Date().toISOString()
    }
    await fs.writeFile(inputLogMetaPath, JSON.stringify(inputLogMeta, null, 2))
  }
}

/**
 * Call backend API to generate sft.json via CQA
 */
async function generateSftViaBackend(inputDir: string, submissionId: string): Promise<void> {
  console.log(`🔧 Calling backend API to generate sft.json for submission: ${submissionId}`)

  // Check if directory exists and has files
  const files = await fs.readdir(inputDir)
  console.log(`📁 Directory contents: ${files.join(', ')}`)

  if (files.length === 0) {
    throw new Error('No files found in input directory')
  }

  // Create form data with files
  const form = new FormData()

  for (const filename of files) {
    const filePath = path.join(inputDir, filename)
    const fileBuffer = await fs.readFile(filePath)
    form.append('files', fileBuffer, filename)
  }

  // Call backend API
  const apiUrl = `${BACKEND_URL}/api/v1/forge/recordings/${submissionId}/process`
  console.log(`🚀 Calling: POST ${apiUrl}`)
  console.log(`⏳ This may take a while (CQA processing)...`)

  try {
    const response = await axios.post(apiUrl, form, {
      headers: {
        ...form.getHeaders(),
        'x-connect-token': CONNECT_TOKEN || ''
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000 // 5 minutes timeout for CQA processing
    })

    console.log(`✅ Backend responded with status: ${response.status}`)

    console.log(`📦 Response data structure:`, {
      success: response.data.success,
      hasData: !!response.data.data,
      hasGeneratedFiles: !!(response.data.data && response.data.data.generatedFiles),
      generatedFilesCount: response.data.data?.generatedFiles ? Object.keys(response.data.data.generatedFiles).length : 0
    })

    if (response.data.success && response.data.data.generatedFiles) {
      const generatedFiles = response.data.data.generatedFiles
      console.log(`✅ Backend generated ${Object.keys(generatedFiles).length} files: ${Object.keys(generatedFiles).join(', ')}`)

      // Save sft.json to temp directory
      if (generatedFiles['sft.json']) {
        const sftPath = path.join(inputDir, 'sft.json')
        console.log(`💾 Writing sft.json to ${sftPath}...`)
        await fs.writeFile(sftPath, generatedFiles['sft.json'])
        const stats = await fs.stat(sftPath)
        console.log(`✅ Saved sft.json (${stats.size} bytes)`)
      } else {
        throw new Error('Backend did not generate sft.json')
      }
    } else {
      console.error(`❌ Unexpected response structure:`, JSON.stringify(response.data, null, 2))
      throw new Error('Backend API response was not successful')
    }
  } catch (error: any) {
    if (error.response) {
      console.error(`❌ Backend API error: ${error.response.status} ${error.response.statusText}`)
      console.error(`Response:`, error.response.data)
      throw new Error(`Backend API failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`)
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to backend at ${BACKEND_URL}`)
      console.error(`Make sure the backend server is running with: npm run dev`)
      throw new Error(`Backend not running - connection refused to ${BACKEND_URL}`)
    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error(`❌ Backend API timeout after 5 minutes`)
      console.error(`CQA processing took too long - this might indicate an issue with the recording files`)
      throw new Error(`Backend API timeout - CQA processing took longer than 5 minutes`)
    } else {
      console.error(`❌ Backend API request error:`, error)
      console.error(`Error code: ${error.code}`)
      console.error(`Error message: ${error.message}`)
      throw new Error(`Backend API request failed: ${error.message}`)
    }
  }
}

/**
 * Transform input_log.jsonl timestamps from absolute Unix time to relative time
 */
async function transformInputLogTimestamps(tempDir: string): Promise<void> {
  console.log(`🕐 Transforming input_log.jsonl timestamps to relative time...`)

  const metaPath = path.join(tempDir, 'meta.json')
  const inputLogPath = path.join(tempDir, 'input_log.jsonl')

  // Read meta.json to get the start timestamp
  const metaContent = await fs.readFile(metaPath, 'utf8')
  const meta = JSON.parse(metaContent)

  let startTimestamp: number
  if (meta.timestamp) {
    // Parse ISO timestamp to Unix milliseconds
    startTimestamp = new Date(meta.timestamp).getTime()
  } else {
    console.warn(`⚠️  No timestamp found in meta.json, using first event timestamp as reference`)
    // We'll determine it from the first event
    const inputLogContent = await fs.readFile(inputLogPath, 'utf8')
    const lines = inputLogContent.trim().split('\n')
    if (lines.length > 0) {
      const firstEvent = JSON.parse(lines[0])
      startTimestamp = firstEvent.time || 0
    } else {
      throw new Error('input_log.jsonl is empty')
    }
  }

  console.log(`   Start timestamp: ${startTimestamp} (${new Date(startTimestamp).toISOString()})`)

  // Read and transform input_log.jsonl
  const inputLogContent = await fs.readFile(inputLogPath, 'utf8')
  const lines = inputLogContent.trim().split('\n')
  const transformedLines: string[] = []

  let minTime = Infinity
  let maxTime = -Infinity
  let transformedCount = 0

  for (const line of lines) {
    if (!line.trim()) continue

    const event = JSON.parse(line)

    // Transform absolute timestamp to relative
    if (typeof event.time === 'number') {
      const relativeTime = event.time - startTimestamp
      event.time = relativeTime

      minTime = Math.min(minTime, relativeTime)
      maxTime = Math.max(maxTime, relativeTime)
      transformedCount++
    }

    transformedLines.push(JSON.stringify(event))
  }

  // Write transformed input_log.jsonl
  await fs.writeFile(inputLogPath, transformedLines.join('\n') + '\n')

  console.log(`✅ Transformed ${transformedCount} events`)
  console.log(`   Time range: ${minTime}ms to ${maxTime}ms (${(maxTime / 1000).toFixed(2)}s duration)`)
}

/**
 * Upload demonstration files to Clones Tigris storage with integrity tracking
 * Stores in datasets/computer-use-v0/ for migrated legacy data
 */
async function uploadToTigris(
  tempDir: string,
  submission: any
): Promise<{
  demoHash: string
  fileManifest: Record<string, { size: number; hash: string }>
  overallHash: string
}> {
  console.log(`☁️  Uploading files to Clones Tigris storage...`)

  const storage = getClonesStorageService()

  // Transform input_log timestamps to relative time before upload
  await transformInputLogTimestamps(tempDir)

  // Generate demoHash from submission data
  const timestamp = submission.createdAt ? new Date(submission.createdAt).getTime() : Date.now()
  const demoHash = generateDemoHash(submission._id, submission.address, timestamp)

  console.log(`🔑 Generated demoHash: ${demoHash}`)

  // Files to upload
  const filesToUpload = [
    { filename: 'recording.mp4', required: true },
    { filename: 'meta.json', required: true },
    { filename: 'input_log.jsonl', required: true },
    { filename: 'sft.json', required: true }
  ]

  const fileManifest: Record<string, { size: number; hash: string }> = {}
  const fileHashes: string[] = []

  for (const { filename, required } of filesToUpload) {
    const filePath = path.join(tempDir, filename)

    try {
      await fs.access(filePath)
    } catch {
      if (required) {
        throw new Error(`Required file ${filename} not found in temp directory`)
      }
      console.warn(`⚠️  Optional file ${filename} not found, skipping`)
      continue
    }

    const fileBuffer = await fs.readFile(filePath)
    const fileHash = calculateFileHash(fileBuffer)
    const fileSize = fileBuffer.length

    // Use v0 path for legacy migrated data (getDemoStoragePath with 'v0')
    const storagePath = `datasets/computer-use-v0/demonstrations/${demoHash}/${filename}`

    console.log(`📤 Uploading ${filename} (${fileSize} bytes, hash: ${fileHash.substring(0, 16)}...)`)

    await storage.saveItem({
      name: storagePath,
      file: fileBuffer
    })

    // Map filename to manifest key
    let manifestKey: string
    if (filename === 'recording.mp4') manifestKey = 'recording'
    else if (filename === 'meta.json') manifestKey = 'meta'
    else if (filename === 'input_log.jsonl') manifestKey = 'input_log'
    else if (filename === 'sft.json') manifestKey = 'sft'
    else continue

    fileManifest[manifestKey] = {
      size: fileSize,
      hash: fileHash
    }

    fileHashes.push(fileHash)
    console.log(`✅ Uploaded ${filename}`)
  }

  // Calculate overall integrity hash
  const overallHash = calculateOverallHash(fileHashes)
  console.log(`🔒 Overall integrity hash: ${overallHash.substring(0, 16)}...`)

  // Create integrity manifest (checksums.json)
  const integrityManifest = {
    schema_version: { major: 1, minor: 0, patch: 0 },
    demoHash,
    submissionId: submission._id,
    userAddress: submission.address.toLowerCase(),
    timestamp,
    files: Object.entries(fileManifest).map(([key, value]) => {
      // Map manifest keys back to filenames
      let filename: string
      if (key === 'recording') filename = 'recording.mp4'
      else if (key === 'meta') filename = 'meta.json'
      else if (key === 'input_log') filename = 'input_log.jsonl'
      else if (key === 'sft') filename = 'sft.json'
      else filename = key

      return {
        filename,
        sha256: value.hash,
        size: value.size,
        lastModified: new Date().toISOString()
      }
    }),
    overallHash
  }

  // Upload checksums.json
  const checksumPath = `datasets/computer-use-v0/demonstrations/${demoHash}/checksums.json`
  console.log(`📤 Uploading checksums.json...`)
  await storage.saveItem({
    name: checksumPath,
    file: Buffer.from(JSON.stringify(integrityManifest, null, 2))
  })
  console.log(`✅ Uploaded checksums.json`)

  return {
    demoHash,
    fileManifest,
    overallHash
  }
}

/**
 * Save sft.json to local project directory as backup
 */
async function saveLocalBackup(tempDir: string, submissionId: string): Promise<string> {
  // Create output directory structure: data/sft_files/{submissionId}/
  const submissionDir = path.join(SFT_OUTPUT_DIR, submissionId)
  await fs.mkdir(submissionDir, { recursive: true })

  // Save sft.json
  const sftJsonSourcePath = path.join(tempDir, 'sft.json')
  const sftJsonTargetPath = path.join(submissionDir, 'sft.json')
  await fs.copyFile(sftJsonSourcePath, sftJsonTargetPath)
  const sftJsonStats = await fs.stat(sftJsonTargetPath)
  console.log(`💾 Saved local backup to ${sftJsonTargetPath} (${sftJsonStats.size} bytes)`)

  // Return relative path from project root for sft.json
  return path.relative(process.cwd(), sftJsonTargetPath)
}

/**
 * Process a single demonstration submission
 */
async function processSubmission(submission: any): Promise<boolean> {
  //console.log(`\n${'='.repeat(80)}`)
  //console.log(`📝 Processing submission: ${submission._id}`)
  //console.log(`${'='.repeat(80)}`)

  // Check if already processed by looking at local backup directory
  const submissionDir = path.join(SFT_OUTPUT_DIR, submission._id)
  try {
    await fs.access(submissionDir)
    //console.log(`⏭️  Skipping - already processed (found in ${submissionDir})`)
    return false
  } catch {
    // Not processed yet, continue
  }

  // Check if legacy_storage_paths exists
  if (!submission.meta?.legacy_storage_paths) {
    console.log(`⏭️  Skipping - no legacy_storage_paths found for ${submission._id}`)
    return false
  }

  const legacyPaths = submission.meta.legacy_storage_paths
  console.log(`📂 Legacy storage paths:`)
  console.log(`   - recording: ${legacyPaths.recording || 'N/A'}`)
  console.log(`   - meta: ${legacyPaths.meta || 'N/A'}`)
  console.log(`   - input_log: ${legacyPaths.input_log || 'N/A'}`)

  // Create temporary directory for processing
  const tempDir = path.join(process.cwd(), 'temp', `sft_gen_${submission._id}`)

  try {
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true })
    console.log(`📁 Created temp directory: ${tempDir} for ${submission._id}`)

    // Step 1: Download files from ViralMind Tigris
    console.log(`\n📥 Step 1: Downloading files from ViralMind Tigris...`)
    await downloadRecordingFiles(legacyPaths, tempDir)

    // Step 2: Call backend API to generate sft.json
    console.log(`\n🔧 Step 2: Calling backend API to generate sft.json...`)
    await generateSftViaBackend(tempDir, submission._id)

    // Step 3: Upload files to Clones Tigris storage with integrity tracking
    console.log(`\n☁️  Step 3: Uploading to Clones Tigris storage...`)
    const { demoHash, fileManifest, overallHash } = await uploadToTigris(tempDir, submission)

    // Step 4: Save local backup of sft.json
    console.log(`\n💾 Step 4: Saving local backup...`)
    const sftRelativePath = await saveLocalBackup(tempDir, submission._id)

    // Step 5: Clean up temp directory immediately to free disk space
    console.log(`\n🧹 Step 5: Cleaning up temp files to free disk space...`)
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
      console.log(`✅ Cleaned up temp directory: ${tempDir}`)
    } catch (cleanupError: any) {
      console.warn(`⚠️  Failed to cleanup temp directory: ${cleanupError.message}`)
    }

    // Step 6: Update database with demoHash, fileManifest, and integrity info
    console.log(`\n💿 Step 6: Updating database...`)
    const now = new Date()
    await DemonstrationSubmission.findByIdAndUpdate(
      submission._id,
      {
        $set: {
          demoHash: demoHash,
          fileManifest: fileManifest,
          integrityVerified: true,
          integrityLastCheck: now,
          'meta.legacy_storage_paths.sft': sftRelativePath,
          'meta.overall_hash': overallHash
        }
      }
    )
    console.log(`✅ Updated database:`)
    console.log(`   - demoHash: ${demoHash}`)
    console.log(`   - fileManifest: ${Object.keys(fileManifest).length} files`)
    console.log(`   - integrityVerified: true`)
    console.log(`   - integrityLastCheck: ${now.toISOString()}`)
    console.log(`   - legacy_storage_paths.sft: ${sftRelativePath}`)

    console.log(`\n🎉 Successfully processed submission ${submission._id}`)
    return true

  } catch (error: any) {
    console.error(`\n❌ Failed to process submission ${submission._id}:`, error.message)

    // Clean up temp directory on error as well
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
      console.log(`🧹 Cleaned up temp directory after error: ${tempDir}`)
    } catch (cleanupError: any) {
      console.warn(`⚠️  Failed to cleanup temp directory: ${cleanupError.message}`)
    }

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
 * Main migration function
 */
async function migrate() {
  try {
    // Validate ViralMind Tigris credentials (legacy source)
    if (!VIRAL_ACCESS_KEY || !VIRAL_SECRET_ACCESS_KEY || !VIRAL_ENDPOINT) {
      console.error('❌ ViralMind Tigris credentials not configured')
      console.error('Please set VIRAL_ACCESS_KEY, VIRAL_SECRET_ACCESS_KEY, and VIRAL_ENDPOINT')
      process.exit(1)
    }

    // Validate Clones Tigris credentials (new destination)
    if (!CLONES_ACCESS_KEY || !CLONES_SECRET_ACCESS_KEY || !CLONES_ENDPOINT) {
      console.error('❌ Clones Tigris credentials not configured')
      console.error('Please set CLONES_BUCKET_ACCESS_KEY, CLONES_BUCKET_SECRET_ACCESS_KEY, and CLONES_BUCKET_ENDPOINT')
      process.exit(1)
    }

    // Validate backend configuration
    console.log(`🔗 Backend URL: ${BACKEND_URL}`)
    console.log(`☁️  Clones Tigris Bucket: ${CLONES_BUCKET}`)
    console.log(`📁 Storage path: datasets/computer-use-v0/`)
    if (CONNECT_TOKEN) {
      console.log(`🔐 Using connect token: ${CONNECT_TOKEN.substring(0, 10)}...`)
    } else {
      console.warn('⚠️  No CONNECT_TOKEN provided - API calls may require authentication')
    }

    // Connect to database
    await connectToMongo()

    console.log('\n🔍 Looking for demonstration submissions with legacy_storage_paths...')

    // Find submissions with legacy_storage_paths
    // Note: We check local directory existence for skip logic, not DB field
    const submissions = await DemonstrationSubmission.find({
      'meta.legacy_storage_paths': { $exists: true }
    })
      .limit(limit)
      .lean()

    console.log(`📊 Found ${submissions.length} submission(s) to process`)

    if (submissions.length === 0) {
      console.log('\n✅ No submissions to process. All done!')
      return
    }

    let processed = 0
    let successful = 0
    let failed = 0

    for (const submission of submissions) {
      processed++
      //console.log(`\n📊 Progress: ${processed}/${submissions.length}`)

      const success = await processSubmission(submission)
      if (success) {
        successful++
      } else {
        failed++
      }
    }

    console.log(`\n${'='.repeat(80)}`)
    console.log(`📊 Migration Summary:`)
    console.log(`   - Total processed: ${processed}`)
    console.log(`   - Successful: ${successful}`)
    console.log(`   - Failed: ${failed}`)
    console.log(`${'='.repeat(80)}`)

    console.log('\n🎉 Migration completed!')

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
