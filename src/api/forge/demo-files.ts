import express, { type Response } from 'express'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import { FactoryModel } from '../../models/Factory.ts'
import { ObjectStorageService } from '../../services/storage/index.ts'
import { DemoStorageService } from '../../services/demo-storage/index.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { generalRateLimit } from '../../middleware/rateLimiter.ts'

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
    console.log('Checking factory creator access:')
    console.log('  Pool ID:', poolId)
    console.log('  User Address:', userAddress)
    
    const factory = await FactoryModel.findOne({
      _id: poolId,
      ownerAddress: userAddress.toLowerCase()
    })
    
    console.log('  Factory found:', !!factory)
    if (factory) {
      console.log('  Factory owner:', factory.ownerAddress)
      return { hasAccess: true, submission, accessType: 'factory_creator' }
    }
    
    // Additional debug: try to find any factory with this pool_id to see what exists
    const anyFactory = await FactoryModel.findOne({
      _id: poolId
    })
    console.log('  Any factory with this pool found:', !!anyFactory)
    if (anyFactory) {
      console.log('  Found factory owner:', anyFactory.ownerAddress)
      console.log('  User address (original):', userAddress)
      console.log('  User address (lowercase):', userAddress.toLowerCase())
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
      console.error(`[DEMO-FILES] Error verifying demo ${submission.demoHash}:`, error)

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
 *         example: "meta.json"
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
  requireWalletAddress,
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
    console.log('Searching for submission:', submissionId)
    console.log('User address:', userAddress)

    const accessCheck = await hasAccessToSubmission(submissionId, userAddress)
    
    console.log('Access check result:', {
      hasAccess: accessCheck.hasAccess,
      accessType: accessCheck.accessType,
      submissionFound: !!accessCheck.submission
    })

    if (accessCheck.hasAccess && accessCheck.accessType) {
      console.log(`User ${userAddress} accessing submission ${submissionId} as ${accessCheck.accessType}`)
    }

    if (!accessCheck.hasAccess || !accessCheck.submission) {
      return res.status(404).json({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    }

    const submission = accessCheck.submission

    console.log('Submission found:', !!submission)
    if (submission && submission.demoHash) {
      const availableFiles = await demoStorageService.listDemoFiles(submission.demoHash)
      console.log('Available files:', availableFiles.map(f => f.filename))
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

      if (asBase64 === 'true' && filename.endsWith('recording.mp4')) {
        const fileBuffer = await demoStorageService.getDemoFile(submission.demoHash, filename)
        const base64Data = fileBuffer.toString('base64')
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', base64Data.length)
        res.setHeader('Content-Disposition', `inline; filename="${filename}.txt"`)
        res.send(base64Data)
        return
      }

      const fileStream = await demoStorageService.getDemoFileStream(submission.demoHash, filename)

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

    console.log('Searching for submission:', submissionId)
    console.log('User address:', userAddress)

    const accessCheck = await hasAccessToSubmission(submissionId, userAddress)
    
    console.log('Access check result:', {
      hasAccess: accessCheck.hasAccess,
      accessType: accessCheck.accessType,
      submissionFound: !!accessCheck.submission
    })

    if (accessCheck.hasAccess && accessCheck.accessType) {
      console.log(`User ${userAddress} accessing submission ${submissionId} as ${accessCheck.accessType}`)
    }

    if (!accessCheck.hasAccess || !accessCheck.submission) {
      return res.status(404).json({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    }

    const submission = accessCheck.submission

    console.log('Submission found:', !!submission)
    if (submission && submission.demoHash) {
      const availableFiles = await demoStorageService.listDemoFiles(submission.demoHash)
      console.log('Available files:', availableFiles.map(f => f.filename))
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