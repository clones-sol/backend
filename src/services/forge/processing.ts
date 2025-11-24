import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

// Utility function to get the correct uploads path based on environment
const getUploadsPath = (...pathSegments: string[]) => {
  // Use /app/uploads only on Fly.io (detected by FLY_APP_NAME env var)
  const basePath = process.env.FLY_APP_NAME ? '/app/uploads' : 'uploads'
  return path.join(basePath, ...pathSegments)
}
import { ethers } from 'ethers'
import type mongoose from 'mongoose'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { acquireLock, releaseLock } from '../../models/ProcessingLock.ts'
import { type DBDemonstrationSubmission } from '../../types/db.ts'
import {
  type ForgeSubmissionGradeResult,
  ForgeSubmissionProcessingStatus,
  type OnChainReward,
  UploadLimitType
} from '../../types/factory.ts'
import { tokenCache } from '../../utils/tokenCache.js'
import { createClaimAuthService } from '../blockchain/claimAuthService.ts'
import { calculateFeeAmounts, getContractFeeConfig } from '../blockchain/contractConfigService.ts'
import { getTokenContractAddress } from '../blockchain/tokens.ts'
import { createReferralLookupService } from '../referral/referralLookupService.ts'
import { logger } from "../logger.ts"
import { DemoStorageService } from '../demo-storage/index.ts'
import { ObjectStorageService } from '../storage/index.ts'

// Initialize demo storage service
let demoStorageService: DemoStorageService | null = null
function getDemoStorageService(): DemoStorageService {
  if (!demoStorageService) {
    const {
      STORAGE_ACCESS_KEY,
      STORAGE_SECRET_KEY,
      STORAGE_ENDPOINT,
      STORAGE_REGION,
      STORAGE_BUCKET
    } = process.env

    if (!STORAGE_ACCESS_KEY || !STORAGE_SECRET_KEY || !STORAGE_ENDPOINT || !STORAGE_REGION || !STORAGE_BUCKET) {
      throw new Error('Storage service environment variables are not properly configured')
    }

    const objectStorage = new ObjectStorageService(
      STORAGE_ACCESS_KEY,
      STORAGE_SECRET_KEY,
      STORAGE_ENDPOINT,
      STORAGE_REGION,
      STORAGE_BUCKET
    )
    demoStorageService = new DemoStorageService(objectStorage)
  }
  return demoStorageService
}

// Initialize claim authorization service
let claimAuthService: ReturnType<typeof createClaimAuthService> | null = null
try {
  if (process.env.PUBLISHER_PRIVATE_KEY) {
    claimAuthService = createClaimAuthService()
  }
} catch (error) {
  logger.warn('ClaimAuthService not initialized:', (error as Error).message)
}

// Global processing queue
let isProcessing = false
const processingQueue: string[] = []

export async function addToProcessingQueue(submissionId: string) {
  processingQueue.push(submissionId)
  processNextInQueue().catch(console.error)
}

export async function processNextInQueue() {
  if (isProcessing || processingQueue.length === 0) return

  isProcessing = true
  const submissionId = processingQueue[0]
  let submission:
    | (mongoose.Document<unknown, {}, DBDemonstrationSubmission> & DBDemonstrationSubmission)
    | null = null
  let lockId: string | null = null

  try {
    // Retry findById 3 times with 100ms delay between attempts
    let retries = 3
    while (retries > 0) {
      try {
        submission = await DemonstrationSubmission.findById(submissionId)
        if (submission) break
        retries--
        if (retries === 0) {
          throw new Error(`Submission ${submissionId} not found`)
        }
        // Wait 100ms before retrying
        await new Promise((resolve) => setTimeout(resolve, 100))
      } catch (error) {
        retries--
        if (retries === 0) throw error
        // Wait 100ms before retrying
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // After retries, ensure submission is not null
    if (!submission) {
      throw new Error(`Submission ${submissionId} not found after retries`)
    }

    // --- Acquire Lock ---
    const userAddress = submission.address
    const factoryId = submission?.meta?.quest.factory_id || submission?.meta?.quest.pool_id
    if (userAddress && factoryId) {
      lockId = `${userAddress}-${factoryId}`
      await acquireLock(lockId)
    }
    // --- End Acquire Lock ---

    // Update status to processing
    submission.status =
      ForgeSubmissionProcessingStatus.PROCESSING as ForgeSubmissionProcessingStatus
    await submission.save()

    // Run Clones Quality Agent
    const extractDir = getUploadsPath(`extract_${submissionId}`)
    logger.info('Running Clones Quality Agent for directory:', extractDir)
    try {
      // Ensure directory exists
      await fs.mkdir(extractDir, { recursive: true })
      logger.info('Extract directory ready:', extractDir)

      // Download files from object storage if demoHash exists
      if (submission.demoHash) {
        logger.info(`Downloading demo files from object storage (demoHash: ${submission.demoHash})`)
        const storage = getDemoStorageService()

        // Download all required files from object storage
        const filesToDownload = ['recording.mp4', 'meta.json', 'sft.json', 'input_log.jsonl', 'input_log_meta.json']

        for (const filename of filesToDownload) {
          try {
            const fileBuffer = await storage.getDemoFile(submission.demoHash, filename)
            const filePath = path.join(extractDir, filename)
            await fs.writeFile(filePath, fileBuffer)
            logger.info(`Downloaded ${filename} (${fileBuffer.length} bytes) to ${filePath}`)
          } catch (downloadError) {
            logger.error(`Failed to download ${filename}:`, downloadError)
            throw new Error(`Failed to download ${filename} from object storage: ${(downloadError as Error).message}`)
          }
        }

        logger.info('All demo files downloaded from object storage')
      } else {
        logger.warn('No demoHash found, expecting files to exist locally')
        // Check if directory exists for backward compatibility
        await fs.access(extractDir)
      }

      // List directory contents
      const files = await fs.readdir(extractDir)
      logger.info('Directory contents:', files)

      await new Promise<void>((resolve, reject) => {
        const absoluteExtractDir = path.resolve(extractDir)
        const args = ['-f', 'desktop', '-i', absoluteExtractDir, '--grade']

        // Enable video mode by default (unless explicitly disabled) or if API key is present
        const useVideoGrading = process.env.USE_VIDEO_GRADING !== 'false';

        if (useVideoGrading) {
          args.push('--video-mode')
          logger.info('Video grading mode enabled (default)')
        }

        if (process.env.CQA_MODEL) {
          args.push('--model', process.env.CQA_MODEL)
        }

        const pipeline = spawn(process.env.CQA_PATH, args, {
          cwd: '/app/cqa', // Run CQA from the directory with node_modules
          env: { ...process.env } // Explicitly pass all environment variables including API keys
        })

        let stdout = ''
        let stderr = ''
        let stdoutLineBuffer = ''
        let stderrLineBuffer = ''

        pipeline.stdout.on('data', (data) => {
          stdout += data
          stdoutLineBuffer += data.toString()

          // Log complete lines as they come
          const lines = stdoutLineBuffer.split('\n')
          stdoutLineBuffer = lines.pop() || '' // Keep incomplete line in buffer

          lines.forEach(line => {
            if (line.trim()) {
              logger.info({ cqaOutput: 'stdout', line }, 'CQA stdout')
            }
          })
        })

        pipeline.stderr.on('data', (data) => {
          stderr += data
          stderrLineBuffer += data.toString()

          // Log complete lines as they come
          const lines = stderrLineBuffer.split('\n')
          stderrLineBuffer = lines.pop() || '' // Keep incomplete line in buffer

          lines.forEach(line => {
            if (line.trim()) {
              logger.warn({ cqaOutput: 'stderr', line }, 'CQA stderr')
            }
          })
        })

        pipeline.on('close', (code: number) => {
          // Log any remaining buffer content
          if (stdoutLineBuffer.trim()) {
            logger.info({ cqaOutput: 'stdout', line: stdoutLineBuffer.trim() }, 'CQA stdout (final)')
          }
          if (stderrLineBuffer.trim()) {
            logger.warn({ cqaOutput: 'stderr', line: stderrLineBuffer.trim() }, 'CQA stderr (final)')
          }

          if (code === 0) {
            logger.info({ exitCode: code, stdoutLength: stdout.length, stderrLength: stderr.length }, 'CQA process completed successfully')
            resolve()
          } else {
            logger.error({
              exitCode: code,
              fullStdout: stdout,
              fullStderr: stderr
            }, 'CQA process failed')
            reject(new Error(`Clones Quality Agent failed:\nstdout: ${stdout}\nstderr: ${stderr}`))
          }
        })

        pipeline.on('error', (err) => {
          logger.error('Clones Quality Agent spawn error:', err)
          reject(err)
        })
      })

      // Check if scores.json exists
      const scoresPath = path.join(extractDir, 'scores.json')
      try {
        await fs.access(scoresPath)
        logger.info('scores.json exists')
      } catch (error) {
        logger.error('scores.json not found:', error)
        throw new Error('scores.json not found after Clones Quality Agent run')
      }

      // Read and parse scores.json
      logger.info('Reading scores.json')
      const scoresContent = await fs.readFile(scoresPath, 'utf8')
      logger.info('scores.json content:', scoresContent)
      const gradeResult: ForgeSubmissionGradeResult = JSON.parse(scoresContent)
      logger.info('Parsed grade result:', gradeResult)

      // ENRICHMENT: If video analysis is present, inject into sft.json
      if (gradeResult.programmaticResults?.videoAnalysis && Array.isArray(gradeResult.programmaticResults.videoAnalysis)) {
        try {
          const sftPath = path.join(extractDir, 'sft.json')
          logger.info('Enriching sft.json with video analysis at:', sftPath)

          // Check if sft.json exists
          await fs.access(sftPath)

          const sftContent = await fs.readFile(sftPath, 'utf8')
          const events = JSON.parse(sftContent)

          if (Array.isArray(events)) {
            const analysis = gradeResult.programmaticResults.videoAnalysis
            const annotations = analysis.map((step: any) => ({
              type: 'context_annotation',
              timestamp: Math.round(step.timestamp_seconds * 1000),
              data: {
                description: step.description,
                status: step.status,
                source: 'gemini-video-grading'
              }
            }))

            events.push(...annotations)
            // Sort events by timestamp
            events.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))

            await fs.writeFile(sftPath, JSON.stringify(events, null, 2))
            logger.info(`Successfully added ${annotations.length} annotations to sft.json`)
          }
        } catch (enrichError) {
          logger.warn('Failed to enrich sft.json:', enrichError)
          // Don't fail the whole process for this
        }
      }

      // Read and parse metrics.json
      const metricsPath = path.join(extractDir, 'metrics.json')
      let metricsResult = null
      try {
        await fs.access(metricsPath)
        logger.info('metrics.json exists')
        const metricsContent = await fs.readFile(metricsPath, 'utf8')
        metricsResult = JSON.parse(metricsContent)
        logger.info('Parsed metrics result:', metricsResult)
      } catch (_error) {
        logger.info('metrics.json not found or could not be parsed, continuing without metrics.')
      }

      // Get factory details and calculate reward
      let reward
      let maxReward: number = 0
      const clampedScore = Math.max(0, Math.min(100, gradeResult.score))
      let onChainReward: OnChainReward | undefined
      let retries = 3

      // Get factory details if factoryId exists
      const factoryId = submission?.meta?.quest.factory_id || submission?.meta?.quest.pool_id
      logger.info('Checking for factoryId:', factoryId)
      let factory = null
      if (factoryId) {
        logger.info('Looking up factory:', factoryId)
        factory = await FactoryModel.findById(factoryId)
        logger.info('Found factory:', factory ? factory.name : 'null')
      }

      if (factoryId && !factory) {
        throw new Error(`Factory not found: ${factoryId}`)
      }

      if (factory) {
        logger.info('Processing factory reward:', factory.name)
        while (retries > 0) {
          try {

            // Check 1: Missing task_id
            if (!submission?.meta?.quest.task_id) {
              reward = 0
              gradeResult.reasoning = `( system: no reward given - missing task_id ) ${gradeResult.reasoning}`
              logger.info('No reward given - missing task_id')
              break
            }

            // Check 2: Invalid task_id
            const task = factory.tasks.find((t) => t.id === submission?.meta?.quest.task_id)

            if (!task) {
              reward = 0
              gradeResult.reasoning = `( system: no reward given - invalid task_id, no corresponding task found ) ${gradeResult.reasoning}`
              logger.info('No reward given - invalid task_id, no corresponding task found')
              break
            }

            if (task.rewardLimit) {
              maxReward = typeof task.rewardLimit === 'number' ? task.rewardLimit : parseFloat(task.rewardLimit.toString())
            }
            else {
              reward = 0
              gradeResult.reasoning = `( system: no reward given - task has no reward limit ) ${gradeResult.reasoning}`
              logger.info('No reward given - task has no reward limit')
              break
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
            }).sort({ 'grade_result.score': -1 })

            if (previousSubmission) {
              reward = 0
              gradeResult.reasoning = `( system: no reward given - previous submission exists with score of ${previousSubmission.grade_result?.score || 0
                } ) ${gradeResult.reasoning}`
              logger.info('No reward given - previous submission exists with score of', previousSubmission.grade_result?.score || 0)
              break
            }

            // Check 4: Per-task upload limit
            if (task.uploadLimit) {
              const taskSubmissionsCount = await DemonstrationSubmission.countDocuments({
                address: submission.address,
                'meta.quest.task_id': submission?.meta?.quest.task_id,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                _id: { $ne: submission._id }
              })

              if (taskSubmissionsCount >= task.uploadLimit) {
                reward = 0
                gradeResult.reasoning = `( system: no reward given - per-task upload limit of ${task.uploadLimit} reached ) ${gradeResult.reasoning}`
                logger.info('No reward given - per-task upload limit of', task.uploadLimit, 'reached')
                break
              }
            }

            // Check 5: Score threshold
            if (clampedScore < 50) {
              reward = 0
              gradeResult.reasoning = `( system: reward returned to factory due to <50% quality score ) ${gradeResult.reasoning}`
              logger.info('No reward given - reward returned to factory due to <50% quality score')
              break
            }

            // All checks passed, calculate reward
            logger.info('Calculating reward:', maxReward, clampedScore)
            reward = Math.max(0, Math.min(maxReward, (maxReward * clampedScore) / 100))
            logger.info('Calculated reward:', reward)

            break // Exit retry loop if successful
          } catch (error) {
            retries--
            if (retries === 0) {
              logger.error('Failed to calculate reward:', error)
            } else {
              // Wait 1 second before retrying
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }
      }

      submission.grade_result = gradeResult
      if (metricsResult) {
        submission.grading_metrics = metricsResult
      }
      submission.reward = reward
      submission.maxReward = maxReward
      submission.clampedScore = clampedScore
      submission.onChainReward = onChainReward
      submission.cqaModel = process.env.CQA_MODEL
      submission.status = ForgeSubmissionProcessingStatus.COMPLETED

      // Capture referral snapshot before generating claim authorization
      let farmerReferrer: string | undefined
      let factoryReferrer: string | undefined

      if (factory && reward !== undefined && reward > 0) {
        const referralLookupService = createReferralLookupService()
        const referralInfo = await referralLookupService.getReferralInfo(
          submission.address,
          factoryId
        )

        farmerReferrer = referralInfo.farmerReferrer
        factoryReferrer = referralInfo.factoryReferrer

        // Store referral snapshot in submission
        submission.farmerReferrerAddress = farmerReferrer
        submission.factoryReferrerAddress = factoryReferrer
      }

      await submission.save()

      // Generate claim authorization signature AFTER submission is saved as COMPLETED
      if (
        factory &&
        reward !== undefined &&
        reward > 0 &&
        factory.token &&
        claimAuthService &&
        factory.poolAddress
      ) {
        logger.info(
          `Generating claim authorization for submission ${submissionId} to user ${submission.address}`
        )

        try {
          const tokenAddress = getTokenContractAddress(factory.token!.symbol)

          // Generate claim authorization signature with referral data
          const claimAuthorization = await claimAuthService.generateClaimAuthorization(
            factory.poolAddress,
            submission.address,
            reward, // Just pass the current reward, service will calculate cumulative
            farmerReferrer,
            factoryReferrer
          )

          logger.info(
            `Claim authorization generated for submission ${submissionId}, claimable: ${claimAuthorization.newClaimableAmount}, publisher: ${claimAuthorization.publisherUsed}`
          )

          const feeConfig = await getContractFeeConfig(factory.poolAddress)
          const { grossAmount, feeAmount, netAmount } = calculateFeeAmounts(
            reward,
            feeConfig.feeBps,
            feeConfig.feeDenominator
          )

          // Get token metadata for decimal precision
          const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
          const metadata = await tokenCache.getTokenMetadata(tokenAddress, provider)

          // Use the precise cumulativeAmount calculated in wei (BigInt) by claimAuthService
          // This avoids floating-point precision errors from adding numbers
          const cumulativeAmountTokens = parseFloat(
            ethers.formatUnits(claimAuthorization.cumulativeAmount, metadata.decimals)
          )

          onChainReward = {
            tokenAddress: tokenAddress,
            poolAddress: factory.poolAddress,
            amount: reward,
            grossAmount: grossAmount,
            feeAmount: feeAmount,
            netAmount: netAmount,
            submissionId: submissionId,
            txHash: undefined,
            timestamp: Date.now(),
            cumulativeAmount: cumulativeAmountTokens
          }

          // Update the grade result reasoning and on-chain reward with referral info
          const feePercentage = (feeConfig.feeBps / feeConfig.feeDenominator * 100).toFixed(1)
          let reasoningMessage =
            `( system: claim authorization generated - farmer can claim ` +
            `${claimAuthorization.newClaimableAmount.toFixed(2)} ${factory.token.symbol} ` +
            `[already claimed: ${claimAuthorization.alreadyClaimed.toFixed(2)}, new reward: ${reward.toFixed(2)} ` +
            `(${netAmount.toFixed(2)} after ${feePercentage}% platform fee)`

          // Add referral info to reasoning if referrals exist
          if (claimAuthorization.referrals && claimAuthorization.referrals.length > 0) {
            const referralInfo = claimAuthorization.referrals
              .map(r => `${r.type}: ${r.amount.toFixed(4)} ${factory.token!.symbol}`)
              .join(', ')
            reasoningMessage += `, referral rewards: ${referralInfo}`
          }

          reasoningMessage += `] ) ${submission.grade_result.reasoning}`
          submission.grade_result.reasoning = reasoningMessage
          submission.onChainReward = onChainReward

          const authWithFee = claimAuthorization as typeof claimAuthorization & { feePercentage: number }
          authWithFee.feePercentage = parseFloat(feePercentage)
          submission.claimAuthorization = authWithFee

          // Save updated claim authorization data
          await submission.save()
        } catch (error) {
          logger.error('Claim authorization generation failed:', error)

          // IMPORTANT: Keep the calculated reward - don't reset to 0 for temporary failures
          // The user earned the reward, the authorization just needs to be retried
          submission.grade_result.reasoning =
            `( system: claim authorization failed - will retry on next claim attempt ) ${submission.grade_result.reasoning}`
          submission.error = `Claim authorization failed: ${error instanceof Error ? error.message : String(error)}`

          // Keep reward and maxReward as calculated - just mark that authorization is missing
          await submission.save()

          logger.info(
            `Submission ${submissionId} completed with reward ${reward} but claim authorization failed (can be regenerated on claim)`
          )
        }
      } else if (
        factory &&
        reward !== undefined &&
        reward > 0 &&
        (!claimAuthService || !factory.poolAddress)
      ) {
        logger.info('ClaimAuthService or poolAddress not available - updating reward to 0')
        submission.reward = 0
        submission.grade_result.reasoning = `( system: no reward given - claim authorization service unavailable ) ${submission.grade_result.reasoning}`
        await submission.save()
      }
    } catch (error) {
      throw new Error(`Failed to process submission: ${(error as Error).message}`)
    }
  } catch (error) {
    const errorMessage = (error as Error).message
    // Update submission with error
    await DemonstrationSubmission.findByIdAndUpdate(submissionId, {
      status: ForgeSubmissionProcessingStatus.FAILED,
      error: errorMessage
    })
  } finally {
    // --- Release Lock ---
    if (lockId) {
      await releaseLock(lockId)
    }
    // --- End Release Lock ---

    // Remove from queue and reset processing flag
    processingQueue.shift()
    isProcessing = false

    // Process next item if available
    if (processingQueue.length > 0) {
      processNextInQueue().catch(console.error)
    }
  }
}
