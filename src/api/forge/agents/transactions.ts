import express, { Response, Router } from 'express';
import { requireWalletAddress } from '../../../middleware/auth.ts';
import { errorHandlerAsync } from '../../../middleware/errorHandler.ts';
import { validateBody, validateParams } from '../../../middleware/validator.ts';
import { submitTxSchema } from '../../schemas/forge-agents.ts';
import { ApiError, ErrorCode, successResponse } from '../../../middleware/types/errors.ts';
import { transitionAgentStatus } from '../../../services/agents/index.ts';
import BlockchainService from '../../../services/blockchain/index.ts';
import { PublicKey } from '@solana/web3.js';
import { createTokenCreationTransaction } from '../../../services/blockchain/splTokenService.ts';
import { v4 as uuidv4 } from 'uuid';
import { idValidationSchema } from '../../schemas/common.ts';
import { NATIVE_MINT } from '@solana/spl-token';
import { Token, type Cluster } from '@raydium-io/raydium-sdk-v2';
import { createPoolCreationTransaction } from '../../../services/blockchain/raydiumService.ts';
import { ValidationRules } from '../../../middleware/validator.ts';
import { requireAgentOwnership } from './middleware.ts';
import { GymAgentModel } from '../../../models/Models.ts';
import { AuthenticatedRequest } from '../../../middleware/types/request.ts';
import { broadcastTxSubmitted } from '../../../services/websockets/agentBroadcaster.ts';

/**
 * @openapi
 * components:
 *   schemas:
 *     SubmitTxRequest:
 *       type: object
 *       required:
 *         - type
 *         - signedTransaction
 *         - idempotencyKey
 *       properties:
 *         type:
 *           type: string
 *           enum: [token-creation, pool-creation]
 *           description: The type of the transaction being submitted.
 *         signedTransaction:
 *           type: string
 *           format: base64
 *           description: The base64-encoded, client-signed transaction.
 *         idempotencyKey:
 *           type: string
 *           format: uuid
 *           description: The idempotency key received from the transaction generation endpoint.
 */
const router: Router = express.Router();
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');
const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER || 'devnet') as Cluster;

/**
 * @openapi
 * /forge/agents/{id}/transactions/{type}:
 *   get:
 *     tags:
 *       - Agents On-Chain
 *     summary: Get an unsigned transaction for on-chain actions
 *     description: |-
 *       Constructs and returns a base64-encoded, unsigned transaction for the client to sign.
 *       The `type` parameter determines which transaction to generate.
 *       - `token-creation`: Generates the transaction to create a new SPL token for the agent.
 *       - `pool-creation`: Generates the transaction to create a Raydium liquidity pool for the agent's token.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent.
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [token-creation, pool-creation]
 *         description: The type of transaction to generate.
 *     responses:
 *       '200':
 *         description: The unsigned transaction and related data.
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
 *                     transaction:
 *                       type: string
 *                       format: base64
 *                     idempotencyKey:
 *                       type: string
 *                       format: uuid
 *                     estimatedFeeSol:
 *                       type: number
 *                     mintAddress:
 *                       type: string
 *                       description: (Only for token-creation) The address of the new token mint.
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */
router.get(
    '/:id/transactions/:type',
    requireWalletAddress,
    validateParams({
        id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] },
        type: { required: true, rules: [ValidationRules.isIn(['token-creation', 'pool-creation'])] }
    }),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const ownerAddress = req.walletAddress!;
        const { agent } = req;
        const { type } = req.params;

        if (type === 'token-creation') {
            if (agent!.deployment.status !== 'PENDING_TOKEN_SIGNATURE') {
                throw ApiError.badRequest(`Agent must be in PENDING_TOKEN_SIGNATURE status, but is in ${agent!.deployment.status}.`);
            }

            const payer = new PublicKey(ownerAddress);
            const { transaction, mintKeypair } = await createTokenCreationTransaction(
                blockchainService.connection,
                payer,
                agent!.tokenomics.supply,
                agent!.tokenomics.decimals ?? 9
            );

            const { blockhash } = await blockchainService.connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = payer;

            transaction.partialSign(mintKeypair);

            const serializedTransaction = transaction.serialize({
                requireAllSignatures: false,
            });
            const base64Transaction = serializedTransaction.toString('base64');
            const idempotencyKey = uuidv4();

            const pendingTransaction = {
                idempotencyKey,
                type: 'TOKEN_CREATION',
                status: 'PENDING',
                details: {
                    mint: mintKeypair.publicKey.toBase58(),
                },
            };

            // Atomic update of pending transaction
            const updatedAgent = await GymAgentModel.findOneAndUpdate(
                {
                    _id: agent!._id,
                    'deployment.status': 'PENDING_TOKEN_SIGNATURE' // Ensure status hasn't changed
                },
                {
                    $set: {
                        'deployment.pendingTransaction': pendingTransaction
                    }
                },
                { new: true }
            );

            if (!updatedAgent) {
                throw ApiError.conflict('Agent status changed during transaction preparation. Please try again.');
            }

            const fee = await transaction.getEstimatedFee(blockchainService.connection);

            res.status(200).json(successResponse({
                transaction: base64Transaction,
                idempotencyKey,
                estimatedFeeSol: (fee || 0) / 1e9,
                mintAddress: mintKeypair.publicKey.toBase58(),
            }));
        } else if (type === 'pool-creation') {
            if (agent!.deployment.status !== 'PENDING_POOL_SIGNATURE') {
                throw ApiError.badRequest(`Agent must be in PENDING_POOL_SIGNATURE status, but is in ${agent!.deployment.status}.`);
            }
            if (!agent!.blockchain.tokenAddress) {
                throw ApiError.internalError('Agent token address is missing.');
            }

            const payer = new PublicKey(ownerAddress);

            const baseToken = new Token({
                mint: new PublicKey(agent!.blockchain.tokenAddress),
                decimals: agent!.tokenomics.decimals ?? 9,
                symbol: agent!.ticker,
                name: agent!.name
            });
            const quoteToken = new Token({
                mint: NATIVE_MINT,
                decimals: 9,
                symbol: 'SOL',
                name: 'Solana'
            });

            try {
                const { transaction, poolKeys } = await createPoolCreationTransaction(
                    blockchainService.connection,
                    payer,
                    baseToken,
                    quoteToken,
                    agent!.tokenomics.supply,
                    agent!.tokenomics.minLiquiditySol,
                    SOLANA_CLUSTER
                );

                const { blockhash } = await blockchainService.connection.getLatestBlockhash('confirmed');
                transaction.message.recentBlockhash = blockhash;

                const message = transaction.message;
                const accountKeys = message.staticAccountKeys;
                const feePayerIndex = accountKeys.findIndex(key => key.equals(payer));

                if (feePayerIndex === -1) {
                    throw new ApiError(500, ErrorCode.INTERNAL_SERVER_ERROR, "Fee payer not found in transaction account keys.");
                }

                if (feePayerIndex > 0) {
                    const [payerKey] = accountKeys.splice(feePayerIndex, 1);
                    accountKeys.unshift(payerKey);

                    const newInstruction = message.compiledInstructions.map(ix => {
                        const newAccountKeyIndexes = ix.accountKeyIndexes.map(oldIndex => {
                            if (oldIndex === 0) return feePayerIndex;
                            if (oldIndex === feePayerIndex) return 0;
                            return oldIndex;
                        });
                        return { ...ix, accountKeyIndexes: newAccountKeyIndexes };
                    });

                    transaction.message = new (transaction.message.constructor as any)({
                        ...message,
                        staticAccountKeys: accountKeys,
                        compiledInstructions: newInstruction
                    });
                }

                const serializedTransaction = transaction.serialize();
                const base64Transaction = Buffer.from(serializedTransaction).toString('base64');
                const idempotencyKey = uuidv4();

                const pendingTransaction = {
                    idempotencyKey,
                    type: 'POOL_CREATION',
                    status: 'PENDING',
                    details: {
                        poolKeys: JSON.stringify(poolKeys),
                    },
                };

                // Atomic update of pending transaction
                const updatedAgent = await GymAgentModel.findOneAndUpdate(
                    {
                        _id: agent!._id,
                        'deployment.status': 'PENDING_POOL_SIGNATURE' // Ensure status hasn't changed
                    },
                    {
                        $set: {
                            'deployment.pendingTransaction': pendingTransaction
                        }
                    },
                    { new: true }
                );

                if (!updatedAgent) {
                    throw ApiError.conflict('Agent status changed during transaction preparation. Please try again.');
                }

                const fee = (await blockchainService.connection.getFeeForMessage(transaction.message)).value || 0;

                res.status(200).json(successResponse({
                    transaction: base64Transaction,
                    idempotencyKey,
                    estimatedFeeSol: fee / 1e9,
                }));
            } catch (e) {
                const error = e as Error;
                console.error("Error creating pool transaction:", error);
                throw new ApiError(501, ErrorCode.INTERNAL_SERVER_ERROR, error.message);
            }
        }
    })
);

/**
 * @openapi
 * /forge/agents/{id}/submit-tx:
 *   post:
 *     tags:
 *       - Agents On-Chain
 *     summary: Submit a signed transaction for broadcasting
 *     description: |-
 *       Submits a client-signed transaction to the backend. The backend broadcasts it to the Solana network and processes the result asynchronously.
 *       This endpoint is idempotent and uses the `idempotencyKey` to prevent duplicate submissions.
 *       The client should listen on the WebSocket connection for real-time updates on the transaction's progress.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubmitTxRequest'
 *     responses:
 *       '202':
 *         description: Transaction accepted for processing. The client should wait for WebSocket messages for final status.
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
 *                     message:
 *                       type: string
 *                     agentId:
 *                       type: string
 *                     status:
 *                       type: string
 *                     idempotencyKey:
 *                       type: string
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */
router.post(
    '/:id/submit-tx/:type',
    requireWalletAddress,
    validateParams({
        id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] },
        type: { required: true, rules: [ValidationRules.isIn(['token-creation', 'pool-creation'])] }
    }),
    validateBody(submitTxSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { type, signedTransaction, idempotencyKey } = req.body;
        const normalizedType = type.toUpperCase().replace('-', '_');
        const agentFromMiddleware = req.agent!;
        const agentIdString = (agentFromMiddleware._id as any).toString();

        const agent = await GymAgentModel.findOneAndUpdate(
            {
                _id: agentFromMiddleware._id,
                'deployment.pendingTransaction.idempotencyKey': idempotencyKey,
                'deployment.pendingTransaction.status': 'PENDING'
            },
            {
                $set: {
                    'deployment.pendingTransaction.status': 'PROCESSING',
                    'deployment.lastAttemptedAt': new Date()
                }
            },
            { new: true }
        );

        if (!agent) {
            const alreadyProcessedAgent = await GymAgentModel.findById(agentFromMiddleware._id);
            if (alreadyProcessedAgent?.deployment?.pendingTransaction?.idempotencyKey === idempotencyKey) {
                throw new ApiError(409, ErrorCode.CONFLICT, 'This transaction is already being processed or has been submitted.');
            }
            throw new ApiError(400, ErrorCode.BAD_REQUEST, 'The provided idempotency key is invalid or out of date.');
        }

        const pendingTx = agent.deployment.pendingTransaction;
        if (!pendingTx) {
            throw ApiError.internalError('Pending transaction lock failed.');
        }

        if (pendingTx.type !== normalizedType) {
            throw ApiError.badRequest(
                `Invalid transaction type. Expected ${pendingTx.type}, got ${normalizedType}.`
            );
        }

        // Respond immediately to the client
        res.status(202).json(successResponse({
            message: 'Transaction accepted and is being processed.',
            agentId: agentIdString,
            status: agent.deployment.status,
            idempotencyKey: pendingTx.idempotencyKey,
        }));

        const processTransaction = async (txType: 'TOKEN_CREATION' | 'POOL_CREATION') => {
            let txHash = pendingTx.txHash;

            if (!txHash) {
                try {
                    const signedTransactionBuffer = Buffer.from(signedTransaction, 'base64');
                    txHash = await blockchainService.connection.sendRawTransaction(signedTransactionBuffer, {
                        skipPreflight: true,
                    });
                    await GymAgentModel.updateOne(
                        { _id: agent._id, 'deployment.pendingTransaction.idempotencyKey': idempotencyKey },
                        { $set: { 'deployment.pendingTransaction.txHash': txHash, 'deployment.pendingTransaction.status': 'SUBMITTED' } }
                    );

                    // Broadcast that the transaction has been submitted
                    broadcastTxSubmitted(agentIdString, agent.deployment.status, txHash);

                } catch (error) {
                    console.error(`Error broadcasting ${txType} transaction:`, error);
                    await GymAgentModel.updateOne(
                        { _id: agent._id, 'deployment.pendingTransaction.idempotencyKey': idempotencyKey },
                        { $set: { 'deployment.pendingTransaction.status': 'PENDING' } }
                    );
                    await transitionAgentStatus(agent, {
                        type: 'FAIL',
                        error: `Failed to broadcast transaction: ${(error as Error).message}`,
                    });
                    // Since we already responded, we can't throw an ApiError here.
                    // The failure is broadcasted via WebSocket by transitionAgentStatus.
                    return;
                }
            }

            try {
                const latestBlockHash = await blockchainService.connection.getLatestBlockhash('confirmed');

                // Configurable timeout based on network conditions
                const CONFIRMATION_TIMEOUT = process.env.NODE_ENV === 'production' ? 120000 : 60000; // 2 minutes in prod, 1 minute in dev
                const MAX_RETRIES = 3;
                let retryCount = 0;
                let confirmation;

                while (retryCount < MAX_RETRIES) {
                    try {
                        const confirmationPromise = blockchainService.connection.confirmTransaction(
                            {
                                signature: txHash,
                                blockhash: latestBlockHash.blockhash,
                                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                            },
                            'confirmed'
                        );

                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => {
                                reject(new Error(`Transaction confirmation timed out after ${CONFIRMATION_TIMEOUT / 1000} seconds (attempt ${retryCount + 1}/${MAX_RETRIES})`));
                            }, CONFIRMATION_TIMEOUT);
                        });

                        confirmation = await Promise.race([confirmationPromise, timeoutPromise]);

                        if ((confirmation as any).value?.err) {
                            throw new Error(`On-chain confirmation error: ${JSON.stringify((confirmation as any).value.err)}`);
                        }

                        // Success - break out of retry loop
                        break;

                    } catch (retryError) {
                        retryCount++;
                        const isTimeout = (retryError as Error).message.includes('timed out');

                        if (retryCount >= MAX_RETRIES) {
                            throw retryError;
                        }

                        if (isTimeout) {
                            console.warn(`[TRANSACTION_TIMEOUT] Retry ${retryCount}/${MAX_RETRIES} for transaction ${txHash}`, {
                                txType,
                                agentId: agent._id,
                                attempt: retryCount
                            });

                            // Exponential backoff: wait longer between retries
                            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                        } else {
                            // Non-timeout error - don't retry
                            throw retryError;
                        }
                    }
                }
            } catch (error) {
                console.error(`Transaction ${txHash} failed to confirm on-chain for ${txType}.`, error);

                // Check if it's a timeout error
                const errorMessage = (error as Error).message;
                const isTimeout = errorMessage.includes('timed out');

                await transitionAgentStatus(agent, {
                    type: 'FAIL',
                    error: isTimeout
                        ? `Transaction confirmation timed out. Transaction may still be processing on-chain: ${txHash}`
                        : `Transaction confirmation failed: ${errorMessage}`,
                });

                // Can't throw here as we already responded.
                return;
            }

            // Add timeout to transaction details retrieval
            let txDetails;
            try {
                const TX_DETAILS_TIMEOUT = 30000; // 30 seconds
                const detailsPromise = blockchainService.connection.getTransaction(txHash, {
                    maxSupportedTransactionVersion: 0,
                    commitment: 'confirmed',
                });

                const detailsTimeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Transaction details retrieval timed out after ${TX_DETAILS_TIMEOUT / 1000} seconds`));
                    }, TX_DETAILS_TIMEOUT);
                });

                txDetails = await Promise.race([detailsPromise, detailsTimeoutPromise]);
            } catch (error) {
                console.error(`Failed to retrieve transaction details for ${txHash}:`, error);
                // Don't fail the entire process for details retrieval timeout
                txDetails = null;
            }

            if (!txDetails) {
                console.warn(`Transaction ${txHash} confirmed but details unavailable. Using fallback data.`);
            }

            if (txType === 'TOKEN_CREATION') {
                if (!pendingTx.details.mint) {
                    throw ApiError.internalError('Mint details missing from pending transaction.');
                }
                return transitionAgentStatus(agent, {
                    type: 'TOKEN_CREATION_SUCCESS',
                    data: {
                        tokenAddress: pendingTx.details.mint,
                        txHash,
                        timestamp: (txDetails as any)?.blockTime || Math.floor(Date.now() / 1000),
                        slot: (txDetails as any)?.slot || 0,
                    },
                });
            } else { // POOL_CREATION
                if (!pendingTx.details.poolKeys) {
                    throw ApiError.internalError('Pool keys missing from pending transaction details.');
                }
                const poolKeys = JSON.parse(pendingTx.details.poolKeys);
                const poolAddress = poolKeys.ammPool;

                if (!poolAddress) {
                    throw ApiError.internalError('Could not find pool address in pending transaction details.');
                }
                return transitionAgentStatus(agent, {
                    type: 'POOL_CREATION_SUCCESS',
                    data: {
                        poolAddress,
                        txHash,
                        timestamp: (txDetails as any)?.blockTime || Math.floor(Date.now() / 1000),
                        slot: (txDetails as any)?.slot || 0,
                    },
                });
            }
        };

        // Do not await this. Let it run in the background.
        processTransaction(normalizedType as 'TOKEN_CREATION' | 'POOL_CREATION').catch(err => {
            // Log any unexpected errors during background processing.
            // The user has already been notified of acceptance, but we need to log this server-side.
            console.error(`[FATAL_TX_PROCESSING_ERROR] Unhandled error in background transaction processor for agent ${agentIdString}:`, err);
        });
    })
);

export { router as transactionRoutes };