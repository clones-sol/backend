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

// Initialize reward pool service
const rewardPoolService = new RewardPoolService(
  new Connection(process.env.RPC_URL || ''),
  process.env.REWARD_POOL_PROGRAM_ID || '11111111111111111111111111111111',
  Keypair.generate() // TODO: Replace with actual platform authority keypair
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
 * Get pending rewards for a farmer
 * GET /api/forge/reward-pool/pending-rewards/:walletAddress
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
      throw ApiError.forbidden('Can only view your own pending rewards');
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
 * Get farmer account data including withdrawal nonce
 * GET /api/forge/reward-pool/farmer-account/:walletAddress
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
 * Get platform statistics (public endpoint)
 * GET /api/forge/reward-pool/platform-stats
 */
router.get(
  '/platform-stats',
  errorHandlerAsync(async (req: Request, res: Response) => {
    try {
      const platformStats = await rewardPoolService.getPlatformStats();
      
      res.status(200).json(successResponse(platformStats));
    } catch (error) {
      console.error('Failed to get platform stats:', error);
      throw ApiError.internal('Failed to retrieve platform statistics');
    }
  })
);

/**
 * Get user's completed tasks that are ready for withdrawal
 * GET /api/forge/reward-pool/withdrawable-tasks
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
 * Get user's withdrawal history
 * GET /api/forge/reward-pool/withdrawal-history
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
 * Withdraw rewards (initiate withdrawal transaction)
 * POST /api/forge/reward-pool/withdraw
 * Note: This endpoint provides the transaction data for the frontend to sign and send
 */
router.post(
  '/withdraw',
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
      
      // TODO: Implement actual smart contract withdrawal transaction
      // For now, return mock transaction data
      const mockTransactionData = {
        instructions: [],
        signers: [],
        feePayer: walletAddress,
        recentBlockhash: 'mock_blockhash',
        estimatedFee: 5000 // 0.005 SOL
      };
      
      res.status(200).json(successResponse({
        transactionData: mockTransactionData,
        taskCount: withdrawableTasks.length,
        totalRewardAmount: withdrawableTasks.reduce((sum, task) => 
          sum + (task.smartContractReward?.farmerRewardAmount || 0), 0
        ),
        totalPlatformFee: withdrawableTasks.reduce((sum, task) => 
          sum + (task.smartContractReward?.platformFeeAmount || 0), 0
        ),
        tasks: withdrawableTasks.map(task => ({
          taskId: task.smartContractReward?.taskId,
          rewardAmount: task.smartContractReward?.farmerRewardAmount,
          platformFeeAmount: task.smartContractReward?.platformFeeAmount,
          tokenMint: task.smartContractReward?.tokenMint
        }))
      }));
    } catch (error) {
      console.error('Failed to prepare withdrawal transaction:', error);
      throw ApiError.internal('Failed to prepare withdrawal transaction');
    }
  })
);

/**
 * Confirm withdrawal (mark tasks as withdrawn after successful transaction)
 * POST /api/forge/reward-pool/confirm-withdrawal
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
 * Set paused state (admin only)
 * POST /api/forge/reward-pool/set-paused
 */
router.post(
  '/set-paused',
  requireWalletAddress,
  validateBody(setPausedSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const walletAddress = req.walletAddress;
    const { isPaused } = req.body;
    
    // TODO: Add admin check
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

export default router; 