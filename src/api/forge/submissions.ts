const router: Router = express.Router();
import express, { Request, Response, Router } from 'express';
import { requireWalletAddress } from '../../middleware/auth.ts';
import multer from 'multer';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { ApiError, successResponse } from '../../middleware/types/errors.ts';
import { ForgeRaceSubmission, TrainingPoolModel } from '../../models/Models.ts';
import { validateParams, ValidationRules } from '../../middleware/validator.ts';
export { router as forgeSubmissionsApi };

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 15 * 1024 * 1024 * 1024 // 15GB limit for /upload-race endpoint
  }
});

// Get submissions for authenticated user
router.get(
  '/user',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    const submissions = await ForgeRaceSubmission.find({ address })
      .sort({ createdAt: -1 })
      .select('-__v');

    res.status(200).json(successResponse(submissions));
  })
);

// Get submissions for a pool
router.get(
  '/pool/:poolId',
  requireWalletAddress,
  validateParams({ poolId: { required: true, rules: [ValidationRules.isString()] } }),
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { poolId } = req.params;

    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    // Verify that the pool belongs to the user
    const pool = await TrainingPoolModel.findById(poolId);
    if (!pool) {
      throw ApiError.notFound('Pool not found');
    }

    if (pool.ownerAddress !== address) {
      throw ApiError.unauthorized('Not authorized to view submissions for this pool');
    }

    const submissions = await ForgeRaceSubmission.find({ 'meta.quest.pool_id': poolId })
      .sort({ createdAt: -1 })
      .select('-__v');

    res.status(200).json(successResponse(submissions));
  })
);

// Get any submission status -- requires authentication
router.get(
  '/:id',
  validateParams({ id: { required: true, rules: [ValidationRules.isString()] } }),
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const submission = await ForgeRaceSubmission.findById(id);

    if (!submission) {
      throw ApiError.notFound('Submission not found');
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
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      })
    );
  })
);
