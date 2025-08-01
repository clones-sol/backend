import express, { Router } from 'express';
import { forgeSubmissionsApi } from './submissions.ts';
import { forgeChatApi } from './chat.ts';
import { forgePoolsApi } from './pools.ts';
import { forgeAppsApi } from './apps.ts';
import { forgeUploadApi } from './upload.ts';
import { forgeAgentsApi } from './agents.ts';

const router: Router = express.Router();

// Mount all the sub-routers
router.use('/submissions', forgeSubmissionsApi);
router.use('/chat', forgeChatApi);
router.use('/pools', forgePoolsApi);
router.use('/apps', forgeAppsApi);
router.use('/upload', forgeUploadApi);
router.use('/agents', forgeAgentsApi);

export { router as forgeApi };
