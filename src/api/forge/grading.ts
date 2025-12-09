/**
 * Grading endpoints for demonstration submissions
 * These endpoints are used by migration scripts and admin tools
 */

import { Router } from 'express'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import { runCQAGrading, prepareDemoForGrading } from '../../services/grading/cqaGradingService.ts'
import { DemoStorageService } from '../../services/demo-storage/index.ts'
import { ObjectStorageService } from '../../services/storage/index.ts'
import { logger } from '../../services/logger.ts'

const router = Router()

// Initialize storage service
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

/**
 * POST /api/v1/forge/grading/grade-submission/:submissionId
 *
 * Grade a demonstration submission
 *
 * Query parameters:
 * - useVideoGrading: boolean (default: true)
 * - model: string (default: from env CQA_MODEL)
 *
 * Returns:
 * - gradeResult: ForgeSubmissionGradeResult
 * - gradingMetrics: any
 * - clampedScore: number
 */
router.post('/grade-submission/:submissionId', async (req, res) => {
  const { submissionId } = req.params
  const useVideoGrading = req.query.useVideoGrading !== 'false'
  const model = (req.query.model as string) || process.env.CQA_MODEL

  logger.info('Admin grading request', { submissionId, useVideoGrading, model })

  try {
    // Find submission
    const submission = await DemonstrationSubmission.findById(submissionId)
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' })
    }

    // Check if demoHash exists
    if (!submission.demoHash) {
      return res.status(400).json({ error: 'Submission has no demoHash' })
    }

    // Check if already graded
    if (submission.grade_result && submission.grade_result.score !== null && submission.grade_result.score !== undefined) {
      logger.info('Submission already graded', { submissionId, score: submission.grade_result.score })
      return res.json({
        message: 'Submission already graded',
        gradeResult: submission.grade_result,
        gradingMetrics: submission.grading_metrics,
        clampedScore: submission.clampedScore,
        alreadyGraded: true
      })
    }

    // Create temporary directory for grading
    const tempDir = path.join(process.cwd(), 'temp', 'grading', submissionId)

    try {
      await fs.mkdir(tempDir, { recursive: true })
      logger.info('Created temp directory', { tempDir })

      // Download demo files
      logger.info('Downloading demo files', { demoHash: submission.demoHash })
      const storage = getDemoStorageService()
      await prepareDemoForGrading(submission.demoHash, tempDir, storage)

      // Run CQA grading
      logger.info('Running CQA grading', { tempDir })
      const { gradeResult, gradingMetrics } = await runCQAGrading(tempDir, {
        useVideoGrading,
        model,
        cleanupOnSuccess: false,
        cleanupOnError: false
      })

      // Calculate clamped score
      const clampedScore = Math.max(0, Math.min(100, gradeResult.score))

      // Update database
      const updateData: any = {
        grade_result: gradeResult,
        clampedScore: clampedScore
      }

      if (gradingMetrics) {
        updateData.grading_metrics = gradingMetrics
      }

      if (model) {
        updateData.cqaModel = model
      }

      await DemonstrationSubmission.findByIdAndUpdate(
        submission._id,
        { $set: updateData }
      )

      logger.info('Updated submission with grade result', {
        submissionId,
        score: gradeResult.score,
        clampedScore
      })

      // Clean up temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
        logger.info('Cleaned up temp directory', { tempDir })
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp directory', { error: cleanupError })
      }

      return res.json({
        message: 'Submission graded successfully',
        gradeResult,
        gradingMetrics,
        clampedScore,
        alreadyGraded: false
      })

    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
        logger.info('Cleaned up temp directory after error', { tempDir })
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp directory', { error: cleanupError })
      }

      throw error
    }

  } catch (error) {
    logger.error('Failed to grade submission', { submissionId, error })
    return res.status(500).json({
      error: 'Failed to grade submission',
      message: (error as Error).message
    })
  }
})

/**
 * POST /api/v1/forge/grading/batch-grade
 *
 * Grade multiple submissions in batch
 *
 * Body:
 * - submissionIds: string[]
 * - useVideoGrading: boolean (default: true)
 * - model: string (default: from env CQA_MODEL)
 *
 * Returns:
 * - results: array of grading results
 * - summary: { total, successful, failed, skipped }
 */
router.post('/batch-grade', async (req, res) => {
  const { submissionIds, useVideoGrading = true, model } = req.body

  if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
    return res.status(400).json({ error: 'submissionIds must be a non-empty array' })
  }

  logger.info('Batch grading request', { count: submissionIds.length, useVideoGrading, model })

  const results = []
  let successful = 0
  let failed = 0
  let skipped = 0

  for (const submissionId of submissionIds) {
    try {
      // Make internal request to grade-submission endpoint
      const submission = await DemonstrationSubmission.findById(submissionId)

      if (!submission) {
        results.push({ submissionId, status: 'not_found', error: 'Submission not found' })
        failed++
        continue
      }

      if (!submission.demoHash) {
        results.push({ submissionId, status: 'no_demohash', error: 'No demoHash' })
        skipped++
        continue
      }

      if (submission.grade_result && submission.grade_result.score !== null) {
        results.push({
          submissionId,
          status: 'already_graded',
          score: submission.grade_result.score
        })
        skipped++
        continue
      }

      // Grade submission
      const tempDir = path.join(process.cwd(), 'temp', 'grading', submissionId)

      try {
        await fs.mkdir(tempDir, { recursive: true })
        const storage = getDemoStorageService()
        await prepareDemoForGrading(submission.demoHash, tempDir, storage)

        const { gradeResult, gradingMetrics } = await runCQAGrading(tempDir, {
          useVideoGrading,
          model: model || process.env.CQA_MODEL,
          cleanupOnSuccess: false,
          cleanupOnError: false
        })

        const clampedScore = Math.max(0, Math.min(100, gradeResult.score))

        const updateData: any = {
          grade_result: gradeResult,
          clampedScore: clampedScore
        }

        if (gradingMetrics) {
          updateData.grading_metrics = gradingMetrics
        }

        if (model || process.env.CQA_MODEL) {
          updateData.cqaModel = model || process.env.CQA_MODEL
        }

        await DemonstrationSubmission.findByIdAndUpdate(
          submission._id,
          { $set: updateData }
        )

        // Clean up
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch {}

        results.push({
          submissionId,
          status: 'success',
          score: gradeResult.score,
          clampedScore
        })
        successful++

      } catch (error) {
        // Clean up on error
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch {}

        throw error
      }

    } catch (error) {
      logger.error('Failed to grade submission in batch', { submissionId, error })
      results.push({
        submissionId,
        status: 'failed',
        error: (error as Error).message
      })
      failed++
    }
  }

  logger.info('Batch grading completed', { total: submissionIds.length, successful, failed, skipped })

  return res.json({
    results,
    summary: {
      total: submissionIds.length,
      successful,
      failed,
      skipped
    }
  })
})

export default router
