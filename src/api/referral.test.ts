import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
const Redis = require('ioredis-mock');

// Mock external services before importing modules that use them
vi.mock('../services/redis.ts', () => {
    const redisMock = new Redis();
    return {
        redisPublisher: redisMock,
        redisSubscriber: redisMock,
    };
});

vi.mock('../services/blockchain/index.ts', () => ({
    default: class MockBlockchainService {
        constructor() {}
    }
}));

vi.mock('../services/blockchain/referralProgram.ts', () => ({
    ReferralProgramService: class MockReferralProgramService {
        constructor() {}
        async storeReferral() {
            return { txHash: 'mock-tx-hash', slot: 12345 };
        }
        async distributeReward() {
            return { txHash: 'mock-reward-tx', slot: 12346 };
        }
    }
}));

vi.mock('../services/referral/rewardService.ts', () => ({
    RewardService: class MockRewardService {
        private config = {
            baseReward: 100,
            bonusMultiplier: 1.5,
            maxReferrals: 10,
            minActionValue: 10,
            cooldownPeriod: 24 * 60 * 60 * 1000,
            maxReferralsInCooldown: 5
        };

        constructor() {}
        async processReward() {
            return {
                referrerAddress: 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97',
                referreeAddress: '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49',
                actionType: 'test_action',
                actionValue: 100,
                rewardAmount: 50,
                timestamp: new Date()
            };
        }
        getRewardConfig() {
            return { ...this.config };
        }
        updateRewardConfig(newConfig: any) {
            this.config = { ...this.config, ...newConfig };
        }
        getRewardStats() {
            return {
                totalRewards: 150,
                totalReferrals: 2,
                averageReward: 75,
                recentRewards: []
            };
        }
    }
}));

vi.mock('../services/referral/cleanupService.ts', () => ({
    ReferralCleanupService: class MockCleanupService {
        constructor() {}
        async cleanupExpiredCodes() {
            return 5;
        }
        async getExpiredCodeStats() {
            return {
                totalExpired: 10,
                totalActive: 50,
                expiringSoon: 3
            };
        }
        async extendExpiration(walletAddress: string, extensionDays: number = 30) {
            return true;
        }
        async regenerateExpiredCode(walletAddress: string) {
            // Return null for non-expired codes (like TEST_WALLETS.referrer)
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return null;
            }
            return 'NEWCODE123';
        }
    }
}));

// Mock admin authentication
vi.mock('../middleware/auth.ts', () => ({
    requireAdminAuth: (req: Request, res: Response, next: NextFunction) => {
        const adminToken = req.headers['x-admin-token'];
        if (adminToken === 'valid-admin-token') {
            next();
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    }
}));

// Mock the referral service
vi.mock('../services/referral/index.ts', () => ({
    ReferralService: class MockReferralService {
        constructor() {}
        async generateReferralCode(walletAddress: string) {
            // Return different codes based on wallet address
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return 'TEST123';
            }
            return 'ABCDEF';
        }
        async getReferralCode(walletAddress: string) {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return {
                    walletAddress,
                    referralCode: 'TEST123',
                    isActive: true,
                    totalReferrals: 0,
                    totalRewards: 0,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                };
            }
            return null;
        }
        async validateReferralCode(referralCode: string) {
            if (referralCode === 'TEST123' || referralCode === 'test123') {
                return 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97';
            }
            return null;
        }
        async createReferral() {
            return {
                _id: 'mock-referral-id',
                referrerAddress: 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97',
                referreeAddress: '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49',
                referralCode: 'TEST123',
                status: 'pending',
                createdAt: new Date(),
                updatedAt: new Date()
            };
        }
        async storeReferralOnChain(referralId: string) {
            return { txHash: 'test-tx-hash', slot: 12345 };
        }
        async getReferralStats(walletAddress: string) {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return {
                    totalReferrals: 0,
                    totalRewards: 0,
                    referralCode: 'TEST123',
                    referrals: []
                };
            }
            return {
                totalReferrals: 0,
                totalRewards: 0,
                referralCode: '',
                referrals: []
            };
        }
        async hasBeenReferred(walletAddress: string) {
            if (walletAddress === '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49') {
                return true;
            }
            return false;
        }
        async getReferrer(walletAddress: string) {
            if (walletAddress === '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49') {
                return 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97';
            }
            return null;
        }
        async getRewardStats() {
            return {
                totalRewards: 150,
                totalReferrals: 2,
                averageReward: 75,
                recentRewards: []
            };
        }
        async getRewardConfig() {
            return {
                baseReward: 100,
                bonusMultiplier: 1.5,
                maxReferrals: 10,
                minActionValue: 10,
                cooldownPeriod: 24 * 60 * 60 * 1000,
                maxReferralsInCooldown: 5
            };
        }
        async updateRewardConfig(newConfig: any) {
            return {
                baseReward: newConfig.baseReward || 100,
                bonusMultiplier: newConfig.bonusMultiplier || 1.5,
                maxReferrals: newConfig.maxReferrals || 10,
                minActionValue: newConfig.minActionValue || 10,
                cooldownPeriod: newConfig.cooldownPeriod || 24 * 60 * 60 * 1000,
                maxReferralsInCooldown: newConfig.maxReferralsInCooldown || 5
            };
        }
        async processReward() {
            return {
                referrerAddress: 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97',
                referreeAddress: '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49',
                actionType: 'test_action',
                actionValue: 100,
                rewardAmount: 50,
                timestamp: new Date()
            };
        }
        async cleanupExpiredCodes() {
            return 5;
        }
        async getCleanupStats() {
            return {
                totalExpired: 10,
                totalActive: 50,
                expiringSoon: 3
            };
        }
        async extendExpiration() {
            return true;
        }
        async regenerateExpiredCode(walletAddress: string) {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return null;
            }
            return 'NEWCODE123';
        }
    },
    referralService: {
        generateReferralCode: async (walletAddress: string) => {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return 'TEST123';
            }
            return 'ABCDEF';
        },
        getReferralCode: async (walletAddress: string) => {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return {
                    walletAddress,
                    referralCode: 'TEST123',
                    isActive: true,
                    totalReferrals: 0,
                    totalRewards: 0,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                };
            }
            return null;
        },
        validateReferralCode: async (referralCode: string) => {
            if (referralCode === 'TEST123' || referralCode === 'test123') {
                return 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97';
            }
            return null;
        },
        createReferral: async (referrerAddress: string, referreeAddress: string, referralCode: string, referralLink: string, firstActionType: string, firstActionData?: any, actionValue?: number) => {
            // Validate referral code
            if (referralCode !== 'TEST123' && referralCode !== 'test123') {
                const { ApiError } = await import('../middleware/types/errors.ts');
                throw ApiError.badRequest('Invalid referral code');
            }
            
            return {
                _id: 'mock-referral-id',
                referrerAddress,
                referreeAddress,
                referralCode,
                firstActionType,
                status: 'pending',
                createdAt: new Date(),
                updatedAt: new Date()
            };
        },
        storeReferralOnChain: async (referralId: string) => {
            return { txHash: 'test-tx-hash', slot: 12345 };
        },
        getReferralStats: async (walletAddress: string) => {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return {
                    totalReferrals: 0,
                    totalRewards: 0,
                    referralCode: 'TEST123',
                    referrals: []
                };
            }
            return {
                totalReferrals: 0,
                totalRewards: 0,
                referralCode: '',
                referrals: []
            };
        },
        hasBeenReferred: async (walletAddress: string) => {
            if (walletAddress === '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49') {
                return true;
            }
            return false;
        },
        getReferrer: async (walletAddress: string) => {
            if (walletAddress === '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49') {
                return 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97';
            }
            return null;
        },
        getRewardStats: async () => ({
            totalRewards: 150,
            totalReferrals: 2,
            averageReward: 75,
            recentRewards: []
        }),
        getRewardConfig: async () => ({
            baseReward: 100,
            bonusMultiplier: 1.5,
            maxReferrals: 10,
            minActionValue: 10,
            cooldownPeriod: 24 * 60 * 60 * 1000,
            maxReferralsInCooldown: 5
        }),
        updateRewardConfig: async (newConfig: any) => ({
            baseReward: newConfig.baseReward || 100,
            bonusMultiplier: newConfig.bonusMultiplier || 1.5,
            maxReferrals: newConfig.maxReferrals || 10,
            minActionValue: newConfig.minActionValue || 10,
            cooldownPeriod: newConfig.cooldownPeriod || 24 * 60 * 60 * 1000,
            maxReferralsInCooldown: newConfig.maxReferralsInCooldown || 5
        }),
        processReward: async () => ({
            referrerAddress: 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97',
            referreeAddress: '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49',
            actionType: 'test_action',
            actionValue: 100,
            rewardAmount: 50,
            timestamp: new Date()
        }),
        cleanupExpiredCodes: async () => 5,
        getCleanupStats: async () => ({
            totalExpired: 10,
            totalActive: 50,
            expiringSoon: 3
        }),
        extendExpiration: async () => true,
        regenerateExpiredCode: async (walletAddress: string) => {
            if (walletAddress === 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97') {
                return null;
            }
            return 'NEWCODE123';
        }
    }
}));

import { ReferralModel, IReferral } from '../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../models/ReferralCode.ts';
import { connectToDatabase } from '../services/database.ts';
import { referralApi } from './referral.ts';
import { errorHandler } from '../middleware/errorHandler.ts';

// Valid Solana wallet addresses for testing
const TEST_WALLETS = {
    referrer: 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97',
    referree: '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49',
    newWallet: 'DKf6oSTPyp9h7V4KcTiouYeormMEQ8dCjmodZLDc73Jv',
    expiredWallet: '66oWkuMRwh8YXEDvgtnBTEJ7ixfiEwx7nqsoQAaWJsx8',
    unreferredWallet: '24kzcdFM1WEXdqgeq5kGXzmVdk6wPM77a7BbqFcs8Rhq',
    noCodeWallet: '7mYm9PMV5xg5LJ1LN99hMVRBg7bGfqfU5QBcwMhGAHzg'
};

let app: express.Express;

describe('Referral API', () => {
    let mongoServer: MongoMemoryServer;
    let testReferralCode: Document & IReferralCode;
    let testReferral: Document & IReferral;

    beforeAll(async () => {
        app = express();
        app.use(express.json());
        app.use('/api/v1/referral', referralApi);
        app.use(errorHandler);

        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        process.env.DB_URI = mongoUri;
        await connectToDatabase();
    });

    afterAll(async () => {
        if (mongoServer) {
            await mongoServer.stop();
        }
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        // Clear all collections before each test
        await ReferralCodeModel.deleteMany({});
        await ReferralModel.deleteMany({});

        // Create test data
        testReferralCode = await ReferralCodeModel.create({
            walletAddress: TEST_WALLETS.referrer,
            referralCode: 'TEST123',
            isActive: true,
            totalReferrals: 0,
            totalRewards: 0,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        testReferral = await ReferralModel.create({
            referrerAddress: TEST_WALLETS.referrer,
            referreeAddress: TEST_WALLETS.referree,
            referralCode: 'TEST123',
            referralLink: 'https://clones-ai.com/ref/TEST123',
            firstActionType: 'wallet_connect',
            firstActionData: { connectionToken: 'test-token' },
            status: 'pending'
        });
    });

    afterEach(async () => {
        vi.clearAllMocks();
    });

    describe('POST /api/v1/referral/generate-code', () => {
        it('should generate referral code successfully', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/generate-code')
                .send({ walletAddress: TEST_WALLETS.newWallet })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.referralCode).toBeDefined();
            expect(response.body.data.referralCode.length).toBe(6);
            expect(response.body.data.referralCode).toMatch(/^[A-Z0-9]{6}$/);
            expect(response.body.data.walletAddress).toBe(TEST_WALLETS.newWallet);
            expect(response.body.data.referralLink).toContain(response.body.data.referralCode);
        });

        it('should return existing code if wallet already has one', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/generate-code')
                .send({ walletAddress: TEST_WALLETS.referrer })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.referralCode).toBe('TEST123');
            expect(response.body.data.walletAddress).toBe(TEST_WALLETS.referrer);
        });

        it('should fail with 400 for missing wallet address', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/generate-code')
                .send({})
                .expect(400);

            expect(response.body.error.message).toBe('Validation failed');
            expect(response.body.error.details.fields.walletAddress).toBe('This field is required');
        });
    });

    describe('GET /api/v1/referral/code/:walletAddress', () => {
        it('should return referral code for existing wallet', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/code/${TEST_WALLETS.referrer}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.referralCode).toBe('TEST123');
            expect(response.body.data.walletAddress).toBe(TEST_WALLETS.referrer);
            expect(response.body.data.totalReferrals).toBe(0);
            expect(response.body.data.totalRewards).toBe(0);
            expect(response.body.data.isActive).toBe(true);
        });

        it('should fail with 404 for non-existent wallet', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/code/${TEST_WALLETS.noCodeWallet}`)
                .expect(404);

            expect(response.body.error.message).toContain('Referral code not found');
        });
    });

    describe('POST /api/v1/referral/validate-code', () => {
        it('should validate referral code successfully', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/validate-code')
                .send({ referralCode: 'TEST123' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.isValid).toBe(true);
            expect(response.body.data.referrerAddress).toBe(TEST_WALLETS.referrer);
            expect(response.body.data.referralCode).toBe('TEST123');
        });

        it('should handle case-insensitive validation', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/validate-code')
                .send({ referralCode: 'test123' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.isValid).toBe(true);
        });

        it('should fail with 400 for invalid code', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/validate-code')
                .send({ referralCode: 'INVALID' })
                .expect(400);

            expect(response.body.error.message).toContain('Invalid referral code');
        });

        it('should fail with 400 for missing referral code', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/validate-code')
                .send({})
                .expect(400);

            expect(response.body.error.message).toBe('Validation failed');
            expect(response.body.error.details.fields.referralCode).toBe('This field is required');
        });
    });

    describe('POST /api/v1/referral/create', () => {
        it('should create referral relationship successfully', async () => {
            const referralData = {
                referrerAddress: TEST_WALLETS.referrer,
                referreeAddress: TEST_WALLETS.newWallet,
                referralCode: 'TEST123',
                firstActionType: 'wallet_connect',
                firstActionData: { connectionToken: 'new-token' },
                actionValue: 100
            };

            const response = await supertest(app)
                .post('/api/v1/referral/create')
                .send(referralData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.data.referrerAddress).toBe(TEST_WALLETS.referrer);
            expect(response.body.data.referreeAddress).toBe(TEST_WALLETS.newWallet);
            expect(response.body.data.status).toBe('pending');
            expect(response.body.data.firstActionType).toBe('wallet_connect');
        });

        it('should fail with 400 for missing required fields', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/create')
                .send({
                    referrerAddress: TEST_WALLETS.referrer,
                    referreeAddress: TEST_WALLETS.newWallet
                    // Missing referralCode and firstActionType
                })
                .expect(400);

            expect(response.body.error.message).toBe('Validation failed');
            expect(response.body.error.details.fields.referralCode).toBe('This field is required');
            expect(response.body.error.details.fields.firstActionType).toBe('This field is required');
        });

        it('should fail with 400 for invalid referral code', async () => {
            const referralData = {
                referrerAddress: TEST_WALLETS.referrer,
                referreeAddress: TEST_WALLETS.newWallet,
                referralCode: 'INVALID',
                firstActionType: 'wallet_connect',
                firstActionData: { connectionToken: 'new-token' }
            };

            const response = await supertest(app)
                .post('/api/v1/referral/create')
                .send(referralData)
                .expect(400);

            expect(response.body.error.message).toContain('Invalid referral code');
        });
    });

    describe('GET /api/v1/referral/stats/:walletAddress', () => {
        it('should return referral statistics', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/stats/${TEST_WALLETS.referrer}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.totalReferrals).toBe(0);
            expect(response.body.data.totalRewards).toBe(0);
            expect(response.body.data.referralCode).toBe('TEST123');
            expect(response.body.data.referrals).toBeInstanceOf(Array);
        });

        it('should return empty stats for wallet without referral code', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/stats/${TEST_WALLETS.noCodeWallet}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.totalReferrals).toBe(0);
            expect(response.body.data.totalRewards).toBe(0);
            expect(response.body.data.referralCode).toBe('');
            expect(response.body.data.referrals).toEqual([]);
        });
    });

    describe('GET /api/v1/referral/referred/:walletAddress', () => {
        it('should return referral status for referred wallet', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/referred/${TEST_WALLETS.referree}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.hasBeenReferred).toBe(true);
            expect(response.body.data.referrer).toBe(TEST_WALLETS.referrer);
        });

        it('should return false for unreferred wallet', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/referred/${TEST_WALLETS.unreferredWallet}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.hasBeenReferred).toBe(false);
            expect(response.body.data.referrer).toBeNull();
        });
    });

    describe('GET /api/v1/referral/referrer/:walletAddress', () => {
        it('should return referrer for referred wallet', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/referrer/${TEST_WALLETS.referree}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.referrer).toBe(TEST_WALLETS.referrer);
        });

        it('should fail with 404 for unreferred wallet', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/referrer/${TEST_WALLETS.unreferredWallet}`)
                .expect(404);

            expect(response.body.error.message).toContain('No referrer found');
        });
    });

    describe('GET /api/v1/referral/rewards/:walletAddress', () => {
        it('should return reward statistics', async () => {
            const response = await supertest(app)
                .get(`/api/v1/referral/rewards/${TEST_WALLETS.referrer}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.totalRewards).toBe(150);
            expect(response.body.data.totalReferrals).toBe(2);
            expect(response.body.data.averageReward).toBe(75);
        });
    });

    describe('GET /api/v1/referral/rewards/config', () => {
        it('should return reward configuration', async () => {
            const response = await supertest(app)
                .get('/api/v1/referral/rewards/config')
                .expect(200);


            expect(response.body.success).toBe(true);
            expect(response.body.data.baseReward).toBe(100);
            expect(response.body.data.bonusMultiplier).toBe(1.5);
            expect(response.body.data.maxReferrals).toBe(10);
            expect(response.body.data.minActionValue).toBe(10);
            expect(response.body.data.cooldownPeriod).toBe(24 * 60 * 60 * 1000);
            expect(response.body.data.maxReferralsInCooldown).toBe(5);
        });
    });

    describe('POST /api/v1/referral/rewards/config', () => {
        it('should update reward configuration with valid admin token', async () => {
            const newConfig = {
                baseReward: 200,
                bonusMultiplier: 2.0,
                maxReferralsInCooldown: 10
            };

            const response = await supertest(app)
                .post('/api/v1/referral/rewards/config')
                .set('x-admin-token', 'valid-admin-token')
                .send(newConfig)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.message).toContain('Reward configuration updated successfully');
            expect(response.body.data.config.baseReward).toBe(200);
            expect(response.body.data.config.bonusMultiplier).toBe(2.0);
            expect(response.body.data.config.maxReferralsInCooldown).toBe(10);
        });

        it('should fail with 401 for invalid admin token', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/rewards/config')
                .set('x-admin-token', 'invalid-token')
                .send({ baseReward: 200 })
                .expect(401);

            expect(response.body.error).toBe('Unauthorized');
        });

        it('should fail with 401 for missing admin token', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/rewards/config')
                .send({ baseReward: 200 })
                .expect(401);

            expect(response.body.error).toBe('Unauthorized');
        });
    });

    describe('POST /api/v1/referral/rewards/process', () => {
        it('should process reward successfully', async () => {
            const rewardData = {
                referrerAddress: TEST_WALLETS.referrer,
                referreeAddress: TEST_WALLETS.newWallet,
                actionType: 'wallet_connect',
                actionValue: 100
            };

            const response = await supertest(app)
                .post('/api/v1/referral/rewards/process')
                .send(rewardData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.processed).toBe(true);
            expect(response.body.data.rewardEvent).toBeDefined();
        });

        it('should fail with 400 for missing required fields', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/rewards/process')
                .send({
                    referrerAddress: TEST_WALLETS.referrer
                    // Missing referreeAddress and actionType
                })
                .expect(400);

            expect(response.body.error.message).toBe('Validation failed');
            expect(response.body.error.details.fields.referreeAddress).toBe('This field is required');
            expect(response.body.error.details.fields.actionType).toBe('This field is required');
        });
    });

    describe('POST /api/v1/referral/cleanup/expired-codes', () => {
        it('should cleanup expired codes with valid admin token', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/expired-codes')
                .set('x-admin-token', 'valid-admin-token')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.message).toContain('Cleaned up 5 expired referral codes');
            expect(response.body.data.cleanedCount).toBe(5);
        });

        it('should fail with 401 for invalid admin token', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/expired-codes')
                .set('x-admin-token', 'invalid-token')
                .expect(401);

            expect(response.body.error).toBe('Unauthorized');
        });
    });

    describe('GET /api/v1/referral/cleanup/stats', () => {
        it('should return cleanup statistics with valid admin token', async () => {
            const response = await supertest(app)
                .get('/api/v1/referral/cleanup/stats')
                .set('x-admin-token', 'valid-admin-token')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.totalExpired).toBe(10);
            expect(response.body.data.totalActive).toBe(50);
            expect(response.body.data.expiringSoon).toBe(3);
        });

        it('should fail with 401 for invalid admin token', async () => {
            const response = await supertest(app)
                .get('/api/v1/referral/cleanup/stats')
                .set('x-admin-token', 'invalid-token')
                .expect(401);

            expect(response.body.error).toBe('Unauthorized');
        });
    });

    describe('POST /api/v1/referral/cleanup/extend-expiration', () => {
        it('should extend expiration successfully', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/extend-expiration')
                .send({
                    walletAddress: TEST_WALLETS.referrer,
                    extensionDays: 30
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.success).toBe(true);
            expect(response.body.data.message).toContain('Expiration extended successfully');
        });

        it('should fail with 400 for missing wallet address', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/extend-expiration')
                .send({ extensionDays: 30 })
                .expect(400);

            expect(response.body.error.message).toBe('Validation failed');
            expect(response.body.error.details.fields.walletAddress).toBe('This field is required');
        });
    });

    describe('POST /api/v1/referral/cleanup/regenerate-code', () => {
        it('should regenerate expired code successfully', async () => {
            // Create expired code
            await ReferralCodeModel.create({
                walletAddress: TEST_WALLETS.expiredWallet,
                referralCode: 'EXPIRED',
                isActive: true,
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
            });

            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/regenerate-code')
                .send({ walletAddress: TEST_WALLETS.expiredWallet })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.success).toBe(true);
            expect(response.body.data.newCode).toBeDefined();
            expect(response.body.data.message).toContain('Code regenerated successfully');
        });

        it('should fail with 400 for missing wallet address', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/regenerate-code')
                .send({})
                .expect(400);

            expect(response.body.error.message).toBe('Validation failed');
            expect(response.body.error.details.fields.walletAddress).toBe('This field is required');
        });

        it('should return failure for non-expired code', async () => {
            const response = await supertest(app)
                .post('/api/v1/referral/cleanup/regenerate-code')
                .send({ walletAddress: TEST_WALLETS.referrer })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.success).toBe(false);
            expect(response.body.data.message).toContain('Failed to regenerate code');
        });
    });
}); 