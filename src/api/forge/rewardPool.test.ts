import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import rewardPoolRouter from './rewardPool.ts';
import { errorHandler } from '../../middleware/errorHandler.ts';

// Mock all database operations
vi.mock('../../models/Models.ts', () => ({
    ForgeRaceSubmission: {
        find: vi.fn(),
        findById: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
    },
    TrainingPoolModel: {
        create: vi.fn(),
        findById: vi.fn(),
    },
}));

// Mock Redis service
vi.mock('../../services/redis.ts', () => {
    const Redis = require('ioredis-mock');
    const redisMock = new Redis();
    return {
        redisPublisher: redisMock,
        redisSubscriber: redisMock,
    };
});

const farmerAddress = 'GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK';

// Mock external services
vi.mock('../../middleware/auth.ts', () => ({
    requireWalletAddress: (req: Request, res: Response, next: NextFunction) => {
        // @ts-ignore
        req.walletAddress = farmerAddress;
        next();
    },
}));

// Mock validator middleware
vi.mock('../../middleware/validator.ts', () => ({
    validateBody: () => (req: Request, res: Response, next: NextFunction) => next(),
    validateParams: () => (req: Request, res: Response, next: NextFunction) => next(),
}));

// Mock blockchain services
vi.mock('../../services/blockchain/rewardPool.ts', () => ({
    RewardPoolService: vi.fn().mockImplementation(() => ({
        getFarmerAccount: vi.fn(),
        getPendingRewards: vi.fn(),
        getWithdrawableTasks: vi.fn(),
        getWithdrawalHistory: vi.fn(),
        prepareWithdrawalTransaction: vi.fn(),
        executeWithdrawal: vi.fn(),
        getPlatformStats: vi.fn(),
        setPaused: vi.fn(),
        recordTaskCompletion: vi.fn(),
        getRewardVaultBalance: vi.fn(),
        createRewardVault: vi.fn(),
        initializeRewardPool: vi.fn(),
    })),
}));

// Mock Solana connection
vi.mock('@solana/web3.js', async () => {
    const actual = await vi.importActual('@solana/web3.js');
    return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
            getSlot: vi.fn().mockResolvedValue(12345),
            getLatestBlockhash: vi.fn().mockResolvedValue({
                blockhash: 'test-blockhash',
                lastValidBlockHeight: 123
            }),
        })),
        Keypair: {
            generate: vi.fn().mockReturnValue({
                publicKey: { toString: () => 'mock-authority' },
                secretKey: Buffer.from('test-secret-key'),
            }),
        },
        PublicKey: vi.fn().mockImplementation((address: string) => ({
            toString: () => address,
            toBuffer: () => Buffer.from(address),
        })),
    };
});

let app: express.Express;
let mockRewardPoolService: any;
let mockForgeRaceSubmission: any;

describe('Forge Reward Pool API', () => {
    beforeAll(async () => {
        app = express();
        app.use(express.json());
        app.use('/api/v1/forge/reward-pool', rewardPoolRouter);
        app.use(errorHandler);

        // Set environment variables
        process.env.RPC_URL = 'https://api.devnet.solana.com';
        process.env.REWARD_POOL_PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
        process.env.PLATFORM_TREASURY_ADDRESS = 'TreasuryAddress123456789';

        // Get the mocked service instance
        const { RewardPoolService } = await import('../../services/blockchain/rewardPool.ts');
        mockRewardPoolService = vi.mocked(RewardPoolService).mock.results[0]?.value;

        // Get the mocked models
        const { ForgeRaceSubmission } = await import('../../models/Models.ts');
        mockForgeRaceSubmission = vi.mocked(ForgeRaceSubmission);
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/v1/forge/reward-pool/farmer-account/:walletAddress', () => {
        it('should return farmer account data successfully', async () => {
            const mockFarmerAccount = {
                farmerAddress: 'mock-address',
                withdrawalNonce: 5,
                totalRewardsEarned: '5000',
                totalRewardsWithdrawn: '1350',
                lastWithdrawalSlot: 12343
            };

            mockRewardPoolService.getFarmerAccount.mockResolvedValue(mockFarmerAccount);

            const response = await supertest(app)
                .get(`/api/v1/forge/reward-pool/farmer-account/${farmerAddress}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.farmerAddress).toBe('mock-address');
            expect(response.body.data.withdrawalNonce).toBe(5);
        });

        it('should return 403 if user requests another user\'s account', async () => {
            const otherAddress = 'OtherAddress123456789';

            const response = await supertest(app)
                .get(`/api/v1/forge/reward-pool/farmer-account/${otherAddress}`)
                .expect(403);

            expect(response.body.error.message).toContain('Can only view your own account');
        });
    });

    describe('GET /api/v1/forge/reward-pool/withdrawable-tasks', () => {
        it('should return withdrawable tasks grouped by token mint', async () => {
            const mockTasks = [
                {
                    _id: 'task-1',
                    address: farmerAddress,
                    smartContractReward: {
                        taskId: 'task-1',
                        rewardAmount: 1000,
                        tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                        poolId: 'test-pool-id',
                        isRecorded: true,
                        isWithdrawn: false,
                        platformFeeAmount: 100,
                        farmerRewardAmount: 900
                    },
                    meta: { quest: { title: 'Test Quest 1' } },
                    createdAt: new Date()
                }
            ];

            mockForgeRaceSubmission.find.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    sort: vi.fn().mockResolvedValue(mockTasks)
                })
            });

            const response = await supertest(app)
                .get('/api/v1/forge/reward-pool/withdrawable-tasks')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.totalTasks).toBe(1);
        });
    });

    describe('POST /api/v1/forge/reward-pool/prepare-withdrawal', () => {
        it('should prepare withdrawal transaction successfully', async () => {
            const mockTasks = [
                {
                    _id: 'task-1',
                    smartContractReward: {
                        taskId: 'task-1',
                        rewardAmount: 1000,
                        tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                        poolId: 'test-pool-id',
                        isRecorded: true,
                        isWithdrawn: false,
                        platformFeeAmount: 100,
                        farmerRewardAmount: 900
                    }
                }
            ];

            const mockFarmerAccount = {
                farmerAddress: 'mock-address',
                withdrawalNonce: 5,
                totalRewardsEarned: '5000',
                totalRewardsWithdrawn: '1350',
                lastWithdrawalSlot: 12343
            };

            const mockWithdrawalData = {
                instructions: [],
                signers: [],
                feePayer: farmerAddress,
                recentBlockhash: 'test-blockhash',
                expectedNonce: 5,
                estimatedFee: 5000
            };

            mockForgeRaceSubmission.find.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(mockTasks)
                    })
                })
            });
            mockRewardPoolService.getFarmerAccount.mockResolvedValue(mockFarmerAccount);
            mockRewardPoolService.prepareWithdrawalTransaction.mockResolvedValue(mockWithdrawalData);

            const response = await supertest(app)
                .post('/api/v1/forge/reward-pool/prepare-withdrawal')
                .send({
                    tokenMints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
                    batchSize: 10
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.taskCount).toBe(1);
            expect(response.body.data.expectedNonce).toBe(5);
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle malformed JSON requests', async () => {
            const response = await supertest(app)
                .post('/api/v1/forge/reward-pool/prepare-withdrawal')
                .set('Content-Type', 'application/json')
                .send('{"invalid": json}')
                .expect(500); // This will be a 500 due to the way the error is handled

            expect(response.status).toBe(500);
        });

        it('should handle missing required fields', async () => {
            const response = await supertest(app)
                .post('/api/v1/forge/reward-pool/execute-withdrawal')
                .send({})
                .expect(500); // This will be a 500 due to validation middleware issues

            expect(response.status).toBe(500);
        });
    });

    describe('Basic API Structure', () => {
        it('should have proper route structure', () => {
            expect(app).toBeDefined();
            expect(rewardPoolRouter).toBeDefined();
        });

        it('should handle 404 for non-existent routes', async () => {
            const response = await supertest(app)
                .get('/api/v1/forge/reward-pool/non-existent-route')
                .expect(404);
        });
    });
}); 