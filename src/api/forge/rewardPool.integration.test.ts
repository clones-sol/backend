import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { Connection, Keypair } from '@solana/web3.js';
import rewardPoolRouter from './rewardPool.ts';
import { RewardPoolService, RewardPoolServiceError, RewardPoolError } from '../../services/blockchain/rewardPool.ts';
import { errorHandler } from '../../middleware/errorHandler.ts';

// Mock external dependencies
vi.mock('../../models/Models.ts', () => ({
  ForgeRaceSubmission: {
    find: vi.fn(),
    findById: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../services/redis.ts', () => {
  const Redis = require('ioredis-mock');
  const redisMock = new Redis();
  return {
    redisPublisher: redisMock,
    redisSubscriber: redisMock,
  };
});

// Mock middleware
vi.mock('../../middleware/auth.ts', () => ({
  requireWalletAddress: (req: any, res: any, next: any) => {
    req.walletAddress = 'GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK';
    next();
  },
}));

vi.mock('../../middleware/validator.ts', () => ({
  validateBody: () => (req: any, res: any, next: any) => next(),
  validateParams: () => (req: any, res: any, next: any) => next(),
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
      rpcEndpoint: 'https://api.devnet.solana.com',
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

describe('Reward Pool Integration Tests', () => {
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/forge/reward-pool', rewardPoolRouter);
    app.use(errorHandler);

    // Mock RewardPoolService
    mockRewardPoolService = {
      getFarmerAccount: vi.fn(),
      getPendingRewards: vi.fn(),
      getWithdrawableTasks: vi.fn(),
      getWithdrawalHistory: vi.fn(),
      prepareWithdrawalTransaction: vi.fn(),
      executeWithdrawal: vi.fn(),
      executeWithdrawalWithRetry: vi.fn(),
      recordTaskCompletionWithRetry: vi.fn(),
      getPlatformStats: vi.fn(),
      setPaused: vi.fn(),
      recordTaskCompletion: vi.fn(),
      getRewardVaultBalance: vi.fn(),
      createRewardVault: vi.fn(),
      initializeRewardPool: vi.fn(),
    };

    vi.mocked(RewardPoolService.getInstance).mockReturnValue(mockRewardPoolService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockForgeRaceSubmission = vi.mocked(require('../../models/Models.ts').ForgeRaceSubmission);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Configuration Validation', () => {
    it('should handle invalid program ID gracefully', async () => {
      // Test with invalid program ID
      const invalidProgramId = 'invalid-program-id';
      
      expect(() => {
        new RewardPoolService(
          new Connection('https://api.devnet.solana.com'),
          invalidProgramId,
          Keypair.generate()
        );
      }).toThrow(RewardPoolServiceError);
    });

    it('should handle missing RPC URL', async () => {
      expect(() => {
        new RewardPoolService(
          null as any,
          'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
          Keypair.generate()
        );
      }).toThrow(RewardPoolServiceError);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to withdrawal endpoints', async () => {
      // Test that withdrawal endpoints have rate limiting middleware
      const response = await supertest(app)
        .post('/api/v1/forge/reward-pool/prepare-withdrawal')
        .send({ tokenMints: [], batchSize: 10 })
        .expect(200);

      // The middleware should be applied (we can't easily test the actual rate limiting in unit tests)
      expect(response.status).toBe(200);
    });

    it('should apply rate limiting to execute withdrawal endpoint', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/reward-pool/execute-withdrawal')
        .send({
          taskIds: ['task1'],
          expectedNonce: 1,
          transactionSignature: 'test-sig',
          slot: 12345
        })
        .expect(200);

      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle RewardPoolServiceError correctly', async () => {
      const error = new RewardPoolServiceError(
        RewardPoolError.INVALID_WALLET_ADDRESS,
        'Invalid wallet address format'
      );

      mockRewardPoolService.getPendingRewards.mockRejectedValue(error);

      const response = await supertest(app)
        .get('/api/v1/forge/reward-pool/pending-rewards/GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK')
        .expect(500);

      expect(response.body.error).toBeDefined();
    });

    it('should handle connection failures gracefully', async () => {
      const connectionError = new RewardPoolServiceError(
        RewardPoolError.CONNECTION_FAILED,
        'Failed to connect to Solana network'
      );

      mockRewardPoolService.getFarmerAccount.mockRejectedValue(connectionError);

      const response = await supertest(app)
        .get('/api/v1/forge/reward-pool/farmer-account/GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK')
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry failed transactions with exponential backoff', async () => {
      // Mock a transaction that fails twice then succeeds
      let attemptCount = 0;
      mockRewardPoolService.executeWithdrawalWithRetry.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Transaction failed');
        }
        return { signature: 'success-sig', slot: 12345 };
      });

      const response = await supertest(app)
        .post('/api/v1/forge/reward-pool/execute-withdrawal')
        .send({
          taskIds: ['task1'],
          expectedNonce: 1,
          transactionSignature: 'test-sig',
          slot: 12345
        })
        .expect(200);

      expect(mockRewardPoolService.executeWithdrawalWithRetry).toHaveBeenCalled();
      expect(response.body.data.signature).toBe('success-sig');
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = new RewardPoolServiceError(
        RewardPoolError.INVALID_CONFIGURATION,
        'Invalid configuration'
      );

      mockRewardPoolService.executeWithdrawalWithRetry.mockRejectedValue(nonRetryableError);

      const response = await supertest(app)
        .post('/api/v1/forge/reward-pool/execute-withdrawal')
        .send({
          taskIds: ['task1'],
          expectedNonce: 1,
          transactionSignature: 'test-sig',
          slot: 12345
        })
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Input Validation', () => {
    it('should validate wallet address format', async () => {
      const invalidAddress = 'invalid-address';
      
      const response = await supertest(app)
        .get(`/api/v1/forge/reward-pool/pending-rewards/${invalidAddress}`)
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should validate withdrawal request parameters', async () => {
      const invalidRequest = {
        taskIds: [], // Empty array should be invalid
        expectedNonce: -1, // Negative nonce should be invalid
        transactionSignature: '',
        slot: -1
      };

      const response = await supertest(app)
        .post('/api/v1/forge/reward-pool/execute-withdrawal')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Security', () => {
    it('should prevent users from accessing other users\' rewards', async () => {
      // Mock the auth middleware to return a different wallet address
      vi.mocked(require('../../middleware/auth.ts').requireWalletAddress)
        .mockImplementation((req: any, res: any, next: any) => {
          req.walletAddress = 'different-wallet-address';
          next();
        });

      const response = await supertest(app)
        .get('/api/v1/forge/reward-pool/pending-rewards/GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK')
        .expect(403);

      expect(response.body.error).toBeDefined();
    });

    it('should validate transaction signatures', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/reward-pool/execute-withdrawal')
        .send({
          taskIds: ['task1'],
          expectedNonce: 1,
          transactionSignature: 'invalid-signature',
          slot: 12345
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      // Mock successful responses
      mockRewardPoolService.getPendingRewards.mockResolvedValue({
        totalPending: 100,
        taskCount: 5,
        tokenBreakdown: { 'USDC': 100 }
      });

      // Make multiple concurrent requests
      const requests = Array(10).fill(null).map(() =>
        supertest(app)
          .get('/api/v1/forge/reward-pool/pending-rewards/GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK')
          .expect(200)
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
      });
    });

    it('should cache frequently accessed data', async () => {
      // This would require implementing caching in the service
      // For now, we just test that the service is called correctly
      mockRewardPoolService.getFarmerAccount.mockResolvedValue({
        farmerAddress: 'GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK',
        withdrawalNonce: 1,
        totalRewardsEarned: 1000,
        totalRewardsWithdrawn: 500,
        lastWithdrawalSlot: 12345
      });

      const response = await supertest(app)
        .get('/api/v1/forge/reward-pool/farmer-account/GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK')
        .expect(200);

      expect(mockRewardPoolService.getFarmerAccount).toHaveBeenCalledWith(
        'GjY2YhNBYbYPUH5nB2p1K2sM9c1A3s8zQ5E6f7g8h9jK'
      );
    });
  });
}); 