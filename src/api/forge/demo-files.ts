import express, { type Response } from 'express'
import { requireSecureSession } from '../../middleware/secureSession.ts'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import { ObjectStorageService } from '../../services/storage/index.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { generalRateLimit } from '../../middleware/rateLimiter.ts'

const router = express.Router()

// Initialize storage service once at module level (singleton pattern)
const storageService = new ObjectStorageService(
  process.env.STORAGE_ACCESS_KEY!,
  process.env.STORAGE_SECRET_KEY!,
  process.env.STORAGE_ENDPOINT!,
  process.env.STORAGE_REGION!,
  process.env.STORAGE_BUCKET!
)

/**
 * @swagger
 * /forge/demo-files/{submissionId}/{filename}:
 *   get:
 *     summary: Download a specific demo file
 *     description: Download a file from a demonstration submission. Only the owner can access their files.
 *     tags: [Demo Files]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *         description: The demonstration submission ID
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: The filename to download
 *         example: "1234567890-meta.json"
 *       - in: query
 *         name: asBase64
 *         required: false
 *         schema:
 *           type: string
 *           enum: ["true"]
 *         description: Return MP4 files as base64 encoded text instead of binary. Only works for recording.mp4 files.
 *         example: "true"
 *     responses:
 *       200:
 *         description: File downloaded successfully
 *         content:
 *           application/json:
 *             description: JSON files (meta.json, sft.json)
 *           video/mp4:
 *             description: Recording video files (binary)
 *           application/x-ndjson:
 *             description: Input log files (jsonl)
 *           text/plain:
 *             description: MP4 files encoded as base64 text (when asBase64=true)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Submission or file not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/RateLimit'
 */
// GET /api/v1/forge/demo-files/:submissionId/:filename
router.get('/:submissionId/:filename', 
  generalRateLimit, // Rate limit file downloads
  requireSecureSession(), 
  errorHandlerAsync(async (req: any, res: Response) => {
  const { submissionId, filename } = req.params
  const { asBase64 } = req.query
  const userAddress = req.walletAddress

  if (!submissionId || !filename) {
    return res.status(400).json({
      success: false,
      error: 'Submission ID and filename are required'
    })
  }

  // Find the demonstration submission
  const submission = await DemonstrationSubmission.findOne({
    _id: submissionId,
    address: userAddress.toLowerCase()
  })

  if (!submission) {
    return res.status(404).json({
      success: false,
      error: 'Demonstration submission not found or access denied'
    })
  }

  // Find the specific file in the submission
  const fileInfo = submission.files?.find(f => f.file === filename)
  
  if (!fileInfo || !fileInfo.storageKey) {
    return res.status(404).json({
      success: false,
      error: 'File not found in submission'
    })
  }

  try {
    // Determine content type for demo files
    const getContentType = (filename: string): string => {
      if (filename.endsWith('-meta.json') || filename.endsWith('-sft.json')) {
        return 'application/json'
      }
      if (filename.endsWith('-recording.mp4')) {
        return 'video/mp4'
      }
      if (filename.endsWith('-input_log.jsonl')) {
        return 'application/x-ndjson'
      }
      return 'application/octet-stream'
    }

    // Handle base64 encoding for MP4 files if requested (requires buffering)
    if (asBase64 === 'true' && filename.endsWith('-recording.mp4')) {
      const fileBuffer = await storageService.getItem({
        name: fileInfo.storageKey
      })
      const base64Data = fileBuffer.toString('base64')
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', base64Data.length)
      res.setHeader('Content-Disposition', `inline; filename="${filename}.txt"`)
      res.send(base64Data)
      return
    }

    // For all other cases: Stream directly from storage (memory efficient)
    const fileStream = await storageService.getItemStream({
      name: fileInfo.storageKey
    })

    // Set appropriate headers
    res.setHeader('Content-Type', getContentType(filename))
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    
    // Stream the file directly (no memory buffering)
    fileStream.pipe(res)

  } catch (error) {
    console.error(`[DEMO-FILES] Error retrieving file ${filename} for submission ${submissionId}:`, error)
    
    if (error instanceof Error && error.message.includes('Object not found')) {
      return res.status(404).json({
        success: false,
        error: 'File not found in storage'
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve file'
    })
  }
}))

/**
 * @swagger
 * /forge/demo-files/{submissionId}:
 *   get:
 *     summary: List files for a demonstration submission
 *     description: Get metadata and file list for a demonstration submission. Only the owner can access their submission.
 *     tags: [Demo Files]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *         description: The demonstration submission ID
 *     responses:
 *       200:
 *         description: File list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     submissionId:
 *                       type: string
 *                       example: "demo_123456"
 *                     files:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                             example: "1234567890-meta.json"
 *                           size:
 *                             type: number
 *                             example: 1024
 *                           downloadUrl:
 *                             type: string
 *                             example: "/api/v1/forge/demo-files/demo_123456/1234567890-meta.json"
 *                     totalFiles:
 *                       type: number
 *                       example: 4
 *                     status:
 *                       type: string
 *                       example: "COMPLETED"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-01T12:00:00.000Z"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Submission not found or access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/RateLimit'
 */
// GET /api/v1/forge/demo-files/:submissionId - List files for a submission
router.get('/:submissionId', 
  generalRateLimit, // Rate limit metadata requests
  requireSecureSession(), 
  errorHandlerAsync(async (req: any, res: Response) => {
  const { submissionId } = req.params
  const userAddress = req.walletAddress

  if (!submissionId) {
    return res.status(400).json({
      success: false,
      error: 'Submission ID is required'
    })
  }

  // Find the demonstration submission
  const submission = await DemonstrationSubmission.findOne({
    _id: submissionId,
    address: userAddress.toLowerCase()
  })

  if (!submission) {
    return res.status(404).json({
      success: false,
      error: 'Demonstration submission not found or access denied'
    })
  }

  // Return file list with metadata
  const files = submission.files?.map(f => ({
    filename: f.file,
    size: f.size,
    downloadUrl: `/api/v1/forge/demo-files/${submissionId}/${f.file}`
  })) || []

  res.json({
    success: true,
    data: {
      submissionId,
      files,
      totalFiles: files.length,
      status: submission.status,
      createdAt: submission.createdAt
    }
  })
}))

export default router