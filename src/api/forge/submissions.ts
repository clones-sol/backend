const router: Router = express.Router()

import express, { type Request, type Response, type Router } from 'express'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../../middleware/types/errors.ts'
import { ValidationRules, validateParams } from '../../middleware/validator.ts'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
export { router as forgeSubmissionsApi }

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
 *     summary: Get submissions for authenticated user
 *     tags: [Submissions]
 *     responses:
 *       '200':
 *         description: Submissions for the user
 *       '403':
 *         description: Not authorized to view submissions for this user
 *       '500':
 *         description: Internal server error
 */
// Get submissions for authenticated user
router.get(
  '/user',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-expect-error - Get walletAddress from the request object
    const address = req.walletAddress

    const submissions = await DemonstrationSubmission.find({ address })
      .sort({ createdAt: -1 })
      .select('-__v')

    res.status(200).json(successResponse(submissions))
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
 *     security:
 *       - walletAuth: []
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
        files: submission.files,
        reward: submission.reward,
        maxReward: submission.maxReward,
        clampedScore: submission.clampedScore,
        claimAuthorization: submission.claimAuthorization,
        cqaModel: submission.cqaModel,
        cqaEvaluationModel: submission.cqaEvaluationModel,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      })
    )
  })
)
