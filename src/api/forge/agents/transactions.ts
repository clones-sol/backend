import express, { Request, Response, Router } from 'express';
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

const router: Router = express.Router();
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');
const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER || 'devnet') as Cluster;

// GET /:id/transactions/:type
router.get(
    '/:id/transactions/:type',
    requireWalletAddress,
    validateParams({
        id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] },
        type: { required: true, rules: [ValidationRules.isIn(['token-creation', 'pool-creation'])] }
    }),
    requireAgentOwnership,
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        // @ts-ignore
        const { agent } = req;
        const { type } = req.params;

        if (type === 'token-creation') {
            if (agent.deployment.status !== 'PENDING_TOKEN_SIGNATURE') {
                throw ApiError.badRequest(`Agent must be in PENDING_TOKEN_SIGNATURE status, but is in ${agent.deployment.status}.`);
            }

            const payer = new PublicKey(ownerAddress);
            const { transaction, mintKeypair } = await createTokenCreationTransaction(
                blockchainService.connection,
                payer,
                agent.tokenomics.supply,
                agent.tokenomics.decimals || 9
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

            agent.deployment.pendingTransaction = {
                idempotencyKey,
                type: 'TOKEN_CREATION',
                details: {
                    mint: mintKeypair.publicKey.toBase58(),
                },
            };
            await agent.save();

            const fee = await transaction.getEstimatedFee(blockchainService.connection);

            res.status(200).json(successResponse({
                transaction: base64Transaction,
                idempotencyKey,
                estimatedFeeSol: (fee || 0) / 1e9,
                mintAddress: mintKeypair.publicKey.toBase58(),
            }));
        } else if (type === 'pool-creation') {
            if (agent.deployment.status !== 'TOKEN_CREATED' && agent.deployment.status !== 'PENDING_POOL_SIGNATURE') {
                throw ApiError.badRequest(`Agent must be in TOKEN_CREATED or PENDING_POOL_SIGNATURE status, but is in ${agent.deployment.status}.`);
            }
            if (!agent.blockchain.tokenAddress) {
                throw ApiError.internalError('Agent token address is missing.');
            }

            const payer = new PublicKey(ownerAddress);

            const baseToken = new Token({
                mint: new PublicKey(agent.blockchain.tokenAddress),
                decimals: agent.tokenomics.decimals || 9,
                symbol: agent.ticker,
                name: agent.name
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
                    agent.tokenomics.supply,
                    agent.tokenomics.minLiquiditySol,
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

                agent.deployment.pendingTransaction = {
                    idempotencyKey,
                    type: 'POOL_CREATION',
                    details: {
                        poolKeys: JSON.stringify(poolKeys),
                    },
                };
                await agent.save();

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

// POST /:id/submit-tx
router.post(
    '/:id/submit-tx',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(submitTxSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const { agent } = req;
        const { type, signedTransaction, idempotencyKey } = req.body;

        if (!agent.deployment.pendingTransaction || agent.deployment.pendingTransaction.idempotencyKey !== idempotencyKey) {
            throw ApiError.badRequest('Invalid idempotency key or no pending transaction.');
        }

        const normalizedType = type.toUpperCase().replace('-', '_');

        if (agent.deployment.pendingTransaction.type !== normalizedType) {
            throw ApiError.badRequest(
                `Invalid transaction type. Expected ${agent.deployment.pendingTransaction.type}, got ${type}.`
            );
        }

        if (normalizedType === 'TOKEN_CREATION') {
            let txHash = agent.deployment.pendingTransaction.txHash;

            if (!txHash) {
                try {
                    const signedTransactionBuffer = Buffer.from(signedTransaction, 'base64');
                    txHash = await blockchainService.connection.sendRawTransaction(signedTransactionBuffer, {
                        skipPreflight: true,
                    });
                    agent.deployment.pendingTransaction.txHash = txHash;
                    await agent.save();
                } catch (error) {
                    console.error('Error broadcasting transaction:', error);
                    await transitionAgentStatus(agent, {
                        type: 'FAIL',
                        error: `Failed to broadcast transaction: ${(error as Error).message}`,
                    });
                    throw ApiError.internalError(`Failed to broadcast transaction: ${(error as Error).message}`);
                }
            }

            try {
                const latestBlockHash = await blockchainService.connection.getLatestBlockhash('confirmed');
                const confirmation = await blockchainService.connection.confirmTransaction(
                    {
                        signature: txHash,
                        blockhash: latestBlockHash.blockhash,
                        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                    },
                    'confirmed'
                );

                if (confirmation.value.err) {
                    throw new Error(`On-chain confirmation error: ${JSON.stringify(confirmation.value.err)}`);
                }
            } catch (error) {
                console.error(`Transaction ${txHash} failed to confirm on-chain.`, error);
                const failedAgent = await transitionAgentStatus(agent, {
                    type: 'FAIL',
                    error: `Transaction confirmation failed: ${(error as Error).message}`,
                });
                throw ApiError.badRequest('Transaction confirmation failed.', { details: failedAgent });
            }

            const txDetails = await blockchainService.connection.getTransaction(txHash, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });
            if (!txDetails) {
                throw ApiError.internalError('Failed to retrieve transaction details after confirmation.');
            }

            // A final check before using the details
            if (!agent.deployment.pendingTransaction?.details.mint) {
                throw ApiError.internalError('Mint details missing from pending transaction.');
            }

            const updatedAgent = await transitionAgentStatus(agent, {
                type: 'TOKEN_CREATION_SUCCESS',
                data: {
                    tokenAddress: agent.deployment.pendingTransaction.details.mint,
                    txHash,
                    timestamp: txDetails.blockTime || Math.floor(Date.now() / 1000),
                    slot: txDetails.slot,
                },
            });

            res.status(200).json(successResponse(updatedAgent));
        } else if (normalizedType === 'POOL_CREATION') {
            let txHash = agent.deployment.pendingTransaction.txHash;

            if (!txHash) {
                try {
                    const signedTransactionBuffer = Buffer.from(signedTransaction, 'base64');
                    txHash = await blockchainService.connection.sendRawTransaction(signedTransactionBuffer, {
                        skipPreflight: true,
                    });
                    agent.deployment.pendingTransaction.txHash = txHash;
                    await agent.save();
                } catch (error) {
                    console.error('Error broadcasting pool creation transaction:', error);
                    await transitionAgentStatus(agent, {
                        type: 'FAIL',
                        error: `Failed to broadcast pool creation transaction: ${(error as Error).message}`,
                    });
                    throw ApiError.internalError(`Failed to broadcast pool creation transaction: ${(error as Error).message}`);
                }
            }

            try {
                const latestBlockHash = await blockchainService.connection.getLatestBlockhash('confirmed');
                const confirmation = await blockchainService.connection.confirmTransaction(
                    {
                        signature: txHash,
                        blockhash: latestBlockHash.blockhash,
                        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                    },
                    'confirmed'
                );

                if (confirmation.value.err) {
                    throw new Error(`On-chain confirmation error for pool creation: ${JSON.stringify(confirmation.value.err)}`);
                }
            } catch (error) {
                console.error(`Pool creation transaction ${txHash} failed to confirm on-chain.`, error);
                const failedAgent = await transitionAgentStatus(agent, {
                    type: 'FAIL',
                    error: `Pool creation transaction confirmation failed: ${(error as Error).message}`,
                });
                throw ApiError.badRequest('Pool creation transaction confirmation failed.', { details: failedAgent });
            }

            const txDetails = await blockchainService.connection.getTransaction(txHash, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });
            if (!txDetails) {
                throw ApiError.internalError('Failed to retrieve pool creation transaction details after confirmation.');
            }

            if (!agent.deployment.pendingTransaction?.details.poolKeys) {
                throw ApiError.internalError('Pool keys missing from pending transaction details.');
            }

            const poolKeys = JSON.parse(agent.deployment.pendingTransaction.details.poolKeys);
            const poolAddress = poolKeys.ammPool;

            if (!poolAddress) {
                throw ApiError.internalError('Could not find pool address in pending transaction details.');
            }

            const updatedAgent = await transitionAgentStatus(agent, {
                type: 'POOL_CREATION_SUCCESS',
                data: {
                    poolAddress,
                    txHash,
                    timestamp: txDetails.blockTime || Math.floor(Date.now() / 1000),
                    slot: txDetails.slot,
                },
            });

            res.status(200).json(successResponse(updatedAgent));
        } else {
            throw ApiError.badRequest('Invalid transaction type.');
        }
    })
);

export { router as transactionRoutes }; 