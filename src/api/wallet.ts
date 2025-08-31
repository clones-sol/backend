import express, { Router, Request, Response } from 'express';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validator.ts';
import { WalletConnectionModel } from '../models/Models.ts';
import { ConnectBody } from '../types/index.ts';
import BlockchainService from '../services/blockchain/index.ts';
import { referralService } from '../services/referral/index.ts';
import {
  checkConnectionSchema,
  connectWalletSchema,
  getBalanceSchema,
  addressParamSchema,
  getNicknameSchema,
  setNicknameSchema,
} from './schemas/wallet.ts';
import { requireWalletAddress } from '../middleware/auth.ts';
import { getTokenContractAddress } from '../services/blockchain/tokens.ts';
import { ethers } from 'ethers';

const router: Router = express.Router();
const blockchainService = new BlockchainService(process.env.RPC_URL || '');

/** Accepts 0x-hex or base64 and returns a bytes-like value usable by ethers.verifyMessage */
function normalizeSignatureToBytes(sig: string): string {
  if (sig.startsWith('0x')) return sig; // hex works directly
  // assume base64
  const buf = Buffer.from(sig, 'base64');
  return '0x' + buf.toString('hex');
}

/**
 * @swagger
 * /wallet/connect:
 *   post:
 *     summary: Connect a wallet
 *     description: Connects an EVM wallet and optionally verifies a signature (EIP-191). It can also handle a referral code.
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
 *                 description: The EVM wallet address (0x...).
 *               signature:
 *                 type: string
 *                 description: Hex (0x...) or base64 signature of the message.
 *               timestamp:
 *                 type: number
 *                 description: Milliseconds since epoch; used as nonce in the signed message.
 *               referralCode:
 *                 type: string
 *                 description: A referral code.
 *     responses:
 *       200:
 *         description: Wallet connected successfully.
 *       400:
 *         description: Bad request, e.g., expired timestamp.
 *       401:
 *         description: Invalid signature.
 *       500:
 *         description: Internal server error.
 */
router.post(
  '/connect',
  validateBody(connectWalletSchema),
  errorHandlerAsync(async (req: Request<{}, {}, ConnectBody>, res: Response) => {
    const { token, address, signature, timestamp } = req.body;

    // Optional signature verification (EIP-191 personal_sign style)
    if (signature && timestamp) {
      const now = Date.now();
      if (now - timestamp > 5 * 60 * 1000) {
        throw ApiError.badRequest('Timestamp expired');
      }

      try {
        const message = `Clones desktop\nnonce: ${timestamp}`;
        const normalizedSig = normalizeSignatureToBytes(signature);
        const recovered = ethers.verifyMessage(message, normalizedSig as any);
        if (recovered.toLowerCase() !== String(address).toLowerCase()) {
          throw ApiError.invalidSignature();
        }
      } catch (err) {
        console.error('Error verifying signature:', err);
        throw ApiError.internalError('Signature verification failed');
      }
    } else {
      // For backward compatibility, allow connections without signature
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
        const hasBeenReferred = await referralService.hasBeenReferred(address);
        if (!hasBeenReferred) {
          const referrerAddress = await referralService.validateReferralCode(req.body.referralCode);
          if (referrerAddress && referrerAddress.toLowerCase() !== address.toLowerCase()) {
            const referralLink = `${process.env.FRONTEND_URL || 'https://clones-ai.com'}/ref/${req.body.referralCode}`;
            await referralService.createReferral(referrerAddress, address, req.body.referralCode);
            referralCreated = true;
          }
        }
      } catch (error) {
        console.error('Referral creation failed:', error);
        // Do not fail the wallet connection if referral fails
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

    res.status(200).json(successResponse({
      connected: !!connection,
      address: connection?.address,
      referralCode,
      referrer
    }));
  })
);

/**
 * @swagger
 * /wallet/balance/{address}:
 *   get:
 *     summary: Get token balance (EVM)
 *     description: Retrieves the ERC-20 token balance for a specific wallet address on Base.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         schema:
 *           type: string
 *         required: true
 *         description: The EVM wallet address (0x...).
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         required: true
 *         description: The token symbol (e.g., "CLONES").
 *     responses:
 *       200:
 *         description: Balance retrieved successfully.
 */
router.get(
  '/balance/:address',
  validateParams(addressParamSchema),
  validateQuery(getBalanceSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { symbol } = req.query as { symbol: string };

    const tokenContractAddress = getTokenContractAddress(symbol);
    const balance = await blockchainService.getTokenBalance(tokenContractAddress, address);

    res.status(200).json(successResponse({ balance }));
  })
);

/**
 * @swagger
 * /wallet/nickname:
 *   get:
 *     summary: Get address's nickname
 *     description: Retrieves the nickname for a given EVM wallet address.
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         required: true
 *         description: The EVM wallet address (0x...).
 *     responses:
 *       200:
 *         description: Nickname retrieved successfully.
 */
router.get(
  '/nickname',
  validateQuery(getNicknameSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address } = req.query as { address: string };
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
 *       400:
 *         description: Bad request.
 *       403:
 *         description: Forbidden.
 */
router.put(
  '/nickname',
  requireWalletAddress,
  validateBody(setNicknameSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address, nickname } = req.body;
    // only let the current wallet update their own nickname
    // @ts-ignore requireWalletAddress attaches walletAddress
    if (String(req.walletAddress).toLowerCase() !== String(address).toLowerCase()) {
      throw ApiError.forbidden("You are not allowed to set this user's nickname");
    }
    await WalletConnectionModel.updateOne({ address }, { $set: { nickname } });
    res.status(200).json(successResponse(nickname));
  })
);

export { router as walletApi };
