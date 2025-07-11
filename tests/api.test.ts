import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

// Mock modules using vi.mock
vi.mock('../src/middleware/auth.js', () => ({
    requireWalletAddress: (req: any, res: any, next: any) => {
        req.walletAddress = 'test-owner-address';
        next();
    }
}));

vi.mock('../src/services/forge/pools.js', () => ({
    updatePoolStatus: vi.fn()
}));

vi.mock('../src/services/security/crypto.js', () => ({
    decrypt: vi.fn(),
    encrypt: vi.fn()
}));

vi.mock('../src/models/Models.js', () => ({
    TrainingPoolModel: {
        findById: vi.fn()
    },
    ForgeAppModel: vi.fn(),
    ForgeRaceSubmission: vi.fn(),
    GymSession: vi.fn(),
    TrainingEvent: vi.fn(),
    UploadSession: vi.fn(),
    WalletConnection: vi.fn()
}));

// Create a mock blockchain service instance
const mockBlockchainService = {
    transferToken: vi.fn(),
    transferSol: vi.fn()
};

vi.mock('../src/services/blockchain/index.js', () => {
    class MockedBlockchainService {
        static MIN_SOL_BALANCE = 0.017;
        transferToken = mockBlockchainService.transferToken;
        transferSol = mockBlockchainService.transferSol;
    }
    return { default: MockedBlockchainService };
});

// Mock Keypair.fromSecretKey to avoid real crypto operations
vi.mock('@solana/web3.js', async () => {
    const actual = await vi.importActual('@solana/web3.js') as any;
    return {
        ...actual,
        Keypair: {
            ...actual.Keypair,
            fromSecretKey: vi.fn().mockReturnValue({
                publicKey: { toString: () => 'mocked-public-key' },
                secretKey: new Uint8Array(64)
            })
        }
    };
});

// Now use dynamic imports to get the mocked modules
const { app } = await import('../src/server.js');
const { supportedTokens } = await import('../src/services/blockchain/tokens.js');
const { TrainingPoolModel } = await import('../src/models/Models.js');
const { updatePoolStatus } = await import('../src/services/forge/pools.js');
const { decrypt } = await import('../src/services/security/crypto.js');
const BlockchainService = (await import('../src/services/blockchain/index.js')).default;
const { TrainingPoolStatus } = await import('../src/types/index.js');

describe('Forge API', () => {
    let server: any;

    beforeAll(async () => {
        return new Promise<void>((resolve, reject) => {
            server = app.listen(0, (err?: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });

    afterAll(async () => {
        return new Promise<void>((resolve, reject) => {
            server.close((err?: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/v1/forge/pools/supportedTokens', () => {
        it('should return a list of supported tokens', async () => {
            const response = await request(server).get('/api/v1/forge/pools/supportedTokens');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toBeInstanceOf(Array);

            const expectedTokens = Object.entries(supportedTokens).map(([symbol, { name }]) => ({
                symbol,
                name
            }));

            expect(response.body.data).toEqual(expect.arrayContaining(expectedTokens));
        });
    });

    describe('POST /api/v1/forge/pools/withdraw/spl', () => {
        const mockPool = {
            _id: 'pool123',
            ownerAddress: 'test-owner-address',
            depositPrivateKey: 'encrypted-key',
            token: { symbol: 'CLONES' },
            save: vi.fn()
        };

        it('should successfully withdraw SPL tokens for the pool owner', async () => {
            // Setup mocks
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 0.1,
                funds: 100,
                status: TrainingPoolStatus.live
            });
            vi.mocked(decrypt).mockReturnValue('decrypted-private-key');

            // Mock the transferToken method to return a successful result
            mockBlockchainService.transferToken.mockResolvedValue({
                signature: 'test-signature',
                usedFeePercentage: 1
            });

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/spl')
                .send({ poolId: 'pool123', amount: 50 });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.signature).toEqual({
                signature: 'test-signature',
                usedFeePercentage: 1
            });
            expect(mockBlockchainService.transferToken).toHaveBeenCalledWith(
                expect.any(String), // tokenMint
                50, // amount
                expect.any(Object), // fromWallet Keypair
                'test-owner-address' // toAddress
            );
        });

        it('should return 404 Not Found if pool does not exist', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(null);

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/spl')
                .send({ poolId: 'nonexistent-pool', amount: 50 });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return 403 Forbidden if the requester is not the owner', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue({
                ...mockPool,
                ownerAddress: 'another-address'
            });

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/spl')
                .send({ poolId: 'pool123', amount: 50 });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
        });

        it('should return 400 Bad Request if withdrawal amount exceeds balance', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 0.1,
                funds: 40, // Less than withdrawal amount
                status: TrainingPoolStatus.live
            });

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/spl')
                .send({ poolId: 'pool123', amount: 50 });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        it('should return 402 Payment Required if insufficient SOL for gas', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 0.01, // Less than MIN_SOL_BALANCE (0.017)
                funds: 100,
                status: TrainingPoolStatus.live
            });

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/spl')
                .send({ poolId: 'pool123', amount: 50 });

            expect(response.status).toBe(402);
            expect(response.body.success).toBe(false);
        });

        it('should return 500 Internal Server Error if token transfer fails', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 0.1,
                funds: 100,
                status: TrainingPoolStatus.live
            });
            vi.mocked(decrypt).mockReturnValue('decrypted-private-key');

            // Mock the transferToken method to return false (failure)
            mockBlockchainService.transferToken.mockResolvedValue(false);

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/spl')
                .send({ poolId: 'pool123', amount: 50 });

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
        });
    });

    describe('POST /api/v1/forge/pools/withdraw/sol', () => {
        const mockPool = {
            _id: 'pool123',
            ownerAddress: 'test-owner-address',
            depositPrivateKey: 'encrypted-key',
            save: vi.fn()
        };

        it('should successfully withdraw SOL for the pool owner', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 1, // 1 SOL
                funds: 0,
                status: TrainingPoolStatus.live
            });
            vi.mocked(decrypt).mockReturnValue('decrypted-private-key');

            // Mock the transferSol method to return a successful result
            mockBlockchainService.transferSol.mockResolvedValue('test-sol-signature');

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/sol')
                .send({ poolId: 'pool123', amount: 0.5 });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.signature).toBe('test-sol-signature');
            expect(mockBlockchainService.transferSol).toHaveBeenCalledWith(
                0.5,
                expect.any(Object), // fromWallet Keypair
                'test-owner-address'
            );
        });

        it('should return 404 Not Found if pool does not exist', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(null);

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/sol')
                .send({ poolId: 'nonexistent-pool', amount: 0.5 });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return 403 Forbidden if the requester is not the owner', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue({
                ...mockPool,
                ownerAddress: 'another-address'
            });

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/sol')
                .send({ poolId: 'pool123', amount: 0.5 });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
        });

        it('should return 400 Bad Request for insufficient SOL balance', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 0.5, // 0.5 SOL - insufficient for withdrawal + gas
                funds: 0,
                status: TrainingPoolStatus.live
            });

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/sol')
                .send({ poolId: 'pool123', amount: 0.5 }); // Trying to withdraw everything

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        it('should return 500 Internal Server Error if SOL transfer fails', async () => {
            vi.mocked(TrainingPoolModel.findById).mockResolvedValue(mockPool);
            vi.mocked(updatePoolStatus).mockResolvedValue({
                solBalance: 1, // 1 SOL
                funds: 0,
                status: TrainingPoolStatus.live
            });
            vi.mocked(decrypt).mockReturnValue('decrypted-private-key');

            // Mock the transferSol method to return false (failure)
            mockBlockchainService.transferSol.mockResolvedValue(false);

            const response = await request(server)
                .post('/api/v1/forge/pools/withdraw/sol')
                .send({ poolId: 'pool123', amount: 0.5 });

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
        });
    });
}); 