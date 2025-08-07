import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import { ForgeRaceSubmission } from '../src/models/Models';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectToDatabase } from '../src/services/database';

describe('Performance Tests', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;
  let rewardPoolService: RewardPoolService;
  let platformAuthority: Keypair;
  let testFarmers: Keypair[];
  let testPoolId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.DB_URI = mongoUri;
    await connectToDatabase();

    connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    platformAuthority = Keypair.generate();
    testFarmers = Array.from({ length: 5 }, () => Keypair.generate());
    testPoolId = `perf-test-pool-${Date.now()}`;

    rewardPoolService = new RewardPoolService(
      connection,
      'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      platformAuthority,
      platformAuthority.publicKey.toString()
    );
  });

  afterAll(async () => {
    if (mongoServer) await mongoServer.stop();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await ForgeRaceSubmission.deleteMany({});
  });

  it('should handle batch processing efficiently', async () => {
    const batchSize = 50;
    const farmer = testFarmers[0];
    const farmerAddress = farmer.publicKey.toString();
    const taskIds: string[] = [];

    // Create test data
    for (let i = 0; i < batchSize; i++) {
      const taskId = `batch-perf-${Date.now()}-${i}`;
      taskIds.push(taskId);

      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: { quest: { title: `Task ${i}`, app: 'Test', task_id: taskId } },
        status: 'COMPLETED',
        grade_result: { score: 85, summary: 'Good', reasoning: 'Success' },
        reward: 100000,
        maxReward: 100000,
        clampedScore: 85,
        smartContractReward: {
          taskId,
          rewardAmount: 100000,
          tokenMint: 'CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T',
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: `mock-sig-${i}`,
          recordSlot: 12345 + i,
          isWithdrawn: false,
          platformFeeAmount: 10000,
          farmerRewardAmount: 90000
        }
      });
    }

    const startTime = Date.now();
    const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);

    const withdrawalData = await rewardPoolService.prepareWithdrawalTransaction({
      farmerAddress,
      expectedNonce: pendingRewards.withdrawalNonce,
      taskIds,
      tokenMints: ['CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T']
    });

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    expect(withdrawalData.taskCount).toBe(batchSize);
    expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds

    console.log(`Batch processing (${batchSize} tasks) completed in ${processingTime}ms`);
  }, 30000);

  it('should handle concurrent operations', async () => {
    const concurrentUsers = 10;
    const tasksPerUser = 5;
    const startTime = Date.now();

    const userPromises = Array.from({ length: concurrentUsers }, async (_, userIndex) => {
      const farmer = testFarmers[userIndex % testFarmers.length];
      const farmerAddress = farmer.publicKey.toString();
      const userResults: any[] = [];

      for (let taskIndex = 0; taskIndex < tasksPerUser; taskIndex++) {
        const taskId = `concurrent-${userIndex}-${taskIndex}-${Date.now()}`;

        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: { quest: { title: `Task ${userIndex}-${taskIndex}`, app: 'Test', task_id: taskId } },
          status: 'COMPLETED',
          grade_result: { score: 85, summary: 'Good', reasoning: 'Success' },
          reward: 75000,
          maxReward: 75000,
          clampedScore: 85
        });

        const recordResult = await rewardPoolService.recordTaskCompletion(
          taskId,
          farmerAddress,
          testPoolId,
          75000,
          'CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T'
        );

        userResults.push({ submission, recordResult });
      }

      return { userIndex, results: userResults };
    });

    const userResults = await Promise.all(userPromises);
    const endTime = Date.now();
    const totalTime = endTime - startTime;

    expect(userResults).toHaveLength(concurrentUsers);
    userResults.forEach(userResult => {
      expect(userResult.results).toHaveLength(tasksPerUser);
      userResult.results.forEach(result => {
        expect(result.recordResult.signature).toBeDefined();
      });
    });

    const totalTasks = concurrentUsers * tasksPerUser;
    console.log(`Concurrent operations (${totalTasks} tasks) completed in ${totalTime}ms`);
    expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds
  }, 60000);

  it('should optimize gas costs', async () => {
    const farmer = testFarmers[0];
    const farmerAddress = farmer.publicKey.toString();
    const taskIds: string[] = [];

    // Create test data
    for (let i = 0; i < 25; i++) {
      const taskId = `gas-opt-${Date.now()}-${i}`;
      taskIds.push(taskId);

      await ForgeRaceSubmission.create({
        _id: new mongoose.Types.ObjectId(),
        address: farmerAddress,
        meta: { quest: { title: `Gas Test ${i}`, app: 'Test', task_id: taskId } },
        status: 'COMPLETED',
        grade_result: { score: 88, summary: 'Good', reasoning: 'Success' },
        reward: 100000,
        maxReward: 100000,
        clampedScore: 88,
        smartContractReward: {
          taskId,
          rewardAmount: 100000,
          tokenMint: 'CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T',
          poolId: testPoolId,
          isRecorded: true,
          recordSignature: `mock-sig-gas-${i}`,
          recordSlot: 12345 + i,
          isWithdrawn: false,
          platformFeeAmount: 10000,
          farmerRewardAmount: 90000
        }
      });
    }

    const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);
    let totalGasUsed = 0;

    // Test different batch sizes
    const batchSizes = [5, 10, 25];
    for (const batchSize of batchSizes) {
      const batches = [];
      for (let i = 0; i < taskIds.length; i += batchSize) {
        batches.push(taskIds.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const withdrawalData = await rewardPoolService.prepareWithdrawalTransaction({
          farmerAddress,
          expectedNonce: pendingRewards.withdrawalNonce,
          taskIds: batch,
          tokenMints: ['CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T']
        });

        totalGasUsed += withdrawalData.estimatedFee || 0;
      }
    }

    console.log(`Gas optimization test completed with ${totalGasUsed} estimated gas units`);
    expect(totalGasUsed).toBeGreaterThan(0);
  }, 30000);
}); 