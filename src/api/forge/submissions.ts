const router: Router = express.Router()

import express, { type Request, type Response, type Router } from 'express'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../../middleware/types/errors.ts'
import { ValidationRules, validateParams, validateQuery, type ValidationSchema } from '../../middleware/validator.ts'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { logger } from "../../services/logger.ts"
export { router as forgeSubmissionsApi }

// Validation schema for user submissions query
const getUserSubmissionsSchema: ValidationSchema = {
  limit: {
    required: false,
    rules: [ValidationRules.isQueryNumber(1, 100)]
  },
  offset: {
    required: false,
    rules: [ValidationRules.isQueryNumber(0)]
  }
}

/**
 * @swagger
 * tags:
 *   name: Submissions
 *   description: Submissions of demonstrations
 */

/**
 * @swagger
 * /forge/submissions/user:
 *   get:
 *     summary: Get submissions for authenticated user with pagination
 *     tags: [Submissions]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of submissions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of submissions to skip
 *     responses:
 *       '200':
 *         description: Paginated submissions for the user
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
 *                     submissions:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       '403':
 *         description: Not authorized to view submissions for this user
 *       '500':
 *         description: Internal server error
 */
// Get submissions for authenticated user
router.get(
  '/user',
  requireWalletAddress,
  validateQuery(getUserSubmissionsSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-expect-error - Get walletAddress from the request object
    const address = req.walletAddress
    const limit = parseInt(req.query.limit as string, 10) || 20
    const offset = parseInt(req.query.offset as string, 10) || 0

    const query = {
      address: new RegExp(`^${address}$`, 'i')
    }

    const submissions = await DemonstrationSubmission.find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .select('-__v')
      .lean()

    const total = await DemonstrationSubmission.countDocuments(query)

    const result = {
      submissions,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }

    logger.debug(`Fetched ${submissions.length} submissions for user ${address} (offset: ${offset}, total: ${total})`)
    res.status(200).json(successResponse(result))
  })
)

/**
 * @swagger
 * /forge/submissions/pool/{factoryId}:
 *   get:
 *     summary: Get submissions for a pool
 *     tags: [Submissions]
 *     parameters:
 *       - in: path
 *         name: factoryId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Submissions for the pool
 *       '400':
 *         description: Invalid pool ID
 *       '403':
 *         description: Not authorized to view submissions for this pool
 *       '500':
 *         description: Internal server error
 */
router.get(
  '/pool/:factoryId',
  requireWalletAddress,
  validateParams({
    factoryId: { required: true, rules: [ValidationRules.isString()] }
  }),
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { factoryId } = req.params

    // @ts-expect-error - Get walletAddress from the request object
    const address = req.walletAddress

    // Verify that the pool belongs to the user
    const factory = await FactoryModel.findById(factoryId)
    if (!factory) {
      throw ApiError.notFound('Factory not found')
    }

    if (factory.ownerAddress.toLowerCase() !== address.toLowerCase()) {
      throw ApiError.unauthorized('Not authorized to view submissions for this factory')
    }

    const submissions = await DemonstrationSubmission.find({
      'meta.quest.pool_id': factoryId
    })
      .sort({ createdAt: -1 })
      .select('-__v')

    res.status(200).json(successResponse(submissions))
  })
)

/**
 * @swagger
 * /forge/submissions/{id}:
 *   get:
 *     summary: Get any submission status
 *     tags: [Submissions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Submission status
 *       '400':
 *         description: Invalid submission ID
 *       '403':
 *         description: Not authorized to view this submission
 *       '500':
 *         description: Internal server error
 */
router.get(
  '/:id',
  validateParams({
    id: { required: true, rules: [ValidationRules.isString()] }
  }),
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id } = req.params
    const submission = await DemonstrationSubmission.findById(id)

    if (!submission) {
      throw ApiError.notFound('Submission not found')
    }

    res.status(200).json(
      successResponse({
        status: submission.status,
        grade_result: submission.grade_result,
        error: submission.error,
        meta: submission.meta,
        demoHash: submission.demoHash,
        fileManifest: submission.fileManifest,
        integrityVerified: submission.integrityVerified,
        reward: submission.reward,
        maxReward: submission.maxReward,
        clampedScore: submission.clampedScore,
        claimAuthorization: submission.claimAuthorization,
        cqaModel: submission.cqaModel,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      })
    )
  })
)
