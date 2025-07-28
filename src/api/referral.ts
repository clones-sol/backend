import express, { Request, Response } from 'express';
import { referralService } from '../services/referral/index.ts';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { validateBody } from '../middleware/validator.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import { requireAdminAuth } from '../middleware/auth.ts';
import { DEFAULT_FRONTEND_URL } from '../constants/referral.ts';

const router = express.Router();

// Generate referral code for a wallet
router.post(
  '/generate-code',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      throw ApiError.badRequest('Wallet address is required');
    }

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
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { referralCode } = req.body;

    if (!referralCode) {
      throw ApiError.badRequest('Referral code is required');
    }

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
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { 
      referrerAddress, 
      referreeAddress, 
      referralCode, 
      firstActionType, 
      firstActionData,
      actionValue 
    } = req.body;

    if (!referrerAddress || !referreeAddress || !referralCode || !firstActionType) {
      throw ApiError.badRequest('Missing required fields');
    }

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
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const stats = await referralService.getReferralStats(walletAddress);

    return res.status(200).json(successResponse(stats));
  })
);

// Check if a wallet has been referred
router.get(
  '/referred/:walletAddress',
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

// Get reward statistics for a wallet
router.get(
  '/rewards/:walletAddress',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const rewardStats = await referralService.getRewardStats(walletAddress);

    return res.status(200).json(successResponse(rewardStats));
  })
);

// Get reward configuration
router.get(
  '/rewards/config',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const config = await referralService.getRewardConfig();

    return res.status(200).json(successResponse(config));
  })
);

// Update reward configuration (admin only)
router.post(
  '/rewards/config',
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

// Get reward statistics for a wallet
router.get(
  '/rewards/stats/:walletAddress',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      throw ApiError.badRequest('Wallet address is required');
    }

    const stats = await referralService.getRewardStats(walletAddress);

    return res.status(200).json(successResponse(stats));
  })
);

// Process reward for a specific action
router.post(
  '/rewards/process',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { 
      referrerAddress, 
      referreeAddress, 
      actionType, 
      actionValue 
    } = req.body;

    if (!referrerAddress || !referreeAddress || !actionType) {
      throw ApiError.badRequest('Missing required fields');
    }

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
  requireAdminAuth,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const stats = await referralService.getCleanupStats();

    return res.status(200).json(successResponse(stats));
  })
);

router.post(
  '/cleanup/extend-expiration',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress, extensionDays } = req.body;

    if (!walletAddress) {
      throw ApiError.badRequest('Wallet address is required');
    }

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
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      throw ApiError.badRequest('Wallet address is required');
    }

    const newCode = await referralService.regenerateExpiredCode(walletAddress);

    return res.status(200).json(successResponse({
      success: !!newCode,
      newCode,
      message: newCode ? 'Code regenerated successfully' : 'Failed to regenerate code'
    }));
  })
);

export { router as referralApi }; 