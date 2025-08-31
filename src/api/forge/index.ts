import express, { Router } from 'express';
import { forgeSubmissionsApi } from './submissions.ts';
import { forgeChatApi } from './chat.ts';
import { forgeUploadApi } from './upload.ts';
import { forgeGasApi } from './gas.ts';
import { factoriesApi } from './factories.ts';
import forgeMetadataApi from './metadata.ts';
import { forgeFactoryAppsApi } from './apps.ts';

const router: Router = express.Router();

// Mount all the sub-routers
// IMPORTANT: More specific routes MUST come before generic ones
router.use('/submissions', forgeSubmissionsApi);
router.use('/chat', forgeChatApi);
router.use('/upload', forgeUploadApi);
router.use('/factories/apps', forgeFactoryAppsApi);
router.use('/factories', factoriesApi);
router.use('/gas', forgeGasApi);
router.use('/metadata', forgeMetadataApi);

export { router as forgeApi };
