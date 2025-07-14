import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { forgeAgentsApi } from './agents.ts';
import { errorHandler } from '../../middleware/errorHandler.ts';
import { TrainingPoolModel, GymAgentModel } from '../../models/Models.ts';
import { DBTrainingPool } from '../../types/index.ts';

// Mock external services
vi.mock('../../services/huggingface/index.ts', () => ({
    validateHuggingFaceApiKey: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../middleware/auth.ts', () => ({
    requireWalletAddress: (req: Request, res: Response, next: NextFunction) => {
        // @ts-ignore
        req.walletAddress = 'test-owner-wallet-address'; // Mock authenticated user
        next();
    },
}));

const app = express();
app.use(express.json());
app.use('/api/v1/forge/agents', forgeAgentsApi);
app.use(errorHandler);

describe('Forge Agents API', () => {
    let mongoServer: MongoMemoryServer;
    let trainingPool: Document & DBTrainingPool;
    const ownerAddress = 'test-owner-wallet-address';

    beforeAll(async () => {
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
}); 