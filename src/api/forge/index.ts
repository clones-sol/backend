import express, { Router, Request, Response } from 'express';
import { forgeSubmissionsApi } from './submissions.ts';
import { forgeChatApi } from './chat.ts';
import { forgePoolsApi } from './pools.ts';
import { forgeAppsApi } from './apps.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { ForgeRaceModel } from '../../models/Models.ts';
import { successResponse } from '../../middleware/types/errors.ts';

const router: Router = express.Router();

// Mount all the sub-routers
router.use('/submissions', forgeSubmissionsApi);
router.use('/chat', forgeChatApi);
router.use('/pools', forgePoolsApi);
router.use('/apps', forgeAppsApi);

// Index routes
/*
 * Get all active gyms
 */
router.get(
  '/gym',
  errorHandlerAsync(async (_req: Request, res: Response) => {
    const races = await ForgeRaceModel.find({
      status: 'active',
      type: 'gym'
    }).sort({
      createdAt: -1
    });
    res.status(200).json(successResponse(races));
  })
);

export { router as forgeApi };
