import express, { Request, Response } from 'express';
import { referralService } from '../services/referral/index.ts';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { validateBody } from '../middleware/validator.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';

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
    const referralLink = `${process.env.FRONTEND_URL || 'https://clones.sol'}/ref/${referralCode}`;

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

    const referralLink = `${process.env.FRONTEND_URL || 'https://clones.sol'}/ref/${referralCode.referralCode}`;

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
      firstActionData 
    } = req.body;

    if (!referrerAddress || !referreeAddress || !referralCode || !firstActionType) {
      throw ApiError.badRequest('Missing required fields');
    }

    const referral = await referralService.createReferral(
      referrerAddress,
      referreeAddress,
      referralCode,
      firstActionType,
      firstActionData
    );

    // Store on-chain (async)
    referralService.storeReferralOnChain(referral._id!.toString())
      .catch(error => console.error('Failed to store referral on-chain:', error));

    return res.status(201).json(successResponse({
      referralId: referral._id,
      referrerAddress: referral.referrerAddress,
      referreeAddress: referral.referreeAddress,
      status: referral.status,
      firstActionType: referral.firstActionType
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

export { router as referralApi }; 