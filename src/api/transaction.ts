import express, { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import { validateBody, validateQuery } from '../middleware/validator.ts';
import { WalletConnectionModel, TransactionSessionModel } from '../models/Models.ts';
import { ethers } from 'ethers';
import { getTokenContractAddress } from '../services/blockchain/tokens.ts';
import { createFactoryService } from '../services/blockchain/factoryTransactionService.ts';
import { TransactionSessionService } from '../services/transactionSession.ts';
import { v4 as uuidv4 } from 'uuid';
import { AmountValidator } from '../utils/amountValidation.ts';
import mongoose from 'mongoose';
import { validateTransactionSchema, estimateGasSchema, prepareTransactionSchema, transactionStatusSchema, completeTransactionSchema } from './schemas/transaction.ts';
import ClaimRouterABI from '../contracts/abis/ClaimRouter.json' with { type: 'json' };
import { createFactoryWithApps } from '../services/factory/factoryDatabaseService.ts';

const router: Router = express.Router();

// Rate limiting for transaction endpoints
const transactionRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 transactions per minute per IP
  message: {
    error: 'Too many transaction requests. Please wait before trying again.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const CLAIM_ROUTER_ABI = ClaimRouterABI;

const CONTRACT_ADDRESSES = {
  REWARD_POOL_FACTORY: process.env.REWARD_POOL_FACTORY_ADDRESS,
  CLAIM_ROUTER: process.env.CLAIM_ROUTER_ADDRESS,
};

/**
 * @swagger
 * tags:
 *   name: Transaction
 *   description: Transaction endpoints for creating, validating, and managing transactions
 */


/**
 * @swagger
 * /transaction/validate-tx:
 *   post:
 *     summary: Validate transaction parameters
 *     description: Validates transaction parameters against user session and blockchain state
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - sessionToken
 *               - timestamp
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [createFactory, fundPool, claimRewards]
 *               sessionToken:
 *                 type: string
 *               userAddress:
 *                 type: string
 *                 description: Optional. If provided, must match the session token's address
 *               creator:
 *                 type: string
 *               token:
 *                 type: string
 *               amount:
 *                 type: string
 *               poolAddress:
 *                 type: string
 *               timestamp:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transaction parameters validated successfully
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Invalid session
 *       403:
 *         description: Unauthorized
 */
router.post(
  '/validate-tx',
  transactionRateLimit,
  validateBody(validateTransactionSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionToken, userAddress, type, creator, token, amount, poolAddress, timestamp } = req.body;

    // Validate timestamp (within last 5 minutes)
    const now = Date.now();
    if (now - timestamp > 5 * 60 * 1000) {
      throw ApiError.badRequest('Transaction request has expired');
    }

    // Validate session token exists and get the associated user address
    const connection = await WalletConnectionModel.findOne({ token: sessionToken });

    if (!connection || !connection.address) {
      throw ApiError.unauthorized('Invalid session token');
    }

    // Validate that the provided userAddress matches the session token
    if (userAddress && userAddress.toLowerCase() !== connection.address.toLowerCase()) {
      throw ApiError.forbidden('User address does not match session');
    }

    // Use the address from the session token as the authenticated user
    const authenticatedAddress = connection.address;

    // Type-specific validations
    switch (type) {
      case 'createFactory':
        if (!token) {
          throw ApiError.badRequest('Token required for createFactory');
        }
        // Validate token is supported
        const tokenAddress = getTokenContractAddress(token);
        if (!tokenAddress) {
          throw ApiError.badRequest(`Unsupported token: ${token}`);
        }
        break;

      case 'createAndFundFactory':
        if (!token || !amount) {
          throw ApiError.badRequest('Token and amount required for createAndFundFactory');
        }
        // Validate token is supported
        const tokenAddressForFund = getTokenContractAddress(token);
        if (!tokenAddressForFund) {
          throw ApiError.badRequest(`Unsupported token: ${token}`);
        }
        // Validate amount format (basic validation only - proper decimals handled in service)
        try {
          AmountValidator.validateBasicAmount(amount);
        } catch (error) {
          throw ApiError.badRequest(error instanceof Error ? error.message : 'Invalid amount format');
        }
        break;

      case 'fundPool':
        if (!token || !amount) {
          throw ApiError.badRequest('Token and amount required for fundPool');
        }
        if (!poolAddress || !ethers.isAddress(poolAddress)) {
          throw ApiError.badRequest('Valid pool address required for fundPool');
        }
        // Validate amount format (basic validation only - proper decimals handled in service)
        try {
          AmountValidator.validateBasicAmount(amount);
        } catch (error) {
          throw ApiError.badRequest(error instanceof Error ? error.message : 'Invalid amount format');
        }
        break;

      case 'claimRewards':
        if (!poolAddress || !ethers.isAddress(poolAddress)) {
          throw ApiError.badRequest('Valid pool address required for claimRewards');
        }
        break;

      default:
        throw ApiError.badRequest(`Unsupported transaction type: ${type}`);
    }

    // Additional security validation - ensure creator matches session user for creator-required operations
    if ((type === 'createFactory' || type === 'createAndFundFactory' || type === 'fundPool') && creator) {
      if (creator.toLowerCase() !== authenticatedAddress.toLowerCase()) {
        throw ApiError.forbidden('Creator must match authenticated wallet address');
      }
    }

    res.status(200).json(successResponse({
      valid: true,
      type,
      sessionToken,
      userAddress: authenticatedAddress,
      validatedAt: Date.now()
    }));
  })
);

/**
 * @swagger
 * /transaction/estimate-gas:
 *   post:
 *     summary: Estimate gas for transaction
 *     description: Provides gas estimation for the specified transaction type
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [createFactory, fundPool, claimRewards]
 *               creator:
 *                 type: string
 *               token:
 *                 type: string
 *               amount:
 *                 type: string
 *               poolAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Gas estimation provided
 */
router.post(
  '/estimate-gas',
  validateBody(estimateGasSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { type, creator, token, amount, poolAddress } = req.body;

    try {
      // Get current gas price from network
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const feeData = await provider.getFeeData();

      let gasLimit: bigint;
      let gasPrice: bigint = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

      // Estimate gas based on transaction type
      switch (type) {
        case 'createFactory':
          // Factory creation typically costs ~180k gas (per PRD)
          gasLimit = BigInt(200000); // Adding buffer
          break;

        case 'createAndFundFactory':
          // Combined create+fund operation costs ~250k gas (optimized vs separate transactions)
          gasLimit = BigInt(280000); // Adding buffer for combined operation
          break;

        case 'fundPool':
          // Pool funding typically costs ~100k gas for first-time, ~50k for subsequent
          gasLimit = BigInt(120000); // Adding buffer for first-time
          break;

        case 'claimRewards':
          // Claim typically costs ~100-140k gas per claim (per PRD)
          gasLimit = BigInt(150000); // Adding buffer for single claim
          break;

        default:
          throw ApiError.badRequest(`Unsupported transaction type for gas estimation: ${type}`);
      }

      const totalCost = gasLimit * gasPrice;
      const totalCostEth = ethers.formatEther(totalCost);
      const gasPriceGwei = ethers.formatUnits(gasPrice, 'gwei');

      // Flag as expensive if > 0.001 ETH (per PRD anti-dust threshold)
      const isExpensive = parseFloat(totalCostEth) > 0.001;

      res.status(200).json(successResponse({
        gasLimit: gasLimit.toString(),
        gasPrice: gasPriceGwei,
        totalCost: totalCostEth,
        isExpensive,
        estimatedAt: Date.now()
      }));

    } catch (error) {
      console.error('Gas estimation error:', error);
      throw ApiError.internalError('Failed to estimate gas');
    }
  })
);

/**
 * @swagger
 * /transaction/prepare-tx:
 *   post:
 *     summary: Prepare transaction data
 *     description: Prepares contract interaction data for frontend execution and creates a transaction session
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - sessionToken
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [createFactory, fundPool, claimRewards]
 *               sessionToken:
 *                 type: string
 *               creator:
 *                 type: string
 *               token:
 *                 type: string
 *               amount:
 *                 type: string
 *               poolAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction data prepared successfully with session ID
 */
router.post(
  '/prepare-tx',
  transactionRateLimit,
  validateBody(prepareTransactionSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { type, sessionToken, creator, token, amount, poolAddress } = req.body;

    // Validate session token and get user address
    const connection = await WalletConnectionModel.findOne({ token: sessionToken });
    if (!connection) {
      throw ApiError.unauthorized('Invalid session token');
    }

    const userAddress = connection.address;
    let transactionData: any;

    // Use factoryService to prepare transaction data with proper validation
    const factoryService = createFactoryService();

    switch (type) {
      case 'createFactory':
        if (!token || !creator) {
          throw ApiError.badRequest('Token and creator required for createFactory');
        }

        const tokenAddress = getTokenContractAddress(token);
        if (!tokenAddress) {
          throw ApiError.badRequest(`Unsupported token: ${token}`);
        }

        transactionData = await factoryService.prepareCreatePoolTransaction(tokenAddress, creator);
        break;

      case 'createAndFundFactory':
        if (!token || !creator || !amount) {
          throw ApiError.badRequest('Token, creator, and amount required for createAndFundFactory');
        }

        const tokenAddressForFund = getTokenContractAddress(token);
        if (!tokenAddressForFund) {
          throw ApiError.badRequest(`Unsupported token: ${token}`);
        }

        const amountNumberForCreateFund = AmountValidator.validateBasicAmount(amount);

        transactionData = await factoryService.prepareCreateAndFundTransaction(tokenAddressForFund, creator, amountNumberForCreateFund);
        break;

      case 'fundPool':
        if (!amount || !poolAddress) {
          throw ApiError.badRequest('Amount and pool address required for fundPool');
        }

        const amountNumber = AmountValidator.validateBasicAmount(amount);

        transactionData = await factoryService.prepareFundPoolTransaction(poolAddress, amountNumber, userAddress);
        break;

      case 'claimRewards':
        if (!poolAddress) {
          throw ApiError.badRequest('Pool address required for claimRewards');
        }

        // For claims, return the claim router contract info
        // Actual claim data would be prepared separately via batch endpoints
        transactionData = {
          contractAddress: CONTRACT_ADDRESSES.CLAIM_ROUTER,
          abi: CLAIM_ROUTER_ABI,
          functionName: 'claimAll',
          args: [], // Claims data provided separately
          validations: { approved: true }
        };
        break;

      default:
        throw ApiError.badRequest(`Unsupported transaction type: ${type}`);
    }

    // Create a transaction session for polling
    const sessionId = uuidv4();

    // For fundPool and createAndFundFactory, include token address for allowance checks
    let transactionParams: any = { type, creator, token, amount, poolAddress };
    if ((type === 'fundPool' || type === 'createAndFundFactory') && token) {
      const tokenContractAddress = getTokenContractAddress(token);
      transactionParams.tokenAddress = tokenContractAddress;
    }

    const transactionSession = new TransactionSessionModel({
      sessionId,
      sessionToken,
      transactionType: type,
      status: 'pending',
      transactionParams,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000) // 3 minutes for security
    });

    await transactionSession.save();

    res.status(200).json(successResponse({
      ...transactionData,
      type,
      sessionId,
      preparedAt: Date.now()
    }));
  })
);

/**
 * @swagger
 * /transaction/status:
 *   get:
 *     summary: Get transaction status
 *     description: Gets the current status of a transaction session for polling
 *     tags: [Transaction]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         required: true
 *         description: The transaction session ID
 *     responses:
 *       200:
 *         description: Transaction status retrieved successfully
 *       404:
 *         description: Transaction session not found
 */
router.get(
  '/status',
  validateQuery(transactionStatusSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionId } = req.query;

    const session = await TransactionSessionModel.findOne({ sessionId });
    if (!session) {
      throw ApiError.notFound('Transaction session not found');
    }

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      // Update status to expired if still pending
      if (session.status === 'pending') {
        session.status = 'failed';
        session.error = 'Transaction session expired';
        await session.save();
      }
    }

    res.status(200).json(successResponse({
      sessionId: session.sessionId,
      status: session.status,
      transactionType: session.transactionType,
      txHash: session.txHash,
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt
    }));
  })
);

/**
 * @swagger
 * /transaction/complete:
 *   post:
 *     summary: Complete transaction session
 *     description: Marks a transaction session as completed (used by website after successful transaction)
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - status
 *             properties:
 *               sessionId:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [completed, failed, cancelled]
 *               txHash:
 *                 type: string
 *               error:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction session updated successfully
 */
router.post(
  '/complete',
  validateBody(completeTransactionSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionId, status, txHash, error } = req.body;

    const session = await TransactionSessionModel.findOne({ sessionId });
    if (!session) {
      throw ApiError.notFound('Transaction session not found');
    }

    // Update session status
    session.status = status;

    if (txHash) session.txHash = txHash;
    if (error) session.error = error;

    await session.save();

    res.status(200).json(successResponse({
      sessionId: session.sessionId,
      status: session.status,
      updatedAt: session.updatedAt
    }));
  })
);

/**
 * @swagger
 * /transaction/finalize-factory:
 *   post:
 *     summary: Finalize factory creation and save metadata
 *     description: Verifies transaction on-chain and saves factory metadata to MongoDB
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *               - sessionId
 *               - metadata
 *             properties:
 *               txHash:
 *                 type: string
 *               sessionId:
 *                 type: string
 *               metadata:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   skills:
 *                     type: string
 *                   apps:
 *                     type: array
 *                   token:
 *                     type: string
 *                   fundingAmount:
 *                     type: string
 *     responses:
 *       200:
 *         description: Factory finalized successfully
 */
router.post(
  '/finalize-factory',
  transactionRateLimit,
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { txHash, sessionId, metadata } = req.body;

    if (!txHash || !sessionId || !metadata) {
      throw ApiError.badRequest('Missing required fields: txHash, sessionId, metadata');
    }

    try {
      // Verify transaction on-chain
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt || receipt.status !== 1) {
        throw ApiError.badRequest('Transaction not found or failed on-chain');
      }

      // Extract pool address from PoolCreated or PoolCreatedAndFunded events
      const factoryInterface = new ethers.Interface([
        'event PoolCreated(address indexed creator, address indexed pool, address indexed token, bytes32 salt, uint256 nonce)',
        'event PoolCreatedAndFunded(address indexed creator, address indexed pool, address indexed token, bytes32 salt, uint256 nonce, uint256 fundingAmount)'
      ]);

      let poolAddress: string | null = null;
      let creatorAddress: string | null = null;
      let tokenAddress: string | null = null;

      for (const log of receipt.logs) {
        try {
          const parsedLog = factoryInterface.parseLog({
            topics: log.topics,
            data: log.data
          });

          if (parsedLog && (parsedLog.name === 'PoolCreated' || parsedLog.name === 'PoolCreatedAndFunded')) {
            poolAddress = parsedLog.args.pool;
            creatorAddress = parsedLog.args.creator;
            tokenAddress = parsedLog.args.token;
            break;
          }
        } catch (e) {
          // Skip logs that don't match our interface
          continue;
        }
      }

      if (!poolAddress || !creatorAddress || !tokenAddress) {
        throw ApiError.badRequest('Could not extract pool information from transaction logs');
      }

      // Get token info
      const tokenSymbol = metadata.token;
      const expectedTokenAddress = getTokenContractAddress(tokenSymbol);

      if (tokenAddress.toLowerCase() !== expectedTokenAddress?.toLowerCase()) {
        throw ApiError.badRequest('Token address mismatch in transaction');
      }

      // Create factory with integrated apps generation
      const skills = metadata.skills ? metadata.skills.split(',').map((s: string) => s.trim()) : [];

      let nbTasks = 0;
      for (const app of metadata.apps) {
        for (const task of app.tasks) {
          nbTasks += 1;
        }
      }
      if (nbTasks === 0) {
        throw ApiError.badRequest('No tasks found in apps');
      }
      const pricePerDemo = metadata.fundingAmount ? AmountValidator.validateBasicAmount(metadata.fundingAmount) / nbTasks : 1.0;
      
      // Use MongoDB transaction for atomicity
      const dbSession = await mongoose.startSession();
      dbSession.startTransaction();
      
      let factory;
      try {
        factory = await createFactoryWithApps(
          poolAddress,
          creatorAddress,
          metadata.name,
          skills,
          {
            type: 'ERC20',
            symbol: tokenSymbol,
            address: tokenAddress.toLowerCase(),
            decimals: 18
          },
          pricePerDemo
        );
        
        await dbSession.commitTransaction();
      } catch (error) {
        await dbSession.abortTransaction();
        throw error;
      } finally {
        dbSession.endSession();
      }

      res.status(200).json(successResponse({
        poolAddress,
        creatorAddress,
        tokenAddress,
        factoryId: factory.id,
        name: metadata.name,
        skills: skills,
        txHash,
        createdAt: new Date().toISOString()
      }));

    } catch (error: any) {
      console.error('Factory finalization error:', error);

      if (error instanceof ApiError) {
        throw error;
      }

      throw ApiError.internalError(`Failed to finalize factory: ${error.message}`);
    }
  })
);

/**
 * @swagger
 * /transaction/session:
 *   get:
 *     summary: Get transaction session details for website
 *     description: Gets transaction session details including parameters for website display
 *     tags: [Transaction]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         required: true
 *         description: The transaction session ID
 *     responses:
 *       200:
 *         description: Transaction session details retrieved successfully
 *       404:
 *         description: Transaction session not found
 */
router.get(
  '/session',
  validateQuery(transactionStatusSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { sessionId } = req.query;

    try {
      const sessionDetails = await TransactionSessionService.validateSessionForWebsite(sessionId as string);

      res.status(200).json(successResponse({
        ...sessionDetails,
        // Additional context for website display
        isExpired: new Date() > new Date(sessionDetails.expiresAt),
        timeRemaining: Math.max(0, new Date(sessionDetails.expiresAt).getTime() - Date.now()),
      }));

    } catch (error: any) {
      if (error.message === 'Transaction session not found') {
        throw ApiError.notFound('Transaction session not found');
      } else if (error.message === 'Transaction session is not pending') {
        throw ApiError.badRequest('Transaction session is no longer pending');
      } else {
        throw ApiError.internalError('Failed to retrieve transaction session');
      }
    }
  })
);

export { router as transactionApi };