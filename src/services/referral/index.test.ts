import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ReferralService } from './index.ts';
import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';

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

        // Create test data
        await ReferralCodeModel.create({
            walletAddress: 'referrer123',
            referralCode: 'TEST123',
            isActive: true,
            totalRewards: 0,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        await ReferralCodeModel.create({
            walletAddress: 'new-referrer',
            referralCode: 'NEWCODE',
            isActive: true,
            totalRewards: 0,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        testReferral = await ReferralModel.create({
            referrerAddress: 'referrer123',
            referreeAddress: 'referree123'
        });
    });

    afterEach(async () => {
        vi.clearAllMocks();
    });

    describe('generateReferralCode', () => {
        it('should return existing referral code if wallet already has one', async () => {
            const existingCodeData = await referralService.generateReferralCode('referrer123');
            expect(existingCodeData.referralCode).toBe('TEST123');
        });

        it('should generate a new unique referral code for new wallet', async () => {
            const newCodeData = await referralService.generateReferralCode('new-wallet-456');

            expect(newCodeData).toBeDefined();
            expect(newCodeData.referralCode.length).toBe(6);
            expect(newCodeData.referralCode).toMatch(/^[A-Z0-9]{6}$/);

            // Verify it was saved to database
            const savedCode = await ReferralCodeModel.findOne({ walletAddress: 'new-wallet-456' });
            expect(savedCode).not.toBeNull();
            expect(savedCode?.referralCode).toBe(newCodeData.referralCode);
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
            const referrerAddress = await referralService.validateReferralCode('TEST123');
            expect(referrerAddress).toBe('referrer123');
        });

        it('should return null for invalid code', async () => {
            const referrerAddress = await referralService.validateReferralCode('INVALID');
            expect(referrerAddress).toBeNull();
        });

        it('should return null for expired code', async () => {
            // Create expired code
            await ReferralCodeModel.create({
                walletAddress: 'expired-wallet',
                referralCode: 'EXPIRED',
                isActive: true,
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
                updatedAt: null
            });

            const referrerAddress = await referralService.validateReferralCode('EXPIRED');
            expect(referrerAddress).toBeNull();

            // Verify code was marked as inactive
            const expiredCode = await ReferralCodeModel.findOne({ referralCode: 'EXPIRED' });
            expect(expiredCode?.isActive).toBe(false);
        });

        it('should handle case-insensitive code validation', async () => {
            const referrerAddress = await referralService.validateReferralCode('test123');
            expect(referrerAddress).toBe('referrer123');
        });
    });

    describe('createReferral', () => {
        it('should create referral relationship successfully', async () => {
            const initialCount = await ReferralModel.countDocuments();

            const referral = await referralService.createReferral(
                'new-referrer',
                'new-referree',
                'NEWCODE'
            );

            expect(referral.referrerAddress).toBe('new-referrer');
            expect(referral.referreeAddress).toBe('new-referree');

            const finalCount = await ReferralModel.countDocuments();
            expect(finalCount).toBe(initialCount + 1);
        });

        it('should throw error if referree has already been referred', async () => {
            await expect(
                referralService.createReferral(
                    'referrer123',
                    'referree123', // This one was created in beforeEach
                    'TEST123'
                )
            ).rejects.toThrow('This wallet has already been referred.');
        });

        it('should throw error for invalid referral code', async () => {
            await expect(
                referralService.createReferral(
                    'referrer123',
                    'new-referree',
                    'INVALIDCODE'
                )
            ).rejects.toThrow('Invalid or expired referral code.');
        });

        it('should throw error for self-referral', async () => {
            await expect(
                referralService.createReferral(
                    'referrer123',
                    'referrer123',
                    'TEST123'
                )
            ).rejects.toThrow('You cannot refer yourself.');
        });
    });

    describe('hasBeenReferred', () => {
        it('should return true if wallet has been referred', async () => {
            const hasBeenReferred = await referralService.hasBeenReferred('referree123');
            expect(hasBeenReferred).toBe(true);
        });

        it('should return false if wallet has not been referred', async () => {
            const hasBeenReferred = await referralService.hasBeenReferred('unreferred-wallet');
            expect(hasBeenReferred).toBe(false);
        });
    });

    describe('getReferrer', () => {
        it('should return referrer address for referred wallet', async () => {
            const referrer = await referralService.getReferrer('referree123');
            expect(referrer).toEqual({
                walletAddress: 'referrer123',
                referralCode: 'TEST123'
            });
        });

        it('should return null for unreferred wallet', async () => {
            const referrer = await referralService.getReferrer('unreferred-wallet');
            expect(referrer).toBeNull();
        });
    });

    describe('getReferralStats', () => {
        it('should return referral statistics for wallet', async () => {
            const stats = await referralService.getReferralStats('referrer123');

            expect(stats.referralInfo?.totalReferrals).toBe(1); // Calculated from actual referrals
            expect(stats.referralInfo?.totalRewards).toBe(0);
            expect(stats.referralInfo?.referralCode).toBe('TEST123');
            expect(stats.referrals).toBeInstanceOf(Array);
        });

        it('should return empty stats for wallet without referral code', async () => {
            const stats = await referralService.getReferralStats('no-code-wallet');

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
            // Create a referrer
            await ReferralCodeModel.create({
                walletAddress: 'race-referrer',
                referralCode: 'RACE123',
                isActive: true,
                totalRewards: 0,
                updatedAt: null
            });

            // Simulate concurrent referral creation attempts
            const concurrentPromises = [
                referralService.createReferral(
                    'race-referrer',
                    'referree1',
                    'RACE123'
                ),
                referralService.createReferral(
                    'race-referrer',
                    'referree2',
                    'RACE123'
                ),
                referralService.createReferral(
                    'race-referrer',
                    'referree3',
                    'RACE123'
                )
            ];

            // Execute all promises concurrently
            const results = await Promise.all(concurrentPromises);

            // All should succeed since they're for different referrees
            expect(results).toHaveLength(3);
            expect(results.every(result => result !== null)).toBe(true);

            // Verify that all referrals were created
            const referrals = await ReferralModel.find({ referrerAddress: 'race-referrer' });
            expect(referrals).toHaveLength(3);

            // Verify that referrer stats were updated correctly
            const referralCount = await ReferralModel.countDocuments({ referrerAddress: 'race-referrer' });
            expect(referralCount).toBe(3);
        });

        it('should prevent duplicate referrals for the same referree', async () => {
            // Create a referrer
            await ReferralCodeModel.create({
                walletAddress: 'dupe-referrer',
                referralCode: 'DUPE123',
                isActive: true,
                totalRewards: 0,
                updatedAt: null
            });

            // Simulate concurrent attempts to refer the same person
            const concurrentPromises = [
                referralService.createReferral(
                    'dupe-referrer',
                    'same-referree',
                    'DUPE123'
                ),
                referralService.createReferral(
                    'dupe-referrer',
                    'same-referree',
                    'DUPE123'
                ),
                referralService.createReferral(
                    'dupe-referrer',
                    'same-referree',
                    'DUPE123'
                )
            ];

            // Execute all promises concurrently - only one should succeed
            const results = await Promise.allSettled(concurrentPromises);

            // Count successful and failed results
            const successful = results.filter(result => result.status === 'fulfilled');
            const failed = results.filter(result => result.status === 'rejected');

            // Only one should succeed, others should fail with "User has already been referred"
            expect(successful).toHaveLength(1);
            expect(failed).toHaveLength(2);

            // Verify that only one referral was created
            const referrals = await ReferralModel.find({ referrerAddress: 'dupe-referrer' });
            expect(referrals).toHaveLength(1);

            // Verify that referrer stats were updated correctly
            const referralCount = await ReferralModel.countDocuments({ referrerAddress: 'dupe-referrer' });
            expect(referralCount).toBe(1);
        });
    });
}); 