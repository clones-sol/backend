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
  applySponsorCodeSchema,
  extendExpirationSchema,
  regenerateCodeSchema,
  walletAddressParamSchema
} from './schemas/referral.ts';
import { requireWalletAddress } from '../middleware/auth.ts';

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
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                           description: The date and time the code was created
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
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// Generate referral code for a wallet
router.post(
  '/generate-code',
  sensitiveRateLimiter,
  requireWalletAddress,
  validateBody(generateCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {

    interface RequestWithWalletAddress extends Request {
      walletAddress: string;
    }
    const { walletAddress } = req.body;
    if ((req as RequestWithWalletAddress).walletAddress !== walletAddress) {
      throw ApiError.forbidden('You can only generate a referral code for your own wallet.');
    }

    const referralCodeData = await referralService.generateReferralCode(walletAddress);
    const referralLink = `${process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL}/ref/${referralCodeData.referralCode
      }`;
    res.status(200).json(
      successResponse({
        referralCode: referralCodeData.referralCode,
        createdAt: referralCodeData.createdAt,
        referralLink,
        walletAddress
      })
    );
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
 * /referral/apply-sponsor-code:
 *   post:
 *     summary: Apply a sponsor code
 *     description: Applies a sponsor code to create a referral relationship. This establishes the connection between referrer and referree.
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
 *               - referreeAddress
 *               - referralCode
 *             properties:
 *               referreeAddress:
 *                 type: string
 *                 description: The wallet address of the person being referred (referree)
 *                 example: "4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49"
 *               referralCode:
 *                 type: string
 *                 description: The referral code used
 *                 example: "ABC123"
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
  '/apply-sponsor-code',
  sensitiveRateLimiter, // Sensitive operation - creating referrals
  validateBody(applySponsorCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const {
      referreeAddress,
      referralCode
    } = req.body;

    const referrerAddress = await referralService.validateReferralCode(referralCode);

    if (!referrerAddress) {
      throw ApiError.badRequest('Invalid or expired referral code.');
    }

    if (referrerAddress === referreeAddress) {
      throw ApiError.badRequest('You cannot refer yourself.');
    }

    const referral = await referralService.createReferral(
      referrerAddress,
      referreeAddress,
      referralCode
    );

    if (!referral._id) {
      console.error('Referral creation failed: Missing _id');
      throw ApiError.internalError('Failed to create referral: Missing _id');
    }

    return res.status(201).json(successResponse({
      referralId: referral._id,
      referrerAddress: referral.referrerAddress,
      referreeAddress: referral.referreeAddress
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
 *                         referralInfo:
 *                           type: object
 *                           nullable: true
 *                           description: Information about the user's referral code.
 *                           properties:
 *                             walletAddress:
 *                               type: string
 *                             referralCode:
 *                               type: string
 *                             isActive:
 *                               type: boolean
 *                             totalReferrals:
 *                               type: number
 *                             totalRewards:
 *                               type: number
 *                             createdAt:
 *                               type: string
 *                               format: date-time
 *                             expiresAt:
 *                               type: string
 *                               format: date-time
 *                         referrals:
 *                           type: array
 *                           description: List of users referred by this wallet.
 *                           items:
 *                             type: object
 *                             properties:
 *                               referreeAddress:
 *                                 type: string
 *                               status:
 *                                 type: string
 *                               createdAt:
 *                                 type: string
 *                                 format: date-time
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