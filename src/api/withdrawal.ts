import express, { type Request, type Response, type Router } from 'express'
import { ethers } from 'ethers'
import { requireWalletAddress } from '../middleware/auth.ts'
import { errorHandlerAsync } from '../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../middleware/types/errors.ts'
import { ValidationRules, validateBody, validateParams, validateQuery } from '../middleware/validator.ts'
import { createWithdrawalValidationService } from '../services/blockchain/withdrawalValidationService.ts'
import { logger } from "../services/logger.ts"

/**
 * @title Withdrawal Management API
 * @notice Endpoints for validating withdrawals and monitoring pool health
 * @dev Backend validation layer ensuring pool balances remain adequate for allocated farmer rewards
 */

const router: Router = express.Router()

/**
 * @swagger
 * tags:
 *   name: Withdrawal
 *   description: Withdrawal validation and pool health monitoring
 */

/**
 * @swagger
 * /withdrawal/validate:
 *   post:
 *     summary: Validate a withdrawal before execution
 *     description: Checks if a withdrawal would leave sufficient funds for pending farmer claims
 *     tags: [Withdrawal]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - poolAddress
 *               - amount
 *             properties:
 *               poolAddress:
 *                 type: string
 *                 format: hex
 *               amount:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validation result
 *       400:
 *         description: Invalid parameters
 *       403:
 *         description: Not authorized or withdrawal not allowed
 */
router.post(
    '/validate',
    requireWalletAddress,
    validateBody({
        poolAddress: {
            required: true,
            rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
        },
        amount: {
            required: true,
            rules: [ValidationRules.isString()]
        }
    }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { poolAddress, amount } = req.body
        // @ts-expect-error - walletAddress is added by requireWalletAddress middleware
        const userAddress = req.walletAddress.toLowerCase()

        const validationService = createWithdrawalValidationService()

        try {
            // Get pool state
            const poolState = await validationService.getPoolState(poolAddress)

            // Check if user is the creator
            if (poolState.creator.toLowerCase() !== userAddress) {
                throw ApiError.forbidden('Only the pool creator can withdraw funds')
            }

            // Parse amount to wei
            const tokenContract = new ethers.Contract(
                poolState.token,
                ['function decimals() view returns (uint8)'],
                validationService.getProvider()
            )
            const decimals = await tokenContract.decimals()
            const amountWei = ethers.parseUnits(amount, decimals)

            // Validate withdrawal
            const validation = await validationService.validateWithdrawal(poolState, amountWei)

            if (!validation.allowed) {
                return res.status(200).json(
                    successResponse({
                        allowed: false,
                        reason: validation.reason,
                        maxSafeWithdrawal: ethers.formatUnits(validation.maxWithdrawable, decimals),
                        poolState: validationService.formatPoolStateForAPI(poolState)
                    })
                )
            }

            res.status(200).json(
                successResponse({
                    allowed: true,
                    maxSafeWithdrawal: ethers.formatUnits(validation.maxWithdrawable, decimals),
                    safetyBuffer: ethers.formatUnits(validation.safetyBuffer, decimals),
                    poolState: validationService.formatPoolStateForAPI(poolState)
                })
            )
        } catch (error) {
            logger.error('Withdrawal validation error:', error)
            // Re-throw ApiError as-is (preserves status codes like 403)
            if (error instanceof ApiError) {
                throw error
            }
            throw ApiError.internalError(
                `Failed to validate withdrawal: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
        }
    })
)

/**
 * @swagger
 * /withdrawal/pools/{poolAddress}/health:
 *   get:
 *     summary: Get pool health status
 *     description: Returns comprehensive health metrics for a pool including pending claims
 *     tags: [Withdrawal]
 *     parameters:
 *       - in: path
 *         name: poolAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pool health metrics
 *       404:
 *         description: Pool not found
 */
router.get(
    '/pools/:poolAddress/health',
    validateParams({
        poolAddress: {
            required: true,
            rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
        }
    }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { poolAddress } = req.params

        const validationService = createWithdrawalValidationService()

        try {
            const [health, poolState] = await Promise.all([
                validationService.checkPoolHealth(poolAddress),
                validationService.getPoolState(poolAddress)
            ])

            res.status(200).json(
                successResponse({
                    poolAddress,
                    healthy: health.healthy,
                    alerts: health.alerts,
                    metrics: health.metrics,
                    state: validationService.formatPoolStateForAPI(poolState)
                })
            )
        } catch (error) {
            logger.error('Pool health check error:', error)
            throw ApiError.internalError(
                `Failed to check pool health: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
        }
    })
)

/**
 * @swagger
 * /withdrawal/pools/{poolAddress}/max-withdrawal:
 *   get:
 *     summary: Get maximum safe withdrawal amount
 *     description: Calculates the maximum amount that can be safely withdrawn without affecting pending claims
 *     tags: [Withdrawal]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: poolAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Maximum withdrawal amount
 *       403:
 *         description: Not authorized
 */
router.get(
    '/pools/:poolAddress/max-withdrawal',
    requireWalletAddress,
    validateParams({
        poolAddress: {
            required: true,
            rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
        }
    }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { poolAddress } = req.params
        // @ts-expect-error
        const userAddress = req.walletAddress.toLowerCase()

        const validationService = createWithdrawalValidationService()

        try {
            const poolState = await validationService.getPoolState(poolAddress)

            // Check if user is the creator
            if (poolState.creator.toLowerCase() !== userAddress) {
                throw ApiError.forbidden('Only the pool creator can check withdrawal limits')
            }

            // Calculate max safe withdrawal
            const validation = await validationService.validateWithdrawal(poolState, 0n)

            res.status(200).json(
                successResponse({
                    maxSafeWithdrawal: ethers.formatEther(validation.maxWithdrawable),
                    safetyBuffer: ethers.formatEther(validation.safetyBuffer),
                    currentBalance: ethers.formatEther(poolState.balance),
                    pendingClaims: ethers.formatEther(poolState.totalPending),
                    pendingClaimsCount: poolState.allocations.length
                })
            )
        } catch (error) {
            logger.error('Max withdrawal calculation error:', error)
            // Re-throw ApiError as-is (preserves status codes like 403)
            if (error instanceof ApiError) {
                throw error
            }
            throw ApiError.internalError(
                `Failed to calculate max withdrawal: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
        }
    })
)

export { router as withdrawalApi }

