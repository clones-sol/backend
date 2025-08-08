import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import { ForgeRaceSubmission } from '../src/models/Models';
import { setupTestMongoDB, teardownTestMongoDB } from './utils/testSetup';

// Test configuration
const TEST_CONFIG = {
  RPC_URL: 'https://api.devnet.solana.com',
  PROGRAM_ID: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
  CLONES_MINT: 'CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T',
  TEST_FARMER_ADDRESS: 'Gv4X6uNVMouwtYCZ1SW9GpBjmMUNGvEd8gRZkTFpLEqf',
  TEST_POOL_ID: 'test-pool-001',
  TEST_REWARD_AMOUNT: 100000, // 0.1 CLONES
  BATCH_SIZE: 10,
  MAX_RETRIES: 3
};

describe('Reward Pool Complete Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;
  let rewardPoolService: RewardPoolService;
  let platformAuthority: Keypair;
  let testFarmer: Keypair;
  let testPoolId: string;

  beforeAll(async () => {
    // Start MongoDB memory server using shared utility
    const setup = await setupTestMongoDB();
    mongoServer = setup.mongoServer;

    // Initialize Solana connection
    connection = new Connection(TEST_CONFIG.RPC_URL, 'confirmed');
    
    // Generate test keypairs
    platformAuthority = Keypair.generate();
    testFarmer = Keypair.generate();
    testPoolId = `test-pool-${Date.now()}`;

    // Initialize reward pool service
    rewardPoolService = new RewardPoolService(
      connection,
      TEST_CONFIG.PROGRAM_ID,
      platformAuthority,
      platformAuthority.publicKey.toString()
    );

    // Airdrop SOL to test accounts (devnet only)
    try {
      const signature1 = await connection.requestAirdrop(platformAuthority.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature1);
      
      const signature2 = await connection.requestAirdrop(testFarmer.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature2);
    } catch (error) {
      console.warn('Airdrop failed (expected on non-devnet):', error);
    }
  });

  afterAll(async () => {
    await teardownTestMongoDB(mongoServer);
  });

  beforeEach(async () => {
    // Clear test data before each test
    await ForgeRaceSubmission.deleteMany({});
  });

  afterEach(async () => {
    // Clean up after each test
    await ForgeRaceSubmission.deleteMany({});
  });

  describe('Complete Reward Flow', () => {
    it('should complete full reward flow: task completion -> recording -> withdrawal', async () => {
      const taskId = `task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Step 1: Create a test submission
      const submission = await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Test Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 85,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 85
      });

      // Step 2: Record task completion in smart contract
      const recordResult = await rewardPoolService.recordTaskCompletion(
        taskId,
        farmerAddress,
        testPoolId,
        TEST_CONFIG.TEST_REWARD_AMOUNT,
        TEST_CONFIG.CLONES_MINT
      );

      expect(recordResult.signature).toBeDefined();
      expect(recordResult.slot).toBeGreaterThan(0);

      // Step 3: Update submission with smart contract data
      await ForgeRaceSubmission.findByIdAndUpdate(submission._id, {
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: recordResult.signature,
          recordSlot: recordResult.slot,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      // Step 4: Check pending rewards
      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);
      expect(pendingRewards).toBeDefined();
      expect(pendingRewards.totalRewardsEarned).toBeGreaterThan(0);

      // Step 5: Prepare withdrawal
      const withdrawalData = await rewardPoolService.prepareWithdrawalTransaction({
        farmerAddress,
        expectedNonce: pendingRewards.withdrawalNonce,
        taskIds: [taskId],
        tokenMints: [TEST_CONFIG.CLONES_MINT]
      });

      expect(withdrawalData.taskCount).toBe(1);
      expect(withdrawalData.expectedNonce).toBe(pendingRewards.withdrawalNonce);

      // Step 6: Execute withdrawal
      const withdrawalResult = await rewardPoolService.executeWithdrawal(
        [taskId],
        pendingRewards.withdrawalNonce,
        testFarmer,
        TEST_CONFIG.CLONES_MINT,
        platformAuthority.publicKey.toString()
      );

      expect(withdrawalResult.signature).toBeDefined();
      expect(withdrawalResult.slot).toBeGreaterThan(0);

      // Step 7: Update submission as withdrawn
      await ForgeRaceSubmission.findByIdAndUpdate(submission._id, {
        'smartContractReward.isWithdrawn': true,
        'smartContractReward.withdrawalSignature': withdrawalResult.signature,
        'smartContractReward.withdrawalSlot': withdrawalResult.slot
      });

      // Step 8: Verify final state
      const updatedSubmission = await ForgeRaceSubmission.findById(submission._id);
      expect(updatedSubmission?.smartContractReward?.isWithdrawn).toBe(true);
      expect(updatedSubmission?.smartContractReward?.withdrawalSignature).toBe(withdrawalResult.signature);

      const finalRewards = await rewardPoolService.getPendingRewards(farmerAddress);
      expect(finalRewards.totalRewardsWithdrawn).toBeGreaterThan(0);
    }, 30000); // 30 second timeout for integration test

    it('should handle batch withdrawals efficiently', async () => {
      const taskIds: string[] = [];
      const farmerAddress = testFarmer.publicKey.toString();

      // Create multiple test submissions
      for (let i = 0; i < TEST_CONFIG.BATCH_SIZE; i++) {
        const taskId = `batch-task-${Date.now()}-${i}`;
        taskIds.push(taskId);

        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `Batch Task ${i}`,
              app: 'Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 90,
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          clampedScore: 90,
          smartContractReward: {
            taskId,
            rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
            tokenMint: TEST_CONFIG.CLONES_MINT,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: `mock-sig-${i}`,
            recordSlot: 12345 + i,
            isWithdrawn: false,
            platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
            farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
          }
        });
      }

      // Get pending rewards
      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);
      
      // Prepare batch withdrawal
      const withdrawalData = await rewardPoolService.prepareWithdrawalTransaction({
        farmerAddress,
        expectedNonce: pendingRewards.withdrawalNonce,
        taskIds,
        tokenMints: [TEST_CONFIG.CLONES_MINT]
      });

      expect(withdrawalData.taskCount).toBe(TEST_CONFIG.BATCH_SIZE);
      expect(withdrawalData.totalRewardAmount).toBe(TEST_CONFIG.TEST_REWARD_AMOUNT * TEST_CONFIG.BATCH_SIZE);

      // Execute batch withdrawal
      const withdrawalResult = await rewardPoolService.executeWithdrawal(
        taskIds,
        pendingRewards.withdrawalNonce,
        testFarmer,
        TEST_CONFIG.CLONES_MINT,
        platformAuthority.publicKey.toString()
      );

      expect(withdrawalResult.signature).toBeDefined();

      // Update all submissions as withdrawn
      const updateResult = await ForgeRaceSubmission.updateMany(
        {
          address: farmerAddress,
          'smartContractReward.taskId': { $in: taskIds },
          'smartContractReward.isWithdrawn': false
        },
        {
          $set: {
            'smartContractReward.isWithdrawn': true,
            'smartContractReward.withdrawalSignature': withdrawalResult.signature,
            'smartContractReward.withdrawalSlot': withdrawalResult.slot
          }
        }
      );

      expect(updateResult.modifiedCount).toBe(TEST_CONFIG.BATCH_SIZE);
    }, 30000);

    it('should handle withdrawal retries with exponential backoff', async () => {
      const taskId = `retry-task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Create test submission
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Retry Test Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 80,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 80,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-retry',
          recordSlot: 12345,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Test withdrawal with retry mechanism
      const withdrawalResult = await rewardPoolService.executeWithdrawalWithRetry(
        [taskId],
        pendingRewards.withdrawalNonce,
        testFarmer,
        TEST_CONFIG.CLONES_MINT,
        platformAuthority.publicKey.toString(),
        TEST_CONFIG.MAX_RETRIES
      );

      expect(withdrawalResult.signature).toBeDefined();
      expect(withdrawalResult.slot).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid nonce gracefully', async () => {
      const taskId = `invalid-nonce-task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Create test submission
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Invalid Nonce Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 75,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 75,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-invalid-nonce',
          recordSlot: 12345,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      // Try to withdraw with wrong nonce
      await expect(
        rewardPoolService.executeWithdrawal(
          [taskId],
          999, // Wrong nonce
          testFarmer,
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        )
      ).rejects.toThrow();
    });

    it('should handle already withdrawn tasks', async () => {
      const taskId = `already-withdrawn-task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Create test submission already marked as withdrawn
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Already Withdrawn Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 70,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 70,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-already-withdrawn',
          recordSlot: 12345,
          isWithdrawn: true, // Already withdrawn
          withdrawalSignature: 'mock-withdrawal-sig',
          withdrawalSlot: 12346,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Try to withdraw already withdrawn task
      await expect(
        rewardPoolService.executeWithdrawal(
          [taskId],
          pendingRewards.withdrawalNonce,
          testFarmer,
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        )
      ).rejects.toThrow();
    });

    it('should handle empty task list', async () => {
      const farmerAddress = testFarmer.publicKey.toString();
      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Try to withdraw with empty task list
      await expect(
        rewardPoolService.executeWithdrawal(
          [], // Empty task list
          pendingRewards.withdrawalNonce,
          testFarmer,
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        )
      ).rejects.toThrow();
    });

    it('should handle mixed token types in batch', async () => {
      const taskId1 = `mixed-token-task-1-${Date.now()}`;
      const taskId2 = `mixed-token-task-2-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();
      const differentTokenMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

      // Create submissions with different token mints
      await ForgeRaceSubmission.create([
        {
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: 'Mixed Token Task 1',
              app: 'Test App',
              task_id: taskId1
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 85,
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          clampedScore: 85,
          smartContractReward: {
            taskId: taskId1,
            rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
            tokenMint: TEST_CONFIG.CLONES_MINT,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: 'mock-sig-mixed-1',
            recordSlot: 12345,
            isWithdrawn: false,
            platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
            farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
          }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: 'Mixed Token Task 2',
              app: 'Test App',
              task_id: taskId2
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 90,
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          clampedScore: 90,
          smartContractReward: {
            taskId: taskId2,
            rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
            tokenMint: differentTokenMint,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: 'mock-sig-mixed-2',
            recordSlot: 12346,
            isWithdrawn: false,
            platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
            farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
          }
        }
      ]);

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Try to withdraw tasks with different token mints
      await expect(
        rewardPoolService.executeWithdrawal(
          [taskId1, taskId2],
          pendingRewards.withdrawalNonce,
          testFarmer,
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        )
      ).rejects.toThrow();
    });
  });

  describe('Gas Optimization Tests', () => {
    it('should optimize gas costs for batch operations', async () => {
      const taskIds: string[] = [];
      const farmerAddress = testFarmer.publicKey.toString();

      // Create multiple test submissions
      for (let i = 0; i < 50; i++) {
        const taskId = `gas-opt-task-${Date.now()}-${i}`;
        taskIds.push(taskId);

        await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `Gas Optimization Task ${i}`,
              app: 'Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 88,
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
          clampedScore: 88,
          smartContractReward: {
            taskId,
            rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
            tokenMint: TEST_CONFIG.CLONES_MINT,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: `mock-sig-gas-${i}`,
            recordSlot: 12345 + i,
            isWithdrawn: false,
            platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
            farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
          }
        });
      }

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Test gas optimization by processing in batches
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < taskIds.length; i += batchSize) {
        batches.push(taskIds.slice(i, i + batchSize));
      }

      const startTime = Date.now();
      let totalGasUsed = 0;

      for (const batch of batches) {
        const withdrawalData = await rewardPoolService.prepareWithdrawalTransaction({
          farmerAddress,
          expectedNonce: pendingRewards.withdrawalNonce,
          taskIds: batch,
          tokenMints: [TEST_CONFIG.CLONES_MINT]
        });

        totalGasUsed += withdrawalData.estimatedFee || 0;

        const withdrawalResult = await rewardPoolService.executeWithdrawal(
          batch,
          pendingRewards.withdrawalNonce,
          testFarmer,
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        );

        expect(withdrawalResult.signature).toBeDefined();
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify gas optimization
      expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds
      expect(totalGasUsed).toBeGreaterThan(0);
      
      console.log(`Gas optimization test completed in ${totalTime}ms with ${totalGasUsed} estimated gas units`);
    }, 60000);

    it('should handle priority fee adjustments', async () => {
      const taskId = `priority-fee-task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Create test submission
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Priority Fee Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 95,
          summary: 'Excellent performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 95,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-priority-fee',
          recordSlot: 12345,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Test withdrawal with priority fee adjustment
      const withdrawalResult = await rewardPoolService.executeWithdrawalWithRetry(
        [taskId],
        pendingRewards.withdrawalNonce,
        testFarmer,
        TEST_CONFIG.CLONES_MINT,
        platformAuthority.publicKey.toString(),
        3 // maxRetries
      );

      expect(withdrawalResult.signature).toBeDefined();
    }, 30000);
  });

  describe('Security Tests', () => {
    it('should prevent unauthorized access to rewards', async () => {
      const taskId = `unauthorized-task-${Date.now()}`;
      const authorizedFarmer = testFarmer.publicKey.toString();
      const unauthorizedFarmer = Keypair.generate().publicKey.toString();

      // Create submission for authorized farmer
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: authorizedFarmer,
        meta: {
          quest: {
            title: 'Unauthorized Access Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 85,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 85,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-unauthorized',
          recordSlot: 12345,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      const pendingRewards = await rewardPoolService.getPendingRewards(authorizedFarmer);

      // Try to withdraw with unauthorized farmer keypair
      const unauthorizedKeypair = Keypair.generate();
      
      await expect(
        rewardPoolService.executeWithdrawal(
          [taskId],
          pendingRewards.withdrawalNonce,
          unauthorizedKeypair, // Wrong keypair
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        )
      ).rejects.toThrow();
    });

    it('should validate transaction signatures', async () => {
      const taskId = `signature-validation-task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Create test submission
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Signature Validation Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 90,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 90,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-validation',
          recordSlot: 12345,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // Test withdrawal and verify signature
      const withdrawalResult = await rewardPoolService.executeWithdrawal(
        [taskId],
        pendingRewards.withdrawalNonce,
        testFarmer,
        TEST_CONFIG.CLONES_MINT,
        platformAuthority.publicKey.toString()
      );

      expect(withdrawalResult.signature).toBeDefined();
      expect(withdrawalResult.signature.length).toBeGreaterThan(0);
      
      // Verify signature format (should be base58 encoded)
      expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(withdrawalResult.signature)).toBe(true);
    }, 30000);

    it('should handle replay attack prevention', async () => {
      const taskId = `replay-attack-task-${Date.now()}`;
      const farmerAddress = testFarmer.publicKey.toString();

      // Create test submission
      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: {
          quest: {
            title: 'Replay Attack Task',
            app: 'Test App',
            task_id: taskId
          }
        },
        status: 'COMPLETED',
        grade_result: {
          score: 88,
          summary: 'Good performance',
          reasoning: 'Task completed successfully'
        },
        reward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        maxReward: TEST_CONFIG.TEST_REWARD_AMOUNT,
        clampedScore: 88,
        smartContractReward: {
          taskId,
          rewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT,
          tokenMint: TEST_CONFIG.CLONES_MINT,
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: 'mock-sig-replay',
          recordSlot: 12345,
          isWithdrawn: false,
          platformFeeAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.1,
          farmerRewardAmount: TEST_CONFIG.TEST_REWARD_AMOUNT * 0.9
        }
      });

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

      // First withdrawal should succeed
      const withdrawalResult1 = await rewardPoolService.executeWithdrawal(
        [taskId],
        pendingRewards.withdrawalNonce,
        testFarmer,
        TEST_CONFIG.CLONES_MINT,
        platformAuthority.publicKey.toString()
      );

      expect(withdrawalResult1.signature).toBeDefined();

      // Second withdrawal with same nonce should fail (replay attack)
      await expect(
        rewardPoolService.executeWithdrawal(
          [taskId],
          pendingRewards.withdrawalNonce, // Same nonce
          testFarmer,
          TEST_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        )
      ).rejects.toThrow();
    }, 30000);
  });
}); 