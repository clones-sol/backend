import express, { Request, Response, Router } from 'express';
import { requireWalletAddress } from '../../middleware/auth.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validator.ts';
import {
    createAgentSchema,
    updateAgentSchema,
    updateAgentStatusSchema,
    submitTxSchema,
    agentVersionSchema,
    setActiveVersionSchema,
    metricsQuerySchema,
    searchAgentsSchema,
} from '../schemas/forge-agents.ts';
import { ApiError, ErrorCode, successResponse } from '../../middleware/types/errors.ts';
import { GymAgentModel, TrainingPoolModel, GymAgentInvocationModel } from '../../models/Models.ts';
import { IGymAgent } from '../../models/GymAgent.ts';
import { encrypt } from '../../services/security/crypto.ts';
import { ValidationRules } from '../../middleware/validator.ts';
import { validateHuggingFaceApiKey } from '../../services/huggingface/index.ts';
import { transitionAgentStatus } from '../../services/agents/index.ts';
import BlockchainService from '../../services/blockchain/index.ts';
import { PublicKey } from '@solana/web3.js';
import { createTokenCreationTransaction } from '../../services/blockchain/splTokenService.ts';
import { v4 as uuidv4 } from 'uuid';
import { idValidationSchema } from '../schemas/common.ts';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Token } from '@raydium-io/raydium-sdk-v2';
import { createPoolCreationTransaction } from '../../services/blockchain/raydiumService.ts';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';

const router: Router = express.Router();
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');

/**
 * Creates a sanitized copy of agent data for logging purposes, redacting sensitive fields.
 * @param data The raw data object from the request body.
 * @returns A sanitized data object.
 */
const sanitizeAgentDataForLogging = (data: any) => {
    const sanitized = JSON.parse(JSON.stringify(data));
    if (sanitized.deployment?.huggingFaceApiKey) {
        sanitized.deployment.huggingFaceApiKey = '[REDACTED]';
    }
    return sanitized;
};

/**
 * Creates the initial deployment version object if deployment data is provided.
 * @param deploymentData The deployment data from the request.
 * @returns A DeploymentVersion object or undefined.
 */
const createFirstDeploymentVersion = (deploymentData?: { customUrl?: string; huggingFaceApiKey?: string }) => {
    if (!deploymentData || (!deploymentData.customUrl && !deploymentData.huggingFaceApiKey)) {
        return undefined;
    }

    return {
        versionTag: 'v1.0',
        status: 'active' as const,
        createdAt: new Date(),
        customUrl: deploymentData.customUrl,
        encryptedApiKey: deploymentData.huggingFaceApiKey ? encrypt(deploymentData.huggingFaceApiKey) : undefined,
    };
};

router.post(
    '/',
    requireWalletAddress,
    validateBody(createAgentSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;
        const { pool_id, name, ticker, description, logoUrl, tokenomics, deployment } = req.body;

        // 0. Validate Hugging Face API key if provided
        if (deployment?.huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(deployment.huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        // 1. Check if an agent already exists for this pool
        const existingAgent = await GymAgentModel.findOne({ pool_id });
        if (existingAgent) {
            throw ApiError.conflict(`An agent already exists for pool_id ${pool_id}.`);
        }

        // 2. Verify ownership of the training pool
        const pool = await TrainingPoolModel.findById(pool_id);
        if (!pool) {
            throw ApiError.notFound(`TrainingPool with id ${pool_id} not found.`);
        }
        if (pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not the owner of the specified TrainingPool.');
        }

        // Sanitize the request body for audit logging
        const sanitizedDetails = sanitizeAgentDataForLogging(req.body);

        // 3. Create the new agent
        const newAgentData: Partial<IGymAgent> = {
            pool_id,
            name,
            ticker,
            description,
            logoUrl,
            tokenomics,
            deployment: {
                status: 'DRAFT',
                versions: [],
            },
            auditLog: [{
                timestamp: new Date(),
                user: ownerAddress,
                action: 'CREATE',
                details: sanitizedDetails
            }]
        };

        // 4. Handle initial deployment version if provided
        const firstVersion = createFirstDeploymentVersion(deployment);
        if (firstVersion) {
            newAgentData.deployment!.versions.push(firstVersion);
            newAgentData.deployment!.activeVersionTag = firstVersion.versionTag;
        }

        const agent = new GymAgentModel(newAgentData);
        await agent.save();

        res.status(201).json(successResponse(agent));
    })
);

router.get(
    '/',
    requireWalletAddress,
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;

        // 1. Find all pools owned by the user
        const userPools = await TrainingPoolModel.find({ ownerAddress }).select('_id');

        // 2. Get the IDs of the pools
        const poolIds = userPools.map(pool => pool._id);

        if (poolIds.length === 0) {
            return res.status(200).json(successResponse([]));
        }

        // 3. Find all agents associated with those pools
        const agents = await GymAgentModel.find({ pool_id: { $in: poolIds } });

        res.status(200).json(successResponse(agents));
    })
);

router.get(
    '/search',
    rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 100, // Limit each IP to 100 requests per windowMs
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    }),
    validateQuery(searchAgentsSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { q, sortBy = 'newest', limit = '10', offset = '0' } = req.query;

        const parsedLimit = parseInt(limit as string, 10);
        const parsedOffset = parseInt(offset as string, 10);

        // 1. Build query filters
        const filters: any = { 'deployment.status': 'DEPLOYED' };
        if (q) {
            filters.$text = { $search: q as string };
        }

        // 2. Build sort options
        const sortOptions: any = {};
        if (sortBy === 'name') {
            sortOptions.name = 1;
        } else {
            sortOptions.createdAt = -1; // Default to newest
        }

        // 3. Define projection for public data
        const projection = {
            name: 1,
            ticker: 1,
            description: 1,
            logoUrl: 1,
            'tokenomics.supply': 1,
            'tokenomics.gatedPercentage': 1,
            'blockchain.tokenAddress': 1,
            'blockchain.poolAddress': 1,
        };

        // 4. Execute queries for data and total count
        const agents = await GymAgentModel.find(filters)
            .sort(sortOptions)
            .skip(parsedOffset)
            .limit(parsedLimit)
            .select(projection)
            .lean();

        const total = await GymAgentModel.countDocuments(filters);

        // 5. Format and send response
        res.status(200).json(successResponse({
            data: agents,
            pagination: {
                total,
                limit: parsedLimit,
                offset: parsedOffset,
            }
        }));
    })
);

router.put(
    '/:id',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    validateBody(updateAgentSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;
        const { id } = req.params;
        const updateData = req.body;

        // 0. Validate new Hugging Face API key if provided
        if (updateData.deployment?.huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(updateData.deployment.huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        // 1. Find agent and verify ownership
        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to update this agent.');
        }

        const changedFields: string[] = [];

        // 2. Apply updates based on status
        if (agent.deployment.status === 'DRAFT') {
            // Can update most fields in DRAFT
            if (updateData.name && agent.name !== updateData.name) {
                agent.name = updateData.name;
                changedFields.push('name');
            }
            if (updateData.tokenomics) {
                agent.tokenomics = { ...agent.tokenomics, ...updateData.tokenomics };
                changedFields.push('tokenomics');
            }
        }

        // Fields updatable in DRAFT, DEPLOYED, or DEACTIVATED status
        if (['DRAFT', 'DEPLOYED', 'DEACTIVATED'].includes(agent.deployment.status)) {
            if (updateData.description && agent.description !== updateData.description) {
                agent.description = updateData.description;
                changedFields.push('description');
            }
            if (updateData.logoUrl && agent.logoUrl !== updateData.logoUrl) {
                agent.logoUrl = updateData.logoUrl;
                changedFields.push('logoUrl');
            }

            // Handle deployment updates for the active version
            if (updateData.deployment) {
                const activeVersion = agent.deployment.versions.find(v => v.versionTag === agent.deployment.activeVersionTag);

                if (!activeVersion && agent.deployment.status === 'DRAFT') {
                    // If in DRAFT and no versions exist, create the first one directly with data.
                    const firstVersion = createFirstDeploymentVersion(updateData.deployment);
                    if (firstVersion) {
                        agent.deployment.versions.push(firstVersion);
                        agent.deployment.activeVersionTag = firstVersion.versionTag;
                        changedFields.push('deployment.versions');
                    }
                } else if (activeVersion) {
                    // Update an existing active version
                    if (updateData.deployment.customUrl && activeVersion.customUrl !== updateData.deployment.customUrl) {
                        activeVersion.customUrl = updateData.deployment.customUrl;
                        changedFields.push('deployment.customUrl');
                    }
                    if (updateData.deployment.huggingFaceApiKey) {
                        const newEncryptedKey = encrypt(updateData.deployment.huggingFaceApiKey);
                        if (activeVersion.encryptedApiKey !== newEncryptedKey) {
                            activeVersion.encryptedApiKey = newEncryptedKey;
                            changedFields.push('deployment.huggingFaceApiKey');
                        }
                    }
                }
            }
        }

        // 3. Add to audit log and save if changes were made
        if (changedFields.length > 0) {
            // Sanitize the update data before logging to avoid storing sensitive info
            const sanitizedDetails = sanitizeAgentDataForLogging(updateData);

            agent.auditLog.push({
                timestamp: new Date(),
                user: ownerAddress,
                action: 'UPDATE',
                details: sanitizedDetails
            });
            await agent.save();
        } else if (Object.keys(updateData).length > 0) {
            // If there's data in the body but no valid fields were updated, throw an error.
            throw ApiError.badRequest(`Agent cannot be updated in its current status: ${agent.deployment.status}, or no valid fields were provided.`);
        }

        res.status(200).json(successResponse(agent));
    })
);

router.post(
    '/:id/deploy',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;

        // 1. Find agent
        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        // 2. Verify ownership
        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to deploy this agent.');
        }

        // 3. Perform the transition
        const updatedAgent = await transitionAgentStatus(agent, { type: 'INITIATE_DEPLOYMENT' });

        res.status(200).json(successResponse(updatedAgent));
    })
);

router.patch(
    '/:id/status',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    validateBody(updateAgentStatusSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;
        const { status } = req.body;

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to change this agent\'s status.');
        }

        let updatedAgent;
        if (status === 'DEACTIVATED') {
            updatedAgent = await transitionAgentStatus(agent, { type: 'DEACTIVATE' });
        } else {
            // This case should be blocked by the validator, but as a safeguard:
            throw ApiError.badRequest(`Unsupported status transition to '${status}'.`);
        }

        res.status(200).json(successResponse(updatedAgent));
    })
);

router.delete(
    '/:id',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to archive this agent.');
        }

        // The state machine will automatically prevent archiving from an invalid state (e.g., DEPLOYED).
        const updatedAgent = await transitionAgentStatus(agent, { type: 'ARCHIVE' });

        res.status(200).json(successResponse(updatedAgent));
    })
);

router.get(
    '/:id/transactions/:type',
    requireWalletAddress,
    validateParams({
        id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] },
        type: { required: true, rules: [ValidationRules.isIn(['token-creation', 'pool-creation'])] }
    }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id, type } = req.params;

        // 1. Find agent and verify ownership
        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to perform this action.');
        }

        // 2. Handle token creation
        if (type === 'token-creation') {
            if (agent.deployment.status !== 'PENDING_TOKEN_SIGNATURE') {
                throw ApiError.badRequest(`Agent must be in PENDING_TOKEN_SIGNATURE status, but is in ${agent.deployment.status}.`);
            }

            const payer = new PublicKey(ownerAddress);
            const { transaction, mintKeypair } = await createTokenCreationTransaction(
                blockchainService.connection,
                payer,
                agent.tokenomics.supply,
                agent.tokenomics.decimals || 9 // Use default 9 if not specified
            );

            // 3. Set recent blockhash and fee payer
            const { blockhash } = await blockchainService.connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = payer;

            // 4. Temporarily sign with the mint keypair to get a fee estimate.
            // This signature will not be sent to the client.
            transaction.partialSign(mintKeypair);

            // 5. Serialize the transaction (partially signed) and convert to base64
            const serializedTransaction = transaction.serialize({
                requireAllSignatures: false, // Important: we only need the fee payer's signature
            });
            const base64Transaction = serializedTransaction.toString('base64');

            // 6. Generate idempotency key
            const idempotencyKey = uuidv4();

            // 7. Save pending transaction details to the agent
            agent.deployment.pendingTransaction = {
                idempotencyKey,
                type: 'TOKEN_CREATION',
                details: {
                    mint: mintKeypair.publicKey.toBase58(),
                },
            };
            await agent.save();

            // 8. Estimate fee
            const fee = await transaction.getEstimatedFee(blockchainService.connection);

            res.status(200).json(successResponse({
                transaction: base64Transaction,
                idempotencyKey,
                estimatedFeeSol: (fee || 0) / 1e9, // Convert lamports to SOL, default to 0 if null
                mintAddress: mintKeypair.publicKey.toBase58(),
            }));
        } else if (type === 'pool-creation') {

            if (agent.deployment.status !== 'TOKEN_CREATED') {
                throw ApiError.badRequest(`Agent must be in TOKEN_CREATED status, but is in ${agent.deployment.status}.`);
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
                    agent.tokenomics.minLiquiditySol
                );

                const { blockhash } = await blockchainService.connection.getLatestBlockhash('confirmed');
                transaction.message.recentBlockhash = blockhash;

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

router.post(
    '/:id/retry-deployment',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to retry this agent\'s deployment.');
        }

        // The state machine will only allow this transition from the FAILED state
        // and will determine the correct state to return to (PENDING_TOKEN_SIGNATURE or PENDING_POOL_SIGNATURE).
        const updatedAgent = await transitionAgentStatus(agent, { type: 'RETRY' });

        res.status(200).json(successResponse(updatedAgent));
    })
);

router.post(
    '/:id/cancel',
    requireWalletAddress,
    validateParams({ id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to cancel this agent\'s deployment.');
        }

        const updatedAgent = await transitionAgentStatus(agent, { type: 'CANCEL' });

        res.status(200).json(successResponse(updatedAgent));
    })
);

router.post(
    '/:id/submit-tx',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(submitTxSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { id } = req.params;
        const { type, signedTransaction, idempotencyKey } = req.body;
        // @ts-ignore
        const walletAddress = req.walletAddress;

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound('Agent not found');
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== walletAddress) {
            throw ApiError.forbidden('You are not authorized to perform this action.');
        }

        if (!agent.deployment.pendingTransaction || agent.deployment.pendingTransaction.idempotencyKey !== idempotencyKey) {
            throw ApiError.badRequest('Invalid idempotency key or no pending transaction.');
        }

        // Normalize the input type to match the stored format (e.g., 'token-creation' -> 'TOKEN_CREATION')
        const normalizedType = type.toUpperCase().replace('-', '_');

        if (agent.deployment.pendingTransaction.type !== normalizedType) {
            throw ApiError.badRequest(
                `Invalid transaction type. Expected ${agent.deployment.pendingTransaction.type}, got ${type}.`
            );
        }

        if (normalizedType === 'TOKEN_CREATION') {
            let txHash = agent.deployment.pendingTransaction.txHash;

            // Broadcast transaction only if it hasn't been broadcasted before
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

            // Confirm the transaction
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
                throw ApiError.badRequest(`Transaction confirmation failed.`, failedAgent);
            }

            // Fetch transaction details
            const txDetails = await blockchainService.connection.getTransaction(txHash, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });
            if (!txDetails) {
                throw ApiError.internalError('Failed to retrieve transaction details after confirmation.');
            }

            // Transition state machine to TOKEN_CREATED
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

            // Broadcast transaction only if it hasn't been broadcasted before
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

            // Confirm the transaction
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
                throw ApiError.badRequest(`Pool creation transaction confirmation failed.`, failedAgent);
            }

            // Fetch transaction details
            const txDetails = await blockchainService.connection.getTransaction(txHash, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });
            if (!txDetails) {
                throw ApiError.internalError('Failed to retrieve pool creation transaction details after confirmation.');
            }

            // Extract pool address from stored details
            const poolKeys = JSON.parse(agent.deployment.pendingTransaction.details.poolKeys);
            const poolAddress = poolKeys.ammPool;

            if (!poolAddress) {
                throw ApiError.internalError('Could not find pool address in pending transaction details.');
            }

            // Transition state machine to DEPLOYED
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

router.post(
    '/:id/versions',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(agentVersionSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;
        const { versionTag, customUrl, huggingFaceApiKey } = req.body;

        // 1. Find agent and verify ownership
        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to add a version to this agent.');
        }

        // 2. Validate Hugging Face API key if provided
        if (huggingFaceApiKey) {
            const isApiKeyValid = await validateHuggingFaceApiKey(huggingFaceApiKey);
            if (!isApiKeyValid) {
                throw ApiError.badRequest('The provided Hugging Face API key is invalid.');
            }
        }

        // 3. Check if version tag already exists
        if (agent.deployment.versions.some(v => v.versionTag === versionTag)) {
            throw ApiError.conflict(`Version tag '${versionTag}' already exists for this agent.`);
        }

        // 4. Create and add the new version
        const newVersion = {
            versionTag,
            customUrl,
            encryptedApiKey: huggingFaceApiKey ? encrypt(huggingFaceApiKey) : undefined,
            status: 'deprecated' as const,
            createdAt: new Date(),
        };

        agent.deployment.versions.push(newVersion);

        agent.auditLog.push({
            timestamp: new Date(),
            user: ownerAddress,
            action: 'ADD_VERSION',
            details: { versionTag, customUrl, huggingFaceApiKey: huggingFaceApiKey ? '[REDACTED]' : undefined } as any
        });

        await agent.save();

        res.status(201).json(successResponse(agent));
    })
);

router.put(
    '/:id/versions/active',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateBody(setActiveVersionSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;
        const { versionTag } = req.body;

        const agent = await GymAgentModel.findById(id);
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to modify this agent.');
        }

        const targetVersion = agent.deployment.versions.find(v => v.versionTag === versionTag);
        if (!targetVersion) {
            throw ApiError.notFound(`Version with tag '${versionTag}' not found.`);
        }

        if (targetVersion.status === 'active') {
            return res.status(200).json(successResponse(agent)); // Already active, do nothing.
        }

        const currentActiveVersion = agent.deployment.versions.find(v => v.status === 'active');
        if (currentActiveVersion) {
            currentActiveVersion.status = 'deprecated';
        }

        targetVersion.status = 'active';
        agent.deployment.activeVersionTag = versionTag;

        agent.auditLog.push({
            timestamp: new Date(),
            user: ownerAddress,
            action: 'SET_ACTIVE_VERSION',
            details: { versionTag } as any
        });

        await agent.save();

        res.status(200).json(successResponse(agent));
    })
);

router.get(
    '/:id/health',
    requireWalletAddress,
    validateParams(idValidationSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;

        const agent = await GymAgentModel.findById(id).select('deployment.status deployment.lastError');
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        // Basic ownership check is still good practice for private health checks
        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to view this agent\'s health.');
        }

        const healthStatus = {
            status: agent.deployment.status,
            isOperational: agent.deployment.status === 'DEPLOYED',
            lastError: agent.deployment.lastError,
        };

        res.status(200).json(successResponse(healthStatus));
    })
);

router.get(
    '/:id/metrics',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateQuery(metricsQuerySchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore
        const ownerAddress = req.walletAddress;
        const { id } = req.params;
        const { timeframe = '24h', versionTag } = req.query as { timeframe?: string; versionTag?: string };

        // 1. Find agent and verify ownership
        const agent = await GymAgentModel.findById(id).select('_id pool_id');
        if (!agent) {
            throw ApiError.notFound(`Agent with id ${id} not found.`);
        }

        const pool = await TrainingPoolModel.findById(agent.pool_id);
        if (!pool || pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not authorized to view this agent\'s metrics.');
        }

        // 2. Build the aggregation pipeline
        const agentId = new mongoose.Types.ObjectId(id);
        const now = new Date();
        let startDate;
        switch (timeframe) {
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '24h':
            default:
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
        }

        const matchFilter: any = {
            agentId: agentId,
            timestamp: { $gte: startDate },
        };

        if (versionTag) {
            matchFilter.versionTag = versionTag;
        }

        const pipeline = [
            { $match: matchFilter },
            {
                $group: {
                    _id: null,
                    totalRequests: { $sum: 1 },
                    totalSuccessful: { $sum: { $cond: ['$isSuccess', 1, 0] } },
                    totalDurationMs: { $sum: '$durationMs' }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalRequests: 1,
                    errorRate: {
                        $cond: [
                            { $eq: ['$totalRequests', 0] },
                            0,
                            { $divide: [{ $subtract: ['$totalRequests', '$totalSuccessful'] }, '$totalRequests'] }
                        ]
                    },
                    averageResponseTimeMs: {
                        $cond: [
                            { $eq: ['$totalRequests', 0] },
                            0,
                            { $divide: ['$totalDurationMs', '$totalRequests'] }
                        ]
                    }
                }
            }
        ];

        // 3. Execute aggregation
        const results = await GymAgentInvocationModel.aggregate(pipeline);

        // 4. Format and return response
        let metrics;
        if (results.length > 0) {
            metrics = {
                timeframe,
                ...results[0],
                averageResponseTimeMs: Math.round(results[0].averageResponseTimeMs),
            };
        } else {
            metrics = {
                timeframe,
                totalRequests: 0,
                errorRate: 0,
                averageResponseTimeMs: 0,
            };
        }
        if (versionTag) {
            // @ts-ignore
            metrics.versionTag = versionTag;
        }

        res.status(200).json(successResponse(metrics));
    })
);


router.get(
    '/pool/:pool_id',
    requireWalletAddress,
    validateParams({ pool_id: { required: true, rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')] } }),
    errorHandlerAsync(async (req: Request, res: Response) => {
        // @ts-ignore - Get walletAddress from the request object
        const ownerAddress = req.walletAddress;
        const { pool_id } = req.params;

        // 1. Find the agent by pool_id
        const agent = await GymAgentModel.findOne({ pool_id });
        if (!agent) {
            throw ApiError.notFound(`Agent for pool_id ${pool_id} not found.`);
        }

        // 2. Verify ownership of the training pool
        const pool = await TrainingPoolModel.findById(pool_id);
        if (!pool) {
            // This case should ideally not happen if an agent exists, indicates data inconsistency
            throw ApiError.internalError(`Data inconsistency: TrainingPool ${pool_id} not found for existing agent.`);
        }
        if (pool.ownerAddress !== ownerAddress) {
            throw ApiError.forbidden('You are not the owner of the specified TrainingPool.');
        }

        // 3. Return the agent
        res.status(200).json(successResponse(agent));
    })
);


export { router as forgeAgentsApi }; 