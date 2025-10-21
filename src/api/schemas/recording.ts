import { z } from 'zod'

/**
 * Schema for recording processing requests
 */
export const RecordingProcessRequestSchema = z.object({
  recordingId: z.string()
    .min(1, 'Recording ID is required')
    .max(256, 'Recording ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Recording ID contains invalid characters')
})

/**
 * Schema for recording processing response
 */
export const RecordingProcessResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    recordingId: z.string(),
    scores: z.object({
      score: z.number().min(0).max(100),
      confidence: z.number().min(0).max(100),
      confidenceReasoning: z.string(),
      outcomeAchievement: z.number().min(0).max(100),
      outcomeAchievementReasoning: z.string(),
      processQuality: z.number().min(0).max(100),
      processQualityReasoning: z.string(),
      efficiency: z.number().min(0).max(100),
      efficiencyReasoning: z.string(),
      summary: z.string(),
      observations: z.string(),
      reasoning: z.string(),
      version: z.string().optional()
    }),
    metrics: z.object({
      sessionId: z.string(),
      status: z.enum(['success', 'partial_failure', 'failed']),
      totalRequests: z.number(),
      successfulRequests: z.number().optional(),
      failedRequests: z.number().optional(),
      totalTokens: z.number(),
      totalDuration: z.number(),
      averageRetries: z.number()
    }).optional(),
    processedAt: z.string()
  })
})

/**
 * Schema for CQA health check response
 */
export const CQAHealthResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    status: z.literal('healthy'),
    timestamp: z.string()
  }).optional(),
  error: z.string().optional()
})

export type RecordingProcessRequest = z.infer<typeof RecordingProcessRequestSchema>
export type RecordingProcessResponse = z.infer<typeof RecordingProcessResponseSchema>
export type CQAHealthResponse = z.infer<typeof CQAHealthResponseSchema>