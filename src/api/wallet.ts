import { PublicKey } from '@solana/web3.js';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import {
  validateBody,
  validateParams,
  validateQuery,
  ValidationRules
} from '../middleware/validator.ts';
import express, { Router, Request, Response } from 'express';
import nacl from 'tweetnacl';
import { WalletConnectionModel } from '../models/Models.ts';
import { ConnectBody } from '../types/index.ts';
import BlockchainService from '../services/blockchain/index.ts';
import { referralService } from '../services/referral/index.ts';
import {
  checkConnectionSchema,
  connectWalletSchema,
  getBalanceSchema
} from './schemas/wallet.ts';
import { requireWalletAddress } from '../middleware/auth.ts';
import { getTokenAddress } from '../services/blockchain/tokens.ts';

const router: Router = express.Router();
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');

/**
 * @swagger
 * /wallet/connect:
 *   post:
 *     summary: Connect a wallet
 *     description: Connects a wallet and optionally verifies a signature. It can also handle a referral code.
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - address
 *             properties:
 *               token:
 *                 type: string
 *                 description: A unique token for the connection.
 *               address:
 *                 type: string
 *                 description: The wallet address.
 *               signature:
 *                 type: string
 *                 description: A base64 encoded signature.
 *               timestamp:
 *                 type: number
 *                 description: The timestamp when the message was signed.
 *               referralCode:
 *                 type: string
 *                 description: A referral code.
 *     responses:
 *       200:
 *         description: Wallet connected successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Bad request, e.g., expired timestamp.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid signature.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  '/connect',
  validateBody(connectWalletSchema),
  errorHandlerAsync(async (req: Request<{}, {}, ConnectBody>, res: Response) => {
    const { token, address, signature, timestamp } = req.body;

    // If signature and timestamp are provided, verify the signature
    if (signature && timestamp) {
      // Check if timestamp is within 5 minutes
      const now = Date.now();
      if (now - timestamp > 5 * 60 * 1000) {
        throw ApiError.badRequest('Timestamp expired');
      }

      try {
        // Create the message that was signed
        const message = `Clones desktop\nnonce: ${timestamp}`;
        const messageBytes = new TextEncoder().encode(message);

        // Convert base64 signature to Uint8Array
        const signatureBytes = Buffer.from(signature, 'base64');

        // Convert address to PublicKey
        const publicKey = new PublicKey(address);

        // Verify the signature
        const verified = nacl.sign.detached.verify(
          messageBytes,
          signatureBytes,
          publicKey.toBytes()
        );

        if (!verified) {
          throw ApiError.invalidSignature();
        }
      } catch (verifyError) {
        console.error('Error verifying signature:', verifyError);
        throw ApiError.internalError('Signature verification failed');
      }
    } else {
      // For backward compatibility, allow connections without signature
      // In production, you might want to require signatures
      console.warn('Connection without signature from address:', address);
    }

    // Store connection token with address
    await WalletConnectionModel.updateOne(
      { token },
      { $set: { token, address } },
      { upsert: true }
    );

    // Handle referral if this is a new wallet connection
    let referralCreated = false;
    if (req.body.referralCode) {
      try {
        // Check if this wallet has already been referred
        const hasBeenReferred = await referralService.hasBeenReferred(address);

        if (!hasBeenReferred) {
          // Validate the referral code and get referrer
          const referrerAddress = await referralService.validateReferralCode(req.body.referralCode);

          if (referrerAddress && referrerAddress !== address) {
            // Create referral relationship
            const referralLink = `${process.env.FRONTEND_URL || 'https://clones-ai.com'}/ref/${req.body.referralCode}`;
            await referralService.createReferral(
              referrerAddress,
              address,
              req.body.referralCode,
            );
            referralCreated = true;
          }
        }
      } catch (error) {
        console.error('Referral creation failed:', error);
        // Don't fail the wallet connection if referral fails
      }
    }

    res.status(200).json(successResponse({
      referralCreated,
      referralCode: req.body.referralCode || null
    }));
  })
);

/**
 * @swagger
 * /wallet/connection:
 *   get:
 *     summary: Check connection status
 *     description: Checks the connection status for a given token.
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: The connection token.
 *     responses:
 *       200:
 *         description: Connection status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connected:
 *                   type: boolean
 *                 address:
 *                   type: string
 *                 referralCode:
 *                   type: string
 *                   nullable: true
 *                 referrer:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     walletAddress:
 *                       type: string
 *                     referralCode:
 *                       type: string
 *                       nullable: true
 *       400:
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/connection',
  validateQuery(checkConnectionSchema),
  errorHandlerAsync(async (req: Request<{}, {}, {}, { token?: string }>, res: Response) => {
    const token = req.query.token;

    const connection = await WalletConnectionModel.findOne({ token });
    let referralCode: string | null = null;
    let referrer: { walletAddress: string; referralCode: string | null } | null = null;
    if (connection?.address) {
      const [referralCodeInfo, referrerInfo] = await Promise.all([
        referralService.getReferralCode(connection.address),
        referralService.getReferrer(connection.address)
      ]);
      referralCode = referralCodeInfo?.referralCode || null;
      if (referrerInfo && referrerInfo.walletAddress) {
        const referrerCodeInfo = await referralService.getReferralCode(referrerInfo.walletAddress);
        referrer = {
          walletAddress: referrerInfo.walletAddress,
          referralCode: referrerCodeInfo?.referralCode || null
        };
      }
    }

    res.status(200).json(
      successResponse({
        connected: !!connection,
        address: connection?.address,
        referralCode,
        referrer
      })
    );
  })
);

/**
 * @swagger
 * /wallet/balance/{address}:
 *   get:
 *     summary: Get token balance
 *     description: Retrieves the token balance for a specific wallet address.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         schema:
 *           type: string
 *         required: true
 *         description: The wallet address.
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         required: true
 *         description: The token symbol (e.g., "CLONES").
 *     responses:
 *       200:
 *         description: Balance retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/balance/:address',
  validateParams({ address: { required: true, rules: [ValidationRules.isSolanaAddress()] } }),
  validateQuery(getBalanceSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { symbol } = req.query as { symbol: string };

    const tokenMintAddress = getTokenAddress(symbol);
    const balance = await blockchainService.getTokenBalance(tokenMintAddress, address);

    res.status(200).json(successResponse({ balance }));
  })
);

/**
 * @swagger
 * /wallet/nickname:
 *   get:
 *     summary: Get address's nickname
 *     description: Retrieves the nickname for a given wallet address.
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         required: true
 *         description: The wallet address.
 *     responses:
 *       200:
 *         description: Nickname retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/nickname',
  validateQuery({ address: { required: true, rules: [ValidationRules.isSolanaAddress()] } }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address } = req.query;
    const nickname = (await WalletConnectionModel.findOne({ address }))?.nickname;
    res.status(200).json(successResponse(nickname));
  })
);

/**
 * @swagger
 * /wallet/nickname:
 *   put:
 *     summary: Set address's nickname
 *     description: Sets or updates the nickname for a wallet address. Requires authentication.
 *     tags: [Wallet]
 *     security:
 *       - walletAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               address:
 *                 type: string
 *               nickname:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nickname updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put(
  '/nickname',
  requireWalletAddress,
  validateBody({
    address: { required: true, rules: [ValidationRules.isSolanaAddress()] },
    nickname: { required: true, rules: [ValidationRules.isString(), ValidationRules.maxLength(25)] }
  }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address, nickname } = req.body;
    //@ts-ignore only let the current wallet update their own nickname
    if (req.walletAddress !== address)
      throw ApiError.forbidden("You are not allowed to set this user's nickname");
    await WalletConnectionModel.updateOne({ address }, { $set: { nickname: nickname } });
    res.status(200).json(successResponse(nickname));
  })
);

export { router as walletApi };
