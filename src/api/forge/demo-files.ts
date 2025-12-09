import express, { type Response } from 'express'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import { FactoryModel } from '../../models/Factory.ts'
import { ObjectStorageService } from '../../services/storage/index.ts'
import { DemoStorageService } from '../../services/demo-storage/index.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { generalRateLimit } from '../../middleware/rateLimiter.ts'
import { logger } from "../../services/logger.ts"
import { WalletConnectionModel } from '../../models/Models.ts'

const router = express.Router()

// Initialize storage services once at module level (singleton pattern)
const objectStorageService = new ObjectStorageService(
  process.env.STORAGE_ACCESS_KEY!,
  process.env.STORAGE_SECRET_KEY!,
  process.env.STORAGE_ENDPOINT!,
  process.env.STORAGE_REGION!,
  process.env.STORAGE_BUCKET!
)

const demoStorageService = new DemoStorageService(objectStorageService)

/**
 * Check if user has access to a submission (either as owner or factory creator)
 */
async function hasAccessToSubmission(submissionId: string, userAddress: string) {
  // First, find the submission
  const submission = await DemonstrationSubmission.findOne({ _id: submissionId })
  if (!submission) {
    return { hasAccess: false, submission: null }
  }

  // Check if user is the owner (farmer)
  const isOwner = submission.address?.toLowerCase() === userAddress.toLowerCase()
  if (isOwner) {
    return { hasAccess: true, submission, accessType: 'owner' }
  }

  // Check if user is the factory creator via meta.quest.pool_id
  const poolId = submission.meta?.quest?.pool_id || submission.onChainReward?.poolAddress
  if (poolId) {
    logger.info('Checking factory creator access:')
    logger.info('  Pool ID:', poolId)
    logger.info('  User Address:', userAddress)
    
    const factory = await FactoryModel.findOne({
      _id: poolId,
      ownerAddress: userAddress.toLowerCase()
    })
    
    logger.info('  Factory found:', !!factory)
    if (factory) {
      logger.info('  Factory owner:', factory.ownerAddress)
      return { hasAccess: true, submission, accessType: 'factory_creator' }
    }
    
    // Additional debug: try to find any factory with this pool_id to see what exists
    const anyFactory = await FactoryModel.findOne({
      _id: poolId
    })
    logger.info('  Any factory with this pool found:', !!anyFactory)
    if (anyFactory) {
      logger.info('  Found factory owner:', anyFactory.ownerAddress)
      logger.info('  User address (original):', userAddress)
      logger.info('  User address (lowercase):', userAddress.toLowerCase())
    }
  }

  return { hasAccess: false, submission }
}

/**
 * @swagger
 * /forge/demo-files/{submissionId}/verify:
 *   get:
 *     summary: Verify integrity of demonstration files
 *     description: Check file integrity using SHA-256 hashes
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
 *         description: Integrity verification result
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
 *                     valid:
 *                       type: boolean
 *                     demoHash:
 *                       type: string
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     verifiedAt:
 *                       type: string
 *                       format: date-time
 */
router.get('/:submissionId/verify',
  generalRateLimit,
  requireWalletAddress,
  errorHandlerAsync(async (req: any, res: Response) => {
    const { submissionId } = req.params
    const userAddress = req.walletAddress

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required'
      })
    }

    const accessCheck = await hasAccessToSubmission(submissionId, userAddress)
    
    if (!accessCheck.hasAccess || !accessCheck.submission) {
      return res.status(404).json({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    }

    const submission = accessCheck.submission

    if (!submission.demoHash) {
      return res.status(404).json({
        success: false,
        error: 'Demo hash not found for submission'
      })
    }

    try {
      const verification = await demoStorageService.verifyDemo(submission.demoHash)

      // Update verification status in database
      await DemonstrationSubmission.updateOne(
        { _id: submissionId },
        {
          integrityVerified: verification.valid,
          integrityLastCheck: new Date()
        }
      )

      res.json({
        success: true,
        data: {
          valid: verification.valid,
          demoHash: submission.demoHash,
          errors: verification.errors,
          verifiedAt: new Date().toISOString()
        }
      })
    } catch (error) {
      logger.error(`[DEMO-FILES] Error verifying demo ${submission.demoHash}:`, error)

      res.status(500).json({
        success: false,
        error: 'Failed to verify demo integrity'
      })
    }
  }))

/**
 * @swagger
 * /forge/demo-files/{submissionId}/{filename}:
 *   get:
 *     summary: Download or stream a specific demo file
 *     description: |
 *       Download a file from a demonstration submission. Only the owner or factory creator can access files.
 *
 *       For video files (recording.mp4), supports HTTP Range requests for efficient streaming:
 *       - Send `Range: bytes=0-1023` header to request partial content
 *       - Server responds with 206 Partial Content
 *       - Enables video seeking, progressive loading, and bandwidth optimization
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
 *         example: "recording.mp4"
 *       - in: header
 *         name: Range
 *         required: false
 *         schema:
 *           type: string
 *         description: HTTP Range header for partial content requests (e.g., "bytes=0-1023")
 *         example: "bytes=0-1048575"
 *     responses:
 *       200:
 *         description: File downloaded successfully (full content)
 *         content:
 *           application/json:
 *             description: JSON files (meta.json, sft.json)
 *           video/mp4:
 *             description: Recording video files (binary stream with Accept-Ranges support)
 *           application/x-ndjson:
 *             description: Input log files (jsonl)
 *         headers:
 *           Accept-Ranges:
 *             schema:
 *               type: string
 *             description: Indicates server accepts Range requests (for video files)
 *           Cache-Control:
 *             schema:
 *               type: string
 *             description: Cache directives (immutable for videos)
 *       206:
 *         description: Partial content (Range request successful)
 *         content:
 *           video/mp4:
 *             description: Partial video content
 *         headers:
 *           Content-Range:
 *             schema:
 *               type: string
 *             description: Range of bytes returned (e.g., "bytes 0-1048575/52428800")
 *           Content-Length:
 *             schema:
 *               type: integer
 *             description: Size of partial content
 *           Accept-Ranges:
 *             schema:
 *               type: string
 *             description: Server accepts Range requests
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
 *       416:
 *         description: Range Not Satisfiable (invalid range request)
 *       429:
 *         $ref: '#/components/responses/RateLimit'
 */
// GET /api/v1/forge/demo-files/:submissionId/:filename
router.get('/:submissionId/:filename',
  generalRateLimit, // Rate limit file downloads
  errorHandlerAsync(async (req: any, res: Response) => {
    const { submissionId, filename } = req.params
    const tokenQuery = req.query.token as string | undefined

    // Try token from query param first (for media players without custom headers)
    let userAddress: string | undefined
    const tokenToCheck = tokenQuery || req.headers['x-connect-token']

    if (!tokenToCheck) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required (token missing)'
      })
    }

    // Validate connect token
    const connection = await WalletConnectionModel.findOne({ token: tokenToCheck })
    if (!connection || !connection.address) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      })
    }

    userAddress = connection.address

    if (!submissionId || !filename) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID and filename are required'
      })
    }

    // Check user access to submission
    logger.info('Searching for submission:', submissionId)
    logger.info('User address:', userAddress)

    const accessCheck = await hasAccessToSubmission(submissionId, userAddress)

    logger.info('Access check result:', {
      hasAccess: accessCheck.hasAccess,
      accessType: accessCheck.accessType,
      submissionFound: !!accessCheck.submission
    })

    if (accessCheck.hasAccess && accessCheck.accessType) {
      logger.info(`User ${userAddress} accessing submission ${submissionId} as ${accessCheck.accessType}`)
    }

    if (!accessCheck.hasAccess || !accessCheck.submission) {
      return res.status(404).json({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    }

    const submission = accessCheck.submission

    logger.info('Submission found:', !!submission)
    if (submission && submission.demoHash) {
      const availableFiles = await demoStorageService.listDemoFiles(submission.demoHash)
      logger.info('Available files:', availableFiles.map(f => f.filename))
    }

    if (!submission.demoHash) {
      return res.status(404).json({
        success: false,
        error: 'Demo hash not found for submission'
      })
    }

    try {
      await demoStorageService.getDemoFile(submission.demoHash, filename)
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'File not found in submission'
      })
    }

    try {
      // Determine content type for demo files
      const getContentType = (filename: string): string => {
        if (filename.endsWith('meta.json') || filename.endsWith('sft.json')) {
          return 'application/json'
        }
        if (filename.endsWith('recording.mp4')) {
          return 'video/mp4'
        }
        if (filename.endsWith('input_log.jsonl')) {
          return 'application/x-ndjson'
        }
        return 'application/octet-stream'
      }

      // Check for Range request header
      const rangeHeader = req.headers.range

      // For video files, support Range requests for efficient streaming
      if (filename.endsWith('recording.mp4') && rangeHeader) {
        const { stream, contentLength, contentRange, totalSize } =
          await demoStorageService.getDemoFileStreamWithRange(
            submission.demoHash,
            filename,
            rangeHeader
          )

        // Set headers for partial content response (206)
        res.status(206) // Partial Content
        res.setHeader('Content-Type', getContentType(filename))
        res.setHeader('Content-Length', contentLength)
        res.setHeader('Content-Range', contentRange || `bytes 0-${contentLength - 1}/${totalSize}`)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`)

        // Enable caching for video chunks (helps with seeking)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

        // Stream the partial content
        stream.pipe(res)
        return
      }

      // Regular streaming for non-range requests or non-video files
      const fileStream = await demoStorageService.getDemoFileStream(submission.demoHash, filename)

      // Set appropriate headers
      res.setHeader('Content-Type', getContentType(filename))
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`)

      // For video files, advertise Range support even without Range request
      if (filename.endsWith('recording.mp4')) {
        res.setHeader('Accept-Ranges', 'bytes')
        // Cache video files aggressively
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }

      // Stream the file directly (no memory buffering)
      fileStream.pipe(res)

    } catch (error) {
      logger.error(`[DEMO-FILES] Error retrieving file ${filename} for submission ${submissionId}:`, error)

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
  requireWalletAddress,
  errorHandlerAsync(async (req: any, res: Response) => {
    const { submissionId } = req.params
    const userAddress = req.walletAddress

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required'
      })
    }

    logger.info('Searching for submission:', submissionId)
    logger.info('User address:', userAddress)

    const accessCheck = await hasAccessToSubmission(submissionId, userAddress)
    
    logger.info('Access check result:', {
      hasAccess: accessCheck.hasAccess,
      accessType: accessCheck.accessType,
      submissionFound: !!accessCheck.submission
    })

    if (accessCheck.hasAccess && accessCheck.accessType) {
      logger.info(`User ${userAddress} accessing submission ${submissionId} as ${accessCheck.accessType}`)
    }

    if (!accessCheck.hasAccess || !accessCheck.submission) {
      return res.status(404).json({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    }

    const submission = accessCheck.submission

    logger.info('Submission found:', !!submission)
    if (submission && submission.demoHash) {
      const availableFiles = await demoStorageService.listDemoFiles(submission.demoHash)
      logger.info('Available files:', availableFiles.map(f => f.filename))
    }

    if (!submission.demoHash) {
      return res.status(404).json({
        success: false,
        error: 'Demo hash not found for submission'
      })
    }

    const files = await demoStorageService.listDemoFiles(submission.demoHash)
    const fileList = files.map(f => ({
      filename: f.filename,
      size: f.size,
      downloadUrl: `/api/v1/forge/demo-files/${submissionId}/${f.filename}`,
      hash: f.hash
    }))

    res.json({
      success: true,
      data: {
        submissionId,
        demoHash: submission.demoHash,
        files: fileList,
        totalFiles: fileList.length,
        status: submission.status,
        createdAt: submission.createdAt,
        integrityVerified: submission.integrityVerified
      }
    })
  }))

export default router