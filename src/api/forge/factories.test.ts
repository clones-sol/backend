import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { factoriesApi } from './factories.ts';
import { errorHandler } from '../../middleware/errorHandler.ts';
import { FactoryModel } from '../../models/Factory.ts';
import { FactoryStatus } from '../../types/factory.ts';

// Mock auth middleware
const { mockAuth, TEST_WALLET_ADDRESS, OTHER_WALLET_ADDRESS } = vi.hoisted(() => {
    const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const OTHER_WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    return {
        TEST_WALLET_ADDRESS,
        OTHER_WALLET_ADDRESS,
        mockAuth: {
            walletAddress: TEST_WALLET_ADDRESS,
        }
    };
});
vi.mock('../../middleware/auth.ts', () => ({
    requireWalletAddress: (req: Request, res: Response, next: NextFunction) => {
        // @ts-ignore
        req.walletAddress = mockAuth.walletAddress;
        next();
    },
}));

// Mock factory service
const { mockGenerateApps } = vi.hoisted(() => {
    return { mockGenerateApps: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../../services/factory/factoryDatabaseService.ts', () => ({
    generateAppsForFactory: mockGenerateApps,
    createFactoryWithApps: vi.fn().mockResolvedValue({ id: 'mock-factory-id' })
}));

// Mock blockchain tokens service
const { mockSupportedTokens } = vi.hoisted(() => {
    return {
        mockSupportedTokens: {
            'USDC': { name: 'USD Coin', address: '0xusdcaddress' },
            'WETH': { name: 'Wrapped Ether', address: '0xwethaddress' },
        }
    };
});
vi.mock('../../services/blockchain/tokens.ts', () => ({
    supportedTokens: mockSupportedTokens,
    getTokenContractAddress: vi.fn((tokenSymbol: string) => mockSupportedTokens[tokenSymbol as keyof typeof mockSupportedTokens]?.address || `0xaddress_for_${tokenSymbol}`),
    getSupportedTokenSymbols: vi.fn(() => Object.keys(mockSupportedTokens)),
}));

// Mock blockchain factory service
const { mockFactoryService } = vi.hoisted(() => {
    return {
        mockFactoryService: {
            prepareCreatePoolTransaction: vi.fn(),
            predictPoolAddress: vi.fn(),
            getPoolInfo: vi.fn(),
            prepareFundPoolTransaction: vi.fn(),
            prepareClaimSignatureData: vi.fn(),
            prepareBatchClaimData: vi.fn(),
            getPublisherInfo: vi.fn(),
        }
    };
});
vi.mock('../../services/blockchain/factoryTransactionService.ts', () => ({
    createFactoryService: () => mockFactoryService,
}));

let app: express.Express;
let mongoServer: MongoMemoryServer;

describe('Forge Factories API', () => {
    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        app = express();
        app.use(express.json());
        app.use('/api/v1/forge/factories', factoriesApi);
        app.use(errorHandler);
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        await FactoryModel.create([
            {
                _id: new mongoose.Types.ObjectId('60f8e4b4c3b3e4a3b1e8e4a1'),
                name: 'Test Factory 1',
                ownerAddress: TEST_WALLET_ADDRESS.toLowerCase(),
                poolAddress: '0xpool1address',
                skills: ['skill1', 'skill2'],
                status: FactoryStatus.active,
                pricePerDemo: 10,
                searchText: 'Test Factory 1 skill1 skill2 type1',
                createdAt: new Date('2023-01-01'),
                demonstrations: 5,
                totalEarned: 50,
                token: {
                    symbol: 'USDC',
                    address: '0xusdc',
                    decimals: 6,
                    type: 'ERC20'
                }
            },
            {
                _id: new mongoose.Types.ObjectId('60f8e4b4c3b3e4a3b1e8e4a2'),
                name: 'Another Factory 2',
                ownerAddress: OTHER_WALLET_ADDRESS.toLowerCase(),
                poolAddress: '0xpool2address',
                skills: ['skill3', 'skill4'],
                status: FactoryStatus.paused,
                pricePerDemo: 20,
                searchText: 'Another Factory 2 skill3 skill4 type2',
                createdAt: new Date('2023-01-02'),
                demonstrations: 10,
                totalEarned: 200,
                token: {
                    symbol: 'WETH',
                    address: '0xweth',
                    decimals: 18,
                    type: 'ERC20'
                }
            }
        ]);
        mockAuth.walletAddress = TEST_WALLET_ADDRESS;
    });

    afterEach(async () => {
        await FactoryModel.deleteMany({});
        vi.clearAllMocks();
    });

    describe('GET /supported-tokens', () => {
        it('should return a list of supported tokens', async () => {
            const response = await supertest(app)
                .get('/api/v1/forge/factories/supported-tokens')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual([
                { symbol: 'USDC', name: 'USD Coin' },
                { symbol: 'WETH', name: 'Wrapped Ether' },
            ]);
        });
    });

    describe('POST /search', () => {
        it('should return all factories with no criteria', async () => {
            const response = await supertest(app)
                .post('/api/v1/forge/factories/search')
                .send({})
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.factories).toHaveLength(2);
            expect(response.body.data.total).toBe(2);
        });

        it('should filter by searchTerm', async () => {
            const response = await supertest(app)
                .post('/api/v1/forge/factories/search')
                .send({ searchTerm: 'Another' })
                .expect(200);

            expect(response.body.data.factories).toHaveLength(1);
            expect(response.body.data.factories[0].name).toBe('Another Factory 2');
        });

        it('should filter by creator', async () => {
            const response = await supertest(app)
                .post('/api/v1/forge/factories/search')
                .send({ creator: TEST_WALLET_ADDRESS })
                .expect(200);

            expect(response.body.data.factories).toHaveLength(1);
            expect(response.body.data.factories[0].name).toBe('Test Factory 1');
        });
    });

    describe('GET /', () => {
        it('should return factories for the authenticated user', async () => {
            const response = await supertest(app)
                .get('/api/v1/forge/factories/')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.factories).toHaveLength(1);
            expect(response.body.data.factories[0].ownerAddress).toBe(TEST_WALLET_ADDRESS.toLowerCase());
        });
    });

    describe('GET /:id', () => {
        it('should return a factory by id', async () => {
            const factoryId = '60f8e4b4c3b3e4a3b1e8e4a1';
            const response = await supertest(app)
                .get(`/api/v1/forge/factories/${factoryId}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.name).toBe('Test Factory 1');
        });

        it('should return 404 for a non-existent factory id', async () => {
            const nonExistentId = '60f8e4b4c3b3e4a3b1e8e4a9';
            await supertest(app)
                .get(`/api/v1/forge/factories/${nonExistentId}`)
                .expect(404);
        });
    });

    describe('PUT /:id', () => {
        const factoryId = '60f8e4b4c3b3e4a3b1e8e4a1';

        it('should update the factory if user is owner', async () => {
            const response = await supertest(app)
                .put(`/api/v1/forge/factories/${factoryId}`)
                .send({ name: 'Updated Factory Name' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.name).toBe('Updated Factory Name');
        });

        it('should call generateAppsForFactory when skills are updated', async () => {
            await supertest(app)
                .put(`/api/v1/forge/factories/${factoryId}`)
                .send({ skills: ['newSkill'] })
                .expect(200);

            expect(mockGenerateApps).toHaveBeenCalledWith(factoryId, ['newSkill']);
        });

        it('should return 403 if user is not owner', async () => {
            mockAuth.walletAddress = OTHER_WALLET_ADDRESS;

            await supertest(app)
                .put(`/api/v1/forge/factories/${factoryId}`)
                .send({ name: 'Should Fail' })
                .expect(403);
        });

        it('should return 404 if factory does not exist', async () => {
            const nonExistentId = '60f8e4b4c3b3e4a3b1e8e4a9';
            await supertest(app)
                .put(`/api/v1/forge/factories/${nonExistentId}`)
                .send({ name: 'Should Fail' })
                .expect(404);
        });
    });

    describe('POST /pools', () => {
        it('should prepare a create pool transaction', async () => {
            mockFactoryService.prepareCreatePoolTransaction.mockResolvedValue({
                to: '0xFactoryContract',
                data: '0xcalldata'
            });

            const creator = TEST_WALLET_ADDRESS;
            const token = 'USDC';

            const response = await supertest(app)
                .post('/api/v1/forge/factories/pools')
                .send({ token, creator })
                .expect(200);

            expect(mockFactoryService.prepareCreatePoolTransaction).toHaveBeenCalledWith(
                mockSupportedTokens.USDC.address,
                creator
            );
            expect(response.body.data.to).toBe('0xFactoryContract');
        });

        it('should return 403 if authenticated user does not match creator', async () => {
            await supertest(app)
                .post('/api/v1/forge/factories/pools')
                .send({ token: 'USDC', creator: OTHER_WALLET_ADDRESS })
                .expect(403);
        });
    });

    describe('GET /pools/predict', () => {
        it('should predict a pool address', async () => {
            mockFactoryService.predictPoolAddress.mockResolvedValue({
                predicted: '0xPredictedAddress',
                salt: '0xSalt'
            });

            const creator = TEST_WALLET_ADDRESS;
            const token = 'WETH';

            const response = await supertest(app)
                .get(`/api/v1/forge/factories/pools/predict?creator=${creator}&token=${token}`)
                .expect(200);

            expect(mockFactoryService.predictPoolAddress).toHaveBeenCalledWith(creator, mockSupportedTokens.WETH.address);
            expect(response.body.data.predicted).toBe('0xPredictedAddress');
        });
    });

    describe('GET /pools/:poolAddress', () => {
        it('should get pool info', async () => {
            const poolAddress = '0x1234567890123456789012345678901234567890'; // Must be a valid address format
            mockFactoryService.getPoolInfo.mockResolvedValue({ owner: TEST_WALLET_ADDRESS });

            const response = await supertest(app)
                .get(`/api/v1/forge/factories/pools/${poolAddress}`)
                .expect(200);

            expect(mockFactoryService.getPoolInfo).toHaveBeenCalledWith(poolAddress, undefined);
            expect(response.body.data.owner).toBe(TEST_WALLET_ADDRESS);
        });
    });
});
