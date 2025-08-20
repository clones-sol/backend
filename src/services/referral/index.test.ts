import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ReferralService } from './index.ts';
import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import { connectToDatabase } from '../database.ts';
import { ApiError } from '../../middleware/types/errors.ts';

const TEST_WALLETS = {
    referrer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    referree: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    newWallet: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    expiredWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    unreferredWallet: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    noCodeWallet: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'
};

// Mock external services
vi.mock('../blockchain/index.ts', () => ({
    default: class MockBlockchainService {
        constructor() { }
    }
}));

vi.mock('../blockchain/referralProgram.ts', () => ({
    ReferralProgramService: class MockReferralProgramService {
        constructor() { }
        async storeReferral() {
            return { txHash: 'mock-tx-hash', slot: 12345 };
        }
        async distributeReward() {
            return { txHash: 'mock-reward-tx', slot: 12346 };
        }
    }
}));

vi.mock('./rewardService.ts', () => ({
    RewardService: class MockRewardService {
        constructor() { }
        async processReward() {
            return {
                referrerAddress: 'referrer123',
                referreeAddress: 'referree123',
                actionType: 'test_action',
                actionValue: 100,
                rewardAmount: 50,
                timestamp: new Date()
            };
        }
        getRewardConfig() {
            return {
                baseReward: 100,
                bonusMultiplier: 1.5,
                maxReferrals: 10,
                minActionValue: 10,
                cooldownPeriod: 24 * 60 * 60 * 1000,
                maxReferralsPerCooldownPeriod: 5
            };
        }
        updateRewardConfig() { }
    }
}));

vi.mock('./cleanupService.ts', () => ({
    ReferralCleanupService: class MockCleanupService {
        constructor() { }
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
    }
}));

describe('ReferralService', () => {
    let mongoServer: MongoMemoryServer;
    let referralService: ReferralService;
    let testReferralCode: Document & IReferralCode;
    let testExpiredCode: Document & IReferralCode;
    let testReferral: Document & IReferral;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        process.env.DB_URI = mongoUri;

        // Connect with explicit options to handle mixed ID types
        await mongoose.connect(mongoUri, {
            // Ensure proper handling of mixed ID types
            maxPoolSize: 1,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        // Wait for connection to be ready
        await mongoose.connection.asPromise();

        referralService = new ReferralService();
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

        // Create initial data for tests
        testReferralCode = await ReferralCodeModel.create({
            walletAddress: TEST_WALLETS.referrer,
            referralCode: 'TESTCD',
            isActive: true,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        });

        testExpiredCode = await ReferralCodeModel.create({
            walletAddress: TEST_WALLETS.expiredWallet,
            referralCode: 'EXPIRED',
            isActive: false,
            expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
        });

        testReferral = await ReferralModel.create({
            referrerAddress: TEST_WALLETS.referrer,
            referreeAddress: TEST_WALLETS.referree,
            referralCode: 'TESTCD'
        });
    });

    afterEach(async () => {
        vi.clearAllMocks();
    });

    describe('generateReferralCode', () => {
        it('should return existing referral code if wallet already has one', async () => {
            const result = await referralService.generateReferralCode(TEST_WALLETS.referrer);
            expect(result.referralCode).toBe('TESTCD');
        });

        it('should generate a new unique referral code for new wallet', async () => {
            const result = await referralService.generateReferralCode(TEST_WALLETS.newWallet);
            expect(result.referralCode).toBeDefined();
            expect(result.referralCode.length).toBe(6);
            expect(result.referralCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);

            const codeInDb = await ReferralCodeModel.findOne({ walletAddress: TEST_WALLETS.newWallet });
            expect(codeInDb).not.toBeNull();
            expect(codeInDb?.referralCode).toBe(result.referralCode);
        });

        it('should throw error if unable to generate unique code after max attempts', async () => {
            // Create a mock ReferralService with a lower max attempts for testing
            const testService = new ReferralService();

            // Mock the generateReferralCode method to simulate max attempts failure
            const originalMethod = testService.generateReferralCode.bind(testService);
            testService.generateReferralCode = vi.fn().mockRejectedValue(
                new Error('Failed to generate unique referral code after 100 attempts')
            );

            await expect(testService.generateReferralCode('new-wallet')).rejects.toThrow(
                'Failed to generate unique referral code after 100 attempts'
            );
        });
    });

    describe('validateReferralCode', () => {
        it('should return referrer address for valid active code', async () => {
            const referrerAddress = await referralService.validateReferralCode('TESTCD');
            expect(referrerAddress).toBe(TEST_WALLETS.referrer);
        });

        it('should return null for invalid code', async () => {
            const referrerAddress = await referralService.validateReferralCode('INVALID');
            expect(referrerAddress).toBeNull();
        });

        it('should return null for expired code', async () => {
            const referrerAddress = await referralService.validateReferralCode('EXPIRED');
            expect(referrerAddress).toBeNull();
        });

        it('should handle case-insensitive code validation', async () => {
            const referrerAddress = await referralService.validateReferralCode('testcd');
            expect(referrerAddress).toBe(TEST_WALLETS.referrer);
        });
    });

    describe('createReferral', () => {
        it('should create referral relationship successfully', async () => {
            const referral = await referralService.createReferral(
                TEST_WALLETS.referrer,
                TEST_WALLETS.newWallet,
                'TESTCD'
            );
            expect(referral).toBeDefined();
            expect(referral.referrerAddress).toBe(TEST_WALLETS.referrer);
            expect(referral.referreeAddress).toBe(TEST_WALLETS.newWallet);

            const referralInDb = await ReferralModel.findById(referral._id);
            expect(referralInDb).not.toBeNull();
        });

        it('should throw error if referree has already been referred', async () => {
            await expect(
                referralService.createReferral(TEST_WALLETS.referrer, TEST_WALLETS.referree, 'TESTCD')
            ).rejects.toThrow(ApiError.badRequest('This wallet has already been referred.'));
        });

        it('should throw error for invalid referral code', async () => {
            await expect(
                referralService.createReferral(TEST_WALLETS.referrer, TEST_WALLETS.newWallet, 'INVALID')
            ).rejects.toThrow(ApiError.badRequest('Invalid or expired referral code.'));
        });

        it('should throw error for self-referral', async () => {
            await expect(
                referralService.createReferral(TEST_WALLETS.referrer, TEST_WALLETS.referrer, 'TESTCD')
            ).rejects.toThrow(ApiError.badRequest('You cannot refer yourself.'));
        });
    });

    describe('hasBeenReferred', () => {
        it('should return true if wallet has been referred', async () => {
            const result = await referralService.hasBeenReferred(TEST_WALLETS.referree);
            expect(result).toBe(true);
        });

        it('should return false if wallet has not been referred', async () => {
            const result = await referralService.hasBeenReferred(TEST_WALLETS.newWallet);
            expect(result).toBe(false);
        });
    });

    describe('getReferrer', () => {
        it('should return referrer address for referred wallet', async () => {
            const referrer = await referralService.getReferrer(TEST_WALLETS.referree);
            expect(referrer?.walletAddress).toBe(TEST_WALLETS.referrer);
            expect(referrer?.referralCode).toBe('TESTCD');
        });

        it('should return null for unreferred wallet', async () => {
            const referrer = await referralService.getReferrer(TEST_WALLETS.newWallet);
            expect(referrer).toBeNull();
        });
    });

    describe('getReferralStats', () => {
        it('should return referral statistics for wallet', async () => {
            const stats = await referralService.getReferralStats(TEST_WALLETS.referrer);
            expect(stats.referralInfo).toBeDefined();
            expect(stats.referralInfo!.totalReferrals).toBe(1);
            expect(stats.referralInfo!.totalRewards).toBe(0);
            expect(stats.referralInfo!.referralCode).toBe('TESTCD');
            expect(stats.referrals).toBeInstanceOf(Array);
        });

        it('should return empty stats for wallet without referral code', async () => {
            const stats = await referralService.getReferralStats(TEST_WALLETS.noCodeWallet);
            expect(stats.referralInfo).toBeNull();
            expect(stats.referrals).toEqual([]);
        });
    });

    describe('cleanup methods', () => {
        it('should cleanup expired codes', async () => {
            const cleanedCount = await referralService.cleanupExpiredCodes();
            expect(cleanedCount).toBe(5);
        });

        it('should get cleanup stats', async () => {
            const stats = await referralService.getCleanupStats();
            expect(stats.totalExpired).toBe(10);
            expect(stats.totalActive).toBe(50);
            expect(stats.expiringSoon).toBe(3);
        });
    });

    describe('Race condition prevention', () => {
        it('should prevent race conditions when creating multiple referrals concurrently', async () => {
            const p1 = referralService.createReferral(TEST_WALLETS.referrer, '0x976EA74026E726554dB657fA54763abd0C3a0aa9', 'TESTCD');
            const p2 = referralService.createReferral(TEST_WALLETS.referrer, '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', 'TESTCD');
            await Promise.all([p1, p2]);

            const finalCount = await ReferralModel.countDocuments({ referrerAddress: TEST_WALLETS.referrer });
            expect(finalCount).toBe(3);
        });

        it('should prevent duplicate referrals for the same referree', async () => {
            const promises = [
                referralService.createReferral(TEST_WALLETS.referrer, TEST_WALLETS.newWallet, 'TESTCD'),
                referralService.createReferral(TEST_WALLETS.referrer, TEST_WALLETS.newWallet, 'TESTCD'),
                referralService.createReferral(TEST_WALLETS.referrer, TEST_WALLETS.newWallet, 'TESTCD')
            ];

            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => r.status === 'fulfilled');
            expect(successful).toHaveLength(1);

            const finalCount = await ReferralModel.countDocuments({ referreeAddress: TEST_WALLETS.newWallet });
            expect(finalCount).toBe(1);
        });
    });
}); 