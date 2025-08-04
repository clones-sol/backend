import express, { Request, Response } from 'express';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { successResponse } from '../../middleware/types/errors.ts';
import { ApiError } from '../../middleware/types/errors.ts';
import { ForgeMigrationService } from '../../services/forge/migration.ts';

const router = express.Router();
const migrationService = new ForgeMigrationService();

/**
 * Get migration status
 * GET /api/forge/migration/status
 */
router.get(
  '/status',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    try {
      const status = await migrationService.getMigrationStatus();
      
      res.status(200).json(successResponse(status));
    } catch (error) {
      console.error('Failed to get migration status:', error);
      throw ApiError.internal('Failed to retrieve migration status');
    }
  })
);

/**
 * Validate migration integrity
 * GET /api/forge/migration/validate
 */
router.get(
  '/validate',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    try {
      const validation = await migrationService.validateMigration();
      
      res.status(200).json(successResponse(validation));
    } catch (error) {
      console.error('Failed to validate migration:', error);
      throw ApiError.internal('Failed to validate migration');
    }
  })
);

/**
 * Start migration process
 * POST /api/forge/migration/start
 * Note: This should be restricted to admin users only
 */
router.post(
  '/start',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // TODO: Add admin check
    // For now, allow any authenticated user (should be restricted to admins)
    
    try {
      console.log('[MIGRATION] Migration started by user');
      
      const result = await migrationService.migrateExistingRewards();
      
      res.status(200).json(successResponse({
        message: 'Migration completed',
        ...result
      }));
    } catch (error) {
      console.error('Failed to start migration:', error);
      throw ApiError.internal('Failed to start migration');
    }
  })
);

export default router; 