import express, { Request, Response } from 'express';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../middleware/validator.ts';
import { successResponse } from '../../middleware/types/errors.ts';
import { ApiError } from '../../middleware/types/errors.ts';
import { ForgeRaceSubmission } from '../../models/Models.ts';
import { RewardPoolService } from '../../services/blockchain/rewardPool.ts';
import { Connection, Keypair } from '@solana/web3.js';
import { z } from 'zod';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Reward Pool System
 *   description: Smart contract-based reward pool management for task completion rewards and withdrawals
 */

// Initialize reward pool service
const rewardPoolService = RewardPoolService.getInstance(
  new Connection(process.env.RPC_URL || ''),
  process.env.REWARD_POOL_PROGRAM_ID || '11111111111111111111111111111111',
  Keypair.generate(), // TODO: Replace with actual platform authority keypair
  process.env.PLATFORM_TREASURY_ADDRESS
);

// Schema for getting pending rewards
const getPendingRewardsSchema = z.object({
  walletAddress: z.string().min(1)
});

// Schema for withdrawal request
const withdrawRewardsSchema = z.object({
  tokenMints: z.array(z.string()).optional(), // Optional: specific tokens to withdraw
  batchSize: z.number().min(1).max(50).optional() // Optional: max tasks to withdraw
});

// Schema for executing withdrawal
const executeWithdrawalSchema = z.object({
  taskIds: z.array(z.string()),
  expectedNonce: z.number(),
  transactionSignature: z.string(),
  slot: z.number()
});

// Schema for getting farmer account
const getFarmerAccountSchema = z.object({
  walletAddress: z.string().min(1)
});

// Schema for getting platform stats
const getPlatformStatsSchema = z.object({});

// Schema for setting paused state (admin only)
const setPausedSchema = z.object({
  isPaused: z.boolean()
});

/**
 * @swagger
 * /forge/reward-pool/pending-rewards/{walletAddress}:
 *   get:
 *     summary: Get pending rewards for a farmer
 *     description: Retrieves all pending rewards for a specific wallet address that are ready for withdrawal from the smart contract.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get pending rewards for
 *         example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Pending rewards retrieved successfully
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
 *                         totalPending:
 *                           type: number
 *                           description: Total pending reward amount
 *                           example: 1500
 *                         taskCount:
 *                           type: number
 *                           description: Number of completed tasks with pending rewards
 *                           example: 5
 *                         tokenBreakdown:
 *                           type: object
 *                           description: Breakdown of rewards by token mint
 *                           example:
 *                             "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 1000
 *                             "your_clones_token_mint_address_here": 500
 *       403:
 *         description: Forbidden - Can only view your own rewards
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
  '/pending-rewards/:walletAddress',
  requireWalletAddress,
  validateParams(getPendingRewardsSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;
    
    // Verify the user is requesting their own rewards
    // @ts-ignore - Get walletAddress from the request object
    const requestWalletAddress = req.walletAddress;
    if (walletAddress !== requestWalletAddress) {
      throw ApiError.forbidden('Can only view your own rewards');
    }

    try {
      const pendingRewards = await rewardPoolService.getPendingRewards(walletAddress);
      res.status(200).json(successResponse(pendingRewards));
    } catch (error) {
      console.error('Failed to get pending rewards:', error);
      throw ApiError.internal('Failed to retrieve pending rewards');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/farmer-account/{walletAddress}:
 *   get:
 *     summary: Get farmer account data including withdrawal nonce
 *     description: Retrieves the farmer account data from the smart contract, including withdrawal nonce and total rewards earned.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The Solana wallet address to get farmer account for
 *         example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *     responses:
 *       200:
 *         description: Farmer account data retrieved successfully
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
 *                         farmerAddress:
 *                           type: string
 *                           description: The farmer's wallet address
 *                           example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                         withdrawalNonce:
 *                           type: number
 *                           description: Current withdrawal nonce for transaction ordering
 *                           example: 5
 *                         totalRewardsEarned:
 *                           type: number
 *                           description: Total rewards earned by the farmer
 *                           example: 5000
 *                         totalRewardsWithdrawn:
 *                           type: number
 *                           description: Total rewards already withdrawn
 *                           example: 3500
 *                         lastWithdrawalSlot:
 *                           type: number
 *                           description: Slot number of the last withdrawal
 *                           example: 12345678
 *       403:
 *         description: Forbidden - Can only view your own account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Farmer account not found
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
  '/farmer-account/:walletAddress',
  requireWalletAddress,
  validateParams(getFarmerAccountSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { walletAddress } = req.params;
    
    // Verify the user is requesting their own account
    // @ts-ignore - Get walletAddress from the request object
    const requestWalletAddress = req.walletAddress;
    if (walletAddress !== requestWalletAddress) {
      throw ApiError.forbidden('Can only view your own account');
    }

    try {
      const farmerAccount = await rewardPoolService.getFarmerAccount(walletAddress);
      
      if (!farmerAccount) {
        throw ApiError.notFound('Farmer account not found');
      }
      
      res.status(200).json(successResponse(farmerAccount));
    } catch (error) {
      console.error('Failed to get farmer account:', error);
      throw ApiError.internal('Failed to retrieve farmer account');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/withdrawable-tasks:
 *   get:
 *     summary: Get user's completed tasks that are ready for withdrawal
 *     description: Retrieves all completed tasks for the authenticated user that have been recorded in the smart contract but not yet withdrawn.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     responses:
 *       200:
 *         description: Withdrawable tasks retrieved successfully
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
 *                         tasksByToken:
 *                           type: object
 *                           description: Tasks grouped by token mint
 *                           example:
 *                             "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v":
 *                               - taskId: "task_123"
 *                                 rewardAmount: 100
 *                                 platformFeeAmount: 10
 *                                 poolId: "pool_456"
 *                                 createdAt: "2024-01-01T00:00:00.000Z"
 *                                 questTitle: "AI Training Task"
 *                         totalTasks:
 *                           type: number
 *                           description: Total number of withdrawable tasks
 *                           example: 5
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.get(
  '/withdrawable-tasks',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    
    try {
      // Get all completed tasks for the user that haven't been withdrawn
      const withdrawableTasks = await ForgeRaceSubmission.find({
        address: walletAddress,
        'smartContractReward.isRecorded': true,
        'smartContractReward.isWithdrawn': false,
        status: 'COMPLETED'
      }).select('smartContractReward meta createdAt').sort({ createdAt: -1 });
      
      // Group by token mint for easier frontend processing
      const tasksByToken: Record<string, any[]> = {};
      
      withdrawableTasks.forEach(task => {
        if (task.smartContractReward) {
          const tokenMint = task.smartContractReward.tokenMint;
          if (!tasksByToken[tokenMint]) {
            tasksByToken[tokenMint] = [];
          }
          tasksByToken[tokenMint].push({
            taskId: task.smartContractReward.taskId,
            rewardAmount: task.smartContractReward.farmerRewardAmount,
            platformFeeAmount: task.smartContractReward.platformFeeAmount,
            poolId: task.smartContractReward.poolId,
            createdAt: task.createdAt,
            questTitle: task.meta?.quest?.title || 'Unknown Quest'
          });
        }
      });
      
      res.status(200).json(successResponse({
        tasksByToken,
        totalTasks: withdrawableTasks.length
      }));
    } catch (error) {
      console.error('Failed to get withdrawable tasks:', error);
      throw ApiError.internal('Failed to retrieve withdrawable tasks');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/withdrawal-history:
 *   get:
 *     summary: Get user's withdrawal history
 *     description: Retrieves the withdrawal history for the authenticated user, showing all previously withdrawn tasks.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal history retrieved successfully
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
 *                         history:
 *                           type: array
 *                           description: List of withdrawal history items
 *                           items:
 *                             type: object
 *                             properties:
 *                               taskId:
 *                                 type: string
 *                                 example: "task_123"
 *                               rewardAmount:
 *                                 type: number
 *                                 example: 100
 *                               withdrawalSignature:
 *                                 type: string
 *                                 example: "5J7X..."
 *                         totalWithdrawals:
 *                           type: number
 *                           example: 10
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.get(
  '/withdrawal-history',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    
    try {
      // Get all withdrawn tasks for the user
      const withdrawalHistory = await ForgeRaceSubmission.find({
        address: walletAddress,
        'smartContractReward.isWithdrawn': true
      }).select('smartContractReward meta createdAt').sort({ createdAt: -1 }).limit(50);
      
      const history = withdrawalHistory.map(task => ({
        taskId: task.smartContractReward?.taskId,
        rewardAmount: task.smartContractReward?.farmerRewardAmount,
        platformFeeAmount: task.smartContractReward?.platformFeeAmount,
        tokenMint: task.smartContractReward?.tokenMint,
        withdrawalSignature: task.smartContractReward?.withdrawalSignature,
        withdrawalSlot: task.smartContractReward?.withdrawalSlot,
        createdAt: task.createdAt,
        questTitle: task.meta?.quest?.title || 'Unknown Quest'
      }));
      
      res.status(200).json(successResponse({
        history,
        totalWithdrawals: history.length
      }));
    } catch (error) {
      console.error('Failed to get withdrawal history:', error);
      throw ApiError.internal('Failed to retrieve withdrawal history');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/prepare-withdrawal:
 *   post:
 *     summary: Prepare withdrawal transaction
 *     description: Prepares a withdrawal transaction for the smart contract. This endpoint provides the transaction data for the frontend to sign and send.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokenMints:
 *                 type: array
 *                 description: Specific tokens to withdraw (optional)
 *                 items:
 *                   type: string
 *                 example: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]
 *               batchSize:
 *                 type: number
 *                 description: Maximum tasks to withdraw (optional, default 10)
 *                 example: 10
 *     responses:
 *       200:
 *         description: Withdrawal transaction prepared successfully
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
 *                         instructions:
 *                           type: array
 *                           description: Transaction instructions
 *                         signers:
 *                           type: array
 *                           description: Required signers
 *                         feePayer:
 *                           type: string
 *                           example: "E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97"
 *                         recentBlockhash:
 *                           type: string
 *                           example: "5J7X..."
 *                         expectedNonce:
 *                           type: number
 *                           example: 5
 *                         estimatedFee:
 *                           type: number
 *                           example: 5000
 *                         taskCount:
 *                           type: number
 *                           example: 3
 *                         totalRewardAmount:
 *                           type: number
 *                           example: 1500
 *       400:
 *         description: No withdrawable rewards found
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
  '/prepare-withdrawal',
  requireWalletAddress,
  validateBody(withdrawRewardsSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    const { tokenMints, batchSize = 10 } = req.body;
    
    try {
      // Get withdrawable tasks
      const query: any = {
        address: walletAddress,
        'smartContractReward.isRecorded': true,
        'smartContractReward.isWithdrawn': false,
        status: 'COMPLETED'
      };
      
      if (tokenMints && tokenMints.length > 0) {
        query['smartContractReward.tokenMint'] = { $in: tokenMints };
      }
      
      const withdrawableTasks = await ForgeRaceSubmission.find(query)
        .select('smartContractReward')
        .sort({ createdAt: 1 })
        .limit(batchSize);
      
      if (withdrawableTasks.length === 0) {
        throw ApiError.badRequest('No withdrawable rewards found');
      }

      // Get farmer account to get current nonce
      const farmerAccount = await rewardPoolService.getFarmerAccount(walletAddress);
      if (!farmerAccount) {
        throw ApiError.badRequest('Farmer account not found');
      }

      const taskIds = withdrawableTasks.map(task => task.smartContractReward?.taskId).filter(Boolean);
      const tokenMintsFromTasks = [...new Set(withdrawableTasks.map(task => task.smartContractReward?.tokenMint).filter(Boolean))];

      // Prepare withdrawal transaction
      const withdrawalData = await rewardPoolService.prepareWithdrawalTransaction({
        farmerAddress: walletAddress,
        expectedNonce: farmerAccount.withdrawalNonce,
        taskIds,
        tokenMints: tokenMintsFromTasks
      });

      // Calculate totals
      const totalRewardAmount = withdrawableTasks.reduce((sum, task) => 
        sum + (task.smartContractReward?.farmerRewardAmount || 0), 0
      );
      const totalPlatformFee = withdrawableTasks.reduce((sum, task) => 
        sum + (task.smartContractReward?.platformFeeAmount || 0), 0
      );

      const tasks = withdrawableTasks.map(task => ({
        taskId: task.smartContractReward?.taskId,
        rewardAmount: task.smartContractReward?.farmerRewardAmount,
        platformFeeAmount: task.smartContractReward?.platformFeeAmount,
        tokenMint: task.smartContractReward?.tokenMint
      }));
      
      res.status(200).json(successResponse({
        ...withdrawalData,
        taskCount: withdrawableTasks.length,
        totalRewardAmount,
        totalPlatformFee,
        tasks
      }));
    } catch (error) {
      console.error('Failed to prepare withdrawal transaction:', error);
      throw ApiError.internal('Failed to prepare withdrawal transaction');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/execute-withdrawal:
 *   post:
 *     summary: Execute withdrawal transaction
 *     description: Executes the withdrawal transaction on-chain after the frontend has signed and sent the transaction.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - taskIds
 *               - expectedNonce
 *               - transactionSignature
 *               - slot
 *             properties:
 *               taskIds:
 *                 type: array
 *                 description: Array of task IDs to withdraw
 *                 items:
 *                   type: string
 *                 example: ["task_123", "task_456"]
 *               expectedNonce:
 *                 type: number
 *                 description: Expected withdrawal nonce
 *                 example: 5
 *               transactionSignature:
 *                 type: string
 *                 description: Transaction signature from the blockchain
 *                 example: "5J7X..."
 *               slot:
 *                 type: number
 *                 description: Transaction slot number
 *                 example: 12345678
 *     responses:
 *       200:
 *         description: Withdrawal executed successfully
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
 *                           example: "Withdrawal executed successfully"
 *                         updatedTasks:
 *                           type: number
 *                           example: 3
 *                         transactionSignature:
 *                           type: string
 *                           example: "5J7X..."
 *                         slot:
 *                           type: number
 *                           example: 12345678
 *       400:
 *         description: Invalid withdrawal data or tasks not found
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
  '/execute-withdrawal',
  requireWalletAddress,
  validateBody(executeWithdrawalSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    const { taskIds, expectedNonce, transactionSignature, slot } = req.body;
    
    try {
      // Verify the tasks belong to the user
      const tasks = await ForgeRaceSubmission.find({
        address: walletAddress,
        'smartContractReward.taskId': { $in: taskIds },
        'smartContractReward.isWithdrawn': false
      });

      if (tasks.length !== taskIds.length) {
        throw ApiError.badRequest('Some tasks not found or already withdrawn');
      }

      // Get the token mint from the first task (all should be the same for batch withdrawal)
      const tokenMint = tasks[0].smartContractReward?.tokenMint;
      if (!tokenMint) {
        throw ApiError.badRequest('Invalid task data');
      }

      // Verify all tasks have the same token mint
      const allSameToken = tasks.every(task => task.smartContractReward?.tokenMint === tokenMint);
      if (!allSameToken) {
        throw ApiError.badRequest('All tasks must have the same token mint for batch withdrawal');
      }

      // Get platform treasury address
      const platformTreasuryAddress = process.env.PLATFORM_TREASURY_ADDRESS;
      if (!platformTreasuryAddress) {
        throw ApiError.internal('Platform treasury address not configured');
      }

      // Execute withdrawal on-chain
      const result = await rewardPoolService.executeWithdrawal(
        taskIds,
        expectedNonce,
        Keypair.generate(), // TODO: Get actual farmer keypair
        tokenMint,
        platformTreasuryAddress
      );

      // Update all tasks as withdrawn
      const updateResult = await ForgeRaceSubmission.updateMany(
        {
          address: walletAddress,
          'smartContractReward.taskId': { $in: taskIds },
          'smartContractReward.isWithdrawn': false
        },
        {
          $set: {
            'smartContractReward.isWithdrawn': true,
            'smartContractReward.withdrawalSignature': result.signature,
            'smartContractReward.withdrawalSlot': result.slot
          }
        }
      );
      
      if (updateResult.modifiedCount === 0) {
        throw ApiError.badRequest('No tasks were updated. They may have already been withdrawn.');
      }
      
      res.status(200).json(successResponse({
        message: 'Withdrawal executed successfully',
        updatedTasks: updateResult.modifiedCount,
        transactionSignature: result.signature,
        slot: result.slot
      }));
    } catch (error) {
      console.error('Failed to execute withdrawal:', error);
      throw ApiError.internal('Failed to execute withdrawal');
    }
  })
);

/**
 * Confirm withdrawal (mark tasks as withdrawn after successful transaction)
 * POST /api/forge/reward-pool/confirm-withdrawal
 * @deprecated Use execute-withdrawal instead
 */
router.post(
  '/confirm-withdrawal',
  requireWalletAddress,
  validateBody(z.object({
    taskIds: z.array(z.string()),
    transactionSignature: z.string(),
    slot: z.number()
  })),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    const { taskIds, transactionSignature, slot } = req.body;
    
    try {
      // Update all tasks as withdrawn
      const updateResult = await ForgeRaceSubmission.updateMany(
        {
          address: walletAddress,
          'smartContractReward.taskId': { $in: taskIds },
          'smartContractReward.isWithdrawn': false
        },
        {
          $set: {
            'smartContractReward.isWithdrawn': true,
            'smartContractReward.withdrawalSignature': transactionSignature,
            'smartContractReward.withdrawalSlot': slot
          }
        }
      );
      
      if (updateResult.modifiedCount === 0) {
        throw ApiError.badRequest('No tasks were updated. They may have already been withdrawn.');
      }
      
      res.status(200).json(successResponse({
        message: 'Withdrawal confirmed successfully',
        updatedTasks: updateResult.modifiedCount,
        transactionSignature,
        slot
      }));
    } catch (error) {
      console.error('Failed to confirm withdrawal:', error);
      throw ApiError.internal('Failed to confirm withdrawal');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/platform-stats:
 *   get:
 *     summary: Get platform statistics
 *     description: Retrieves platform-wide statistics from the reward pool smart contract, including total rewards distributed and platform fees collected.
 *     tags: [Reward Pool System]
 *     responses:
 *       200:
 *         description: Platform statistics retrieved successfully
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
 *                         totalRewardsDistributed:
 *                           type: number
 *                           description: Total rewards distributed to farmers
 *                           example: 50000
 *                         totalPlatformFeesCollected:
 *                           type: number
 *                           description: Total platform fees collected
 *                           example: 5000
 *                         isPaused:
 *                           type: boolean
 *                           description: Whether the reward pool is paused
 *                           example: false
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.get(
  '/platform-stats',
  validateParams(getPlatformStatsSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    try {
      const stats = await rewardPoolService.getPlatformStats();
      res.status(200).json(successResponse(stats));
    } catch (error) {
      console.error('Failed to get platform stats:', error);
      throw ApiError.internal('Failed to retrieve platform statistics');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/set-paused:
 *   post:
 *     summary: Set paused state (admin only)
 *     description: Pauses or unpauses the reward pool system. This endpoint requires admin privileges.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isPaused
 *             properties:
 *               isPaused:
 *                 type: boolean
 *                 description: Whether to pause or unpause the reward pool
 *                 example: true
 *     responses:
 *       200:
 *         description: Paused state updated successfully
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
 *                           example: "Reward pool paused successfully"
 *                         signature:
 *                           type: string
 *                           example: "5J7X..."
 *                         slot:
 *                           type: number
 *                           example: 12345678
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.post(
  '/set-paused',
  requireWalletAddress,
  validateBody(setPausedSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    const { isPaused } = req.body;
    
    // TODO: Add admin authorization check
    // For now, allow any authenticated user (should be restricted to admins)
    
    try {
      const result = await rewardPoolService.setPaused(isPaused);
      res.status(200).json(successResponse({
        message: `Reward pool ${isPaused ? 'paused' : 'unpaused'} successfully`,
        signature: result.signature,
        slot: result.slot
      }));
    } catch (error) {
      console.error('Failed to set paused state:', error);
      throw ApiError.internal('Failed to update paused state');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/create-vault:
 *   post:
 *     summary: Create reward vault for a token
 *     description: Creates a new reward vault for a specific token mint. This endpoint requires admin privileges.
 *     tags: [Reward Pool System]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokenMint
 *             properties:
 *               tokenMint:
 *                 type: string
 *                 description: The token mint address to create a vault for
 *                 example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
 *     responses:
 *       200:
 *         description: Reward vault created successfully
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
 *                           example: "Reward vault created successfully"
 *                         tokenMint:
 *                           type: string
 *                           example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
 *                         signature:
 *                           type: string
 *                           example: "5J7X..."
 *                         slot:
 *                           type: number
 *                           example: 12345678
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.post(
  '/create-vault',
  requireWalletAddress,
  validateBody(z.object({
    tokenMint: z.string().min(1)
  })),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    const { tokenMint } = req.body;
    
    // TODO: Add admin authorization check
    // For now, allow any authenticated user (should be restricted to admins)
    
    try {
      const result = await rewardPoolService.createRewardVault(tokenMint);
      res.status(200).json(successResponse({
        message: 'Reward vault created successfully',
        tokenMint,
        signature: result.signature,
        slot: result.slot
      }));
    } catch (error) {
      console.error('Failed to create reward vault:', error);
      throw ApiError.internal('Failed to create reward vault');
    }
  })
);

/**
 * @swagger
 * /forge/reward-pool/vault-balance/{tokenMint}:
 *   get:
 *     summary: Get reward vault balance
 *     description: Retrieves the current balance of a specific token in the reward vault.
 *     tags: [Reward Pool System]
 *     parameters:
 *       - in: path
 *         name: tokenMint
 *         required: true
 *         schema:
 *           type: string
 *         description: The token mint address to get balance for
 *         example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
 *     responses:
 *       200:
 *         description: Vault balance retrieved successfully
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
 *                         tokenMint:
 *                           type: string
 *                           example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
 *                         balance:
 *                           type: number
 *                           description: Current balance in the vault
 *                           example: 10000
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.get(
  '/vault-balance/:tokenMint',
  validateParams(z.object({
    tokenMint: z.string().min(1)
  })),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { tokenMint } = req.params;
    
    try {
      const balance = await rewardPoolService.getRewardVaultBalance(tokenMint);
      res.status(200).json(successResponse({
        tokenMint,
        balance
      }));
    } catch (error) {
      console.error('Failed to get vault balance:', error);
      throw ApiError.internal('Failed to retrieve vault balance');
    }
  })
);

export default router; 