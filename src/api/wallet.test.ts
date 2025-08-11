import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, type MockedFunction } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { walletApi } from './wallet.ts';
import { errorHandler } from '../middleware/errorHandler.ts';
import { WalletConnectionModel } from '../models/WalletConnection.ts';
import { referralService } from '../services/referral/index.ts';

// Mock referral service
vi.mock('../services/referral/index.ts', () => ({
    referralService: {
        getReferralCode: vi.fn(),
        getReferrer: vi.fn(),
    },
}));

const TEST_TOKEN = 'test-token';
const TEST_WALLET_ADDRESS = 'E8fgSKVQYf93xNrJhPWdQZi4Rz5fL4WDJLM727Pe2P97';
const REFERRER_WALLET_ADDRESS = '4ngcdKzzCe9pTd35MamzfCsvk2uS9PBfcGJwBuGVQV49';
const REFERRER_CODE = 'REFERRER1';

describe('Wallet API', () => {
    let app: express.Express;
    let mongoServer: MongoMemoryServer;

    beforeAll(async () => {
        app = express();
        app.use(express.json());
        app.use('/api/v1/wallet', walletApi);
        app.use(errorHandler);

        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        await WalletConnectionModel.deleteMany({});
    });

    describe('GET /api/v1/wallet/connection', () => {
        it('should return connection status with referrer info if referrer exists', async () => {
            await WalletConnectionModel.create({ token: TEST_TOKEN, address: TEST_WALLET_ADDRESS });

            (referralService.getReferralCode as MockedFunction<any>).mockResolvedValueOnce({ referralCode: 'MYCODE123' });
            (referralService.getReferrer as MockedFunction<any>).mockResolvedValueOnce({ walletAddress: REFERRER_WALLET_ADDRESS, referralCode: REFERRER_CODE });
            (referralService.getReferralCode as MockedFunction<any>).mockResolvedValueOnce({ referralCode: REFERRER_CODE });

            const response = await supertest(app)
                .get('/api/v1/wallet/connection')
                .query({ token: TEST_TOKEN })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.connected).toBe(true);
            expect(response.body.data.address).toBe(TEST_WALLET_ADDRESS);
            expect(response.body.data.referrer).toBeDefined();
            expect(response.body.data.referrer.walletAddress).toBe(REFERRER_WALLET_ADDRESS);
            expect(response.body.data.referrer.referralCode).toBe(REFERRER_CODE);
        });

        it('should return connection status without referrer info if referrer does not exist', async () => {
            await WalletConnectionModel.create({ token: TEST_TOKEN, address: TEST_WALLET_ADDRESS });

            (referralService.getReferralCode as MockedFunction<any>).mockResolvedValueOnce({ referralCode: 'MYCODE123' });
            (referralService.getReferrer as MockedFunction<any>).mockResolvedValueOnce(null);

            const response = await supertest(app)
                .get('/api/v1/wallet/connection')
                .query({ token: TEST_TOKEN })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.connected).toBe(true);
            expect(response.body.data.address).toBe(TEST_WALLET_ADDRESS);
            expect(response.body.data.referralCode).toBe('MYCODE123');
            expect(response.body.data.referrer).toBeNull();
        });

        it('should return not connected if token is invalid', async () => {
            const response = await supertest(app)
                .get('/api/v1/wallet/connection')
                .query({ token: 'invalid-token' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.connected).toBe(false);
            expect(response.body.data.address).toBeUndefined();
            expect(response.body.data.referralCode).toBeNull();
            expect(response.body.data.referrer).toBeNull();
        });
    });
});
