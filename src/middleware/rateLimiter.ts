import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints
 * Prevents brute force attacks on wallet authentication
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes per IP
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for successful responses
  skipSuccessfulRequests: true
});

/**
 * Rate limiter for general API endpoints
 */
export const generalRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limiter for sensitive operations
 */
export const strictRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per hour per IP
  message: {
    success: false,
    error: 'Too many attempts for this operation. Please try again in an hour.',
    code: 'STRICT_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Relaxed rate limiter for forge/factory read operations
 * Higher limits to support loading multiple factories and their metadata
 */
export const forgeReadRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute per IP
  message: {
    success: false,
    error: 'Too many forge requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limiter for expensive grading operations
 * CQA grading involves LLM API calls and significant compute resources
 */
export const gradingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 grading requests per hour per IP
  message: {
    success: false,
    error: 'Too many grading requests. Grading operations are resource-intensive. Please try again later.',
    code: 'GRADING_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Very strict rate limiter for batch grading operations
 * Batch grading can process multiple submissions and is extremely expensive
 */
export const batchGradingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 batch operations per hour per IP
  message: {
    success: false,
    error: 'Too many batch grading requests. This operation is extremely resource-intensive. Please try again later.',
    code: 'BATCH_GRADING_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});