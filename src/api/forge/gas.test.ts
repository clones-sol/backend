import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import supertest from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { forgeGasApi } from './gas.ts';
import { errorHandler } from '../../middleware/errorHandler.ts';

// Mock services and middleware
vi.mock('../../middleware/auth.ts', () => ({
    requireWalletAddress: (req: Request, res: Response, next: NextFunction) => {
        // Assume wallet address is present and valid for tests
        // @ts-ignore
        req.walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
        next();
    },
}));

const mockGasEstimationService = {
    estimateBatchClaimGas: vi.fn(),
    analyzeClaimGasCost: vi.fn(),
    optimizeBatchSize: vi.fn(),
    getGasOptimizationAdvice: vi.fn(),
};

vi.mock('../../services/blockchain/gasEstimationService.ts', () => ({
    createGasEstimationService: () => mockGasEstimationService,
}));

// Test constants
const TEST_WALLETS = {
    fromAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

const dummyClaims = [
    { vault: '0xVault1', account: '0xAccount1', cumulativeAmount: '100', deadline: 123, signature: '0xSig1' },
    { vault: '0xVault2', account: '0xAccount2', cumulativeAmount: '200', deadline: 124, signature: '0xSig2' },
];

let app: express.Express;

describe('Forge Gas API', () => {
    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/v1/forge/gas', forgeGasApi);
        app.use(errorHandler);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('POST /api/v1/forge/gas/estimate', () => {
        it('should estimate gas for a batch claim successfully', async () => {
            const mockGasEstimate = { totalGasCostUsd: 5.5 };
            mockGasEstimationService.estimateBatchClaimGas.mockResolvedValue(mockGasEstimate);

            const response = await supertest(app)
                .post('/api/v1/forge/gas/estimate')
                .send({ claims: dummyClaims, fromAddress: TEST_WALLETS.fromAddress })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.gasEstimate).toEqual(mockGasEstimate);
            expect(mockGasEstimationService.estimateBatchClaimGas).toHaveBeenCalledWith(dummyClaims, TEST_WALLETS.fromAddress);
        });

        it('should return 400 if claims are missing', async () => {
            await supertest(app)
                .post('/api/v1/forge/gas/estimate')
                .send({ fromAddress: TEST_WALLETS.fromAddress })
                .expect(400);
        });

        it('should handle errors during gas estimation', async () => {
            mockGasEstimationService.estimateBatchClaimGas.mockRejectedValue(new Error('Provider error'));

            const response = await supertest(app)
                .post('/api/v1/forge/gas/estimate')
                .send({ claims: dummyClaims, fromAddress: TEST_WALLETS.fromAddress })
                .expect(500);

            expect(response.body.error.message).toContain('Gas estimation failed: Provider error');
        });
    });

    describe('POST /api/v1/forge/gas/analyze', () => {
        it('should analyze gas cost successfully', async () => {
            const mockAnalysis = { shouldWarn: false, recommendation: 'Go for it' };
            mockGasEstimationService.analyzeClaimGasCost.mockResolvedValue(mockAnalysis);

            const response = await supertest(app)
                .post('/api/v1/forge/gas/analyze')
                .send({ claims: dummyClaims, fromAddress: TEST_WALLETS.fromAddress })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.analysis).toEqual(mockAnalysis);
            expect(mockGasEstimationService.analyzeClaimGasCost).toHaveBeenCalledWith(dummyClaims, TEST_WALLETS.fromAddress, 1);
        });

        it('should allow overriding tokenPriceUsd', async () => {
            const mockAnalysis = { shouldWarn: true, recommendation: 'Maybe wait' };
            mockGasEstimationService.analyzeClaimGasCost.mockResolvedValue(mockAnalysis);

            await supertest(app)
                .post('/api/v1/forge/gas/analyze')
                .send({ claims: dummyClaims, fromAddress: TEST_WALLETS.fromAddress, tokenPriceUsd: 0.5 })
                .expect(200);

            expect(mockGasEstimationService.analyzeClaimGasCost).toHaveBeenCalledWith(dummyClaims, TEST_WALLETS.fromAddress, 0.5);
        });
    });

    describe('POST /api/v1/forge/gas/optimize', () => {
        it('should optimize batch size successfully', async () => {
            const mockOptimization = { optimizedBatches: [dummyClaims], recommendation: 'One batch is fine' };
            mockGasEstimationService.optimizeBatchSize.mockResolvedValue(mockOptimization);

            const response = await supertest(app)
                .post('/api/v1/forge/gas/optimize')
                .send({ claims: dummyClaims, fromAddress: TEST_WALLETS.fromAddress })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.optimization).toEqual(mockOptimization);
            expect(mockGasEstimationService.optimizeBatchSize).toHaveBeenCalledWith(dummyClaims, TEST_WALLETS.fromAddress, 50);
        });

        it('should allow overriding maxGasCostUsd', async () => {
            await supertest(app)
                .post('/api/v1/forge/gas/optimize')
                .send({ claims: dummyClaims, fromAddress: TEST_WALLETS.fromAddress, maxGasCostUsd: 10 })
                .expect(200);

            expect(mockGasEstimationService.optimizeBatchSize).toHaveBeenCalledWith(dummyClaims, TEST_WALLETS.fromAddress, 10);
        });
    });

    describe('GET /api/v1/forge/gas/advice', () => {
        it('should get gas advice successfully', async () => {
            const mockAdvice = { gasPriceLevel: 'low', recommendation: 'Good time to transact' };
            mockGasEstimationService.getGasOptimizationAdvice.mockResolvedValue(mockAdvice);

            const response = await supertest(app)
                .get('/api/v1/forge/gas/advice')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.advice).toEqual(mockAdvice);
            expect(mockGasEstimationService.getGasOptimizationAdvice).toHaveBeenCalled();
        });

        it('should specify network for gas advice', async () => {
            await supertest(app)
                .get('/api/v1/forge/gas/advice')
                .query({ network: 'baseMainnet' })
                .expect(200);

            // The mock is reused, but the test ensures the network parameter is passed
            // to the endpoint, which in turn would call createGasEstimationService('baseMainnet')
            // This is an implicit test of the routing/validation layer.
            expect(mockGasEstimationService.getGasOptimizationAdvice).toHaveBeenCalled();
        });
    });
});
