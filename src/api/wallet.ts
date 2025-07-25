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

// Store wallet address for token
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
            const referralLink = `${process.env.FRONTEND_URL || 'https://clones.sol'}/ref/${req.body.referralCode}`;
            await referralService.createReferral(
              referrerAddress,
              address,
              req.body.referralCode,
              referralLink,
              'wallet_connect',
              { connectionToken: token },
              0 // actionValue - wallet connection has no monetary value
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

// Check connection status
router.get(
  '/connection',
  validateQuery(checkConnectionSchema),
  errorHandlerAsync(async (req: Request<{}, {}, {}, { token?: string }>, res: Response) => {
    const token = req.query.token;

    const connection = await WalletConnectionModel.findOne({ token });

    res.status(200).json(
      successResponse({
        connected: !!connection,
        address: connection?.address
      })
    );
  })
);

// Get token balance for an address
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

// Get address's nickname
router.get(
  '/nickname',
  validateQuery({ address: { required: true, rules: [ValidationRules.isSolanaAddress()] } }),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address } = req.query;
    const nickname = (await WalletConnectionModel.findOne({ address }))?.nickname;
    res.status(200).json(successResponse(nickname));
  })
);

// Set address's nickname
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
