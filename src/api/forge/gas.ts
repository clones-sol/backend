import express, { Request, Response, Router } from 'express';
import { ApiError, successResponse } from '../../middleware/types/errors.ts';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { validateBody, validateQuery } from '../../middleware/validator.ts';
import { createGasEstimationService } from '../../services/blockchain/gasEstimationService.ts';
import {
    estimateGasSchema,
    analyzeGasSchema,
    optimizeBatchSchema,
    gasAdviceSchema
} from '../schemas/forgeGas.ts';

const router: Router = express.Router();

/**
 * @swagger
 * tags:
 *   name: ForgeGas
 *   description: Gas estimation and optimization for claims
 */

/**
 * @swagger
 * /forge/gas/estimate:
 *   post:
 *     summary: Estimate gas cost for batch claims
 *     tags: [ForgeGas]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               claims:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: An array of claim objects.
 *               fromAddress:
 *                 type: string
 *                 description: The wallet address initiating the claim.
 *             required:
 *               - claims
 *               - fromAddress
 *     responses:
 *       '200':
 *         description: Gas estimate returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '500':
 *         description: Internal server error.
 */
router.post(
    '/estimate',
    requireWalletAddress,
    validateBody(estimateGasSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { claims, fromAddress } = req.body;

        try {
            const gasService = createGasEstimationService();
            const gasEstimate = await gasService.estimateBatchClaimGas(claims, fromAddress);

            res.status(200).json(successResponse({
                gasEstimate,
                claimCount: claims.length
            }));
        } catch (error) {
            console.error('Gas estimation failed:', error);
            throw ApiError.internalError(`Gas estimation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    })
);

/**
 * @swagger
 * /forge/gas/analyze:
 *   post:
 *     summary: Analyze gas cost vs. reward
 *     tags: [ForgeGas]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               claims:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: An array of claim objects.
 *               fromAddress:
 *                 type: string
 *                 description: The wallet address initiating the claim.
 *               tokenPriceUsd:
 *                 type: number
 *                 description: The USD price of the reward token.
 *                 default: 1
 *             required:
 *               - claims
 *               - fromAddress
 *     responses:
 *       '200':
 *         description: Gas analysis returned successfully.
 *       '500':
 *         description: Internal server error.
 */
router.post(
    '/analyze',
    requireWalletAddress,
    validateBody(analyzeGasSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { claims, fromAddress, tokenPriceUsd = 1 } = req.body;

        try {
            const gasService = createGasEstimationService();
            const analysis = await gasService.analyzeClaimGasCost(claims, fromAddress, tokenPriceUsd);

            res.status(200).json(successResponse({
                analysis,
                claimCount: claims.length
            }));
        } catch (error) {
            console.error('Gas analysis failed:', error);
            throw ApiError.internalError(`Gas analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    })
);

/**
 * @swagger
 * /forge/gas/optimize:
 *   post:
 *     summary: Optimize batch size for gas efficiency
 *     tags: [ForgeGas]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               claims:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: An array of claim objects.
 *               fromAddress:
 *                 type: string
 *                 description: The wallet address initiating the claim.
 *               maxGasCostUsd:
 *                 type: number
 *                 description: The maximum gas cost in USD for a batch.
 *                 default: 50
 *             required:
 *               - claims
 *               - fromAddress
 *     responses:
 *       '200':
 *         description: Batch optimization details returned successfully.
 *       '500':
 *         description: Internal server error.
 */
router.post(
    '/optimize',
    requireWalletAddress,
    validateBody(optimizeBatchSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { claims, fromAddress, maxGasCostUsd = 50 } = req.body;

        try {
            const gasService = createGasEstimationService();
            const optimization = await gasService.optimizeBatchSize(claims, fromAddress, maxGasCostUsd);

            res.status(200).json(successResponse({
                optimization,
                originalClaimCount: claims.length,
                optimizedBatchCount: optimization.optimizedBatches.length
            }));
        } catch (error) {
            console.error('Batch optimization failed:', error);
            throw ApiError.internalError(`Batch optimization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    })
);

/**
 * @swagger
 * /forge/gas/advice:
 *   get:
 *     summary: Get gas price advice
 *     tags: [ForgeGas]
 *     responses:
 *       '200':
 *         description: Gas advice returned successfully.
 *       '500':
 *         description: Internal server error.
 */
router.get(
    '/advice',
    validateQuery(gasAdviceSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        try {
            const gasService = createGasEstimationService();
            const advice = await gasService.getGasOptimizationAdvice();

            res.status(200).json(successResponse({
                advice,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.error('Gas advice failed:', error);
            throw ApiError.internalError(`Gas advice failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    })
);

export { router as forgeGasApi };