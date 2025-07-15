import express, { Router } from 'express';

import { managementRoutes } from './agents/management.ts';
import { lifecycleRoutes } from './agents/lifecycle.ts';
import { transactionRoutes } from './agents/transactions.ts';
import { versionRoutes } from './agents/versions.ts';
import { monitoringRoutes } from './agents/monitoring.ts';

const router: Router = express.Router();

// Mount all the sub-routers
router.use('/', managementRoutes);
router.use('/', lifecycleRoutes);
router.use('/', transactionRoutes);
router.use('/', versionRoutes);
router.use('/', monitoringRoutes);

export { router as forgeAgentsApi }; 