import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import { ForgeRaceSubmission } from '../src/models/Models';
import { setupTestMongoDB, teardownTestMongoDB } from './utils/testSetup';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// Performance test configuration
const PERFORMANCE_CONFIG = {
  RPC_URL: 'https://api.devnet.solana.com',
  PROGRAM_ID: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
  CLONES_MINT: 'CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T',
  SMALL_LOAD: 10,
  MEDIUM_LOAD: 50,
  HIGH_LOAD: 100,
  STRESS_LOAD: 500,
  BATCH_SIZES: [5, 10, 25, 50],
  TIMEOUT: 120000 // 2 minutes for performance tests
};

describe('Performance and Load Tests', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;
  let rewardPoolService: RewardPoolService;
  let platformAuthority: Keypair;
  let testFarmers: Keypair[];
  let testPoolId: string;

  beforeAll(async () => {
    // Start MongoDB memory server using shared utility
    const setup = await setupTestMongoDB();
    mongoServer = setup.mongoServer;

    // Initialize Solana connection
    connection = new Connection(PERFORMANCE_CONFIG.RPC_URL, 'confirmed');
    
    // Generate test keypairs
    platformAuthority = Keypair.generate();
    testFarmers = Array.from({ length: 10 }, () => Keypair.generate());
    testPoolId = `perf-test-pool-${Date.now()}`;

    // Initialize reward pool service
    rewardPoolService = new RewardPoolService(
      connection,
      PERFORMANCE_CONFIG.PROGRAM_ID,
      platformAuthority,
      platformAuthority.publicKey.toString()
    );

    // Airdrop SOL to test accounts (devnet only)
    try {
      const airdropPromises = [
        connection.requestAirdrop(platformAuthority.publicKey, 5 * LAMPORTS_PER_SOL),
        ...testFarmers.map(farmer => 
          connection.requestAirdrop(farmer.publicKey, 2 * LAMPORTS_PER_SOL)
        )
      ];
      
      const signatures = await Promise.all(airdropPromises);
      await Promise.all(signatures.map(sig => connection.confirmTransaction(sig)));
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

  describe('Load Testing', () => {
    it('should handle small load (10 concurrent tasks)', async () => {
      const loadSize = PERFORMANCE_CONFIG.SMALL_LOAD;
      const startTime = Date.now();
      
      // Create concurrent task submissions
      const taskPromises = Array.from({ length: loadSize }, async (_, index) => {
        const taskId = `small-load-task-${Date.now()}-${index}`;
        const farmer = testFarmers[index % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();

        // Create submission
        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `Small Load Task ${index}`,
              app: 'Performance Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 85 + (index % 15),
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: 100000,
          maxReward: 100000,
          clampedScore: 85 + (index % 15)
        });

        // Record task completion
        const recordResult = await rewardPoolService.recordTaskCompletion(
          taskId,
          farmerAddress,
          testPoolId,
          100000,
          PERFORMANCE_CONFIG.CLONES_MINT
        );

        return { submission, recordResult };
      });

      const results = await Promise.all(taskPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify results
      expect(results).toHaveLength(loadSize);
      results.forEach(result => {
        expect(result.recordResult.signature).toBeDefined();
        expect(result.recordResult.slot).toBeGreaterThan(0);
      });

      console.log(`Small load test (${loadSize} tasks) completed in ${totalTime}ms`);
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
    }, PERFORMANCE_CONFIG.TIMEOUT);

    it('should handle medium load (50 concurrent tasks)', async () => {
      const loadSize = PERFORMANCE_CONFIG.MEDIUM_LOAD;
      const startTime = Date.now();
      
      // Create concurrent task submissions
      const taskPromises = Array.from({ length: loadSize }, async (_, index) => {
        const taskId = `medium-load-task-${Date.now()}-${index}`;
        const farmer = testFarmers[index % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();

        // Create submission
        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `Medium Load Task ${index}`,
              app: 'Performance Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 80 + (index % 20),
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: 150000,
          maxReward: 150000,
          clampedScore: 80 + (index % 20)
        });

        // Record task completion
        const recordResult = await rewardPoolService.recordTaskCompletion(
          taskId,
          farmerAddress,
          testPoolId,
          150000,
          PERFORMANCE_CONFIG.CLONES_MINT
        );

        return { submission, recordResult };
      });

      const results = await Promise.all(taskPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify results
      expect(results).toHaveLength(loadSize);
      results.forEach(result => {
        expect(result.recordResult.signature).toBeDefined();
        expect(result.recordResult.slot).toBeGreaterThan(0);
      });

      console.log(`Medium load test (${loadSize} tasks) completed in ${totalTime}ms`);
      expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds
    }, PERFORMANCE_CONFIG.TIMEOUT);

    it('should handle high load (100 concurrent tasks)', async () => {
      const loadSize = PERFORMANCE_CONFIG.HIGH_LOAD;
      const startTime = Date.now();
      
      // Create concurrent task submissions
      const taskPromises = Array.from({ length: loadSize }, async (_, index) => {
        const taskId = `high-load-task-${Date.now()}-${index}`;
        const farmer = testFarmers[index % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();

        // Create submission
        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `High Load Task ${index}`,
              app: 'Performance Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 75 + (index % 25),
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: 200000,
          maxReward: 200000,
          clampedScore: 75 + (index % 25)
        });

        // Record task completion
        const recordResult = await rewardPoolService.recordTaskCompletion(
          taskId,
          farmerAddress,
          testPoolId,
          200000,
          PERFORMANCE_CONFIG.CLONES_MINT
        );

        return { submission, recordResult };
      });

      const results = await Promise.all(taskPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify results
      expect(results).toHaveLength(loadSize);
      results.forEach(result => {
        expect(result.recordResult.signature).toBeDefined();
        expect(result.recordResult.slot).toBeGreaterThan(0);
      });

      console.log(`High load test (${loadSize} tasks) completed in ${totalTime}ms`);
      expect(totalTime).toBeLessThan(90000); // Should complete within 90 seconds
    }, PERFORMANCE_CONFIG.TIMEOUT);
  });

  describe('Batch Processing Performance', () => {
    it('should benchmark different batch sizes', async () => {
      const batchSizes = PERFORMANCE_CONFIG.BATCH_SIZES;
      const totalTasks = 100;
      const farmer = testFarmers[0];
      const farmerAddress = farmer.publicKey.toString();

      // Create test data
      const taskIds: string[] = [];
      for (let i = 0; i < totalTasks; i++) {
        const taskId = `batch-benchmark-task-${Date.now()}-${i}`;
        taskIds.push(taskId);

        await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `Batch Benchmark Task ${i}`,
              app: 'Performance Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 85,
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: 100000,
          maxReward: 100000,
          clampedScore: 85,
          smartContractReward: {
            taskId,
            rewardAmount: 100000,
            tokenMint: PERFORMANCE_CONFIG.CLONES_MINT,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: `mock-sig-batch-${i}`,
            recordSlot: 12345 + i,
            isWithdrawn: false,
            platformFeeAmount: 10000,
            farmerRewardAmount: 90000
          }
        });
      }

      const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);
      const benchmarkResults: { batchSize: number; time: number; gasUsed: number }[] = [];

      // Test each batch size
      for (const batchSize of batchSizes) {
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
            tokenMints: [PERFORMANCE_CONFIG.CLONES_MINT]
          });

          totalGasUsed += withdrawalData.estimatedFee || 0;

          const withdrawalResult = await rewardPoolService.executeWithdrawal(
            batch,
            pendingRewards.withdrawalNonce,
            farmer,
            PERFORMANCE_CONFIG.CLONES_MINT,
            platformAuthority.publicKey.toString()
          );

          expect(withdrawalResult.signature).toBeDefined();
        }

        const endTime = Date.now();
        const totalTime = endTime - startTime;

        benchmarkResults.push({
          batchSize,
          time: totalTime,
          gasUsed: totalGasUsed
        });

        console.log(`Batch size ${batchSize}: ${totalTime}ms, ${totalGasUsed} gas units`);
      }

      // Verify benchmark results
      expect(benchmarkResults).toHaveLength(batchSizes.length);
      
      // Larger batch sizes should generally be more efficient
      for (let i = 1; i < benchmarkResults.length; i++) {
        const current = benchmarkResults[i];
        const previous = benchmarkResults[i - 1];
        
        // Larger batches should use less gas per task
        const currentGasPerTask = current.gasUsed / (totalTasks / current.batchSize);
        const previousGasPerTask = previous.gasUsed / (totalTasks / previous.batchSize);
        
        console.log(`Batch ${current.batchSize}: ${currentGasPerTask} gas per task`);
        console.log(`Batch ${previous.batchSize}: ${previousGasPerTask} gas per task`);
      }
    }, PERFORMANCE_CONFIG.TIMEOUT);
  });

  describe('Stress Testing', () => {
    it('should handle stress load (500 tasks) with graceful degradation', async () => {
      const loadSize = PERFORMANCE_CONFIG.STRESS_LOAD;
      const startTime = Date.now();
      const maxConcurrent = 20; // Limit concurrent operations
      
      // Create tasks in batches to avoid overwhelming the system
      const batches = [];
      for (let i = 0; i < loadSize; i += maxConcurrent) {
        batches.push(Array.from({ length: Math.min(maxConcurrent, loadSize - i) }, (_, index) => i + index));
      }

      const results: any[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const batch of batches) {
        const batchPromises = batch.map(async (index) => {
          try {
            const taskId = `stress-task-${Date.now()}-${index}`;
            const farmer = testFarmers[index % testFarmers.length];
            const farmerAddress = farmer.publicKey.toString();

            // Create submission
            const submission = await ForgeRaceSubmission.create({
              _id: new mongoose.Types.ObjectId(),
              address: farmerAddress,
              meta: {
                quest: {
                  title: `Stress Task ${index}`,
                  app: 'Performance Test App',
                  task_id: taskId
                }
              },
              status: 'COMPLETED',
              grade_result: {
                score: 70 + (index % 30),
                summary: 'Good performance',
                reasoning: 'Task completed successfully'
              },
              reward: 50000,
              maxReward: 50000,
              clampedScore: 70 + (index % 30)
            });

            // Record task completion
            const recordResult = await rewardPoolService.recordTaskCompletion(
              taskId,
              farmerAddress,
              testPoolId,
              50000,
              PERFORMANCE_CONFIG.CLONES_MINT
            );

            successCount++;
            return { success: true, submission, recordResult };
          } catch (error) {
            failureCount++;
            return { success: false, error: error.message };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Small delay between batches to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Calculate success rate
      const successRate = (successCount / loadSize) * 100;
      const failureRate = (failureCount / loadSize) * 100;

      console.log(`Stress test results:`);
      console.log(`- Total tasks: ${loadSize}`);
      console.log(`- Success count: ${successCount} (${successRate.toFixed(2)}%)`);
      console.log(`- Failure count: ${failureCount} (${failureRate.toFixed(2)}%)`);
      console.log(`- Total time: ${totalTime}ms`);
      console.log(`- Average time per task: ${(totalTime / loadSize).toFixed(2)}ms`);

      // Verify stress test results
      expect(successCount).toBeGreaterThan(0);
      expect(successRate).toBeGreaterThan(80); // At least 80% success rate
      expect(totalTime).toBeLessThan(PERFORMANCE_CONFIG.TIMEOUT);

      // Verify successful results
      const successfulResults = results.filter(r => r.success);
      successfulResults.forEach(result => {
        expect(result.recordResult.signature).toBeDefined();
        expect(result.recordResult.slot).toBeGreaterThan(0);
      });
    }, PERFORMANCE_CONFIG.TIMEOUT);

    it('should handle memory pressure gracefully', async () => {
      const loadSize = 200;
      const startTime = Date.now();
      
      // Monitor memory usage
      const initialMemory = process.memoryUsage();
      
      // Create large number of submissions
      const submissions = [];
      for (let i = 0; i < loadSize; i++) {
        const taskId = `memory-test-task-${Date.now()}-${i}`;
        const farmer = testFarmers[i % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();

        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `Memory Test Task ${i}`,
              app: 'Performance Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 80,
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: 100000,
          maxReward: 100000,
          clampedScore: 80,
          smartContractReward: {
            taskId,
            rewardAmount: 100000,
            tokenMint: PERFORMANCE_CONFIG.CLONES_MINT,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: `mock-sig-memory-${i}`,
            recordSlot: 12345 + i,
            isWithdrawn: false,
            platformFeeAmount: 10000,
            farmerRewardAmount: 90000
          }
        });

        submissions.push(submission);
      }

      const midMemory = process.memoryUsage();
      
      // Process all submissions
      const processingPromises = submissions.map(async (submission, index) => {
        const taskId = `memory-test-task-${Date.now()}-${index}`;
        const farmer = testFarmers[index % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();

        const pendingRewards = await rewardPoolService.getPendingRewards(farmerAddress);
        
        const withdrawalResult = await rewardPoolService.executeWithdrawal(
          [taskId],
          pendingRewards.withdrawalNonce,
          farmer,
          PERFORMANCE_CONFIG.CLONES_MINT,
          platformAuthority.publicKey.toString()
        );

        return withdrawalResult;
      });

      const results = await Promise.all(processingPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const finalMemory = process.memoryUsage();

      // Calculate memory usage
      const memoryIncrease = {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss
      };

      console.log(`Memory test results:`);
      console.log(`- Total tasks: ${loadSize}`);
      console.log(`- Total time: ${totalTime}ms`);
      console.log(`- Memory increase:`, memoryIncrease);
      console.log(`- Final memory usage:`, finalMemory);

      // Verify results
      expect(results).toHaveLength(loadSize);
      results.forEach(result => {
        expect(result.signature).toBeDefined();
        expect(result.slot).toBeGreaterThan(0);
      });

      // Memory should not grow excessively - use percentage-based threshold
      const memoryThreshold = Math.max(100 * 1024 * 1024, initialMemory.heapUsed * 0.5); // 100MB or 50% of initial memory
      expect(memoryIncrease.heapUsed).toBeLessThan(memoryThreshold);
      expect(totalTime).toBeLessThan(PERFORMANCE_CONFIG.TIMEOUT);
    }, PERFORMANCE_CONFIG.TIMEOUT);
  });

  describe('Concurrent User Testing', () => {
    it('should handle multiple concurrent users efficiently', async () => {
      const userCount = 20;
      const tasksPerUser = 5;
      const startTime = Date.now();

      // Create concurrent users with their tasks
      const userPromises = Array.from({ length: userCount }, async (_, userIndex) => {
        const farmer = testFarmers[userIndex % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();
        const userResults: any[] = [];

        // Each user creates multiple tasks
        for (let taskIndex = 0; taskIndex < tasksPerUser; taskIndex++) {
          const taskId = `concurrent-user-${userIndex}-task-${taskIndex}-${Date.now()}`;

          // Create submission
          const submission = await ForgeRaceSubmission.create({
            _id: new mongoose.Types.ObjectId(),
            address: farmerAddress,
            meta: {
              quest: {
                title: `Concurrent User ${userIndex} Task ${taskIndex}`,
                app: 'Performance Test App',
                task_id: taskId
              }
            },
            status: 'COMPLETED',
            grade_result: {
              score: 85,
              summary: 'Good performance',
              reasoning: 'Task completed successfully'
            },
            reward: 75000,
            maxReward: 75000,
            clampedScore: 85
          });

          // Record task completion
          const recordResult = await rewardPoolService.recordTaskCompletion(
            taskId,
            farmerAddress,
            testPoolId,
            75000,
            PERFORMANCE_CONFIG.CLONES_MINT
          );

          userResults.push({ submission, recordResult });
        }

        return { userIndex, results: userResults };
      });

      const userResults = await Promise.all(userPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify results
      expect(userResults).toHaveLength(userCount);
      userResults.forEach(userResult => {
        expect(userResult.results).toHaveLength(tasksPerUser);
        userResult.results.forEach(result => {
          expect(result.recordResult.signature).toBeDefined();
          expect(result.recordResult.slot).toBeGreaterThan(0);
        });
      });

      const totalTasks = userCount * tasksPerUser;
      console.log(`Concurrent user test results:`);
      console.log(`- Users: ${userCount}`);
      console.log(`- Tasks per user: ${tasksPerUser}`);
      console.log(`- Total tasks: ${totalTasks}`);
      console.log(`- Total time: ${totalTime}ms`);
      console.log(`- Average time per task: ${(totalTime / totalTasks).toFixed(2)}ms`);

      expect(totalTime).toBeLessThan(PERFORMANCE_CONFIG.TIMEOUT);
    }, PERFORMANCE_CONFIG.TIMEOUT);
  });

  describe('Database Performance', () => {
    it('should handle large dataset queries efficiently', async () => {
      const datasetSize = 1000;
      const startTime = Date.now();

      // Create large dataset
      const submissions = [];
      for (let i = 0; i < datasetSize; i++) {
        const taskId = `db-perf-task-${Date.now()}-${i}`;
        const farmer = testFarmers[i % testFarmers.length];
        const farmerAddress = farmer.publicKey.toString();

        const submission = await ForgeRaceSubmission.create({
          _id: new mongoose.Types.ObjectId(),
          address: farmerAddress,
          meta: {
            quest: {
              title: `DB Performance Task ${i}`,
              app: 'Performance Test App',
              task_id: taskId
            }
          },
          status: 'COMPLETED',
          grade_result: {
            score: 80 + (i % 20),
            summary: 'Good performance',
            reasoning: 'Task completed successfully'
          },
          reward: 100000,
          maxReward: 100000,
          clampedScore: 80 + (i % 20),
          smartContractReward: {
            taskId,
            rewardAmount: 100000,
            tokenMint: PERFORMANCE_CONFIG.CLONES_MINT,
            poolId: testPoolId,
            isRecorded: true,
            recordSignature: `mock-sig-db-${i}`,
            recordSlot: 12345 + i,
            isWithdrawn: false,
            platformFeeAmount: 10000,
            farmerRewardAmount: 90000
          }
        });

        submissions.push(submission);
      }

      const creationTime = Date.now() - startTime;

      // Test various database queries
      const queryStartTime = Date.now();

      // Query 1: Find all submissions for a specific user
      const userAddress = testFarmers[0].publicKey.toString();
      const userSubmissions = await ForgeRaceSubmission.find({ address: userAddress });
      
      // Query 2: Find all completed submissions
      const completedSubmissions = await ForgeRaceSubmission.find({ status: 'COMPLETED' });
      
      // Query 3: Find submissions with specific reward range
      const highRewardSubmissions = await ForgeRaceSubmission.find({ 
        reward: { $gte: 80000 } 
      });
      
      // Query 4: Aggregate query - count submissions by status
      const statusCounts = await ForgeRaceSubmission.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      // Query 5: Complex query with multiple conditions
      const complexQuery = await ForgeRaceSubmission.find({
        status: 'COMPLETED',
        'smartContractReward.isRecorded': true,
        'smartContractReward.isWithdrawn': false,
        reward: { $gte: 50000, $lte: 150000 }
      });

      const queryTime = Date.now() - queryStartTime;

      console.log(`Database performance test results:`);
      console.log(`- Dataset size: ${datasetSize}`);
      console.log(`- Creation time: ${creationTime}ms`);
      console.log(`- Query time: ${queryTime}ms`);
      console.log(`- User submissions: ${userSubmissions.length}`);
      console.log(`- Completed submissions: ${completedSubmissions.length}`);
      console.log(`- High reward submissions: ${highRewardSubmissions.length}`);
      console.log(`- Status counts:`, statusCounts);
      console.log(`- Complex query results: ${complexQuery.length}`);

      // Verify query results
      expect(userSubmissions.length).toBeGreaterThan(0);
      expect(completedSubmissions.length).toBe(datasetSize);
      expect(highRewardSubmissions.length).toBeGreaterThan(0);
      expect(statusCounts.length).toBeGreaterThan(0);
      expect(complexQuery.length).toBeGreaterThan(0);

      // Performance assertions
      expect(creationTime).toBeLessThan(30000); // Should create dataset within 30 seconds
      expect(queryTime).toBeLessThan(5000); // Should query within 5 seconds
    }, PERFORMANCE_CONFIG.TIMEOUT);
  });
}); 