import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import express, { type NextFunction, type Request, type Response, type Router } from 'express'
import multer from 'multer'
import { Extract } from 'unzipper'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../../middleware/types/errors.ts'
import { validateBody, validateParams } from '../../middleware/validator.ts'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { type IUploadSessionDocument, UploadSessionModel } from '../../models/UploadSession.ts'
import BlockchainService from '../../services/blockchain/index.ts'
import { addToProcessingQueue, cleanupSession } from '../../services/forge/index.ts'
import { ObjectStorageService } from '../../services/storage/index.ts'
import { DemoStorageService, DemoFiles } from '../../services/demo-storage/index.ts'
import {
  type DBDemonstrationSubmission,
  ForgeSubmissionProcessingStatus,
  UploadLimitType
} from '../../types/index.ts'
import { initUploadSchema, uploadChunkSchema, uploadIdParamSchema } from '../schemas/forgeUpload.ts'

// Initialize services as singletons (module-level)
const blockchainService = new BlockchainService(process.env.RPC_URL || '')

// Initialize demo storage service singleton - will throw if env vars missing
let demoStorageService: DemoStorageService | null = null

function getDemoStorageService(): DemoStorageService {
  if (!demoStorageService) {
    const config = validateStorageConfig()
    const objectStorage = new ObjectStorageService(
      config.STORAGE_ACCESS_KEY,
      config.STORAGE_SECRET_KEY,
      config.STORAGE_ENDPOINT,
      config.STORAGE_REGION,
      config.STORAGE_BUCKET
    )
    demoStorageService = new DemoStorageService(objectStorage)
  }
  return demoStorageService
}

// Helper functions to reduce complexity
async function validateUploadComplete(session: IUploadSessionDocument) {
  if (session.receivedChunks.size !== session.totalChunks) {
    console.log(
      `[UPLOAD] Incomplete upload: ${session.receivedChunks.size}/${session.totalChunks} chunks received`
    )
    const missing = Array.from({ length: session.totalChunks }, (_, i) => i).filter(
      (i) => !session.receivedChunks.has(i.toString())
    )
    console.log(`[UPLOAD] Missing chunks: ${missing.join(', ')}`)

    throw ApiError.uploadIncomplete('Upload incomplete', {
      received: session.receivedChunks.size,
      total: session.totalChunks,
      missing
    })
  }
}

async function combineChunks(session: IUploadSessionDocument, finalFilePath: string) {
  console.log(`[UPLOAD] All chunks received, combining into final file`)
  console.log(`[UPLOAD] Final file path: ${finalFilePath}`)

  const sortedChunks = Array.from(session.receivedChunks.values()).sort(
    (a, b) => a.chunkIndex - b.chunkIndex
  )
  console.log(`[UPLOAD] Sorted ${sortedChunks.length} chunks for combining`)

  const writeStream = createWriteStream(finalFilePath)
  console.log(`[UPLOAD] Created write stream for final file`)

  // Write chunks sequentially
  console.log(`[UPLOAD] Starting to write chunks sequentially`)
  for (let i = 0; i < sortedChunks.length; i++) {
    const chunk = sortedChunks[i]
    console.log(
      `[UPLOAD] Writing chunk ${i + 1}/${sortedChunks.length} (index: ${chunk.chunkIndex
      }, size: ${chunk.size} bytes)`
    )
    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(chunk.path)

      // Handle backpressure
      let draining = false

      const handleDrain = () => {
        draining = false
        readStream.resume()
      }

      writeStream.on('drain', handleDrain)

      readStream
        .on('error', (err: Error) => {
          console.error(`[UPLOAD] Error reading chunk ${chunk.chunkIndex}:`, err)
          writeStream.removeListener('drain', handleDrain)
          reject(err)
        })
        .on('data', (chunk) => {
          // If writeStream returns false, it's experiencing backpressure
          if (!writeStream.write(chunk) && !draining) {
            draining = true
            readStream.pause() // Pause reading until drain
          }
        })
        .on('end', () => {
          console.log(`[UPLOAD] Finished reading chunk ${chunk.chunkIndex}`)
          writeStream.removeListener('drain', handleDrain)
          resolve()
        })
    })
  }

  // Close the write stream
  console.log(`[UPLOAD] All chunks written, closing write stream`)
  await new Promise<void>((resolve, reject) => {
    writeStream.end()
    writeStream.on('finish', () => {
      console.log(`[UPLOAD] Write stream closed successfully`)
      resolve()
    })
    writeStream.on('error', (err: Error) => {
      console.error(`[UPLOAD] Error closing write stream:`, err)
      reject(err)
    })
  })
}

async function extractZipFile(finalFilePath: string, extractDir: string) {
  console.log(`[UPLOAD] Creating extraction directory: ${extractDir}`)
  await mkdir(extractDir, { recursive: true })

  console.log(`[UPLOAD] Extracting ZIP file to ${extractDir}`)
  await new Promise<void>((resolve, reject) => {
    createReadStream(finalFilePath)
      .pipe(Extract({ path: extractDir }))
      .on('close', () => {
        console.log(`[UPLOAD] ZIP extraction completed`)
        resolve()
      })
      .on('error', (err: Error) => {
        console.error(`[UPLOAD] Error extracting ZIP:`, err)
        reject(err)
      })
  })
}

async function processMetadata(extractDir: string, address: string) {
  console.log(`[UPLOAD] Reading meta.json from extracted files`)
  const metaJsonPath = path.join(extractDir, 'meta.json')
  console.log(`[UPLOAD] Meta JSON path: ${metaJsonPath}`)
  const metaJson = await readFile(metaJsonPath, 'utf8')
  console.log(`[UPLOAD] Meta JSON content length: ${metaJson.length}`)
  const meta: DBDemonstrationSubmission['meta'] = JSON.parse(metaJson)
  console.log(`[UPLOAD] Parsed meta data, id: ${meta.id}`)

  // Create UUID from meta.id + address
  const uuid = createHash('sha256').update(`${meta.id}${address}`).digest('hex')
  console.log(`[UPLOAD] Generated submission UUID: ${uuid}`)

  return { meta, uuid }
}

async function moveRequiredFiles(extractDir: string, finalDir: string) {
  console.log(`[UPLOAD] Creating final directory: ${finalDir}`)
  await mkdir(finalDir, { recursive: true })

  const requiredFiles = ['input_log.jsonl', 'meta.json', 'recording.mp4', 'sft.json']
  console.log(`[UPLOAD] Moving required files to final directory`)

  for (const file of requiredFiles) {
    const sourcePath = path.join(extractDir, file)
    const destPath = path.join(finalDir, file)
    console.log(`[UPLOAD] Copying ${file} from ${sourcePath} to ${destPath}`)
    try {
      await copyFile(sourcePath, destPath)
      console.log(`[UPLOAD] Successfully copied ${file}`)
    } catch (error) {
      console.error(`[UPLOAD] Error copying file ${file}:`, error)
      throw ApiError.badRequest(`Missing required file: ${file}`)
    }
  }

  return requiredFiles
}

function validateStorageConfig() {
  const {
    STORAGE_ACCESS_KEY,
    STORAGE_SECRET_KEY,
    STORAGE_ENDPOINT,
    STORAGE_REGION,
    STORAGE_BUCKET
  } = process.env

  const missingVariables = []
  if (!STORAGE_ACCESS_KEY) missingVariables.push('STORAGE_ACCESS_KEY')
  if (!STORAGE_SECRET_KEY) missingVariables.push('STORAGE_SECRET_KEY')
  if (!STORAGE_ENDPOINT) missingVariables.push('STORAGE_ENDPOINT')
  if (!STORAGE_REGION) missingVariables.push('STORAGE_REGION')
  if (!STORAGE_BUCKET) missingVariables.push('STORAGE_BUCKET')

  if (missingVariables.length > 0) {
    throw new Error(
      `Storage service environment variables are not properly configured. Missing: ${missingVariables.join(', ')}`
    )
  }

  return {
    STORAGE_ACCESS_KEY: STORAGE_ACCESS_KEY as string,
    STORAGE_SECRET_KEY: STORAGE_SECRET_KEY as string,
    STORAGE_ENDPOINT: STORAGE_ENDPOINT as string,
    STORAGE_REGION: STORAGE_REGION as string,
    STORAGE_BUCKET: STORAGE_BUCKET as string
  }
}

// Configure multer for handling chunk uploads
const upload = multer({
  dest: 'uploads/chunks/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit per chunk
  }
})

// Store active upload sessions - DEPRECATED in favor of MongoDB storage
// const activeSessions = new Map<string, UploadSession>();

const SESSION_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours

// startUploadInterval is no longer needed as MongoDB's TTL index handles session expiry
// startUploadInterval(activeSessions, SESSION_EXPIRY);

// Middleware to validate upload session
export const requireUploadSession = errorHandlerAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const uploadId = req.params.uploadId || req.body.uploadId

    if (!uploadId) {
      throw ApiError.badRequest('Upload ID is required')
    }

    const session = await UploadSessionModel.findById(uploadId)
    if (!session) {
      throw ApiError.notFound(`Upload session not found or expired: ${uploadId}`)
    }

    // @ts-expect-error - Add session to the request object
    req.uploadSession = session
    next()
  }
)

const router: Router = express.Router()

async function verifyFactoryAndBalance(meta: Record<string, any>): Promise<any> {
  if (!meta.quest.pool_id) {
    throw ApiError.badRequest('Invalid data: missing pool id')
  }

  console.log(`[UPLOAD] Verifying pool balance and status for factoryId: ${meta.quest.pool_id}`)
  const factory = await FactoryModel.findById(meta.quest.pool_id)
  if (!factory) {
    throw ApiError.notFound('Factory not found')
  }

  if (factory.status !== 'active') {
    throw ApiError.badRequest(`Factory is not active (status: ${factory.status})`)
  }

  const tokenAddress = factory.token.address
  const currentBalance = await blockchainService.getTokenBalance(tokenAddress, factory.poolAddress)

  if (currentBalance < factory.pricePerDemo) {
    console.log(`[UPLOAD] Insufficient funds: ${currentBalance} < ${factory.pricePerDemo}`)
    throw ApiError.insufficientFunds('Factory has insufficient funds')
  }

  return factory
}

async function checkFactoryUploadLimits(factory: Record<string, any>): Promise<void> {
  if (!factory.uploadLimit?.value) return

  let gymSubmissions: number
  const factoryId = factory._id.toString()

  switch (factory.uploadLimit.type) {
    case UploadLimitType.perDay: {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      gymSubmissions = await DemonstrationSubmission.countDocuments({
        'meta.factoryId': factoryId,
        createdAt: { $gte: today },
        status: ForgeSubmissionProcessingStatus.COMPLETED,
        reward: { $gt: 0 }
      })

      if (gymSubmissions >= factory.uploadLimit.value) {
        console.log(`[UPLOAD] Daily upload limit reached for pool.`)
        throw ApiError.forbidden('Daily upload limit reached for this pool')
      }
      break
    }
    case UploadLimitType.total:
      gymSubmissions = await DemonstrationSubmission.countDocuments({
        'meta.factoryId': factoryId,
        status: ForgeSubmissionProcessingStatus.COMPLETED,
        reward: { $gt: 0 }
      })

      if (gymSubmissions >= factory.uploadLimit.value) {
        console.log(`[UPLOAD] Total upload limit reached for pool.`)
        throw ApiError.forbidden('Total upload limit reached for this pool.')
      }
      break
  }
}

async function checkTaskUploadLimits(
  meta: Record<string, any>,
  factory: Record<string, any>
): Promise<void> {
  if (!meta.quest?.task_id) {
    throw ApiError.badRequest('Invalid data: missing task id')
  }

  const taskFactory = await FactoryModel.findOne({
    _id: meta.quest.pool_id,
    'apps.tasks.id': meta.quest.task_id
  })

  if (!taskFactory) {
    throw ApiError.badRequest('Submission Error: invalid task')
  }

  let task = null
  for (const app of taskFactory.apps) {
    task = app.tasks.find((t) => t.id === meta.quest.task_id)
    if (task) break
  }

  const taskSubmissions = await DemonstrationSubmission.countDocuments({
    'meta.quest.task_id': meta.quest.task_id,
    status: ForgeSubmissionProcessingStatus.COMPLETED,
    reward: { $gt: 0 }
  })

  if (task?.uploadLimit && taskSubmissions >= task.uploadLimit) {
    console.log(`[UPLOAD] Total upload limit reached for task.`)
    throw ApiError.forbidden('Upload limit reached for this task')
  }

  if (
    factory.uploadLimit?.type === UploadLimitType.perTask &&
    factory.uploadLimit?.value &&
    taskSubmissions >= factory.uploadLimit.value
  ) {
    console.log(`[UPLOAD] Per-Task upload limit reached for pool.`)
    throw ApiError.forbidden('Per-task upload limit reached for this pool')
  }
}

async function uploadFilesToStorage(
  requiredFiles: string[],
  finalDir: string,
  submissionId: string,
  userAddress: string
): Promise<{ demoHash: string; fileManifest: any; integrityVerified: boolean }> {
  console.log(`[UPLOAD] Starting demo storage upload for ${requiredFiles.length} files`)
  const demoStorage = getDemoStorageService()

  const demoFiles = {} as Record<string, Buffer>
  for (const file of requiredFiles) {
    const filePath = path.join(finalDir, file)
    const fileBuffer = await readFile(filePath)
    demoFiles[file] = fileBuffer
    console.log(`[UPLOAD] Loaded ${file} (${fileBuffer.length} bytes) into memory`)
  }

  const typedDemoFiles: DemoFiles = {
    'recording.mp4': demoFiles['recording.mp4'],
    'meta.json': demoFiles['meta.json'],
    'input_log.jsonl': demoFiles['input_log.jsonl'],
    'sft.json': demoFiles['sft.json']
  }

  console.log(`[UPLOAD] Storing demo files with hash-based storage`)
  
  // Extract real metadata from meta.json
  const metaJsonContent = JSON.parse(typedDemoFiles['meta.json'].toString())
  const metadata = {
    task: {
      type: 'computer_use',
      description: metaJsonContent.quest?.content || metaJsonContent.description || 'User demonstration',
      url: metaJsonContent.quest?.icon_url || undefined,
      title: metaJsonContent.quest?.title || metaJsonContent.title,
      app: metaJsonContent.quest?.app,
      objectives: metaJsonContent.quest?.objectives
    },
    environment: {
      os: metaJsonContent.platform || 'unknown',
      browser: 'desktop_app',
      screen_resolution: metaJsonContent.primary_monitor 
        ? `${metaJsonContent.primary_monitor.width}x${metaJsonContent.primary_monitor.height}`
        : 'unknown',
      arch: metaJsonContent.arch,
      locale: metaJsonContent.locale,
      version: metaJsonContent.version
    },
    quality_metrics: {
      duration_seconds: metaJsonContent.duration_seconds,
      completion_status: metaJsonContent.status,
      completion_reason: metaJsonContent.reason
    }
  }
  
  const demoHash = await demoStorage.storeDemo(
    submissionId,
    userAddress,
    typedDemoFiles,
    metadata
  )

  console.log(`[UPLOAD] Demo stored with hash: ${demoHash}`)

  console.log(`[UPLOAD] Verifying demo integrity`)
  const verification = await demoStorage.verifyDemo(demoHash)
  if (!verification.valid) {
    throw new Error(`Demo integrity verification failed: ${verification.errors.join(', ')}`)
  }

  const integrity = await demoStorage.getDemoIntegrity(demoHash)
  if (!integrity) {
    throw new Error('Failed to get demo integrity information')
  }

  const fileManifest = {
    recording: {
      size: integrity.files.find(f => f.filename === 'recording.mp4')?.size,
      hash: integrity.files.find(f => f.filename === 'recording.mp4')?.sha256
    },
    meta: {
      size: integrity.files.find(f => f.filename === 'meta.json')?.size,
      hash: integrity.files.find(f => f.filename === 'meta.json')?.sha256
    },
    input_log: {
      size: integrity.files.find(f => f.filename === 'input_log.jsonl')?.size,
      hash: integrity.files.find(f => f.filename === 'input_log.jsonl')?.sha256
    },
    sft: {
      size: integrity.files.find(f => f.filename === 'sft.json')?.size,
      hash: integrity.files.find(f => f.filename === 'sft.json')?.sha256
    }
  }

  console.log(`[UPLOAD] Demo integrity verified and file manifest created`)

  return {
    demoHash,
    fileManifest,
    integrityVerified: true
  }
}

async function cleanupUploadFiles(
  session: IUploadSessionDocument,
  finalFilePath: string
): Promise<void> {
  console.log(`[UPLOAD] Cleaning up session files`)
  await cleanupSession(session)
  console.log(`[UPLOAD] Session files cleaned up`)

  console.log(`[UPLOAD] Removing session from active sessions`)
  await UploadSessionModel.findByIdAndDelete(session.id)

  console.log(`[UPLOAD] Cleaning up temporary ZIP file: ${finalFilePath}`)
  await unlink(finalFilePath).catch((err: Error) => {
    console.error(`[UPLOAD] Error deleting temporary ZIP file:`, err)
  })
}

/**
 * @swagger
 * tags:
 *   name: Upload
 *   description: Uploads of demonstrations
 */

/**
 * @swagger
 *  /forge/upload/init:
 *   post:
 *     summary: Initialize a new upload session
 *     tags: [Upload]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               totalChunks:
 *                 type: number
 *               metadata:
 *                 type: object
 *     responses:
 *       '200':
 *         description: Upload session initialized
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/init',
  requireWalletAddress,
  validateBody(initUploadSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-expect-error - Get walletAddress from the request object
    const address = req.walletAddress
    const { totalChunks, metadata } = req.body

    // Generate a unique upload ID
    const uploadId = createHash('sha256')
      .update(`${address}-${Date.now()}-${Math.random()}`)
      .digest('hex')

    // Create temp directory for this upload
    const tempDir = path.join('uploads', `temp_${uploadId}`)
    await mkdir(tempDir, { recursive: true })

    // Store metadata in the temp directory
    await writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata))

    // Create and store the session in MongoDB
    const session = new UploadSessionModel({
      _id: uploadId,
      address,
      totalChunks: Number(totalChunks),
      metadata,
      tempDir
    })
    await session.save()

    res.status(200).json(
      successResponse({
        uploadId,
        expiresIn: SESSION_EXPIRY / 1000, // in seconds
        chunkSize: 100 * 1024 * 1024 // 100MB
      })
    )
  })
)

/**
 * @swagger
 * /forge/upload/chunk/{uploadId}:
 *   post:
 *     summary: Upload a chunk
 *     tags: [Upload]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               chunk:
 *                 type: string
 *                 format: binary
 *               chunkIndex:
 *                 type: number
 *               checksum:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Chunk uploaded successfully
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/chunk/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  upload.single('chunk'),
  validateBody(uploadChunkSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    if (!req.file) {
      throw ApiError.badRequest('No chunk uploaded')
    }

    // @ts-expect-error - Get session from the request object
    const session: IUploadSessionDocument = req.uploadSession
    const chunkIndex = Number(req.body.chunkIndex)
    const checksum = req.body.checksum

    if (Number.isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      await unlink(req.file.path).catch(() => { })
      throw ApiError.badRequest('Invalid chunk index')
    }

    if (!checksum) {
      await unlink(req.file.path).catch(() => { })
      throw ApiError.badRequest('Checksum is required')
    }

    // Verify checksum
    const fileBuffer = await readFile(req.file.path)
    const calculatedChecksum = createHash('sha256').update(fileBuffer).digest('hex')

    if (calculatedChecksum !== checksum) {
      await unlink(req.file.path).catch(() => { })
      throw ApiError.badRequest('Checksum verification failed', {
        expected: checksum,
        calculated: calculatedChecksum
      })
    }

    // Store chunk info
    session.receivedChunks.set(chunkIndex.toString(), {
      chunkIndex,
      path: req.file.path,
      size: req.file.size,
      checksum
    })

    // Update session timestamp and save to DB
    await session.save()

    res.status(200).json(
      successResponse({
        uploadId: session.id,
        chunkIndex,
        received: session.receivedChunks.size,
        total: session.totalChunks,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100)
      })
    )
  })
)

/**
 * @swagger
 * /forge/upload/status/{uploadId}:
 *   get:
 *     summary: Get upload status
 *     tags: [Upload]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Upload status
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 *       '500':
 *         description: Internal server error
 */
router.get(
  '/status/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  validateParams(uploadIdParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-expect-error - Get session from the request object
    const session: IUploadSessionDocument = req.uploadSession

    res.json(
      successResponse({
        uploadId: session.id,
        received: session.receivedChunks.size,
        total: session.totalChunks,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100),
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated
      })
    )
  })
)

/**
 * @swagger
 * /forge/upload/cancel/{uploadId}:
 *   delete:
 *     summary: Cancel upload
 *     tags: [Upload]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Upload cancelled successfully
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 *       '500':
 *         description: Internal server error
 */
router.delete(
  '/cancel/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-expect-error - Get session from the request object
    const session: IUploadSessionDocument = req.uploadSession

    // Clean up session files
    await cleanupSession(session)

    // Remove session from DB
    await UploadSessionModel.findByIdAndDelete(session.id)

    res.status(200).json(successResponse('Upload cancelled successfully'))
  })
)

/**
 * @swagger
 * /forge/upload/complete/{uploadId}:
 *   post:
 *     summary: Complete upload and process files
 *     tags: [Upload]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Upload completed successfully
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 *       '500':
 *         description: Internal server error
 */
router.post(
  '/complete/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  errorHandlerAsync(async (req: Request, res: Response) => {
    console.log(`[UPLOAD] Starting complete process for upload ${req.params.uploadId}`)

    await mkdir('uploads', { recursive: true }).catch((err) => {
      console.error('[UPLOAD] Error ensuring uploads directory exists:', err)
    })

    // @ts-expect-error - Get session from the request object
    const session: IUploadSessionDocument = req.uploadSession
    // @ts-expect-error - Get walletAddress from the request object
    const address = req.walletAddress
    console.log(
      `[UPLOAD] Processing upload for address: ${address}, chunks: ${session.receivedChunks.size}/${session.totalChunks}`
    )

    await validateUploadComplete(session)

    const finalFilePath = path.join('uploads', `complete_${session.id}.zip`)
    await combineChunks(session, finalFilePath)

    const extractDir = path.join('uploads', `extract_${session.id}`)
    await extractZipFile(finalFilePath, extractDir)

    const { meta, uuid } = await processMetadata(extractDir, address)

    const finalDir = path.join('uploads', `extract_${uuid}`)
    const requiredFiles = await moveRequiredFiles(extractDir, finalDir)

    const { demoHash, fileManifest, integrityVerified } = await uploadFilesToStorage(requiredFiles, finalDir, uuid, address)
    console.log(`[UPLOAD] All files uploaded to demo storage successfully`)

    const factory = await verifyFactoryAndBalance(meta)

    await checkFactoryUploadLimits(factory)
    await checkTaskUploadLimits(meta, factory)

    console.log(`[UPLOAD] Checking for existing submission with ID: ${uuid}`)
    const tempSub = await DemonstrationSubmission.findById(uuid)
    if (tempSub) {
      console.log(`[UPLOAD] Submission already exists with ID: ${uuid}`)
      throw ApiError.conflict('Submission data already uploaded', {
        submissionId: uuid
      })
    }

    console.log(`[UPLOAD] Creating new submission record in database`)
    const submission = await DemonstrationSubmission.create({
      _id: uuid,
      address,
      meta,
      status: ForgeSubmissionProcessingStatus.PENDING,
      demoHash,
      fileManifest,
      integrityVerified,
      integrityLastCheck: new Date()
    })
    console.log(`[UPLOAD] Submission created with ID: ${submission._id}`)

    console.log(`[UPLOAD] Adding submission to processing queue`)
    addToProcessingQueue(uuid)
    console.log(`[UPLOAD] Submission added to processing queue`)

    await cleanupUploadFiles(session, finalFilePath)

    console.log(`[UPLOAD] Upload complete process finished successfully for ID: ${uuid}`)
    res.json(
      successResponse({
        message: 'Upload completed successfully',
        submissionId: submission._id,
        demoHash,
        fileManifest
      })
    )
  })
)

/**
 * ## Chunked Upload API Documentation
 *
 * This API provides endpoints for uploading large files in chunks, which improves reliability
 * and allows for resumable uploads.
 *
 * ### POST /forge/upload/init
 *
 * Initializes a new chunked upload session.
 *
 * #### Request Body
 * ```json
 * {
 *   "totalChunks": 10,           // Required: Total number of chunks to expect
 *   "metadata": {                 // Required: Metadata about the upload
 *     "factoryId": "pool123",        // Optional: Pool ID if applicable
 *     "generatedTime": 1647123456789, // Optional: Timestamp when content was generated
 *     "id": "unique-race-id"      // Required: Unique identifier for the race
 *   }
 * }
 * ```
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",     // Unique ID for this upload session
 *   "expiresIn": 86400,          // Seconds until this session expires (24 hours)
 *   "chunkSize": 104857600       // Maximum chunk size in bytes (100MB)
 * }
 * ```
 *
 * ### POST /forge/upload/chunk/:uploadId
 *
 * Uploads a single chunk of the file.
 *
 * #### Request
 * - URL Parameter: `uploadId` - The upload session ID from init
 * - Form Data:
 *   - `chunk`: (file) The binary chunk data
 *   - `chunkIndex`: (number) Zero-based index of this chunk
 *   - `checksum`: (string) SHA256 hash of the chunk for verification
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",
 *   "chunkIndex": 0,
 *   "received": 1,               // Number of chunks received so far
 *   "total": 10,                 // Total number of chunks expected
 *   "progress": 10               // Upload progress percentage
 * }
 * ```
 *
 * ### GET /forge/upload/status/:uploadId
 *
 * Gets the current status of an upload.
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",
 *   "received": 5,               // Number of chunks received
 *   "total": 10,                 // Total number of chunks
 *   "progress": 50,              // Upload progress percentage
 *   "createdAt": "2023-01-01T12:00:00.000Z",
 *   "lastUpdated": "2023-01-01T12:05:00.000Z"
 * }
 * ```
 *
 * ### DELETE /forge/upload/cancel/:uploadId
 *
 * Cancels an in-progress upload and cleans up temporary files.
 *
 * #### Response
 * ```json
 * {
 *   "message": "Upload cancelled successfully"
 * }
 * ```
 *
 * ### POST /forge/upload/complete/:uploadId
 *
 * Completes the upload process, combines chunks, and processes the file.
 *
 * #### Response (Success)
 * ```json
 * {
 *   "message": "Upload completed successfully",
 *   "submissionId": "def456...",
 *   "files": [
 *     {
 *       "file": "meta.json",
 *       "storageKey": "forge-races/1647123456789-meta.json",
 *       "size": 1024
 *     },
 *     // ... other files
 *   ]
 * }
 * ```
 *
 * #### Response (Incomplete Upload)
 * ```json
 * {
 *   "error": "Upload incomplete",
 *   "received": 8,
 *   "total": 10,
 *   "missing": [2, 5]            // Indices of missing chunks
 * }
 * ```
 *
 * ### Authentication
 *
 * All endpoints require authentication via the `x-connect-token` header.
 *
 * ### Error Handling
 *
 * All endpoints return appropriate HTTP status codes:
 * - 400: Bad Request (invalid parameters)
 * - 401: Unauthorized (missing or invalid token)
 * - 404: Not Found (upload session not found)
 * - 500: Internal Server Error
 *
 * ### Example Usage
 *
 * ```javascript
 * // Initialize upload
 * const initResponse = await fetch('/api/forge/upload/init', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'x-connect-token': 'user-token'
 *   },
 *   body: JSON.stringify({
 *     totalChunks: 3,
 *     metadata: { id: 'race-123', factoryId: 'pool-456' }
 *   })
 * });
 * const { uploadId } = await initResponse.json();
 *
 * // Upload chunks
 * for (let i = 0; i < 3; i++) {
 *   const chunk = getChunk(i); // Your function to get chunk data
 *   const checksum = calculateSHA256(chunk); // Your function to calculate SHA256
 *
 *   const formData = new FormData();
 *   formData.append('chunk', chunk);
 *   formData.append('chunkIndex', i);
 *   formData.append('checksum', checksum);
 *
 *   await fetch(`/api/forge/upload/chunk/${uploadId}`, {
 *     method: 'POST',
 *     headers: {
 *       'x-connect-token': 'user-token'
 *     },
 *     body: formData
 *   });
 * }
 *
 * // Complete upload
 * const completeResponse = await fetch(`/api/forge/upload/complete/${uploadId}`, {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'x-connect-token': 'user-token'
 *   }
 * });
 * const result = await completeResponse.json();
 * console.log(`Upload completed with submission ID: ${result.submissionId}`);
 * ```
 */

export { router as forgeUploadApi }
