import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TrainingPoolModel, GymAgentModel } from '../../models/Models.ts';
import { DBTrainingPool } from '../../types/index.ts';
import { validateHuggingFaceApiKey } from '../../services/huggingface/index.ts';
import { createTokenCreationTransaction } from '../../services/blockchain/splTokenService.ts';
import { createPoolCreationTransaction } from '../../services/blockchain/raydiumService.ts';
import { PublicKey } from '@solana/web3.js';

const ownerAddress = 'GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK'; // A valid Base58 public key

// Mock external services
vi.mock('../../services/huggingface/index.ts', () => ({
    validateHuggingFaceApiKey: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../middleware/auth.ts', () => ({
    requireWalletAddress: (req: Request, res: Response, next: NextFunction) => {
        // @ts-ignore
        req.walletAddress = ownerAddress; // Use the valid address
        next();
    },
}));

// Define the mock connection object at the top level so it can be hoisted.
const mockConnection = {
    getLatestBlockhash: vi.fn(),
    sendRawTransaction: vi.fn(),
    confirmTransaction: vi.fn(),
    getFeeForMessage: vi.fn(),
    getTransaction: vi.fn(),
};

// Mock blockchain transaction services
vi.mock('../../services/blockchain/index.ts', () => {
    return {
        default: class MockBlockchainService {
            connection = mockConnection;
        }
    };
});

vi.mock('../../services/blockchain/splTokenService.ts', () => ({
    createTokenCreationTransaction: vi.fn(),
}));

vi.mock('../../services/blockchain/raydiumService.ts', () => ({
    createPoolCreationTransaction: vi.fn(),
}));

let app: express.Express;

describe('Forge Agents API', () => {
    let mongoServer: MongoMemoryServer;
    let trainingPool: Document & DBTrainingPool;

    beforeAll(async () => {
        // Dynamically import app after all mocks are set up
        const serverModule = await import('../../server.ts');
        app = serverModule.app;

        // Setup middleware and routes after app is initialized
        app.use(express.json());
        const { forgeAgentsApi } = await import('./agents.ts');
        const { errorHandler } = await import('../../middleware/errorHandler.ts');
        app.use('/api/v1/forge/agents', forgeAgentsApi);
        app.use(errorHandler);

        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        trainingPool = await TrainingPoolModel.create({
            name: 'Test Pool for Agents',
            ownerAddress: ownerAddress,
            // Add other required fields for TrainingPoolModel to be valid
            skills: "testing",
            depositAddress: "dummy_deposit_address",
            depositPrivateKey: "dummy_private_key_encrypted",
            token: {
                type: 'SOL',
                symbol: 'SOL'
            }
        });
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    afterEach(async () => {
        // Clean up the GymAgent collection after each test to ensure isolation
        await GymAgentModel.deleteMany({});
    });

    describe('POST /api/v1/forge/agents', () => {
        it('should create a new agent successfully with valid data', async () => {
            if (!trainingPool?._id) throw new Error('Test setup failed: trainingPool not initialized');
            const agentData = {
                pool_id: trainingPool._id.toString(),
                name: 'My Test Agent',
                ticker: 'AGENTX',
                description: 'This is a test agent for integration testing.',
                tokenomics: {
                    supply: 1000000,
                    minLiquiditySol: 5,
                    decimals: 9,
                },
            };

            const response = await supertest(app)
                .post('/api/v1/forge/agents')
                .send(agentData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.data.name).toBe(agentData.name);
            expect(response.body.data.deployment.status).toBe('DRAFT');
            expect(response.body.data.pool_id).toBe(agentData.pool_id);

            const dbAgent = await GymAgentModel.findById(response.body.data._id);
            expect(dbAgent).not.toBeNull();
            expect(dbAgent?.name).toBe(agentData.name);
        });

        it('should fail with 403 Forbidden if user does not own the pool', async () => {
            if (!trainingPool?._id) throw new Error('Test setup failed: trainingPool not initialized');
            const otherPool = await TrainingPoolModel.create({
                name: 'Someone Elses Pool',
                ownerAddress: 'another-wallet-address',
                skills: "testing",
                depositAddress: "dummy_deposit_address_2",
                depositPrivateKey: "dummy_private_key_encrypted_2",
                token: {
                    type: 'SOL',
                    symbol: 'SOL'
                }
            });

            const agentData = {
                pool_id: otherPool._id.toString(),
                name: 'Unauthorized Agent',
                ticker: 'NOAUTH',
                description: 'This should not be created.',
                tokenomics: {
                    supply: 1000,
                    minLiquiditySol: 1,
                    decimals: 9,
                },
            };

            const response = await supertest(app)
                .post('/api/v1/forge/agents')
                .send(agentData)
                .expect(403);

            expect(response.body.error.message).toContain('You are not the owner');
        });

        it('should fail with 400 Bad Request for invalid data (e.g., short ticker)', async () => {
            if (!trainingPool?._id) throw new Error('Test setup failed: trainingPool not initialized');
            const agentData = {
                pool_id: trainingPool._id.toString(),
                name: 'My Test Agent',
                ticker: 'A', // Invalid ticker
                description: 'This is a test agent for integration testing.',
                tokenomics: {
                    supply: 1000000,
                    minLiquiditySol: 5,
                    decimals: 9,
                },
            };

            const response = await supertest(app)
                .post('/api/v1/forge/agents')
                .send(agentData)
                .expect(400);

            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(response.body.error.details.fields.ticker).toBeDefined();
        });
    });

    describe('Lifecycle Endpoints', () => {
        let agent: any;

        beforeEach(async () => {
            // Create a fresh agent in DRAFT state before each lifecycle test
            agent = await GymAgentModel.create({
                pool_id: trainingPool._id,
                name: 'Lifecycle Test Agent',
                ticker: 'LIFE',
                description: 'Testing state transitions.',
                tokenomics: { supply: 1000, minLiquiditySol: 1, decimals: 9 },
                auditLog: [],
                deployment: { status: 'DRAFT', versions: [] },
            });
        });

        it('POST /:id/deploy should transition agent from DRAFT to PENDING_TOKEN_SIGNATURE', async () => {
            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/deploy`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('PENDING_TOKEN_SIGNATURE');
            const dbAgent = await GymAgentModel.findById(agent._id);
            expect(dbAgent?.deployment.status).toBe('PENDING_TOKEN_SIGNATURE');
        });

        it('should fail to deploy if agent is not in DRAFT status', async () => {
            agent.deployment.status = 'PENDING_TOKEN_SIGNATURE';
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/deploy`)
                .expect(400);

            expect(response.body.error.message).toContain('Invalid transition');
        });

        it('POST /:id/cancel should transition agent from PENDING_TOKEN_SIGNATURE back to DRAFT', async () => {
            agent.deployment.status = 'PENDING_TOKEN_SIGNATURE';
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/cancel`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('DRAFT');
        });

        it('should fail to cancel if agent is not in a pending status', async () => {
            agent.deployment.status = 'DEPLOYED';
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/cancel`)
                .expect(400);

            expect(response.body.error.message).toContain('Invalid transition');
        });

        it('POST /:id/cancel should transition agent from PENDING_POOL_SIGNATURE to FAILED', async () => {
            agent.deployment.status = 'PENDING_POOL_SIGNATURE';
            agent.blockchain = { tokenAddress: 'some-token-address' };
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/cancel`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('FAILED');
            expect(response.body.data.deployment.lastError).toContain('cancelled by user after token creation');
        });

        it('POST /:id/retry-deployment should transition from FAILED to PENDING_TOKEN_SIGNATURE if no token exists', async () => {
            agent.deployment.status = 'FAILED';
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/retry-deployment`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('PENDING_TOKEN_SIGNATURE');
        });

        it('should fail to retry if agent is not in FAILED status', async () => {
            agent.deployment.status = 'DRAFT';
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/retry-deployment`)
                .expect(400);

            expect(response.body.error.message).toContain('Invalid transition');
        });

        it('POST /:id/retry-deployment should transition from FAILED to PENDING_POOL_SIGNATURE if a token exists', async () => {
            agent.deployment.status = 'FAILED';
            agent.blockchain = { tokenAddress: 'some-token-address' };
            await agent.save();

            const response = await supertest(app)
                .post(`/api/v1/forge/agents/${agent._id}/retry-deployment`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('PENDING_POOL_SIGNATURE');
        });

        it('DELETE /:id should transition agent from DRAFT to ARCHIVED', async () => {
            const response = await supertest(app)
                .delete(`/api/v1/forge/agents/${agent._id}`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('ARCHIVED');
        });

        it('DELETE /:id should transition agent from DEACTIVATED to ARCHIVED', async () => {
            agent.deployment.status = 'DEACTIVATED';
            await agent.save();

            const response = await supertest(app)
                .delete(`/api/v1/forge/agents/${agent._id}`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('ARCHIVED');
        });

        it('DELETE /:id should transition agent from FAILED to ARCHIVED', async () => {
            agent.deployment.status = 'FAILED';
            await agent.save();

            const response = await supertest(app)
                .delete(`/api/v1/forge/agents/${agent._id}`)
                .expect(200);

            expect(response.body.data.deployment.status).toBe('ARCHIVED');
        });

        it('DELETE /:id should fail if agent is in a non-archivable state like DEPLOYED', async () => {
            agent.deployment.status = 'DEPLOYED';
            await agent.save();

            const response = await supertest(app)
                .delete(`/api/v1/forge/agents/${agent._id}`)
                .expect(400);

            expect(response.body.error.message).toContain('Invalid transition');
        });

        it('PATCH /:id/status should transition from DEPLOYED to DEACTIVATED', async () => {
            agent.deployment.status = 'DEPLOYED';
            await agent.save();

            const response = await supertest(app)
                .patch(`/api/v1/forge/agents/${agent._id}/status`)
                .send({ status: 'DEACTIVATED' })
                .expect(200);

            expect(response.body.data.deployment.status).toBe('DEACTIVATED');
        });

        it('PATCH /:id/status should fail if agent is not DEPLOYED', async () => {
            agent.deployment.status = 'DRAFT'; // Cannot deactivate from DRAFT
            await agent.save();

            const response = await supertest(app)
                .patch(`/api/v1/forge/agents/${agent._id}/status`)
                .send({ status: 'DEACTIVATED' })
                .expect(400);

            expect(response.body.error.message).toContain('Invalid transition');
        });

        it('PATCH /:id/status should fail for an unsupported status', async () => {
            agent.deployment.status = 'DEPLOYED';
            await agent.save();

            const response = await supertest(app)
                .patch(`/api/v1/forge/agents/${agent._id}/status`)
                .send({ status: 'DRAFT' }) // Cannot transition to DRAFT via this endpoint
                .expect(400);

            expect(response.body.error.details.fields.status).toContain('Must be one of: DEACTIVATED');
        });
    });

    describe('PUT /api/v1/forge/agents/:id', () => {
        let agent: any;

        beforeEach(async () => {
            // Create a fresh agent in DRAFT state before each update test
            agent = await GymAgentModel.create({
                pool_id: trainingPool._id,
                name: 'Update Test Agent',
                ticker: 'UPDATE',
                description: 'Initial description',
                tokenomics: { supply: 1000, minLiquiditySol: 1, decimals: 9 },
                auditLog: [{ user: ownerAddress, action: 'CREATE' }],
                deployment: { status: 'DRAFT', versions: [] },
            });
        });

        it('should update basic fields when in DRAFT status', async () => {
            const updates = {
                name: 'Updated Name',
                description: 'Updated description.',
                tokenomics: { supply: 5000, minLiquiditySol: 2, decimals: 6 },
            };

            const response = await supertest(app)
                .put(`/api/v1/forge/agents/${agent._id}`)
                .send(updates)
                .expect(200);

            expect(response.body.data.name).toBe(updates.name);
            expect(response.body.data.description).toBe(updates.description);
            expect(response.body.data.tokenomics.supply).toBe(updates.tokenomics.supply);
            expect(response.body.data.auditLog.length).toBe(2);
            expect(response.body.data.auditLog[1].action).toBe('UPDATE');
        });

        it('should update description but not tokenomics when DEPLOYED', async () => {
            agent.deployment.status = 'DEPLOYED';
            await agent.save();

            const updates = {
                description: 'A new description for a deployed agent.',
                tokenomics: { supply: 999999 }, // This should be ignored
            };

            const response = await supertest(app)
                .put(`/api/v1/forge/agents/${agent._id}`)
                .send(updates)
                .expect(200);

            expect(response.body.data.description).toBe(updates.description);
            // Verify that the immutable field was NOT changed
            expect(response.body.data.tokenomics.supply).toBe(1000);
        });

        it('should return 400 if trying to update only immutable fields when DEPLOYED', async () => {
            agent.deployment.status = 'DEPLOYED';
            await agent.save();

            const updates = {
                name: 'A new name that cannot be applied',
                tokenomics: { supply: 999999 },
            };

            const response = await supertest(app)
                .put(`/api/v1/forge/agents/${agent._id}`)
                .send(updates)
                .expect(400);

            expect(response.body.error.message).toContain('Agent cannot be updated');
        });

        it('should fail if Hugging Face API key is invalid', async () => {
            vi.mocked(validateHuggingFaceApiKey).mockResolvedValueOnce(false);

            const updates = {
                deployment: {
                    huggingFaceApiKey: 'invalid-key',
                }
            };

            const response = await supertest(app)
                .put(`/api/v1/forge/agents/${agent._id}`)
                .send(updates)
                .expect(400);

            expect(response.body.error.message).toContain('Hugging Face API key is invalid');
        });
    });

    describe('On-Chain Orchestration', () => {
        let agent: any;

        beforeEach(async () => {
            // Clear all mocks before each test
            vi.clearAllMocks();

            // Create a fresh agent for each test
            agent = await GymAgentModel.create({
                pool_id: trainingPool._id,
                name: 'On-Chain Test Agent',
                ticker: 'ONCHAIN',
                description: 'Testing on-chain flows.',
                tokenomics: { supply: 1000000, minLiquiditySol: 1, decimals: 9 },
                auditLog: [],
                deployment: { status: 'DRAFT', versions: [] },
            });

            // Setup default happy-path mocks for blockchain services
            vi.mocked(mockConnection.getLatestBlockhash).mockResolvedValue({
                blockhash: 'test-blockhash',
                lastValidBlockHeight: 123
            });
            vi.mocked(mockConnection.sendRawTransaction).mockResolvedValue('test-tx-signature');
            vi.mocked(mockConnection.confirmTransaction).mockResolvedValue({ value: { err: null } });
            vi.mocked(mockConnection.getTransaction).mockResolvedValue({
                blockTime: Math.floor(Date.now() / 1000),
                slot: 12345,
                meta: { err: null },
            });
        });

        describe('GET /:id/transactions/token-creation', () => {
            it('should return an unsigned token creation transaction', async () => {
                // Setup
                agent.deployment.status = 'PENDING_TOKEN_SIGNATURE';
                await agent.save();

                const mockTransaction = {
                    serialize: vi.fn().mockReturnValue(Buffer.from('mock-serialized-tx')),
                    partialSign: vi.fn(),
                    getEstimatedFee: vi.fn().mockResolvedValue(5000),
                    recentBlockhash: '',
                    feePayer: undefined,
                };
                vi.mocked(createTokenCreationTransaction).mockResolvedValue({
                    transaction: mockTransaction as any,
                    mintKeypair: { publicKey: { toBase58: () => 'mock-mint-address' } } as any,
                });

                // Act
                const response = await supertest(app)
                    .get(`/api/v1/forge/agents/${agent._id}/transactions/token-creation`)
                    .expect(200);

                // Assert
                expect(response.body.success).toBe(true);
                expect(response.body.data.transaction).toBe(Buffer.from('mock-serialized-tx').toString('base64'));
                expect(response.body.data.idempotencyKey).toBeDefined();
                expect(response.body.data.mintAddress).toBe('mock-mint-address');

                const dbAgent = await GymAgentModel.findById(agent._id);
                expect(dbAgent?.deployment.pendingTransaction).toBeDefined();
                expect(dbAgent?.deployment.pendingTransaction?.type).toBe('TOKEN_CREATION');
            });

            it('should fail if agent is not in PENDING_TOKEN_SIGNATURE status', async () => {
                agent.deployment.status = 'DRAFT';
                await agent.save();

                const response = await supertest(app)
                    .get(`/api/v1/forge/agents/${agent._id}/transactions/token-creation`)
                    .expect(400);

                expect(response.body.error.message).toContain('Agent must be in PENDING_TOKEN_SIGNATURE status');
            });
        });

        describe('POST /:id/submit-tx (Token Creation)', () => {
            it('should process a signed token creation tx and update agent status', async () => {
                // Setup
                const idempotencyKey = 'test-idempotency-key-token';
                agent.deployment.status = 'PENDING_TOKEN_SIGNATURE';
                agent.deployment.pendingTransaction = {
                    idempotencyKey: idempotencyKey,
                    type: 'TOKEN_CREATION',
                    status: 'PENDING',
                    details: { mint: 'mock-mint-address' },
                };
                await agent.save();

                // Act
                const response = await supertest(app)
                    .post(`/api/v1/forge/agents/${agent._id}/submit-tx`)
                    .send({
                        type: 'token-creation', // Use kebab-case to match validator
                        signedTransaction: 'mock-signed-tx-base64',
                        idempotencyKey: idempotencyKey,
                    })
                    .expect(200);

                // Assert
                expect(response.body.success).toBe(true);
                expect(response.body.data.deployment.status).toBe('PENDING_POOL_SIGNATURE');
                expect(response.body.data.blockchain.tokenAddress).toBe('mock-mint-address');
                expect(response.body.data.blockchain.tokenCreationDetails.txHash).toBe('test-tx-signature');
                expect(mockConnection.sendRawTransaction).toHaveBeenCalledTimes(1);
                expect(mockConnection.confirmTransaction).toHaveBeenCalledTimes(1);
            });

            it('should fail gracefully if transaction confirmation fails', async () => {
                // Setup
                const idempotencyKey = 'test-idempotency-key-fail';
                agent.deployment.status = 'PENDING_TOKEN_SIGNATURE';
                agent.deployment.pendingTransaction = {
                    idempotencyKey,
                    type: 'TOKEN_CREATION',
                    status: 'PENDING',
                    details: { mint: 'mock-mint-address' },
                };
                await agent.save();

                vi.mocked(mockConnection.confirmTransaction).mockRejectedValue(new Error('Confirmation failed on-chain'));

                // Act
                const response = await supertest(app)
                    .post(`/api/v1/forge/agents/${agent._id}/submit-tx`)
                    .send({
                        type: 'token-creation', // Use kebab-case
                        signedTransaction: 'mock-signed-tx-base64',
                        idempotencyKey,
                    })
                    .expect(400);

                // Assert
                expect(response.body.error.message).toContain('Transaction confirmation failed');
                const dbAgent = await GymAgentModel.findById(agent._id);
                expect(dbAgent?.deployment.status).toBe('FAILED');
                expect(dbAgent?.deployment.lastError).toContain('Transaction confirmation failed');
            });
        });

        describe('GET /:id/transactions/pool-creation', () => {
            it('should return an unsigned pool creation transaction', async () => {
                // Setup
                agent.deployment.status = 'PENDING_POOL_SIGNATURE';
                agent.blockchain.tokenAddress = 'So11111111111111111111111111111111111111112'; // Use a valid base58 address
                await agent.save();

                const mockPoolTransaction = {
                    serialize: vi.fn().mockReturnValue(Buffer.from('mock-pool-tx')),
                    message: {
                        recentBlockhash: '',
                        staticAccountKeys: [new PublicKey(ownerAddress)], // Include the owner/payer key
                        compiledInstructions: [],
                    }
                };
                vi.mocked(createPoolCreationTransaction).mockResolvedValue({
                    transaction: mockPoolTransaction as any,
                    poolKeys: { ammPool: 'mock-pool-address' } as any,
                });
                vi.mocked(mockConnection.getFeeForMessage).mockResolvedValue({ value: 5000 });


                // Act
                const response = await supertest(app)
                    .get(`/api/v1/forge/agents/${agent._id}/transactions/pool-creation`)
                    .expect(200);

                // Assert
                expect(response.body.success).toBe(true);
                expect(response.body.data.transaction).toBe(Buffer.from('mock-pool-tx').toString('base64'));
                expect(response.body.data.idempotencyKey).toBeDefined();
                const dbAgent = await GymAgentModel.findById(agent._id);
                expect(dbAgent?.deployment.pendingTransaction?.type).toBe('POOL_CREATION');
            });

            it('should fail if agent is not in PENDING_POOL_SIGNATURE status', async () => {
                const response = await supertest(app)
                    .get(`/api/v1/forge/agents/${agent._id}/transactions/pool-creation`)
                    .expect(400);
                expect(response.body.error.message).toContain('Agent must be in PENDING_POOL_SIGNATURE status');
            });
        });

        describe('POST /:id/submit-tx (Pool Creation)', () => {
            it('should process a signed pool creation tx and update agent status to DEPLOYED', async () => {
                // Setup
                const idempotencyKey = 'test-idempotency-key-pool';
                agent.deployment.status = 'PENDING_POOL_SIGNATURE';
                agent.deployment.pendingTransaction = {
                    idempotencyKey,
                    type: 'POOL_CREATION',
                    status: 'PENDING',
                    details: { poolKeys: JSON.stringify({ ammPool: 'mock-pool-address' }) },
                };
                await agent.save();

                // Act
                const response = await supertest(app)
                    .post(`/api/v1/forge/agents/${agent._id}/submit-tx`)
                    .send({
                        type: 'pool-creation', // Use kebab-case
                        signedTransaction: 'mock-signed-pool-tx-base64',
                        idempotencyKey,
                    })
                    .expect(200);

                // Assert
                expect(response.body.success).toBe(true);
                expect(response.body.data.deployment.status).toBe('DEPLOYED');
                expect(response.body.data.blockchain.poolAddress).toBe('mock-pool-address');
                expect(response.body.data.blockchain.poolCreationDetails.txHash).toBe('test-tx-signature');
            });
        });
    });
}); 