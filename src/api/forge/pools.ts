const router: Router = express.Router();
import express, { Request, Response, Router } from 'express';
import { ApiError, successResponse } from '../../middleware/types/errors.ts';
import { generateAppsForPool, updatePoolStatus } from '../../services/forge/index.ts';
import { ForgeAppModel, ForgeRaceSubmission, TrainingPoolModel } from '../../models/Models.ts';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { validateBody, validateQuery, validateParams } from '../../middleware/validator.ts';
import {
  createPoolSchema,
  getPoolByIdSchema,
  refreshPoolSchema,
  rewardQuerySchema,
  updatePoolSchema,
  withdrawSplSchema,
  withdrawSolSchema
} from '../schemas/forge.ts';
import {
  CreatePoolBody,
  DBTrainingPool,
  TrainingPoolStatus,
  UpdatePoolBody
} from '../../types/index.ts';
import { Keypair } from '@solana/web3.js';
import { Webhook } from '../../services/webhook/index.ts';
import { decrypt, encrypt } from '../../services/security/crypto.ts';
import { getTokenAddress, getSupportedTokenSymbols, supportedTokens } from '../../services/blockchain/tokens.ts';
import BlockchainService from '../../services/blockchain/index.ts';

const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');

// set up the discord webhook
const FORGE_WEBHOOK = process.env.GYM_FORGE_WEBHOOK;
const webhook = new Webhook(FORGE_WEBHOOK);

// Get supported tokens
router.get(
  '/supportedTokens',
  errorHandlerAsync(async (req: Request, res: Response) => {
    // Return only symbol and name
    const tokens = Object.entries(supportedTokens).map(([symbol, { name }]) => ({
      symbol,
      name
    }));
    res.status(200).json(successResponse(tokens));
  })
);

// Refresh pool balance
router.post(
  '/refresh',
  requireWalletAddress,
  validateBody(refreshPoolSchema),
  errorHandlerAsync(async (req: Request<{}, {}, { id: string }>, res: Response) => {
    const { id } = req.body;

    const pool = await TrainingPoolModel.findById(id);
    if (!pool) {
      throw ApiError.notFound('Training pool not found');
    }

    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    // Verify that the pool belongs to the user
    if (pool.ownerAddress !== address) {
      throw ApiError.forbidden('Not authorized to refresh this pool');
    }

    const { solBalance } = await updatePoolStatus(pool);

    // Get demonstration count
    const demoCount = await ForgeRaceSubmission.countDocuments({
      'meta.quest.pool_id': pool._id.toString()
    });

    // Return pool without private key but with demo count and noGas flag
    const { depositPrivateKey: _, ...poolObj } = pool.toObject();
    res.status(200).json(
      successResponse({
        ...poolObj,
        demonstrations: demoCount,
        solBalance
      })
    );
  })
);

// Get all training pools for user
router.get(
  '/',
  requireWalletAddress,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    const pools = await TrainingPoolModel.find({ ownerAddress: address }).select(
      '-depositPrivateKey'
    ); // Exclude private key from response

    // Get demonstration counts for each pool
    const poolsWithDemos = await Promise.all(
      pools.map(async (pool) => {
        const demoCount = await ForgeRaceSubmission.countDocuments({
          'meta.quest.pool_id': pool._id.toString()
        });

        const { solBalance, funds: tokenBalance } = await updatePoolStatus(pool);

        const poolObj = pool.toObject();
        return {
          ...poolObj,
          demonstrations: demoCount,
          solBalance,
          tokenBalance
        };
      })
    );

    res.status(200).json(successResponse(poolsWithDemos));
  })
);

// Get reward calculation
// todo: this needs to be updated for the new reward system
router.get(
  '/reward',
  validateQuery(rewardQuerySchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { poolId } = req.query;

    // Get the pool to check pricePerDemo
    const pool = await TrainingPoolModel.findById(poolId);
    if (!pool) {
      throw ApiError.notFound('Pool not found');
    }

    // Check if pool has enough funds for at least one demo
    if (pool.funds < pool.pricePerDemo) {
      throw ApiError.paymentRequired('Pool has insufficient funds');
    }

    // Round time down to last minute
    const currentTime = Math.floor(Date.now() / 60000) * 60000;
    // Create hash using poolId + address + time + secret
    // const hash = createHash('sha256')
    //   .update(`${poolId}${address}${currentTime}${process.env.IPC_SECRET}`)
    //   .digest('hex');
    // // Convert first 8 chars of hash to number between 0-1
    // const rng = parseInt(hash.slice(0, 8), 16) / 0xffffffff;

    // Use pricePerDemo as the base reward value
    const reward = pool.pricePerDemo;

    res.status(200).json(
      successResponse({
        time: currentTime,
        maxReward: reward,
        pricePerDemo: pool.pricePerDemo
      })
    );
  })
);

// Get a single training pool by ID
router.get(
  '/:id',
  requireWalletAddress,
  validateParams(getPoolByIdSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;
    const { id } = req.params;

    const pool = await TrainingPoolModel.findById(id).select('-depositPrivateKey'); // Exclude private key from response

    if (!pool) {
      throw ApiError.notFound('Training pool not found');
    }

    // Verify that the pool belongs to the user
    if (pool.ownerAddress !== address) {
      throw ApiError.forbidden('Not authorized to view this pool');
    }

    // Get demonstration count
    const demoCount = await ForgeRaceSubmission.countDocuments({
      'meta.quest.pool_id': pool._id.toString()
    });

    const { solBalance, funds: tokenBalance } = await updatePoolStatus(pool);

    const poolObj = pool.toObject();
    res.status(200).json(
      successResponse({
        ...poolObj,
        demonstrations: demoCount,
        solBalance,
        tokenBalance
      })
    );
  })
);

// Create training pool
router.post(
  '/',
  requireWalletAddress,
  validateBody(createPoolSchema),
  errorHandlerAsync(async (req: Request<{}, {}, CreatePoolBody>, res: Response) => {
    const { name, skills, token, pricePerDemo, apps } = req.body;

    // @ts-ignore - Get walletAddress from the request object
    const ownerAddress = req.walletAddress;

    // Validate token symbol
    const supportedSymbols = getSupportedTokenSymbols();
    if (!token || !supportedSymbols.includes(token.symbol)) {
      throw ApiError.badRequest(
        `Token symbol "${token?.symbol}" is not supported. Supported symbols are: ${supportedSymbols.join(
          ', '
        )}`
      );
    }

    // Generate Solana keypair for deposit address
    const keypair = Keypair.generate();
    const depositAddress = keypair.publicKey.toString();
    const depositPrivateKey = encrypt(Buffer.from(keypair.secretKey).toString('base64'));

    const pool = new TrainingPoolModel({
      name,
      skills,
      token: {
        type: token.type,
        symbol: token.symbol
      },
      ownerAddress,
      status: TrainingPoolStatus.noFunds,
      demonstrations: 0,
      funds: 0,
      pricePerDemo: pricePerDemo ? Math.max(1, pricePerDemo) : 10, // Default to 10 if not provided, minimum of 1
      depositAddress,
      depositPrivateKey
    });

    await pool.save();

    const poolId = pool._id.toString();

    // If predefined apps were provided, use those
    if (apps && Array.isArray(apps) && apps.length > 0) {
      console.log(`Using ${apps.length} predefined apps for pool ${poolId}`);

      try {
        // Store the predefined apps
        for (const app of apps) {
          await ForgeAppModel.create({
            ...app,
            pool_id: poolId
          });
        }

        // Log success
        console.log(`Successfully added ${apps.length} predefined apps for pool ${poolId}`);
        await webhook.sendText(
          `✅ Added ${apps.length} predefined apps for pool "${pool.name}" (${poolId})\n${apps
            .map((a) => `- ${a.name}`)
            .join('\n')}`
        );
      } catch (error) {
        const appError = error as Error;
        console.error('Error adding predefined apps:', appError);
        await webhook.sendText(
          `❌ Error adding predefined apps for pool ${poolId}: ${appError.message}`
        );
        // Continue with creating the pool, just log the error
      }
    } else {
      // No predefined apps, generate them using OpenAI (non-blocking)
      generateAppsForPool(poolId, skills).catch((error) => {
        console.error('Error generating initial apps:', error);
      });
    }

    // Create response object without private key
    const { depositPrivateKey: _, ...response } = pool.toObject();

    res.status(200).json(successResponse(response));
  })
);

// Update training pool
router.put(
  '/',
  validateBody(updatePoolSchema),
  requireWalletAddress,
  errorHandlerAsync(async (req: Request<{}, {}, UpdatePoolBody>, res: Response) => {
    const { id, name, status, skills, pricePerDemo, apps } = req.body;

    const pool = await TrainingPoolModel.findById(id);
    if (!pool) {
      throw ApiError.notFound('Training pool not found');
    }

    // @ts-ignore - Get walletAddress from the request object
    if (pool.ownerAddress !== req.walletAddress) {
      throw ApiError.forbidden('Not authorized to update this pool');
    }

    // Only allow status update if funds > 0 and funds >= pricePerDemo
    if (status && (pool.funds === 0 || pool.funds < pool.pricePerDemo)) {
      throw ApiError.paymentRequired('Cannot update status: pool has insufficient funds');
    }

    // Create update operations
    let updateOperation: any = {};

    // Build $set operation for regular updates
    const setUpdates: Partial<DBTrainingPool> = {};
    if (name) setUpdates.name = name;
    if (status) setUpdates.status = status;
    if (skills) setUpdates.skills = skills;
    if (pricePerDemo !== undefined) setUpdates.pricePerDemo = Math.max(1, pricePerDemo);

    // Add $set operation if we have updates
    if (Object.keys(setUpdates).length > 0) {
      updateOperation.$set = setUpdates;
    }

    // Handle upload limit updates - allow setting to null to remove limits
    if (req.body.hasOwnProperty('uploadLimit')) {
      if (req.body.uploadLimit === null) {
        // If uploadLimit is explicitly set to null, remove the upload limit
        updateOperation.$unset = { uploadLimit: 1 };
      } else {
        // Otherwise update with the new value
        if (!updateOperation.$set) updateOperation.$set = {};
        updateOperation.$set.uploadLimit = req.body.uploadLimit;
      }
    }

    const updatedPool = await TrainingPoolModel.findByIdAndUpdate(id, updateOperation, {
      new: true
    }).select('-depositPrivateKey'); // Exclude private key from response

    // If apps were provided, update the apps
    if (apps && Array.isArray(apps) && apps.length > 0) {
      try {
        // Delete existing apps for this pool
        await ForgeAppModel.deleteMany({ pool_id: id });

        // Store the new apps
        for (const app of apps) {
          await ForgeAppModel.create({
            ...app,
            pool_id: id
          });
        }

        console.log(`Successfully updated ${apps.length} apps for pool ${id}`);
        // await notifyForgeWebhook(
        //   `✅ Updated ${apps.length} apps for pool "${updatedPool?.name}" (${id})\n${apps
        //     .map((a) => `- ${a.name}`)
        //     .join('\n')}`
        // );
      } catch (error) {
        const appError = error as Error;
        console.error('Error updating apps:', appError);
        // await notifyForgeWebhook(
        //   `❌ Error updating apps for pool ${id}: ${appError.message}`
        // );
      }
    }
    // If skills were updated but no apps were provided, generate apps
    else if (skills) {
      generateAppsForPool(id, skills).catch((error) => {
        console.error('Error regenerating apps:', error);
      });
    }

    res.status(200).json(successResponse(updatedPool));
  })
);

// Withdraw SPL tokens from a pool
router.post(
  '/withdraw/spl',
  requireWalletAddress,
  validateBody(withdrawSplSchema),
  errorHandlerAsync(async (req: Request<{}, {}, { poolId: string; amount: number }>, res: Response) => {
    const { poolId, amount } = req.body;

    const pool = await TrainingPoolModel.findById(poolId);
    if (!pool) {
      throw ApiError.notFound('Training pool not found');
    }

    // @ts-ignore
    if (pool.ownerAddress !== req.walletAddress) {
      throw ApiError.forbidden('Not authorized to withdraw from this pool');
    }

    const { solBalance, funds } = await updatePoolStatus(pool);

    if (amount > funds) {
      throw ApiError.badRequest(`Insufficient token balance. Available: ${funds}`);
    }

    if (solBalance < BlockchainService.MIN_SOL_BALANCE) {
      throw ApiError.paymentRequired(
        `Insufficient SOL for gas. Required: ${BlockchainService.MIN_SOL_BALANCE} SOL`
      );
    }

    const decryptedKey = decrypt(pool.depositPrivateKey);
    const fromWallet = Keypair.fromSecretKey(Buffer.from(decryptedKey, 'base64'));
    const tokenMint = getTokenAddress(pool.token.symbol);

    const signature = await blockchainService.transferToken(
      tokenMint,
      amount,
      fromWallet,
      pool.ownerAddress
    );

    if (!signature) {
      throw ApiError.internalError('Token transfer failed');
    }

    // Update pool balance after withdrawal
    await updatePoolStatus(pool);

    res.status(200).json(successResponse({ signature }));
  })
);

// Withdraw SOL from a pool
router.post(
  '/withdraw/sol',
  requireWalletAddress,
  validateBody(withdrawSolSchema),
  errorHandlerAsync(async (req: Request<{}, {}, { poolId: string; amount: number }>, res: Response) => {
    const { poolId, amount } = req.body;

    const pool = await TrainingPoolModel.findById(poolId);
    if (!pool) {
      throw ApiError.notFound('Training pool not found');
    }

    // @ts-ignore
    if (pool.ownerAddress !== req.walletAddress) {
      throw ApiError.forbidden('Not authorized to withdraw from this pool');
    }

    const { solBalance } = await updatePoolStatus(pool);
    const requiredBalance = amount + BlockchainService.MIN_SOL_BALANCE;

    if (solBalance < requiredBalance) {
      throw ApiError.badRequest(
        `Insufficient SOL balance. Available for withdrawal: ${solBalance - BlockchainService.MIN_SOL_BALANCE
        } SOL. Required for operation: ${requiredBalance} SOL.`
      );
    }

    const decryptedKey = decrypt(pool.depositPrivateKey);
    const fromWallet = Keypair.fromSecretKey(Buffer.from(decryptedKey, 'base64'));

    const signature = await blockchainService.transferSol(amount, fromWallet, pool.ownerAddress);

    if (!signature) {
      throw ApiError.internalError('SOL transfer failed');
    }

    // Update pool balance after withdrawal
    await updatePoolStatus(pool);

    res.status(200).json(successResponse({ signature }));
  })
);

export { router as forgePoolsApi };
