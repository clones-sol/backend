import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { referralService } from '../services/referral/index.ts';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../middleware/validator.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import { requireAdminAuth } from '../middleware/auth.ts';
import { DEFAULT_FRONTEND_URL } from '../constants/referral.ts';
import {
  generateCodeSchema,
  validateCodeSchema,
  createReferralSchema,
  processRewardSchema,
  extendExpirationSchema,
  regenerateCodeSchema,
  walletAddressParamSchema
} from './schemas/referral.ts';

const router = express.Router();

// Rate limiters for different endpoint types
const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});

const sensitiveRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs for sensitive operations
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many sensitive operations from this IP, please try again later.'
});

const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per windowMs for admin operations
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many admin operations from this IP, please try again later.'
});

// Generate referral code for a wallet
router.post(
  '/generate-code',
  sensitiveRateLimiter, // Sensitive operation - generating codes
  validateBody(generateCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.body;

    const referralCode = await referralService.generateReferralCode(walletAddress);
    const referralLink = `${process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL}/ref/${referralCode}`;

    return res.status(200).json(successResponse({
      referralCode,
      referralLink,
      walletAddress
    }));
  })
);

// Get referral code for a wallet
router.get(
  '/code/:walletAddress',
  generalRateLimiter, // General read operation
  validateParams(walletAddressParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const referralCode = await referralService.getReferralCode(walletAddress);
    
    if (!referralCode) {
      throw ApiError.notFound('Referral code not found for this wallet');
    }

    const referralLink = `${process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL}/ref/${referralCode.referralCode}`;

    return res.status(200).json(successResponse({
      referralCode: referralCode.referralCode,
      referralLink,
      walletAddress: referralCode.walletAddress,
      totalReferrals: referralCode.totalReferrals,
      totalRewards: referralCode.totalRewards,
      isActive: referralCode.isActive
    }));
  })
);

// Validate a referral code
router.post(
  '/validate-code',
  generalRateLimiter, // General validation operation
  validateBody(validateCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { referralCode } = req.body;

    const referrerAddress = await referralService.validateReferralCode(referralCode);
    
    if (!referrerAddress) {
      throw ApiError.badRequest('Invalid referral code');
    }

    return res.status(200).json(successResponse({
      isValid: true,
      referrerAddress,
      referralCode: referralCode.toUpperCase()
    }));
  })
);

// Create referral relationship (called when user performs first action)
router.post(
  '/create',
  sensitiveRateLimiter, // Sensitive operation - creating referrals
  validateBody(createReferralSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { 
      referrerAddress, 
      referreeAddress, 
      referralCode, 
      firstActionType, 
      firstActionData,
      actionValue 
    } = req.body;

    // Generate referral link
    const referralLink = `${process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL}/ref/${referralCode}`;
    
    const referral = await referralService.createReferral(
      referrerAddress,
      referreeAddress,
      referralCode,
      referralLink,
      firstActionType,
      firstActionData,
      actionValue
    );

    // Store on-chain (async)
    if (!referral._id) {
      console.error('Referral creation failed: Missing _id');
      throw ApiError.internalError('Failed to create referral: Missing _id');
    }
    referralService.storeReferralOnChain(referral._id.toString())
      .catch(error => console.error('Failed to store referral on-chain:', error));

    return res.status(201).json(successResponse({
      referralId: referral._id,
      referrerAddress: referral.referrerAddress,
      referreeAddress: referral.referreeAddress,
      status: referral.status,
      firstActionType: referral.firstActionType,
      rewardAmount: referral.rewardAmount,
      rewardProcessed: referral.rewardProcessed
    }));
  })
);

// Get referral statistics for a wallet
router.get(
  '/stats/:walletAddress',
  generalRateLimiter, // General read operation
  validateParams(walletAddressParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const stats = await referralService.getReferralStats(walletAddress);

    return res.status(200).json(successResponse(stats));
  })
);

// Check if a wallet has been referred
router.get(
  '/referred/:walletAddress',
  generalRateLimiter, // General read operation
  validateParams(walletAddressParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const hasBeenReferred = await referralService.hasBeenReferred(walletAddress);
    const referrer = hasBeenReferred ? await referralService.getReferrer(walletAddress) : null;

    return res.status(200).json(successResponse({
      hasBeenReferred,
      referrer
    }));
  })
);

// Get referrer for a wallet
router.get(
  '/referrer/:walletAddress',
  generalRateLimiter, // General read operation
  validateParams(walletAddressParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const referrer = await referralService.getReferrer(walletAddress);
    
    if (!referrer) {
      throw ApiError.notFound('No referrer found for this wallet');
    }

    return res.status(200).json(successResponse({
      referrer
    }));
  })
);

// Get reward configuration
router.get(
  '/rewards/config',
  generalRateLimiter, // General read operation
  errorHandlerAsync(async (req: Request, res: Response) => {
    const config = await referralService.getRewardConfig();

    return res.status(200).json(successResponse({
      baseReward: config.baseReward,
      bonusMultiplier: config.bonusMultiplier,
      maxReferrals: config.maxReferrals,
      minActionValue: config.minActionValue,
      cooldownPeriod: config.cooldownPeriod,
      maxReferralsInCooldown: config.maxReferralsInCooldown
    }));
  })
);

// Get reward statistics for a wallet
router.get(
  '/rewards/:walletAddress',
  generalRateLimiter, // General read operation
  validateParams(walletAddressParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const rewardStats = await referralService.getRewardStats(walletAddress);

    return res.status(200).json(successResponse(rewardStats));
  })
);

// Update reward configuration (admin only)
router.post(
  '/rewards/config',
  adminRateLimiter, // Admin operation
  requireAdminAuth,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { baseReward, bonusMultiplier, maxReferrals, minActionValue, cooldownPeriod, maxReferralsInCooldown } = req.body;

    const updatedConfig = await referralService.updateRewardConfig({
      baseReward,
      bonusMultiplier,
      maxReferrals,
      minActionValue,
      cooldownPeriod,
      maxReferralsInCooldown
    });

    return res.status(200).json(successResponse({
      message: 'Reward configuration updated successfully',
      config: updatedConfig
    }));
  })
);

// Get reward statistics for a wallet (detailed)
router.get(
  '/rewards/stats/:walletAddress',
  generalRateLimiter, // General read operation
  validateParams(walletAddressParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const stats = await referralService.getRewardStats(walletAddress);

    return res.status(200).json(successResponse(stats));
  })
);

// Process reward for a specific action
router.post(
  '/rewards/process',
  sensitiveRateLimiter, // Sensitive operation - processing rewards
  validateBody(processRewardSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { 
      referrerAddress, 
      referreeAddress, 
      actionType, 
      actionValue 
    } = req.body;

    const rewardEvent = await referralService.processReward(
      referrerAddress,
      referreeAddress,
      actionType,
      actionValue || 0
    );

    return res.status(200).json(successResponse({
      rewardEvent,
      processed: !!rewardEvent
    }));
  })
);

// Cleanup endpoints (admin only)
router.post(
  '/cleanup/expired-codes',
  adminRateLimiter, // Admin operation
  requireAdminAuth,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const cleanedCount = await referralService.cleanupExpiredCodes();

    return res.status(200).json(successResponse({
      message: `Cleaned up ${cleanedCount} expired referral codes`,
      cleanedCount
    }));
  })
);

router.get(
  '/cleanup/stats',
  adminRateLimiter, // Admin operation
  requireAdminAuth,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const stats = await referralService.getCleanupStats();

    return res.status(200).json(successResponse(stats));
  })
);

router.post(
  '/cleanup/extend-expiration',
  adminRateLimiter, // Admin operation
  validateBody(extendExpirationSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress, extensionDays } = req.body;

    const success = await referralService.extendExpiration(
      walletAddress,
      extensionDays || 30
    );

    return res.status(200).json(successResponse({
      success,
      message: success ? 'Expiration extended successfully' : 'Failed to extend expiration'
    }));
  })
);

router.post(
  '/cleanup/regenerate-code',
  adminRateLimiter, // Admin operation
  validateBody(regenerateCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.body;

    const newCode = await referralService.regenerateExpiredCode(walletAddress);

    return res.status(200).json(successResponse({
      success: !!newCode,
      newCode,
      message: newCode ? 'Code regenerated successfully' : 'Failed to regenerate code'
    }));
  })
);

export { router as referralApi }; 