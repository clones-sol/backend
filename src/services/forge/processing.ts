import mongoose from 'mongoose';
import {
  ForgeSubmissionGradeResult,
  DBDemonstrationSubmission,
  ForgeSubmissionProcessingStatus,
  UploadLimitType,
  OnChainReward
} from '../../types/index.ts';
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts';
import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getTokenContractAddress } from '../blockchain/tokens.ts';
import { createClaimAuthService } from '../blockchain/claimAuthService.ts';


// --- Distributed Lock for Reward Calculation ---
// This should be moved to its own file in /models
const processingLockSchema = new mongoose.Schema({
  _id: String, // Lock ID, e.g., `${userAddress}-${factoryId}`
  createdAt: { type: Date, expires: '5m', default: Date.now } // TTL to prevent stale locks
});
const ProcessingLockModel = mongoose.model('ProcessingLock', processingLockSchema);

async function acquireLock(lockId: string): Promise<void> {
  let lockAcquired = false;
  while (!lockAcquired) {
    try {
      await ProcessingLockModel.create({ _id: lockId });
      lockAcquired = true;
    } catch (error: any) {
      if (error.code === 11000) { // Duplicate key error
        // Lock is held, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        throw error;
      }
    }
  }
}

async function releaseLock(lockId: string): Promise<void> {
  await ProcessingLockModel.deleteOne({ _id: lockId });
}
// --- End Distributed Lock ---


// Initialize claim authorization service
let claimAuthService: ReturnType<typeof createClaimAuthService> | null = null;
try {
  claimAuthService = createClaimAuthService();
} catch (error) {
  console.warn('ClaimAuthService not initialized:', (error as Error).message);
}

// Global processing queue
let isProcessing = false;
const processingQueue: string[] = [];

/**
 * Calculate user's total cumulative earned rewards for a specific factory/pool
 * Does NOT include already claimed amounts - only tracks earned rewards from completed submissions
 */
async function calculateUserCumulativeRewards(userAddress: string, factoryId: string): Promise<number> {
  try {
    // Use aggregation pipeline for efficient summation in the DB
    const result = await DemonstrationSubmission.aggregate([
      {
        $match: {
          address: userAddress,
          'meta.quest.factory_id': factoryId,
          status: ForgeSubmissionProcessingStatus.COMPLETED,
          reward: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: '$reward' }
        }
      }
    ]);

    const totalEarned = result.length > 0 ? result[0].totalEarned : 0;
    console.log(`User ${userAddress} has cumulative earned of ${totalEarned} from factory ${factoryId}`);
    return totalEarned;
  } catch (error) {
    console.error('Error calculating cumulative rewards:', error);
    return 0;
  }
}

export async function addToProcessingQueue(submissionId: string) {
  processingQueue.push(submissionId);
  processNextInQueue().catch(console.error);
}

export async function processNextInQueue() {
  if (isProcessing || processingQueue.length === 0) return;

  isProcessing = true;
  const submissionId = processingQueue[0];
  let submission:
    | (mongoose.Document<unknown, {}, DBDemonstrationSubmission> & DBDemonstrationSubmission)
    | null = null;
  let lockId: string | null = null;

  try {
    // Retry findById 3 times with 100ms delay between attempts
    let retries = 3;
    while (retries > 0) {
      try {
        submission = await DemonstrationSubmission.findById(submissionId);
        if (submission) break;
        retries--;
        if (retries === 0) {
          throw new Error(`Submission ${submissionId} not found`);
        }
        // Wait 100ms before retrying
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        // Wait 100ms before retrying
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // After retries, ensure submission is not null
    if (!submission) {
      throw new Error(`Submission ${submissionId} not found after retries`);
    }

    // --- Acquire Lock ---
    const userAddress = submission.address;
    const factoryId = submission?.meta?.quest.factory_id || submission?.meta?.quest.pool_id;
    if (userAddress && factoryId) {
      lockId = `${userAddress}-${factoryId}`;
      await acquireLock(lockId);
    }
    // --- End Acquire Lock ---

    // Update status to processing
    submission.status =
      ForgeSubmissionProcessingStatus.PROCESSING as ForgeSubmissionProcessingStatus;
    await submission.save();


    // Run Clones Quality Agent
    const extractDir = path.join('uploads', `extract_${submissionId}`);
    console.log('Running Clones Quality Agent for directory:', extractDir);
    try {
      // Check if directory exists
      await fs.access(extractDir);
      console.log('Extract directory exists');

      // List directory contents
      const files = await fs.readdir(extractDir);
      console.log('Directory contents:', files);

      await new Promise<void>((resolve, reject) => {
        const pipeline = spawn(process.env.CQA_PATH, [
          '-f',
          'desktop',
          '-i',
          extractDir,
          '--grade'
        ]);

        let stdout = '';
        let stderr = '';

        pipeline.stdout.on('data', (data) => {
          stdout += data;
          console.log('Clones Quality Agent stdout:', data.toString());
        });

        pipeline.stderr.on('data', (data) => {
          stderr += data;
          console.error('Clones Quality Agent stderr:', data.toString());
        });

        pipeline.on('close', (code: number) => {
          if (code === 0) {
            resolve();
          } else {
            console.error('Clones Quality Agent stdout:', stdout);
            console.error('Clones Quality Agent stderr:', stderr);
            reject(new Error(`Clones Quality Agent failed:\nstdout: ${stdout}\nstderr: ${stderr}`));
          }
        });

        pipeline.on('error', (err) => {
          console.error('Clones Quality Agent spawn error:', err);
          reject(err);
        });
      });

      // Check if scores.json exists
      const scoresPath = path.join(extractDir, 'scores.json');
      try {
        await fs.access(scoresPath);
        console.log('scores.json exists');
      } catch (error) {
        console.error('scores.json not found:', error);
        throw new Error('scores.json not found after Clones Quality Agent run');
      }

      // Read and parse scores.json
      console.log('Reading scores.json');
      const scoresContent = await fs.readFile(scoresPath, 'utf8');
      console.log('scores.json content:', scoresContent);
      const gradeResult: ForgeSubmissionGradeResult = JSON.parse(scoresContent);
      console.log('Parsed grade result:', gradeResult);

      // Read and parse metrics.json
      const metricsPath = path.join(extractDir, 'metrics.json');
      let metricsResult = null;
      try {
        await fs.access(metricsPath);
        console.log('metrics.json exists');
        const metricsContent = await fs.readFile(metricsPath, 'utf8');
        metricsResult = JSON.parse(metricsContent);
        console.log('Parsed metrics result:', metricsResult);
      } catch (error) {
        console.log('metrics.json not found or could not be parsed, continuing without metrics.');
      }

      // Get factory details and calculate reward
      let reward = undefined;
      let maxReward = undefined;
      const clampedScore = Math.max(0, Math.min(100, gradeResult.score));
      let onChainReward: OnChainReward | undefined = undefined;
      let claimAuthorization: any = undefined;
      let retries = 3;

      // Get factory details if factoryId exists
      const factoryId = submission?.meta?.quest.factory_id || submission?.meta?.quest.pool_id;
      console.log('Checking for factoryId:', factoryId);
      let factory = null;
      if (factoryId) {
        console.log('Looking up factory:', factoryId);
        factory = await FactoryModel.findById(factoryId);
        console.log('Found factory:', factory ? factory.name : 'null');
      }

      if (factoryId && !factory) {
        throw new Error(`Factory not found: ${factoryId}`);
      }

      if (factory) {
        console.log('Processing factory reward:', factory.name);
        while (retries > 0) {
          try {
            // Default maxReward is the factory's pricePerDemo
            maxReward = factory.pricePerDemo;

            // Reward skip conditions:
            // 1. Missing task_id
            // 2. Invalid task_id (no corresponding task found)
            // 3. Previous submission exists with same title/task_id and higher/equal score
            // 4. Per-task upload limit reached
            // 5. Per-gym upload limit reached
            // 6. Score below 50%

            // Check 1: Missing task_id
            if (!submission?.meta?.quest.task_id) {
              reward = 0;
              gradeResult.reasoning = `( system: no reward given - missing task_id ) ${gradeResult.reasoning}`;
              break;
            }

            // Check 2: Invalid task_id
            // Find the task within the factory's apps
            let task = null;
            for (const app of factory.apps) {
              task = app.tasks.find((t: any) => t.id === submission?.meta?.quest.task_id);
              if (task) break;
            }

            if (!task) {
              reward = 0;
              gradeResult.reasoning = `( system: no reward given - invalid task_id, no corresponding task found ) ${gradeResult.reasoning}`;
              break;
            }

            // Use the task's rewardLimit if it exists
            if (task.rewardLimit) {
              maxReward = task.rewardLimit;
            }

            // Check 3: Previous submission with higher/equal score
            const previousSubmission = await DemonstrationSubmission.findOne({
              address: submission.address,
              'meta.quest.factory_id': factory._id.toString(),
              $or: [
                { 'meta.quest.title': submission?.meta?.quest.title },
                { 'meta.quest.task_id': submission?.meta?.quest.task_id }
              ],
              'grade_result.score': { $gte: gradeResult.score },
              _id: { $ne: submission._id }
            }).sort({ 'grade_result.score': -1 });

            if (previousSubmission) {
              reward = 0;
              gradeResult.reasoning = `( system: no reward given - previous submission exists with score of ${previousSubmission.grade_result?.score || 0
                } ) ${gradeResult.reasoning}`;
              break;
            }

            // Check 4: Per-task upload limit
            if (task.uploadLimit) {
              const taskSubmissionsCount = await DemonstrationSubmission.countDocuments({
                address: submission.address,
                'meta.quest.task_id': submission?.meta?.quest.task_id,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                _id: { $ne: submission._id }
              });

              if (taskSubmissionsCount >= task.uploadLimit) {
                reward = 0;
                gradeResult.reasoning = `( system: no reward given - per-task upload limit of ${task.uploadLimit} reached ) ${gradeResult.reasoning}`;
                break;
              }
            }

            // Check 5: Per-gym upload limit
            if (factory.uploadLimit) {
              let gymSubmissionsCount;
              const limitType = factory.uploadLimit.type;
              const limitValue = factory.uploadLimit.value;

              if (limitType === UploadLimitType.perDay) {
                // Get start of today
                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);

                // Count submissions for today
                gymSubmissionsCount = await DemonstrationSubmission.countDocuments({
                  address: submission.address,
                  'meta.quest.factory_id': factory._id.toString(),
                  status: ForgeSubmissionProcessingStatus.COMPLETED,
                  createdAt: { $gte: startOfDay },
                  _id: { $ne: submission._id }
                });
              } else if (limitType === UploadLimitType.total) {
                // Count all submissions
                gymSubmissionsCount = await DemonstrationSubmission.countDocuments({
                  address: submission.address,
                  'meta.quest.factory_id': factory._id.toString(),
                  status: ForgeSubmissionProcessingStatus.COMPLETED,
                  _id: { $ne: submission._id }
                });
              }

              if (typeof gymSubmissionsCount === 'number' && gymSubmissionsCount >= limitValue) {
                reward = 0;
                gradeResult.reasoning = `( system: no reward given - per-gym upload limit of ${limitValue} ${limitType} reached ) ${gradeResult.reasoning}`;
                break;
              }
            }

            // Check 6: Score threshold
            if (clampedScore < 50) {
              reward = 0;
              gradeResult.reasoning = `( system: reward returned to factory due to <50% quality score ) ${gradeResult.reasoning}`;
              break;
            }

            // All checks passed, calculate reward
            console.log('Calculating reward:', maxReward, clampedScore);
            reward = Math.max(0, Math.min(maxReward, (maxReward * clampedScore) / 100));
            console.log('Calculated reward:', reward);

            // Generate claim authorization signature if reward > 0 and claimAuthService is available
            const tokenAddress = getTokenContractAddress(factory.token.symbol);

            if (reward && reward > 0 && claimAuthService && factory.poolAddress) {
              console.log(
                `Generating claim authorization for submission ${submissionId} to user ${submission.address}`
              );

              try {
                // Calculate user's total cumulative earned rewards for this pool
                const userCumulativeEarned = await calculateUserCumulativeRewards(
                  submission.address,
                  factory._id.toString()
                );

                console.log(`User ${submission.address} cumulative earned: ${userCumulativeEarned} (including current: ${reward})`);

                // Generate claim authorization signature with proper cumulative amount
                claimAuthorization = await claimAuthService.generateClaimAuthorization(
                  factory.poolAddress,
                  submission.address,
                  userCumulativeEarned + reward // Total earned including current reward
                );

                console.log(`Claim authorization generated for submission ${submissionId}, cumulative amount: ${userCumulativeEarned + reward}, claimable: ${claimAuthorization.newClaimableAmount}, publisher: ${claimAuthorization.publisherUsed}`);

                onChainReward = {
                  tokenAddress: tokenAddress,
                  poolAddress: factory.poolAddress,
                  amount: reward, // Individual reward for this submission
                  submissionId: submissionId, // Use correct field name
                  txHash: '', // No immediate tx, farmer will claim later
                  timestamp: Date.now(),
                  cumulativeAmount: userCumulativeEarned + reward // Total cumulative earned
                };

                gradeResult.reasoning = `( system: claim authorization generated - farmer can claim ${claimAuthorization.newClaimableAmount.toFixed(2)} ${factory.token.symbol} [total earned: ${(userCumulativeEarned + reward).toFixed(2)}, already claimed: ${claimAuthorization.alreadyClaimed.toFixed(2)}] ) ${gradeResult.reasoning}`;
              } catch (error) {
                console.error('Claim authorization generation failed:', error);
                reward = 0;
                gradeResult.reasoning = `( system: no reward given - claim authorization failed ) ${gradeResult.reasoning}`;
              }
            } else if (reward > 0 && (!claimAuthService || !factory.poolAddress)) {
              console.log('ClaimAuthService or poolAddress not available - reward set to 0');
              reward = 0;
              gradeResult.reasoning = `( system: no reward given - claim authorization service unavailable ) ${gradeResult.reasoning}`;
            }

            break; // Exit retry loop if successful
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error('Failed to calculate reward:', error);
            } else {
              // Wait 1 second before retrying
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        }
      }

      submission.grade_result = gradeResult;
      if (metricsResult) {
        submission.grading_metrics = metricsResult;
      }
      submission.reward = reward;
      submission.maxReward = maxReward;
      submission.clampedScore = clampedScore;
      submission.onChainReward = onChainReward;
      submission.status = ForgeSubmissionProcessingStatus.COMPLETED;
      await submission.save();

    } catch (error) {
      throw new Error(`Failed to process submission: ${(error as Error).message}`);
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    // Update submission with error
    await DemonstrationSubmission.findByIdAndUpdate(submissionId, {
      status: ForgeSubmissionProcessingStatus.FAILED,
      error: errorMessage
    });

  } finally {
    // --- Release Lock ---
    if (lockId) {
      await releaseLock(lockId);
    }
    // --- End Release Lock ---

    // Remove from queue and reset processing flag
    processingQueue.shift();
    isProcessing = false;

    // Process next item if available
    if (processingQueue.length > 0) {
      processNextInQueue().catch(console.error);
    }
  }
}

