/**
 * Centralized logging service using Pino
 * 
 * Features:
 * - Structured JSON logging for production
 * - Pretty printing for development  
 * - Configurable log levels via environment
 * - Automatic redaction of sensitive data
 * - W3C Trace Context support preparation
 * - AsyncLocalStorage context propagation
 * - Child logger support for scoped logging
 */

import pino from 'pino'
import { AsyncLocalStorage } from 'node:async_hooks'

// Log levels mapping
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

// Context interface for AsyncLocalStorage
export interface LogContext {
  correlationId?: string
  userId?: string
  requestId?: string
  traceId?: string
  spanId?: string
  sessionId?: string
  factoryId?: string
  walletAddress?: string
}

// AsyncLocalStorage for request context
export const logContext = new AsyncLocalStorage<LogContext>()

/**
 * Get current log context from AsyncLocalStorage
 */
export function getCurrentLogContext(): LogContext {
  return logContext.getStore() || {}
}

/**
 * Run code with specific log context
 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return logContext.run(context, fn)
}

/**
 * Determine log level from environment
 */
function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel
  const validLevels: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']

  if (level && validLevels.includes(level)) {
    return level
  }

  // Default log levels by environment
  switch (process.env.NODE_ENV) {
    case 'production':
      return 'info'
    case 'test':
      return 'warn'
    case 'development':
    default:
      return 'debug'
  }
}

/**
 * Determine if we should use pretty printing
 */
function shouldUsePrettyPrint(): boolean {
  // Never use pretty print in production
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  // Respect explicit setting
  if (process.env.LOG_PRETTY !== undefined) {
    return process.env.LOG_PRETTY === 'true'
  }

  // Default: pretty print in development
  return process.env.NODE_ENV === 'development'
}

/**
 * Create redaction configuration for sensitive data
 */
function createRedactConfig() {
  return {
    paths: [
      // Sensitive authentication data
      'password',
      'privateKey',
      'private_key',
      'secretKey',
      'secret_key',
      'apiKey',
      'api_key',
      'token',
      'accessToken',
      'refreshToken',
      'sessionSecret',
      'csrfToken',

      // Request/response sensitive data
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.privateKey',
      'res.headers["set-cookie"]',

      // Blockchain sensitive data
      'mnemonic',
      'seedPhrase',
      'signature',
      'privateKeys'
    ],
    censor: '[REDACTED]'
  }
}

/**
 * Get structured base labels for Grafana filtering and observability
 * Single source of truth for all base labels
 */
function getBaseLabels() {
  return {
    service: process.env.SERVICE_NAME || 'clones-backend',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    instance: process.env.FLY_ALLOC_ID || process.env.HOSTNAME || 'local'
  }
}

/**
 * Create mixin for global fields added to every log
 */
function createMixin() {
  return function mixin() {
    const context = getCurrentLogContext()
    const baseLabels = getBaseLabels()
    return {
      ...baseLabels,
      ...context
    }
  }
}

/**
 * Create custom serializers for complex objects
 */
function createSerializers() {
  return {
    req: (req: any) => {
      if (!req) return req

      return {
        id: req.id,
        method: req.method,
        url: req.url,
        headers: {
          'user-agent': req.headers?.['user-agent'],
          'content-type': req.headers?.['content-type'],
          'content-length': req.headers?.['content-length'],
          'x-correlation-id': req.headers?.['x-correlation-id'],
          'traceparent': req.headers?.['traceparent'],
          'tracestate': req.headers?.['tracestate']
        },
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort
      }
    },

    res: (res: any) => {
      if (!res) return res

      return {
        statusCode: res.statusCode,
        headers: {
          'content-type': res.getHeader?.('content-type'),
          'content-length': res.getHeader?.('content-length'),
          'x-correlation-id': res.getHeader?.('x-correlation-id')
        }
      }
    },

    err: (err: any) => {
      if (!err) return err

      return {
        type: err.constructor?.name,
        message: err.message,
        stack: err.stack,
        code: err.code,
        statusCode: err.statusCode,
        cause: err.cause ? {
          message: err.cause.message,
          stack: err.cause.stack
        } : undefined
      }
    }
  }
}

/**
 * Create transport configuration
 */
function createTransport() {
  const usePrettyPrint = shouldUsePrettyPrint()

  if (!usePrettyPrint) {
    // Production: JSON to stdout only (Fly.io handles rotation)
    return undefined // Let Pino default to stdout
  }

  // Development: Pretty print with minimal noise
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:mm:ss Z',
      // Hide technical metadata in dev for cleaner output
      ignore: 'pid,hostname,service,version,environment,instance,correlationId,requestId,traceId,spanId,cqaOutput,exitCode'
    }
  }
}

/**
 * Create the base Pino logger instance
 */
function createBaseLogger() {
  return pino({
    level: getLogLevel(),
    base: getBaseLabels(), // Structured labels for Grafana
    redact: createRedactConfig(),
    serializers: createSerializers(),
    mixin: createMixin(),
    formatters: {
      level: (label) => {
        return { level: label }
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: createTransport()
  })
}

// Create the singleton logger instance
const baseLogger = createBaseLogger()

/**
 * Enhanced logger with context-aware methods
 */
export class ContextLogger {
  private pino: pino.Logger

  constructor(pinoInstance: pino.Logger) {
    this.pino = pinoInstance
  }

  /**
   * Get level property for pino-http compatibility
   */
  get level() {
    return this.pino.level
  }

  /**
   * Get silent property for pino-http compatibility
   */
  get silent() {
    return this.pino.silent
  }

  /**
   * Get msgPrefix property for pino-http compatibility
   */
  get msgPrefix() {
    return (this.pino as any).msgPrefix
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, any>): ContextLogger {
    return new ContextLogger(this.pino.child(bindings))
  }

  /**
   * Create a child logger that's compatible with pino-http
   */
  childWithPinoCompat(bindings: Record<string, any>): ContextLogger & pino.Logger {
    const childLogger = new ContextLogger(this.pino.child(bindings))
    // Create a proxy that combines both interfaces
    return new Proxy(childLogger, {
      get(target, prop) {
        // If the property exists on ContextLogger, use it
        if (prop in target) {
          return (target as any)[prop]
        }
        // Otherwise delegate to the underlying Pino instance
        return (target as any).pino[prop]
      }
    }) as ContextLogger & pino.Logger
  }

  /**
   * Create a child logger for a specific scope (e.g., route, service)
   */
  withScope(scope: string, additionalBindings?: Record<string, any>): ContextLogger {
    return this.child({ scope, ...additionalBindings })
  }

  /**
   * Private helper method to handle common logging logic
   */
  private logWithLevel(level: LogLevel, objOrMsg: any, msg?: any, ...args: any[]) {
    if (typeof objOrMsg === 'string') {
      this.pino[level](objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      // Create a more descriptive message based on the object type and context
      const context = getCurrentLogContext()
      const objectType = objOrMsg?.constructor?.name || typeof objOrMsg
      const scope = context.requestId && context.requestId.length >= 8 ? `[req:${context.requestId.slice(-8)}]` :
        context.requestId ? `[req:${context.requestId}]` :
          context.correlationId && context.correlationId.length >= 8 ? `[corr:${context.correlationId.slice(-8)}]` :
            context.correlationId ? `[corr:${context.correlationId}]` :
              '[no-context]'

      const message = `${scope} Logged ${objectType} without explicit message`
      this.pino[level]({ data: objOrMsg }, message)
    } else {
      this.pino[level](objOrMsg, msg, ...args)
    }
  }

  /**
   * Log methods with automatic context injection
   * 
   * These methods accept either:
   * - A single string message: logger.info('message')
   * - An object with optional message: logger.info({ data }, 'message')
   * - Console.log style arguments: logger.info('message', arg1, arg2)
   * - Any data type: logger.info(anything) - for console.log replacement
   */
  fatal(objOrMsg: any, msg?: any, ...args: any[]) {
    this.logWithLevel('fatal', objOrMsg, msg, ...args)
  }

  error(objOrMsg: any, msg?: any, ...args: any[]) {
    this.logWithLevel('error', objOrMsg, msg, ...args)
  }

  warn(objOrMsg: any, msg?: any, ...args: any[]) {
    this.logWithLevel('warn', objOrMsg, msg, ...args)
  }

  info(objOrMsg: any, msg?: any, ...args: any[]) {
    this.logWithLevel('info', objOrMsg, msg, ...args)
  }

  debug(objOrMsg: any, msg?: any, ...args: any[]) {
    this.logWithLevel('debug', objOrMsg, msg, ...args)
  }

  trace(objOrMsg: any, msg?: any, ...args: any[]) {
    this.logWithLevel('trace', objOrMsg, msg, ...args)
  }

  /**
   * Get the underlying Pino instance (for advanced usage)
   */
  getPinoInstance(): pino.Logger {
    return this.pino
  }
}

// Export the main logger instance
export const logger = new ContextLogger(baseLogger)

// Export factory functions for different scopes
export function createScopedLogger(scope: string, bindings?: Record<string, any>): ContextLogger {
  return logger.withScope(scope, bindings)
}

export function createRequestLogger(requestId: string, correlationId?: string): ContextLogger {
  return logger.child({
    requestId,
    correlationId: correlationId || requestId,
    scope: 'request'
  })
}

export function createServiceLogger(serviceName: string, bindings?: Record<string, any>): ContextLogger {
  return logger.child({
    service: serviceName,
    scope: 'service',
    ...bindings
  })
}

// Re-export pino for advanced usage
export { pino }