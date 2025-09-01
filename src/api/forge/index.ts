import express, { type Router } from 'express'
import { forgeFactoryAppsApi } from './apps.ts'
import { forgeChatApi } from './chat.ts'
import { factoriesApi } from './factories.ts'
import { forgeGasApi } from './gas.ts'
import forgeMetadataApi from './metadata.ts'
import { forgeSubmissionsApi } from './submissions.ts'
import { forgeUploadApi } from './upload.ts'

const router: Router = express.Router()

// Mount all the sub-routers
// IMPORTANT: More specific routes MUST come before generic ones
router.use('/submissions', forgeSubmissionsApi)
router.use('/chat', forgeChatApi)
router.use('/upload', forgeUploadApi)
router.use('/factories/apps', forgeFactoryAppsApi)
router.use('/factories', factoriesApi)
router.use('/gas', forgeGasApi)
router.use('/metadata', forgeMetadataApi)

export { router as forgeApi }
