import express, { type Request, type Response } from 'express'
import { requireAdminAuth, requireWalletAddress } from '../middleware/auth.ts'
import { authRateLimit, generalRateLimit, strictRateLimit } from '../middleware/rateLimiter.ts'
import { errorHandlerAsync } from '../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../middleware/types/errors.ts'
import type { AuthenticatedRequest } from '../middleware/types/request.ts'
import { ValidationRules, validateBody, validateParams } from '../middleware/validator.ts'
import { ReferralModel } from '../models/Referral.ts'
import { referralService } from '../services/referral/index.ts'
import {
  applyReferrerCodeSchema,
  extendExpirationSchema,
  generateCodeSchema,
  regenerateCodeSchema
} from './schemas/referral.ts'

const router = express.Router()

const isEvmAddressRule = ValidationRules.isEVMAddress()


/**
 * @swagger
 * tags:
 *   name: Referral System
 *   description: Referral system management endpoints for tracking and rewarding user referrals
 */

/**
 * @swagger
 * /referral/generate-code:
 *   post:
 *     summary: Generate a new referral code for a wallet
 *     description: Creates a unique referral code for the specified EVM wallet address. This code can be shared with others to track referrals.
 *     tags: [Referral System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress]
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The EVM wallet address to generate a referral code for
 *                 example: "0x12cA1c2bB28E7B8B0E1b3bB6C2f60E9a6D6d5A12"
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
 *                           example: "ABC123"
 *                         walletAddress:
 *                           type: string
 *                           example: "0x12cA1c2bB28E7B8B0E1b3bB6C2f60E9a6D6d5A12"
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/generate-code',
  strictRateLimit,
  requireWalletAddress,
  validateBody(generateCodeSchema),
  errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { walletAddress } = req.body
    if (String(req.walletAddress).toLowerCase() !== String(walletAddress).toLowerCase())
      throw ApiError.forbidden('You can only generate a referral code for your own wallet.')

    const referralCodeData = await referralService.generateReferralCode(walletAddress)
    res.status(200).json(
      successResponse({
        referralCode: referralCodeData.referralCode,
        createdAt: referralCodeData.createdAt,
        walletAddress
      })
    )
  })
)

/**
 * @swagger
 * /referral/code/{walletAddress}:
 *   get:
 *     summary: Get referral code information for a wallet
 *     description: Retrieves the referral code and associated statistics for a specific EVM wallet address.
 *     tags: [Referral System]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema: { type: string }
 *         description: The EVM wallet address to get referral code for
 *         example: "0x12cA1c2bB28E7B8B0E1b3bB6C2f60E9a6D6d5A12"
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
 *                         referralCode: { type: string, example: "ABC123" }
 *                         walletAddress: { type: string, example: "0x12cA..." }
 *                         totalReferrals: { type: number, example: 5 }
 *                         totalRewards: { type: number, example: 150 }
 *                         isActive: { type: boolean, example: true }
 *                         referrer:
 *                           type: object
 *                           nullable: true
 *                           properties:
 *                             walletAddress: { type: string, example: "0x5fC1..." }
 *                             referralCode: { type: string, example: "REFER1" }
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  '/code/:walletAddress',
  generalRateLimit,
  validateParams({
    walletAddress: { required: true, rules: [isEvmAddressRule] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params
    const referralCode = await referralService.getReferralCode(walletAddress)
    if (!referralCode) throw ApiError.notFound('Referral code not found for this wallet')

    const [referrerInfo, totalReferrals] = await Promise.all([
      referralService.getReferrer(walletAddress),
      ReferralModel.countDocuments({ referrerAddress: walletAddress })
    ])

    const referrer = referrerInfo
      ? {
        walletAddress: referrerInfo.walletAddress,
        referralCode: referrerInfo.referralCode
      }
      : null

    return res.status(200).json(
      successResponse({
        referralCode: referralCode.referralCode,
        walletAddress: referralCode.walletAddress,
        totalReferrals,
        totalRewards: referralCode.totalRewards,
        isActive: referralCode.isActive,
        referrer
      })
    )
  })
)

/**
 * @swagger
 * /referral/apply-referrer-code:
 *   post:
 *     summary: Apply a referrer code
 *     description: Applies a referrer code to create a referral relationship (referrer → referree).
 *     tags: [Referral System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [referreeAddress, referralCode]
 *             properties:
 *               referreeAddress:
 *                 type: string
 *                 description: The EVM wallet address of the person being referred
 *                 example: "0x5fC1B4c0235D2F9cd79F2B59b4E2Df8A5c3b1E22"
 *               referralCode:
 *                 type: string
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
 *                         referralId: { type: string, example: "507f1f77bcf86cd799439011" }
 *                         referrerAddress: { type: string, example: "0x12cA1..." }
 *                         referreeAddress: { type: string, example: "0x5fC1..." }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/apply-referrer-code',
  strictRateLimit,
  validateBody(applyReferrerCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { referreeAddress, referralCode } = req.body

    const referrerAddress = await referralService.validateReferralCode(referralCode)
    if (!referrerAddress) throw ApiError.badRequest('Invalid or expired referrer code.')

    const referral = await referralService.createReferral(
      referrerAddress,
      referreeAddress,
      referralCode
    )
    if (!referral._id) throw ApiError.internalError('Failed to create referrer relationship: Missing _id')

    return res.status(201).json(
      successResponse({
        referralId: referral._id,
        referrerAddress: referral.referrerAddress,
        referreeAddress: referral.referreeAddress
      })
    )
  })
)

/**
 * @swagger
 * /referral/stats/{walletAddress}:
 *   get:
 *     summary: Get referral statistics for a wallet
 *     description: Retrieves comprehensive referral statistics for a specific EVM wallet address.
 *     tags: [Referral System]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema: { type: string }
 *         description: The EVM wallet address to get statistics for
 *         example: "0x12cA1c2bB28E7B8B0E1b3bB6C2f60E9a6D6d5A12"
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
 *                       description: Referral statistics data
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  '/stats/:walletAddress',
  generalRateLimit,
  validateParams({
    walletAddress: { required: true, rules: [isEvmAddressRule] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params
    const stats = await referralService.getReferralStats(walletAddress)
    return res.status(200).json(successResponse(stats))
  })
)

/**
 * @swagger
 * /referral/referred/{walletAddress}:
 *   get:
 *     summary: Check if a wallet has been referred
 *     description: Checks whether a specific EVM wallet address has been referred and returns the referrer info if applicable.
 *     tags: [Referral System]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema: { type: string }
 *         description: The EVM wallet address to check
 *         example: "0x5fC1B4c0235D2F9cd79F2B59b4E2Df8A5c3b1E22"
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
 *                         hasBeenReferred: { type: boolean, example: true }
 *                         referrer:
 *                           type: object
 *                           nullable: true
 *                           properties:
 *                             walletAddress: { type: string, example: "0x12cA1..." }
 *                             referralCode: { type: string, example: "ABC123" }
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  '/referred/:walletAddress',
  generalRateLimit,
  validateParams({
    walletAddress: { required: true, rules: [isEvmAddressRule] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params
    const hasBeenReferred = await referralService.hasBeenReferred(walletAddress)
    const referrer = hasBeenReferred ? await referralService.getReferrer(walletAddress) : null
    return res.status(200).json(successResponse({ hasBeenReferred, referrer }))
  })
)

/**
 * @swagger
 * /referral/referrer/{walletAddress}:
 *   get:
 *     summary: Get referrer information for a wallet
 *     description: Retrieves the referrer information for a specific EVM wallet address that has been referred.
 *     tags: [Referral System]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema: { type: string }
 *         description: The EVM wallet address to get referrer for
 *         example: "0x12cA1c2bB28E7B8B0E1b3bB6C2f60E9a6D6d5A12"
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
 *                             walletAddress: { type: string, example: "0x12cA1..." }
 *                             referralCode: { type: string, example: "ABC123" }
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  '/referrer/:walletAddress',
  generalRateLimit,
  validateParams({
    walletAddress: { required: true, rules: [isEvmAddressRule] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params
    const referrer = await referralService.getReferrer(walletAddress)
    if (!referrer) throw ApiError.notFound('No referrer found for this wallet')
    return res.status(200).json(successResponse({ referrer }))
  })
)

/**
 * @swagger
 * /referral/cleanup/expired-codes:
 *   post:
 *     summary: Clean up expired referral codes (Admin only)
 *     description: Removes expired referral codes from the system. Requires admin authentication.
 *     tags: [Referral System]
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
 *                         message: { type: string, example: "Cleaned up 5 expired referral codes" }
 *                         cleanedCount: { type: number, example: 5 }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/cleanup/expired-codes',
  authRateLimit,
  requireAdminAuth,
  errorHandlerAsync(async (_req: Request, res: Response) => {
    const cleanedCount = await referralService.cleanupExpiredCodes()
    return res.status(200).json(
      successResponse({
        message: `Cleaned up ${cleanedCount} expired referral codes`,
        cleanedCount
      })
    )
  })
)

/**
 * @swagger
 * /referral/cleanup/stats:
 *   get:
 *     summary: Get cleanup statistics (Admin only)
 *     description: Retrieves statistics about the cleanup process. Requires admin authentication.
 *     tags: [Referral System]
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
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  '/cleanup/stats',
  authRateLimit,
  requireAdminAuth,
  errorHandlerAsync(async (_req: Request, res: Response) => {
    const stats = await referralService.getCleanupStats()
    return res.status(200).json(successResponse(stats))
  })
)

/**
 * @swagger
 * /referral/cleanup/extend-expiration:
 *   post:
 *     summary: Extend expiration for a referral code (Admin only)
 *     description: Extends the expiration date for a specific wallet's referral code. Requires admin authentication.
 *     tags: [Referral System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress]
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The EVM wallet address to extend expiration for
 *                 example: "0x12cA1..."
 *               extensionDays:
 *                 type: number
 *                 description: Number of days to extend (default 30)
 *                 example: 30
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
 *                         success: { type: boolean, example: true }
 *                         message: { type: string, example: "Expiration extended successfully" }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/cleanup/extend-expiration',
  authRateLimit,
  validateBody(extendExpirationSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress, extensionDays } = req.body
    const success = await referralService.extendExpiration(walletAddress, extensionDays || 30)
    return res.status(200).json(
      successResponse({
        success,
        message: success ? 'Expiration extended successfully' : 'Failed to extend expiration'
      })
    )
  })
)

/**
 * @swagger
 * /referral/cleanup/regenerate-code:
 *   post:
 *     summary: Regenerate expired referral code (Admin only)
 *     description: Regenerates a new referral code for a wallet with an expired code. Requires admin authentication.
 *     tags: [Referral System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress]
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The EVM wallet address to regenerate a code for
 *                 example: "0x5fC1..."
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
 *                         success: { type: boolean, example: true }
 *                         newCode: { type: string, nullable: true, example: "XYZ789" }
 *                         message: { type: string, example: "Code regenerated successfully" }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/cleanup/regenerate-code',
  authRateLimit,
  validateBody(regenerateCodeSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.body
    const newCode = await referralService.regenerateExpiredCode(walletAddress)
    return res.status(200).json(
      successResponse({
        success: !!newCode,
        newCode,
        message: newCode ? 'Code regenerated successfully' : 'Failed to regenerate code'
      })
    )
  })
)

export { router as referralApi }
