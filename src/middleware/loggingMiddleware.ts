/**
 * Express logging middleware using Pino HTTP
 * 
 * Features:
 * - Automatic request/response logging
 * - W3C Trace Context propagation
 * - Correlation ID generation and injection
 * - AsyncLocalStorage context propagation
 * - Performance timing
 * - Request ID generation
 */

import type { Request, Response, NextFunction } from 'express'
import { pinoHttp, type HttpLogger, type Options } from 'pino-http'
import { logger, logContext, type LogContext } from "../services/logger.ts"
import {
  extractTraceContext,
  createRootTraceContext,
  createChildSpan,
  generateCorrelationId,
  parseTraceParent
} from '../utils/traceContext.ts'

// Extend Express Request to include logging context
declare global {
  namespace Express {
    interface Request {
      id: string
      correlationId: string
      traceId?: string
      spanId?: string
      log: typeof logger
    }
  }
}

/**
 * Create Pino HTTP middleware with custom configuration
 */
function createPinoHttpMiddleware(): HttpLogger {
  const options: Options = {
    logger: logger.getPinoInstance(),

    // Generate unique request ID
    genReqId: (req, res) => {
      // Use existing correlation ID from headers or generate new one
      const existingCorrelationId = req.headers['x-correlation-id'] as string
      return existingCorrelationId || generateCorrelationId()
    },

    // Custom request message
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 400 && res.statusCode < 500) {
        return 'warn'
      }
      if (res.statusCode >= 500 || err) {
        return 'error'
      }
      if (res.statusCode >= 300 && res.statusCode < 400) {
        return 'info'
      }
      return 'info'
    },

    // Custom success message
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} completed`
    },

    // Custom error message
    customErrorMessage: (req, res, err) => {
      return `${req.method} ${req.url} failed: ${err.message}`
    },

    // Custom request logging
    customReceivedMessage: (req, res) => {
      return `${req.method} ${req.url} started`
    },

    // Auto-logging configuration
    autoLogging: {
      ignore: (req) => {
        // Skip logging for health checks and metrics endpoints
        return req.url === '/health' || req.url === '/metrics'
      }
    }
  }

  return pinoHttp(options)
}

/**
 * Trace context and correlation middleware
 */
export function traceContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    // Extract trace context from incoming headers
    const { traceparent, correlationId } = extractTraceContext(req.headers)

    let finalTraceId: string
    let finalSpanId: string
    let finalCorrelationId: string
    let traceparentHeader: string

    if (traceparent) {
      // Continue existing trace with new child span
      traceparentHeader = createChildSpan(traceparent)
      const parsed = parseTraceParent(traceparentHeader)
      if (!parsed) {
        throw new Error('Failed to parse traceparent header')
      }
      finalTraceId = parsed.traceId
      finalSpanId = parsed.spanId
      finalCorrelationId = correlationId
    } else {
      // Create new root trace
      const rootContext = createRootTraceContext(correlationId)
      traceparentHeader = rootContext.traceparent
      finalTraceId = rootContext.traceId
      finalSpanId = rootContext.spanId
      finalCorrelationId = rootContext.correlationId
    }

    // Set trace headers in response for downstream services
    res.setHeader('traceparent', traceparentHeader)
    res.setHeader('x-correlation-id', finalCorrelationId)

    // Attach trace context to request
    req.correlationId = finalCorrelationId
    req.traceId = finalTraceId
    req.spanId = finalSpanId

    // Create log context for AsyncLocalStorage
    const context: LogContext = {
      correlationId: finalCorrelationId,
      requestId: String(req.id),
      traceId: finalTraceId,
      spanId: finalSpanId
    }

    // Run the rest of the request in trace context
    logContext.run(context, () => {
      // Create scoped logger for this request with HTTP labels for Grafana
      req.log = logger.child({
        requestId: String(req.id),
        correlationId: finalCorrelationId,
        traceId: finalTraceId,
        spanId: finalSpanId,
        // HTTP labels for Grafana filtering
        method: req.method,
        route: req.route?.path || req.path || 'unknown',
        userAgent: req.headers['user-agent']?.slice(0, 100) // Truncate for readability
      }) as any

      next()
    })

  } catch (error) {
    // If trace context setup fails, continue without it
    logger.warn({ error }, 'Failed to setup trace context, continuing without it')
    req.correlationId = generateCorrelationId()
    req.log = logger.child({ requestId: String(req.id), correlationId: req.correlationId }) as any
    next()
  }
}

/**
 * Enhanced error logging middleware
 */
export function errorLoggingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log error with full context
  req.log.error({
    err,
    req: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query
    },
    user: {
      userId: (req as any).userId,
      walletAddress: (req as any).walletAddress,
      sessionId: (req as any).sessionId
    }
  }, `Request failed: ${err.message}`)

  next(err)
}

/**
 * Request timing middleware using safer 'finish' event
 */
export function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now()

  // Use 'finish' event instead of overriding res.end to avoid conflicts
  res.on('finish', () => {
    const duration = Date.now() - startTime

    // Update logger with response status for Grafana
    const responseLogger = req.log.child({
      status: res.statusCode,
      statusClass: Math.floor(res.statusCode / 100) + 'xx' // 2xx, 4xx, 5xx for filtering
    })

    // Log request completion with timing and structured labels
    responseLogger.info({
      req: {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent']
      },
      res: {
        statusCode: res.statusCode,
        contentLength: res.getHeader('content-length')
      },
      duration,
      performance: {
        slow: duration > 1000,
        very_slow: duration > 5000
      }
    }, `Request completed in ${duration}ms`)
  })

  next()
}

/**
 * User context middleware (to be called after authentication)
 */
export function userContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract user information from authenticated request
  const userId = (req as any).userId
  const walletAddress = (req as any).walletAddress
  const sessionId = (req as any).sessionId

  if (userId || walletAddress || sessionId) {
    // Update log context with user information
    const currentContext = logContext.getStore() || {}
    const updatedContext: LogContext = {
      ...currentContext,
      userId,
      walletAddress,
      sessionId
    }

    // Run remaining middleware with updated context
    logContext.run(updatedContext, () => {
      // Update request logger with user context
      req.log = req.log.child({
        userId,
        walletAddress,
        sessionId
      }) as any

      next()
    })
  } else {
    next()
  }
}

/**
 * Create the main logging middleware stack
 */
export function createLoggingMiddleware() {
  const pinoHttpMiddleware = createPinoHttpMiddleware()

  return [
    // 1. Pino HTTP middleware (must be first)
    pinoHttpMiddleware,

    // 2. Trace context and correlation
    traceContextMiddleware,

    // 3. Request timing
    requestTimingMiddleware
  ]
}

// Export individual middlewares for flexibility
export { createPinoHttpMiddleware }
export default createLoggingMiddleware