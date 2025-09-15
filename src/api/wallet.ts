import { ethers } from 'ethers'
import express, { type Request, type Response, type Router } from 'express'
import { requireWalletAddress } from '../middleware/auth.ts'
import { createSessionFromToken, requireSecureSession, getCSRFConfig } from '../middleware/secureSession.ts'
import { errorHandlerAsync } from '../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../middleware/types/errors.ts'
import { validateBody, validateParams, validateQuery } from '../middleware/validator.ts'
import { authRateLimit, strictRateLimit } from '../middleware/rateLimiter.ts'
import { WalletConnectionModel } from '../models/Models.ts'
import BlockchainService from '../services/blockchain/index.ts'
import { getTokenContractAddress } from '../services/blockchain/tokens.ts'
import { referralService } from '../services/referral/index.ts'
import type { ConnectBody } from '../types/index.ts'
import {
  addressParamSchema,
  checkConnectionSchema,
  connectWalletSchema,
  establishSessionFromTransactionSchema,
  getBalanceSchema,
  getNicknameSchema,
  setNicknameSchema,
  getTokenPriceSchema
} from './schemas/wallet.ts'

const router: Router = express.Router()
const blockchainService = new BlockchainService(process.env.RPC_URL || '')

async function verifySignature(
  signature: string,
  timestamp: number,
  address: string
): Promise<void> {
  const now = Date.now()
  if (now - timestamp > 5 * 60 * 1000) {
    throw ApiError.badRequest('Timestamp expired')
  }

  try {
    const message = `Clones desktop\nnonce: ${timestamp}`
    const normalizedSig = normalizeSignatureToBytes(signature)
    const recovered = ethers.verifyMessage(message, normalizedSig)
    if (recovered.toLowerCase() !== String(address).toLowerCase()) {
      throw ApiError.invalidSignature()
    }
  } catch (err) {
    console.error('Error verifying signature:', err)
    throw ApiError.internalError('Signature verification failed')
  }
}

async function handleReferral(referralCode: string, address: string): Promise<boolean> {
  try {
    const hasBeenReferred = await referralService.hasBeenReferred(address)
    if (hasBeenReferred) return false

    const referrerAddress = await referralService.validateReferralCode(referralCode)
    if (!referrerAddress || referrerAddress.toLowerCase() === address.toLowerCase()) {
      return false
    }

    await referralService.createReferral(referrerAddress, address, referralCode)
    return true
  } catch (error) {
    console.error('Referral creation failed:', error)
    return false
  }
}

/** Accepts 0x-hex or base64 and returns a bytes-like value usable by ethers.verifyMessage */
function normalizeSignatureToBytes(sig: string): string {
  if (sig.startsWith('0x')) return sig // hex works directly
  // assume base64
  const buf = Buffer.from(sig, 'base64')
  return `0x${buf.toString('hex')}`
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
  authRateLimit, // Rate limit authentication attempts
  validateBody(connectWalletSchema),
  errorHandlerAsync(
    async (req: Request<any, Record<string, never>, ConnectBody>, res: Response) => {
      const { token, address, signature, timestamp } = req.body

      if (signature && timestamp) {
        await verifySignature(signature, timestamp, address)
      } else {
        console.warn('Connection without signature from address:', address)
      }

      await WalletConnectionModel.updateOne(
        { token },
        { $set: { token, address } },
        { upsert: true }
      )

      let referralCreated = false
      if (req.body.referralCode) {
        referralCreated = await handleReferral(req.body.referralCode, address)
      }

      res.status(200).json(
        successResponse({
          referralCreated,
          referralCode: req.body.referralCode || null,
          sessionEstablished: !!(req as any).session?.authenticated
        })
      )
    }
  )
)

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
  errorHandlerAsync(
    async (
      req: Request<any, Record<string, never>, Record<string, never>, { token?: string }>,
      res: Response
    ) => {
      const token = req.query.token

      const connection = await WalletConnectionModel.findOne({ token })
      let referralCode: string | null = null
      let referrer: {
        walletAddress: string
        referralCode: string | null
      } | null = null

      if (connection?.address) {
        const [referralCodeInfo, referrerInfo] = await Promise.all([
          referralService.getReferralCode(connection.address),
          referralService.getReferrer(connection.address)
        ])
        referralCode = referralCodeInfo?.referralCode || null
        if (referrerInfo?.walletAddress) {
          const referrerCodeInfo = await referralService.getReferralCode(referrerInfo.walletAddress)
          referrer = {
            walletAddress: referrerInfo.walletAddress,
            referralCode: referrerCodeInfo?.referralCode || null
          }
        }
      }

      res.status(200).json(
        successResponse({
          connected: !!connection,
          address: connection?.address,
          referralCode,
          referrer
        })
      )
    }
  )
)

/**
 * @swagger
 * /wallet/verify:
 *   get:
 *     summary: Verify token and get wallet info
 *     description: Validates a session token and returns associated wallet address if valid.
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: The session token to verify.
 *     responses:
 *       200:
 *         description: Token verified successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     address:
 *                       type: string
 *                     valid:
 *                       type: boolean
 *       404:
 *         description: Token not found or expired.
 */
router.get(
  '/verify',
  validateQuery(checkConnectionSchema),
  errorHandlerAsync(
    async (
      req: Request<any, Record<string, never>, Record<string, never>, { token?: string }>,
      res: Response
    ) => {
      const token = req.query.token

      const connection = await WalletConnectionModel.findOne({ token })

      if (!connection) {
        return res.status(404).json({
          success: false,
          error: 'Token not found or expired'
        })
      }

      res.status(200).json(
        successResponse({
          address: connection.address,
          valid: true
        })
      )
    }
  )
)

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
    const { address } = req.params
    const { symbol } = req.query as { symbol: string }

    const tokenContractAddress = getTokenContractAddress(symbol)
    const balance = await blockchainService.getTokenBalance(tokenContractAddress, address)

    res.status(200).json(successResponse({ balance }))
  })
)

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
    const { address } = req.query as { address: string }
    const nickname = (await WalletConnectionModel.findOne({ address }))?.nickname
    res.status(200).json(successResponse(nickname))
  })
)

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
    const { address, nickname } = req.body
    // only let the current wallet update their own nickname
    // @ts-expect-error requireWalletAddress attaches walletAddress
    if (String(req.walletAddress).toLowerCase() !== String(address).toLowerCase()) {
      throw ApiError.forbidden("You are not allowed to set this user's nickname")
    }
    await WalletConnectionModel.updateOne({ address }, { $set: { nickname } })
    res.status(200).json(successResponse(nickname))
  })
)

/**
 * @swagger
 * /wallet/price:
 *   get:
 *     summary: Get token price in USD
 *     description: Retrieves the current price of a token in USD from CoinGecko.
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         required: true
 *         description: The token symbol (e.g., "ETH", "USDC", "CLONES").
 *     responses:
 *       200:
 *         description: Token price retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     symbol:
 *                       type: string
 *                     priceUSD:
 *                       type: number
 *       400:
 *         description: Bad request - invalid token symbol.
 *       500:
 *         description: Internal server error.
 */
router.get(
  '/price',
  validateQuery(getTokenPriceSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { symbol } = req.query as { symbol: string }

    const priceUSD = await BlockchainService.getTokenPriceUSD(symbol)

    res.status(200).json(successResponse({
      symbol: symbol.toUpperCase(),
      priceUSD
    }))
  })
)

/**
 * @swagger
 * /wallet/csrf-token:
 *   get:
 *     summary: Get CSRF token
 *     description: Returns a CSRF token for form submissions
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: CSRF token retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     csrfToken:
 *                       type: string
 */
router.get('/csrf-token', (req: any, res: any) => {
  const config = getCSRFConfig();
  if (!config) {
    return res.status(500).json({
      success: false,
      error: 'CSRF configuration not initialized'
    });
  }
  handleCSRFTokenRequest(req, res, config);
});

// Helper function to generate CSRF token with one retry and send response
function handleCSRFTokenRequest(req: any, res: any, config: any) {
  // Ensure cookies object exists
  if (!req.cookies) {
    req.cookies = {};
  }
  let token;
  try {
    token = config.generateToken(req, res);
  } catch (error) {
    // If token generation fails (usually on first call), try once more
    try {
      token = config.generateToken(req, res);
    } catch (secondError) {
      console.error('CSRF token generation failed after retry');
      return res.status(500).json({
        success: false,
        error: 'Failed to generate CSRF token'
      });
    }
  }
  res.json(successResponse({
    csrfToken: token
  }));
}

/**
 * @swagger
 * /wallet/session-status:
 *   get:
 *     summary: Check secure session status
 *     description: Returns current session authentication status with CSRF token
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Session status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     authenticated:
 *                       type: boolean
 *                     address:
 *                       type: string
 *                     csrfToken:
 *                       type: string
 */
router.get('/session-status', (req: any, res: any) => {
  const authenticated = !!(req.session?.authenticated && req.session?.walletAddress);

  // Generate CSRF token using the global config
  let csrfToken = null;
  try {
    const config = getCSRFConfig();
    if (config) {
      // Ensure cookies object exists
      if (!req.cookies) {
        req.cookies = {};
      }
      csrfToken = config.generateToken(req, res);
    }
  } catch (error) {
    console.warn('CSRF token generation failed in session-status');
  }

  res.json(successResponse({
    authenticated,
    address: authenticated ? req.session.walletAddress : null,
    csrfToken
  }));
});

/**
 * @swagger
 * /wallet/establish-session:
 *   post:
 *     summary: Establish secure session from token
 *     description: Converts a wallet token into a secure HTTP session
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session established successfully
 *       401:
 *         description: Invalid token
 */
router.post(
  '/establish-session',
  authRateLimit, // Rate limit session establishment
  createSessionFromToken(), // Create secure session from token
  errorHandlerAsync(async (req: any, res: any) => {
    // Session creation is handled by middleware
    // Generate CSRF token for new session
    let csrfToken = null;
    try {
      const config = getCSRFConfig();
      if (config) {
        csrfToken = config.generateToken(req, res);
      }
    } catch (error) {
      console.warn('CSRF token generation failed in establish-session');
    }

    res.json(successResponse({
      address: req.session?.walletAddress || 'Unknown',
      authenticated: req.session?.authenticated || false,
      csrfToken
    }));
  })
);

/**
 * @swagger
 * /wallet/logout:
 *   post:
 *     summary: Logout and destroy session
 *     description: Destroys the secure HTTP session
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', (req: any, res: any) => {
  req.session.destroy(() => {
    res.json(successResponse({
      message: 'Logged out successfully'
    }));
  });
});

/**
 * @swagger
 * /wallet/establish-session-from-transaction:
 *   post:
 *     summary: Establish secure session from transaction session ID
 *     description: Converts a transaction sessionId into a secure HTTP session for website access
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Transaction session ID from URL parameter
 *     responses:
 *       200:
 *         description: Session established successfully
 *       404:
 *         description: Transaction session not found
 *       400:
 *         description: Invalid session state
 */
router.post(
  '/establish-session-from-transaction',
  authRateLimit,
  validateBody(establishSessionFromTransactionSchema),
  errorHandlerAsync(async (req: any, res: any) => {
    const { sessionId } = req.body;


    try {
      // Get transaction session details
      const { TransactionSessionService } = await import('../services/transactionSession.ts');
      const sessionDetails = await TransactionSessionService.validateSessionForWebsite(sessionId);

      // Get the wallet token from the session
      const sessionToken = sessionDetails.sessionToken;

      // Verify the token exists in wallet_connections and get wallet address
      const { WalletConnectionModel } = await import('../models/Models.ts');
      const connection = await WalletConnectionModel.findOne({ token: sessionToken });

      if (!connection?.address) {
        return res.status(404).json({
          success: false,
          error: 'Invalid session token or wallet connection not found'
        });
      }

      // Create secure session (similar to establish-session endpoint)
      if (process.env.NODE_ENV === 'test') {
        req.session.walletAddress = connection.address;
        req.session.authToken = sessionToken;
        req.session.authenticated = true;
        req.session.lastActivity = Date.now();
      } else {
        // Regenerate session to prevent session fixation attacks
        await new Promise<void>((resolve, reject) => {
          req.session.regenerate((err: any) => {
            if (err) {
              console.error('Session regeneration failed:', err);
              reject(err);
            } else {
              resolve();
            }
          });
        });

        // Create secure session with new session ID
        req.session.walletAddress = connection.address;
        req.session.authToken = sessionToken;
        req.session.authenticated = true;
        req.session.lastActivity = Date.now();

        await new Promise((resolve, reject) => {
          req.session.save((err: any) => {
            if (err) {
              console.error('Session save failed:', err);
              reject(err);
            } else {
              resolve(undefined);
            }
          });
        });
      }

      // Generate CSRF token for new session
      let csrfToken = null;
      try {
        const config = getCSRFConfig();
        if (config) {
          csrfToken = config.generateToken(req, res);
        }
      } catch (error) {
        console.warn('CSRF token generation failed in establish-session-from-transaction');
      }

      res.json(successResponse({
        authenticated: true,
        address: connection.address,
        csrfToken,
        transactionDetails: {
          sessionId: sessionDetails.sessionId,
          transactionType: sessionDetails.transactionType,
          expiresAt: sessionDetails.expiresAt
        }
      }));

    } catch (error) {
      console.error('Failed to establish session from transaction:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return res.status(404).json({
            success: false,
            error: 'Transaction session not found or expired'
          });
        }
        if (error.message.includes('not pending')) {
          return res.status(400).json({
            success: false,
            error: 'Transaction session is not in pending state'
          });
        }
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to establish session from transaction'
      });
    }
  })
);

export { router as walletApi }
