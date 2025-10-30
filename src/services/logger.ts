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
 * Create mixin for global fields added to every log
 */
function createMixin() {
  return function mixin() {
    const context = getCurrentLogContext()
    return {
      service: process.env.SERVICE_NAME || 'clones-backend',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
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
  const isProduction = process.env.NODE_ENV === 'production'
  const usePrettyPrint = shouldUsePrettyPrint()
  
  if (!usePrettyPrint) {
    // Production: JSON to stdout
    return {
      target: 'pino/file',
      options: {
        destination: 1 // stdout
      }
    }
  }
  
  // Development: Pretty print
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname,service,version,environment'
    }
  }
}

/**
 * Create the base Pino logger instance
 */
function createBaseLogger() {
  return pino({
    level: getLogLevel(),
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
class ContextLogger {
  private pino: pino.Logger

  constructor(pinoInstance: pino.Logger) {
    this.pino = pinoInstance
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, any>): ContextLogger {
    return new ContextLogger(this.pino.child(bindings))
  }

  /**
   * Create a child logger for a specific scope (e.g., route, service)
   */
  withScope(scope: string, additionalBindings?: Record<string, any>): ContextLogger {
    return this.child({ scope, ...additionalBindings })
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
    if (typeof objOrMsg === 'string') {
      this.pino.fatal(objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      this.pino.fatal({ data: objOrMsg }, 'Logged object')
    } else {
      this.pino.fatal(objOrMsg, msg, ...args)
    }
  }

  error(objOrMsg: any, msg?: any, ...args: any[]) {
    if (typeof objOrMsg === 'string') {
      this.pino.error(objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      this.pino.error({ data: objOrMsg }, 'Logged object')
    } else {
      this.pino.error(objOrMsg, msg, ...args)
    }
  }

  warn(objOrMsg: any, msg?: any, ...args: any[]) {
    if (typeof objOrMsg === 'string') {
      this.pino.warn(objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      this.pino.warn({ data: objOrMsg }, 'Logged object')
    } else {
      this.pino.warn(objOrMsg, msg, ...args)
    }
  }

  info(objOrMsg: any, msg?: any, ...args: any[]) {
    if (typeof objOrMsg === 'string') {
      this.pino.info(objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      this.pino.info({ data: objOrMsg }, 'Logged object')
    } else {
      this.pino.info(objOrMsg, msg, ...args)
    }
  }

  debug(objOrMsg: any, msg?: any, ...args: any[]) {
    if (typeof objOrMsg === 'string') {
      this.pino.debug(objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      this.pino.debug({ data: objOrMsg }, 'Logged object')
    } else {
      this.pino.debug(objOrMsg, msg, ...args)
    }
  }

  trace(objOrMsg: any, msg?: any, ...args: any[]) {
    if (typeof objOrMsg === 'string') {
      this.pino.trace(objOrMsg, ...args)
    } else if (msg === undefined) {
      // Handle case where only object is passed (like console.log(obj))
      this.pino.trace({ data: objOrMsg }, 'Logged object')
    } else {
      this.pino.trace(objOrMsg, msg, ...args)
    }
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