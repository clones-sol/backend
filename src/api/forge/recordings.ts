import express, { type Request, type Response, type Router } from 'express'
import multer from 'multer'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

// Utility function to get the correct uploads path based on environment
const getUploadsPath = (...pathSegments: string[]) => {
  // Use /app/uploads only on Fly.io (detected by FLY_APP_NAME env var)
  const basePath = process.env.FLY_APP_NAME ? '/app/uploads' : 'uploads'
  return path.join(basePath, ...pathSegments)
}
import { spawn } from 'node:child_process'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../../middleware/types/errors.ts'
import { ValidationRules, validateParams } from '../../middleware/validator.ts'
import { logger } from "../../services/logger.ts"

const router: Router = express.Router()

// Configure multer for handling file uploads
const upload = multer({
  dest: getUploadsPath('recordings'),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 4 // Exactly 4 files expected
  },
  fileFilter: (_req, file, cb) => {
    // Only allow the exact files that CQA expects
    const allowedFiles = [
      'input_log.jsonl',
      'input_log_meta.json',
      'meta.json',
      'recording.mp4'
    ]

    if (allowedFiles.includes(file.originalname)) {
      cb(null, true)
    } else {
      cb(new Error(`File ${file.originalname} not allowed. Expected: ${allowedFiles.join(', ')}`))
    }
  }
})

/**
 * Validates recording ID format for security
 */
function validateRecordingId(id: string): void {
  if (!id || id.trim().length === 0) {
    throw ApiError.badRequest('Recording ID cannot be empty')
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw ApiError.badRequest('Invalid recording ID (path traversal detected)')
  }
  if (id.length > 256) {
    throw ApiError.badRequest('Recording ID is too long')
  }
}

/**
 * Runs Clones Quality Agent on uploaded recording files
 */
async function runCQAProcessing(recordingDir: string): Promise<{
  generatedFiles: { [filename: string]: string }
}> {
  if (!process.env.CQA_PATH) {
    throw new Error('CQA_PATH environment variable not configured')
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable required for CQA processing')
  }

  logger.info(`[CQA] Running Clones Quality Agent for directory: ${recordingDir}`)

  // Check if directory exists and has files
  try {
    await fs.access(recordingDir)
    const files = await fs.readdir(recordingDir)
    logger.info(`[CQA] Directory contents: ${files.join(', ')}`)

    if (files.length === 0) {
      throw new Error('No files found in recording directory')
    }
  } catch (error) {
    throw new Error(`Recording directory not accessible: ${error}`)
  }

  return new Promise((resolve, reject) => {
    const absoluteRecordingDir = path.resolve(recordingDir)
    // Mimic the same logic as get_ffmpeg_dir() and get_ffprobe_dir()
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
    const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'
    const args = ['-f', 'desktop', '-i', absoluteRecordingDir, '--ffmpeg', ffmpegPath, '--ffprobe', ffprobePath]

    // Add model configuration if available
    if (process.env.CQA_MODEL) {
      args.push('--model', process.env.CQA_MODEL)
    }
    if (process.env.CQA_EVALUATION_MODEL) {
      args.push('--evaluation-model', process.env.CQA_EVALUATION_MODEL)
    }

    logger.info(`[CQA] Executing: ${process.env.CQA_PATH} ${args.join(' ')}`)

    const pipeline = spawn(process.env.CQA_PATH, args, {
      cwd: '/app/cqa', // Run from CQA directory with node_modules
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY
      }
    })

    let stdout = ''
    let stderr = ''

    pipeline.stdout.on('data', (data) => {
      stdout += data
      logger.info(`[CQA stdout] ${data.toString()}`)
    })

    pipeline.stderr.on('data', (data) => {
      stderr += data
      logger.error(`[CQA stderr] ${data.toString()}`)
    })

    pipeline.on('close', async (code: number) => {
      if (code === 0) {
        try {
          // Read all generated files from the recording directory
          const generatedFiles: { [filename: string]: string } = {}

          // List all files in the directory after CQA processing
          const files = await fs.readdir(recordingDir)
          logger.info(`[CQA] Files after processing: ${files.join(', ')}`)

          // Read all generated files (excluding original input files)
          const originalFiles = ['input_log.jsonl', 'input_log_meta.json', 'meta.json', 'recording.mp4']

          for (const file of files) {
            if (!originalFiles.includes(file)) {
              try {
                const filePath = path.join(recordingDir, file)
                const content = await fs.readFile(filePath, 'utf8')
                generatedFiles[file] = content
                logger.info(`[CQA] Read generated file: ${file}`)
              } catch (error) {
                logger.warn(`[CQA] Failed to read file ${file}: ${error}`)
              }
            }
          }

          resolve({ generatedFiles })
        } catch (error) {
          logger.error(`[CQA] Failed to read generated files: ${error}`)
          reject(new Error(`Failed to read CQA generated files: ${error}`))
        }
      } else {
        logger.error(`[CQA] Process failed with code ${code}`)
        logger.error(`[CQA] stdout: ${stdout}`)
        logger.error(`[CQA] stderr: ${stderr}`)
        reject(new Error(`Clones Quality Agent failed with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`))
      }
    })

    pipeline.on('error', (err) => {
      logger.error(`[CQA] Spawn error: ${err}`)
      reject(new Error(`Failed to start Clones Quality Agent: ${err.message}`))
    })
  })
}

/**
 * @swagger
 * /forge/recordings/{recordingId}/process:
 *   post:
 *     summary: Process desktop recording with Clones Quality Agent
 *     tags: [Recordings]
 *     parameters:
 *       - in: path
 *         name: recordingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier for the recording
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Recording files (video, images, metadata)
 *     responses:
 *       '200':
 *         description: Recording processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     recordingId:
 *                       type: string
 *                     scores:
 *                       type: object
 *                     metrics:
 *                       type: object
 *       '400':
 *         description: Invalid request or recording ID
 *       '401':
 *         description: Authentication required
 *       '500':
 *         description: Processing failed
 */
router.post(
  '/:recordingId/process',
  requireWalletAddress,
  validateParams({
    recordingId: { required: true, rules: [ValidationRules.isString()] }
  }),
  upload.array('files'),
  errorHandlerAsync(async (req: any, res: Response) => {
    const { recordingId } = req.params
    const walletAddress = req.walletAddress
    const files = req.files as Express.Multer.File[]
    logger.info('[CQA] Files:', files)

    // Validate recording ID
    validateRecordingId(recordingId)

    if (!files || files.length === 0) {
      throw ApiError.badRequest('No files uploaded')
    }

    logger.info(`[CQA] Processing recording ${recordingId} for wallet ${walletAddress}`)
    logger.info(`[CQA] Received ${files.length} files: ${files.map(f => f.originalname).join(', ')}`)

    // Create dedicated directory for this recording
    const recordingDir = getUploadsPath('recordings', recordingId)
    await fs.mkdir(recordingDir, { recursive: true })

    try {
      // Move uploaded files to recording directory with original names
      for (const file of files) {
        const targetPath = path.join(recordingDir, file.originalname)
        await fs.rename(file.path, targetPath)

        // Get file stats for comparison
        const stats = await fs.stat(targetPath)
        logger.info(`[CQA] Moved ${file.originalname} to ${targetPath} (${stats.size} bytes)`)

        // For JSON/JSONL files, log first few lines
        if (file.originalname.endsWith('.json') || file.originalname.endsWith('.jsonl')) {
          const content = await fs.readFile(targetPath, 'utf8')
          const lines = content.split('\n').slice(0, 3)
          logger.info(`[CQA] ${file.originalname} preview: ${lines.map(l => l.substring(0, 100)).join(' | ')}`)
        }
      }

      // Process with CQA
      const result = await runCQAProcessing(recordingDir)

      logger.info(`[CQA] Successfully processed recording ${recordingId}`)
      logger.info(`[CQA] Generated ${Object.keys(result.generatedFiles).length} files: ${Object.keys(result.generatedFiles).join(', ')}`)

      res.status(200).json(successResponse({
        recordingId,
        generatedFiles: result.generatedFiles,
        processedAt: new Date().toISOString()
      }))

    } catch (error) {
      logger.error(`[CQA] Processing failed for recording ${recordingId}:`, error)

      // Clean up on failure
      try {
        await fs.rm(recordingDir, { recursive: true, force: true })
        logger.info(`[CQA] Cleaned up failed recording directory: ${recordingDir}`)
      } catch (cleanupError) {
        logger.error(`[CQA] Failed to cleanup directory: ${cleanupError}`)
      }

      throw ApiError.internalError(`Recording processing failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
)

/**
 * @swagger
 * /forge/recordings/health:
 *   get:
 *     summary: Check CQA service health
 *     tags: [Recordings]
 *     responses:
 *       '200':
 *         description: Service is healthy
 *       '401':
 *         description: Authentication required
 *       '503':
 *         description: Service unavailable
 */
router.get(
  '/health',
  requireWalletAddress,
  errorHandlerAsync(async (_req: Request, res: Response) => {
    const isConfigured = !!(process.env.CQA_PATH && process.env.OPENAI_API_KEY)

    if (!isConfigured) {
      res.status(503).json({
        success: false,
        error: 'CQA service not properly configured',
        timestamp: new Date().toISOString()
      })
      return
    }

    res.status(200).json(successResponse({
      status: 'healthy',
      timestamp: new Date().toISOString()
    }))
  })
)

export { router as forgeRecordingsApi }