import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ReferralCleanupService } from './cleanupService.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { connectToDatabase } from '../database.ts';

const TEST_WALLETS = {
    referrer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    referree: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    newWallet: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    expiredWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    unreferredWallet: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    noCodeWallet: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'
};

describe('ReferralCleanupService', () => {
    let mongoServer: MongoMemoryServer;
    let cleanupService: ReferralCleanupService;

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
        await ReferralCodeModel.deleteMany({});
        await ReferralModel.deleteMany({});
    });

    describe('cleanupExpiredCodes', () => {
        beforeEach(async () => {
            await ReferralCodeModel.create([
                {
                    walletAddress: TEST_WALLETS.referrer,
                    referralCode: 'ACTIVE1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.expiredWallet,
                    referralCode: 'EXPIRED1',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.newWallet,
                    referralCode: 'ACTIVE2',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet4',
                    referralCode: 'EXPIRED2',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet5',
                    referralCode: 'EXPIRING_SOON',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet6',
                    referralCode: 'NO_EXPIRATION',
                    isActive: true,
                    expiresAt: null
                }
            ]);
        });
        it('should deactivate expired referral codes', async () => {
            const initialActiveExpired = await ReferralCodeModel.countDocuments({
                isActive: true,
                expiresAt: { $lt: new Date() }
            });
            expect(initialActiveExpired).toBe(2);

            const cleanedCount = await cleanupService.cleanupExpiredCodes();
            expect(cleanedCount).toBe(2);

            const finalActiveExpired = await ReferralCodeModel.countDocuments({
                isActive: true,
                expiresAt: { $lt: new Date() }
            });
            expect(finalActiveExpired).toBe(0);

            const inactiveCount = await ReferralCodeModel.countDocuments({ isActive: false });
            expect(inactiveCount).toBe(2);
        });

        it('should not deactivate active codes', async () => {
            const initialActive = await ReferralCodeModel.countDocuments({
                isActive: true,
                expiresAt: { $gt: new Date() }
            });
            expect(initialActive).toBe(3);

            const cleanedCount = await cleanupService.cleanupExpiredCodes();
            expect(cleanedCount).toBe(2);

            const finalActive = await ReferralCodeModel.countDocuments({
                isActive: true,
                expiresAt: { $gt: new Date() }
            });
            expect(finalActive).toBe(3);
        });

        it('should return 0 when no expired codes exist', async () => {
            await ReferralCodeModel.deleteMany({ expiresAt: { $lt: new Date() } });
            const cleanedCount = await cleanupService.cleanupExpiredCodes();
            expect(cleanedCount).toBe(0);
        });
    });

    describe('getExpiredCodeStats', () => {
        beforeEach(async () => {
            await ReferralCodeModel.create([
                {
                    walletAddress: TEST_WALLETS.referrer,
                    referralCode: 'ACTIVE1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.expiredWallet,
                    referralCode: 'EXPIRED1',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.newWallet,
                    referralCode: 'ACTIVE2',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet4',
                    referralCode: 'EXPIRED2',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet5',
                    referralCode: 'EXPIRING_SOON',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet6',
                    referralCode: 'NO_EXPIRATION',
                    isActive: true,
                    expiresAt: null
                }
            ]);
        });
        it('should return correct statistics for expired codes', async () => {
            const stats = await cleanupService.getExpiredCodeStats();
            expect(stats.totalExpired).toBe(2);
            expect(stats.totalActive).toBe(3);
            expect(stats.expiringSoon).toBe(2);
        });

        it('should handle codes without expiration dates', async () => {
            const stats = await cleanupService.getExpiredCodeStats();
            expect(stats.totalActive).toBe(3);
            expect(stats.totalExpired).toBe(2);
        });
    });

    describe('extendExpiration', () => {
        beforeEach(async () => {
            await ReferralCodeModel.create({
                walletAddress: TEST_WALLETS.referrer,
                referralCode: 'ACTIVE1',
                isActive: true,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            });
        });
        it('should extend expiration for existing referral code', async () => {
            const initialCode = await ReferralCodeModel.findOne({ walletAddress: TEST_WALLETS.referrer });
            const originalExpiration = initialCode!.expiresAt;

            const result = await cleanupService.extendExpiration(TEST_WALLETS.referrer, 15);

            const updatedCode = await ReferralCodeModel.findOne({ walletAddress: TEST_WALLETS.referrer });
            const newExpiration = updatedCode!.expiresAt;

            expect(result).toBe(true);
            expect(newExpiration!.getTime()).toBeGreaterThan(originalExpiration!.getTime());
            const diffDays = (newExpiration!.getTime() - originalExpiration!.getTime()) / (1000 * 3600 * 24);
            expect(diffDays).toBeCloseTo(15);
        });

        it('should return false for non-existent wallet', async () => {
            const result = await cleanupService.extendExpiration('non-existent-wallet');
            expect(result).toBe(false);
        });

        it('should use default extension of 30 days', async () => {
            const initialCode = await ReferralCodeModel.findOne({ walletAddress: TEST_WALLETS.referrer });
            const originalExpiration = initialCode!.expiresAt;

            await cleanupService.extendExpiration(TEST_WALLETS.referrer);

            const updatedCode = await ReferralCodeModel.findOne({ walletAddress: TEST_WALLETS.referrer });
            const newExpiration = updatedCode!.expiresAt;
            const diffDays = (newExpiration!.getTime() - originalExpiration!.getTime()) / (1000 * 3600 * 24);
            expect(diffDays).toBeCloseTo(30);
        });
    });

    describe('getExpiringSoonCodes', () => {
        beforeEach(async () => {
            await ReferralCodeModel.create([
                {
                    walletAddress: TEST_WALLETS.referrer,
                    referralCode: 'ACTIVE1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.expiredWallet,
                    referralCode: 'EXPIRED1',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.newWallet,
                    referralCode: 'ACTIVE2',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet4',
                    referralCode: 'EXPIRED2',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet5',
                    referralCode: 'EXPIRING_SOON',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: 'wallet6',
                    referralCode: 'NO_EXPIRATION',
                    isActive: true,
                    expiresAt: null
                }
            ]);
        });
        it('should return codes expiring within threshold', async () => {
            const expiringCodes = await cleanupService.getExpiringSoonCodes(10);
            expect(expiringCodes.length).toBeGreaterThan(0);
            const codes = expiringCodes.map(c => c.referralCode);
            expect(codes).toContain('ACTIVE1');
            expect(codes).toContain('EXPIRING_SOON');
        });

        it('should return codes sorted by expiration date', async () => {
            const expiringCodes = await cleanupService.getExpiringSoonCodes(10);
            expect(expiringCodes.length).toBeGreaterThan(0);
            for (let i = 0; i < expiringCodes.length - 1; i++) {
                expect(expiringCodes[i]!.expiresAt!.getTime()).toBeLessThanOrEqual(
                    expiringCodes[i + 1]!.expiresAt!.getTime()
                );
            }
        });

        it('should use default threshold of 7 days', async () => {
            const soonCodes = await cleanupService.getExpiringSoonCodes();
            expect(soonCodes.length).toBeGreaterThan(0);
            const codes = soonCodes.map(c => c.referralCode);
            expect(codes).toContain('EXPIRING_SOON');
        });
    });

    describe('cleanupOldReferrals', () => {
        beforeEach(async () => {
            await ReferralModel.create([
                {
                    referrerAddress: TEST_WALLETS.referrer,
                    referreeAddress: TEST_WALLETS.referree,
                    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
                },
                {
                    referrerAddress: TEST_WALLETS.newWallet,
                    referreeAddress: TEST_WALLETS.unreferredWallet,
                    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
                }
            ]);
        });
        it('should delete old referral records', async () => {
            const initialCount = await ReferralModel.countDocuments();
            expect(initialCount).toBe(2);

            const cleanedCount = await cleanupService.cleanupOldReferrals(30);
            expect(cleanedCount).toBe(1);

            const finalCount = await ReferralModel.countDocuments();
            expect(finalCount).toBe(1);

            const remainingReferral = await ReferralModel.findOne();
            expect(remainingReferral?.referrerAddress).toBe(TEST_WALLETS.newWallet);
        });

        it('should not delete recent referrals', async () => {
            const initialCount = await ReferralModel.countDocuments();
            const cleanedCount = await cleanupService.cleanupOldReferrals(60);
            expect(cleanedCount).toBe(0);
            const finalCount = await ReferralModel.countDocuments();
            expect(finalCount).toBe(initialCount);
        });
    });

    describe('regenerateExpiredCode', () => {
        beforeEach(async () => {
            await ReferralCodeModel.create([
                {
                    walletAddress: TEST_WALLETS.expiredWallet,
                    referralCode: 'EXPIRED1',
                    isActive: true,
                    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                {
                    walletAddress: TEST_WALLETS.referrer,
                    referralCode: 'ACTIVE1',
                    isActive: true,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                }
            ]);
        });
        it('should regenerate code for expired referral code', async () => {
            const newCode = await cleanupService.regenerateExpiredCode(TEST_WALLETS.expiredWallet);

            expect(newCode).toBeDefined();
            expect(newCode).not.toBe('EXPIRED');
            expect(newCode?.length).toBe(6);
            expect(newCode).toMatch(/^[A-Z0-9]{6}$/);

            // Verify code was updated
            const updatedCode = await ReferralCodeModel.findOne({ walletAddress: TEST_WALLETS.expiredWallet });
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
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                updatedAt: null
            });

            // Create another code with the same pattern that would be generated
            await ReferralCodeModel.create({
                walletAddress: 'existing-wallet',
                referralCode: 'AAAAAA',
                isActive: true,
                updatedAt: null
            });

            const newCode = await cleanupService.regenerateExpiredCode('expired-wallet');
            expect(newCode).toBeNull();

            // Restore original function
            require('crypto').randomBytes = originalRandomBytes;
        });
    });
}); 