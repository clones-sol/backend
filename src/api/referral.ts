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

/**
 * @swagger
 * tags:
 *   name: Referral System
 *   description: Referral system management endpoints for tracking and rewarding user referrals
 */

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

/**
 * @swagger
 * /referral/generate-code:
 *   post:
 *     summary: Generate a new referral code for a wallet
 *     description: Creates a unique referral code for the specified wallet address. This code can be shared with others to track referrals.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The Solana wallet address to generate a referral code for
 *                 example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Referral code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         referralCode:
 *                           type: string
 *                           description: The generated referral code
 *                           example: "ABC123"
 *                         referralLink:
 *                           type: string
 *                           description: Complete referral link for sharing
 *                           example: "https://app.example.com/ref/ABC123"
 *                         walletAddress:
 *                           type: string
 *                           description: The wallet address the code was generated for
 *                           example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *       400:
 *         description: Invalid wallet address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/code/{walletAddress}:
 *   get:
 *     summary: Get referral code information for a wallet
 *     description: Retrieves the referral code and associated statistics for a specific wallet address.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get referral code for
 *         example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Referral code information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         referralCode:
 *                           type: string
 *                           description: The referral code
 *                           example: "ABC123"
 *                         referralLink:
 *                           type: string
 *                           description: Complete referral link
 *                           example: "https://app.example.com/ref/ABC123"
 *                         walletAddress:
 *                           type: string
 *                           description: The wallet address
 *                           example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                         totalReferrals:
 *                           type: number
 *                           description: Total number of successful referrals
 *                           example: 5
 *                         totalRewards:
 *                           type: number
 *                           description: Total rewards earned from referrals
 *                           example: 150
 *                         isActive:
 *                           type: boolean
 *                           description: Whether the referral code is active
 *                           example: true
 *       404:
 *         description: Referral code not found for this wallet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/validate-code:
 *   post:
 *     summary: Validate a referral code
 *     description: Validates a referral code and returns the referrer's wallet address if valid.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referralCode
 *             properties:
 *               referralCode:
 *                 type: string
 *                 description: The referral code to validate
 *                 example: "ABC123"
 *     responses:
 *       200:
 *         description: Referral code validated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         isValid:
 *                           type: boolean
 *                           description: Whether the referral code is valid
 *                           example: true
 *                         referrerAddress:
 *                           type: string
 *                           description: The wallet address of the referrer
 *                           example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                         referralCode:
 *                           type: string
 *                           description: The normalized referral code (uppercase)
 *                           example: "ABC123"
 *       400:
 *         description: Invalid referral code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/create:
 *   post:
 *     summary: Create a referral relationship
 *     description: Creates a referral relationship when a user performs their first action using a referral code. This establishes the connection between referrer and referree.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referrerAddress
 *               - referreeAddress
 *               - referralCode
 *               - firstActionType
 *             properties:
 *               referrerAddress:
 *                 type: string
 *                 description: The wallet address of the person who referred (referrer)
 *                 example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *               referreeAddress:
 *                 type: string
 *                 description: The wallet address of the person being referred (referree)
 *                 example: "4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49"
 *               referralCode:
 *                 type: string
 *                 description: The referral code used
 *                 example: "ABC123"
 *               firstActionType:
 *                 type: string
 *                 description: The type of first action performed by the referree
 *                 example: "AGENT_CREATION"
 *               firstActionData:
 *                 type: object
 *                 description: Additional data about the first action (optional)
 *                 example: {"agentId": "123", "poolId": "456"}
 *               actionValue:
 *                 type: number
 *                 description: The value associated with the first action (optional)
 *                 example: 100
 *     responses:
 *       201:
 *         description: Referral relationship created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         referralId:
 *                           type: string
 *                           description: The unique ID of the created referral
 *                           example: "507f1f77bcf86cd799439011"
 *                         referrerAddress:
 *                           type: string
 *                           description: The referrer's wallet address
 *                           example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                         referreeAddress:
 *                           type: string
 *                           description: The referree's wallet address
 *                           example: "4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49"
 *                         status:
 *                           type: string
 *                           description: The status of the referral
 *                           example: "pending"
 *                         firstActionType:
 *                           type: string
 *                           description: The type of first action performed
 *                           example: "AGENT_CREATION"
 *                         rewardAmount:
 *                           type: number
 *                           description: The reward amount for this referral
 *                           example: 100
 *                         rewardProcessed:
 *                           type: boolean
 *                           description: Whether the reward has been processed
 *                           example: false
 *       400:
 *         description: Invalid referral data or referral code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

    // Store on-chain (async) with proper error handling
    if (!referral._id) {
      console.error('Referral creation failed: Missing _id');
      throw ApiError.internalError('Failed to create referral: Missing _id');
    }
    
    // Queue on-chain storage with retry mechanism
    referralService.storeReferralOnChain(referral._id.toString())
      .catch(error => {
        console.error('Failed to store referral on-chain:', error);
        // TODO: Implement proper queuing system for failed on-chain storage attempts
        // This could use Redis, a database queue, or a message broker
      });

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

/**
 * @swagger
 * /referral/stats/{walletAddress}:
 *   get:
 *     summary: Get referral statistics for a wallet
 *     description: Retrieves comprehensive referral statistics for a specific wallet address, including total referrals, rewards earned, and performance metrics.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get statistics for
 *         example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Referral statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalReferrals:
 *                           type: number
 *                           description: Total number of successful referrals
 *                           example: 15
 *                         totalRewards:
 *                           type: number
 *                           description: Total rewards earned from referrals
 *                           example: 450
 *                         averageReward:
 *                           type: number
 *                           description: Average reward per referral
 *                           example: 30
 *                         recentReferrals:
 *                           type: array
 *                           description: List of recent referrals
 *                           items:
 *                             type: object
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/referred/{walletAddress}:
 *   get:
 *     summary: Check if a wallet has been referred
 *     description: Checks whether a specific wallet address has been referred by someone else and returns the referrer information if applicable.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to check
 *         example: "4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49"
 *     responses:
 *       200:
 *         description: Referral status checked successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         hasBeenReferred:
 *                           type: boolean
 *                           description: Whether the wallet has been referred
 *                           example: true
 *                         referrer:
 *                           type: object
 *                           description: Referrer information if hasBeenReferred is true
 *                           nullable: true
 *                           properties:
 *                             walletAddress:
 *                               type: string
 *                               example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                             referralCode:
 *                               type: string
 *                               example: "ABC123"
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/referrer/{walletAddress}:
 *   get:
 *     summary: Get referrer information for a wallet
 *     description: Retrieves the referrer information for a specific wallet address that has been referred.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get referrer for
 *         example: "4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49"
 *     responses:
 *       200:
 *         description: Referrer information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         referrer:
 *                           type: object
 *                           properties:
 *                             walletAddress:
 *                               type: string
 *                               description: The referrer's wallet address
 *                               example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                             referralCode:
 *                               type: string
 *                               description: The referral code used
 *                               example: "ABC123"
 *       404:
 *         description: No referrer found for this wallet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/rewards/config:
 *   get:
 *     summary: Get reward configuration
 *     description: Retrieves the current reward configuration settings for the referral system, including base rewards, multipliers, and limits.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     responses:
 *       200:
 *         description: Reward configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         baseReward:
 *                           type: number
 *                           description: Base reward amount for each referral
 *                           example: 100
 *                         bonusMultiplier:
 *                           type: number
 *                           description: Bonus multiplier for multiple referrals
 *                           example: 1.5
 *                         maxReferrals:
 *                           type: number
 *                           description: Maximum number of referrals allowed
 *                           example: 10
 *                         minActionValue:
 *                           type: number
 *                           description: Minimum action value required for rewards
 *                           example: 10
 *                         cooldownPeriod:
 *                           type: number
 *                           description: Cooldown period in milliseconds
 *                           example: 86400000
 *                         maxReferralsPerCooldownPeriod:
 *                           type: number
 *                           description: Maximum referrals allowed during cooldown
 *                           example: 5
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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
              maxReferralsPerCooldownPeriod: config.maxReferralsPerCooldownPeriod
    }));
  })
);

/**
 * @swagger
 * /referral/rewards/{walletAddress}:
 *   get:
 *     summary: Get reward statistics for a wallet
 *     description: Retrieves detailed reward statistics for a specific wallet address, including total rewards earned and recent reward events.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get reward statistics for
 *         example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Reward statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalRewards:
 *                           type: number
 *                           description: Total rewards earned
 *                           example: 450
 *                         totalReferrals:
 *                           type: number
 *                           description: Total number of referrals
 *                           example: 15
 *                         averageReward:
 *                           type: number
 *                           description: Average reward per referral
 *                           example: 30
 *                         recentRewards:
 *                           type: array
 *                           description: List of recent reward events
 *                           items:
 *                             type: object
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/rewards/config:
 *   post:
 *     summary: Update reward configuration (Admin only)
 *     description: Updates the reward configuration settings for the referral system. This endpoint requires admin authentication.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               baseReward:
 *                 type: number
 *                 description: Base reward amount for each referral
 *                 example: 100
 *               bonusMultiplier:
 *                 type: number
 *                 description: Bonus multiplier for multiple referrals
 *                 example: 1.5
 *               maxReferrals:
 *                 type: number
 *                 description: Maximum number of referrals allowed
 *                 example: 10
 *               minActionValue:
 *                 type: number
 *                 description: Minimum action value required for rewards
 *                 example: 10
 *               cooldownPeriod:
 *                 type: number
 *                 description: Cooldown period in milliseconds
 *                 example: 86400000
 *               maxReferralsPerCooldownPeriod:
 *                 type: number
 *                 description: Maximum referrals allowed during cooldown
 *                 example: 5
 *     responses:
 *       200:
 *         description: Reward configuration updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         message:
 *                           type: string
 *                           example: "Reward configuration updated successfully"
 *                         config:
 *                           type: object
 *                           description: Updated configuration
 *       401:
 *         description: Unauthorized - Admin authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
// Update reward configuration (admin only)
router.post(
  '/rewards/config',
  adminRateLimiter, // Admin operation
  requireAdminAuth,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { baseReward, bonusMultiplier, maxReferrals, minActionValue, cooldownPeriod, maxReferralsPerCooldownPeriod } = req.body;

    const updatedConfig = await referralService.updateRewardConfig({
      baseReward,
      bonusMultiplier,
      maxReferrals,
      minActionValue,
      cooldownPeriod,
              maxReferralsPerCooldownPeriod
    });

    return res.status(200).json(successResponse({
      message: 'Reward configuration updated successfully',
      config: updatedConfig
    }));
  })
);

/**
 * @swagger
 * /referral/rewards/stats/{walletAddress}:
 *   get:
 *     summary: Get detailed reward statistics for a wallet
 *     description: Retrieves detailed reward statistics for a specific wallet address, including comprehensive metrics and historical data.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get detailed reward statistics for
 *         example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Detailed reward statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalRewards:
 *                           type: number
 *                           description: Total rewards earned
 *                           example: 450
 *                         totalReferrals:
 *                           type: number
 *                           description: Total number of referrals
 *                           example: 15
 *                         averageReward:
 *                           type: number
 *                           description: Average reward per referral
 *                           example: 30
 *                         recentRewards:
 *                           type: array
 *                           description: List of recent reward events
 *                           items:
 *                             type: object
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/rewards/process:
 *   post:
 *     summary: Process reward for a specific action
 *     description: Processes a reward for a specific action performed by a referree, calculating and distributing rewards to the referrer.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referrerAddress
 *               - referreeAddress
 *               - actionType
 *             properties:
 *               referrerAddress:
 *                 type: string
 *                 description: The wallet address of the referrer
 *                 example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *               referreeAddress:
 *                 type: string
 *                 description: The wallet address of the referree
 *                 example: "4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49"
 *               actionType:
 *                 type: string
 *                 description: The type of action performed
 *                 example: "AGENT_CREATION"
 *               actionValue:
 *                 type: number
 *                 description: The value associated with the action (optional)
 *                 example: 100
 *     responses:
 *       200:
 *         description: Reward processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         rewardEvent:
 *                           type: object
 *                           description: The processed reward event
 *                           nullable: true
 *                         processed:
 *                           type: boolean
 *                           description: Whether the reward was successfully processed
 *                           example: true
 *       400:
 *         description: Invalid reward data or ineligible for rewards
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/cleanup/expired-codes:
 *   post:
 *     summary: Clean up expired referral codes (Admin only)
 *     description: Removes expired referral codes from the system. This endpoint requires admin authentication.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     responses:
 *       200:
 *         description: Expired codes cleaned up successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         message:
 *                           type: string
 *                           example: "Cleaned up 5 expired referral codes"
 *                         cleanedCount:
 *                           type: number
 *                           description: Number of expired codes that were cleaned up
 *                           example: 5
 *       401:
 *         description: Unauthorized - Admin authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/cleanup/stats:
 *   get:
 *     summary: Get cleanup statistics (Admin only)
 *     description: Retrieves statistics about the cleanup process, including counts of expired codes and cleanup metrics. This endpoint requires admin authentication.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     responses:
 *       200:
 *         description: Cleanup statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       description: Cleanup statistics data
 *       401:
 *         description: Unauthorized - Admin authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.get(
  '/cleanup/stats',
  adminRateLimiter, // Admin operation
  requireAdminAuth,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const stats = await referralService.getCleanupStats();

    return res.status(200).json(successResponse(stats));
  })
);

/**
 * @swagger
 * /referral/cleanup/extend-expiration:
 *   post:
 *     summary: Extend expiration for a referral code (Admin only)
 *     description: Extends the expiration date for a specific wallet's referral code. This endpoint requires admin authentication.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The Solana wallet address to extend expiration for
 *                 example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *               extensionDays:
 *                 type: number
 *                 description: Number of days to extend the expiration (optional, defaults to 30)
 *                 example: 30
 *                 minimum: 1
 *                 maximum: 365
 *     responses:
 *       200:
 *         description: Expiration extended successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         success:
 *                           type: boolean
 *                           description: Whether the expiration was successfully extended
 *                           example: true
 *                         message:
 *                           type: string
 *                           example: "Expiration extended successfully"
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Admin authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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

/**
 * @swagger
 * /referral/cleanup/regenerate-code:
 *   post:
 *     summary: Regenerate expired referral code (Admin only)
 *     description: Regenerates a new referral code for a wallet that has an expired code. This endpoint requires admin authentication.
 *     tags: [Referral System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The Solana wallet address to regenerate a code for
 *                 example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Code regenerated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         success:
 *                           type: boolean
 *                           description: Whether the code was successfully regenerated
 *                           example: true
 *                         newCode:
 *                           type: string
 *                           description: The newly generated referral code
 *                           example: "XYZ789"
 *                           nullable: true
 *                         message:
 *                           type: string
 *                           example: "Code regenerated successfully"
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Admin authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
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