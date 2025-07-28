import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ReferralCleanupService } from './cleanupService.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { connectToDatabase } from '../database.ts';

describe('ReferralCleanupService', () => {
    let mongoServer: MongoMemoryServer;
    let cleanupService: ReferralCleanupService;
    let testReferralCode: Document & IReferralCode;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        process.env.DB_URI = mongoUri;
        await connectToDatabase();

        cleanupService = new ReferralCleanupService();
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
            walletAddress: 'test-wallet',
            referralCode: 'TEST123',
            isActive: true,
            totalReferrals: 0,
            totalRewards: 0,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
    });

    afterEach(async () => {
        vi.clearAllMocks();
    });

    describe('cleanupExpiredCodes', () => {
        it('should deactivate expired referral codes', async () => {
            // Create expired codes
            const expiredCodes = [
                {
                    walletAddress: 'expired1',
                    referralCode: 'EXPIRED1',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
                },
                {
                    walletAddress: 'expired2',
                    referralCode: 'EXPIRED2',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
                }
            ];

            await ReferralCodeModel.insertMany(expiredCodes);

            const cleanedCount = await cleanupService.cleanupExpiredCodes();

            expect(cleanedCount).toBe(2);

            // Verify codes were deactivated
            const deactivatedCodes = await ReferralCodeModel.find({ isActive: false });
            expect(deactivatedCodes).toHaveLength(2);
            expect(deactivatedCodes.map(c => c.referralCode)).toContain('EXPIRED1');
            expect(deactivatedCodes.map(c => c.referralCode)).toContain('EXPIRED2');
        });

        it('should not deactivate active codes', async () => {
            // Create active codes
            await ReferralCodeModel.create({
                walletAddress: 'active1',
                referralCode: 'ACTIVE1',
                isActive: true,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day from now
            });

            const cleanedCount = await cleanupService.cleanupExpiredCodes();

            expect(cleanedCount).toBe(0);

            // Verify active code remains active
            const activeCode = await ReferralCodeModel.findOne({ referralCode: 'ACTIVE1' });
            expect(activeCode?.isActive).toBe(true);
        });

        it('should return 0 when no expired codes exist', async () => {
            const cleanedCount = await cleanupService.cleanupExpiredCodes();
            expect(cleanedCount).toBe(0);
        });
    });

    describe('getExpiredCodeStats', () => {
        it('should return correct statistics for expired codes', async () => {
            // Create various codes
            const codes = [
                {
                    walletAddress: 'expired1',
                    referralCode: 'EXPIRED1',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Expired
                },
                {
                    walletAddress: 'expired2',
                    referralCode: 'EXPIRED2',
                    isActive: false,
                    expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // Already inactive
                },
                {
                    walletAddress: 'active1',
                    referralCode: 'ACTIVE1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // Active
                },
                {
                    walletAddress: 'expiring1',
                    referralCode: 'EXPIRING1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // Expiring soon (within 7 days)
                }
            ];

            await ReferralCodeModel.insertMany(codes);

            const stats = await cleanupService.getExpiredCodeStats();

            expect(stats.totalExpired).toBe(2); // Both expired codes
            expect(stats.totalActive).toBe(3); // Active, expiring soon, and the one from beforeEach
            expect(stats.expiringSoon).toBe(2); // Expiring soon and the one from beforeEach (within 30 days)
        });

        it('should handle codes without expiration dates', async () => {
            // Create code without expiration
            await ReferralCodeModel.create({
                walletAddress: 'no-expiry',
                referralCode: 'NOEXPIRY',
                isActive: true
            });

            const stats = await cleanupService.getExpiredCodeStats();

            expect(stats.totalActive).toBe(2); // Including the one from beforeEach
        });
    });

    describe('extendExpiration', () => {
        it('should extend expiration for existing referral code', async () => {
            const originalExpiration = testReferralCode.expiresAt;
            const extensionDays = 30;

            const success = await cleanupService.extendExpiration('test-wallet', extensionDays);

            expect(success).toBe(true);

            // Verify expiration was extended
            const updatedCode = await ReferralCodeModel.findOne({ walletAddress: 'test-wallet' });
            expect(updatedCode?.isActive).toBe(true);
            expect(updatedCode?.expiresAt?.getTime()).toBeGreaterThan(originalExpiration!.getTime());
        });

        it('should return false for non-existent wallet', async () => {
            const success = await cleanupService.extendExpiration('non-existent-wallet', 30);
            expect(success).toBe(false);
        });

        it('should use default extension of 30 days', async () => {
            // Fetch the latest code from DB to get the correct original expiration
            const codeBefore = await ReferralCodeModel.findOne({ walletAddress: 'test-wallet' });
            const originalExpiration = codeBefore!.expiresAt;

            const success = await cleanupService.extendExpiration('test-wallet');

            expect(success).toBe(true);

            const updatedCode = await ReferralCodeModel.findOne({ walletAddress: 'test-wallet' });
            // Verify expiration was extended by approximately 30 days
            const timeDifference = updatedCode!.expiresAt!.getTime() - originalExpiration!.getTime();
            const daysDifference = timeDifference / (24 * 60 * 60 * 1000);
            expect(daysDifference).toBeCloseTo(30, 0); // Within 1 day
        });
    });

    describe('getExpiringSoonCodes', () => {
        it('should return codes expiring within threshold', async () => {
            // Create codes with different expiration dates
            const codes = [
                {
                    walletAddress: 'expiring1',
                    referralCode: 'EXPIRING1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
                },
                {
                    walletAddress: 'expiring2',
                    referralCode: 'EXPIRING2',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days
                },
                {
                    walletAddress: 'not-expiring',
                    referralCode: 'NOTEXPIRING',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days
                }
            ];

            await ReferralCodeModel.insertMany(codes);

            const expiringCodes = await cleanupService.getExpiringSoonCodes(7); // 7 day threshold

            expect(expiringCodes).toHaveLength(2);
            expect(expiringCodes.map(c => c.referralCode)).toContain('EXPIRING1');
            expect(expiringCodes.map(c => c.referralCode)).toContain('EXPIRING2');
            expect(expiringCodes.map(c => c.referralCode)).not.toContain('NOTEXPIRING');
        });

        it('should return codes sorted by expiration date', async () => {
            const codes = [
                {
                    walletAddress: 'expiring2',
                    referralCode: 'EXPIRING2',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days
                },
                {
                    walletAddress: 'expiring1',
                    referralCode: 'EXPIRING1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
                }
            ];

            await ReferralCodeModel.insertMany(codes);

            const expiringCodes = await cleanupService.getExpiringSoonCodes(7);

            expect(expiringCodes[0].referralCode).toBe('EXPIRING1'); // Sooner expiration first
            expect(expiringCodes[1].referralCode).toBe('EXPIRING2');
        });

        it('should use default threshold of 7 days', async () => {
            const expiringCodes = await cleanupService.getExpiringSoonCodes();
            expect(expiringCodes).toBeInstanceOf(Array);
        });
    });

    describe('cleanupOldReferrals', () => {
        it('should delete old referral records', async () => {
            // Create old referrals
            const oldReferrals = [
                {
                    referrerAddress: 'referrer1',
                    referreeAddress: 'referree1',
                    referralCode: 'OLD1',
                    referralLink: 'https://clones-ai.com/ref/OLD1',
                    firstActionType: 'wallet_connect',
                    firstActionData: { connectionToken: 'token1' },
                    status: 'confirmed',
                    createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) // 400 days ago
                },
                {
                    referrerAddress: 'referrer2',
                    referreeAddress: 'referree2',
                    referralCode: 'OLD2',
                    referralLink: 'https://clones-ai.com/ref/OLD2',
                    firstActionType: 'wallet_connect',
                    firstActionData: { connectionToken: 'token2' },
                    status: 'failed',
                    createdAt: new Date(Date.now() - 380 * 24 * 60 * 60 * 1000) // 380 days ago
                }
            ];

            await ReferralModel.insertMany(oldReferrals);

            const deletedCount = await cleanupService.cleanupOldReferrals(365); // Delete older than 1 year

            expect(deletedCount).toBe(2);

            // Verify old referrals were deleted
            const remainingReferrals = await ReferralModel.find({});
            expect(remainingReferrals).toHaveLength(0);
        });

        it('should not delete recent referrals', async () => {
            // Create recent referral
            await ReferralModel.create({
                referrerAddress: 'referrer1',
                referreeAddress: 'referree1',
                referralCode: 'RECENT',
                referralLink: 'https://clones-ai.com/ref/RECENT',
                firstActionType: 'wallet_connect',
                firstActionData: { connectionToken: 'token1' },
                status: 'confirmed',
                createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
            });

            const deletedCount = await cleanupService.cleanupOldReferrals(365);

            expect(deletedCount).toBe(0);

            // Verify recent referral remains
            const remainingReferrals = await ReferralModel.find({});
            expect(remainingReferrals).toHaveLength(1);
        });

        it('should only delete confirmed and failed referrals', async () => {
            // Create referrals with different statuses
            const referrals = [
                {
                    referrerAddress: 'referrer1',
                    referreeAddress: 'referree1',
                    referralCode: 'CONFIRMED',
                    referralLink: 'https://clones-ai.com/ref/CONFIRMED',
                    firstActionType: 'wallet_connect',
                    firstActionData: { connectionToken: 'token1' },
                    status: 'confirmed',
                    createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
                },
                {
                    referrerAddress: 'referrer2',
                    referreeAddress: 'referree2',
                    referralCode: 'PENDING',
                    referralLink: 'https://clones-ai.com/ref/PENDING',
                    firstActionType: 'wallet_connect',
                    firstActionData: { connectionToken: 'token2' },
                    status: 'pending',
                    createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
                }
            ];

            await ReferralModel.insertMany(referrals);

            const deletedCount = await cleanupService.cleanupOldReferrals(365);

            expect(deletedCount).toBe(1); // Only confirmed should be deleted

            // Verify pending referral remains
            const remainingReferrals = await ReferralModel.find({});
            expect(remainingReferrals).toHaveLength(1);
            expect(remainingReferrals[0].status).toBe('pending');
        });
    });

    describe('regenerateExpiredCode', () => {
        it('should regenerate code for expired referral code', async () => {
            // Create expired code
            const expiredCode = await ReferralCodeModel.create({
                walletAddress: 'expired-wallet',
                referralCode: 'EXPIRED',
                isActive: true,
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
            });

            const newCode = await cleanupService.regenerateExpiredCode('expired-wallet');

            expect(newCode).not.toBeNull();
            expect(newCode).not.toBe('EXPIRED');
            expect(newCode?.length).toBe(6);
            expect(newCode).toMatch(/^[A-Z0-9]{6}$/);

            // Verify code was updated
            const updatedCode = await ReferralCodeModel.findOne({ walletAddress: 'expired-wallet' });
            expect(updatedCode?.referralCode).toBe(newCode);
            expect(updatedCode?.isActive).toBe(true);
            expect(updatedCode?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
        });

        it('should return null for non-expired code', async () => {
            const newCode = await cleanupService.regenerateExpiredCode('test-wallet');
            expect(newCode).toBeNull();
        });

        it('should return null for non-existent wallet', async () => {
            const newCode = await cleanupService.regenerateExpiredCode('non-existent-wallet');
            expect(newCode).toBeNull();
        });

        it('should return null if unable to generate unique code', async () => {
            // Mock crypto.randomBytes to always return the same value
            const originalRandomBytes = require('crypto').randomBytes;
            require('crypto').randomBytes = vi.fn().mockReturnValue(Buffer.from([0, 0, 0, 0, 0, 0]));

            // Create expired code
            await ReferralCodeModel.create({
                walletAddress: 'expired-wallet',
                referralCode: 'EXPIRED',
                isActive: true,
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
            });

            // Create another code with the same pattern that would be generated
            await ReferralCodeModel.create({
                walletAddress: 'existing-wallet',
                referralCode: 'AAAAAA',
                isActive: true
            });

            const newCode = await cleanupService.regenerateExpiredCode('expired-wallet');
            expect(newCode).toBeNull();

            // Restore original function
            require('crypto').randomBytes = originalRandomBytes;
        });
    });
}); 