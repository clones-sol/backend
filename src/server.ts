import 'dotenv/config'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import swaggerUi from 'swagger-ui-express'
import swaggerSpec from '../swagger.ts'
import { demonstrationApi } from './api/demonstration.ts'
import { forgeApi } from './api/forge/index.ts'
import { referralApi } from './api/referral.ts'
import { transactionApi } from './api/transaction.ts'
import { walletApi } from './api/wallet.ts'
import { withdrawalApi } from './api/withdrawal.ts'
import { catchErrors } from './hooks/errors.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { connectToDatabase } from './services/database.ts'
import { connectToRedis, disconnectFromRedis } from './services/redis.ts'
import { initializeWebSocketServer } from './services/websockets/socketManager.ts'
import { configureSecureSession } from './middleware/secureSession.ts'
import { generalRateLimit } from './middleware/rateLimiter.ts'
import { startClaimLockCleanupService, stopClaimLockCleanupService } from './services/claimLockCleanupService.ts'
import { logger } from './services/logger.ts'
import { createLoggingMiddleware, errorLoggingMiddleware, userContextMiddleware } from './middleware/loggingMiddleware.ts'

const app = express()
const port = parseInt(process.env.PORT || '8001', 10)

// Create HTTP server
const httpServer = createServer(app)

// Get current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Logging middleware - must be early in the stack
app.use(...createLoggingMiddleware())

// Middlewares
app.use(express.json({ limit: '10mb' })) // Reasonable limit for JSON payloads
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cookieParser()) // Parse cookies for CSRF protection
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}))
// Get allowed origins from environment variable
const getAllowedOrigins = (): string[] => {
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  if (!corsOrigins) {
    throw new Error('CORS_ALLOWED_ORIGINS environment variable must be defined')
  }
  return corsOrigins.split(',').map(origin => origin.trim())
}

app.use(
  cors({
    origin: getAllowedOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'X-Requested-With',
      'content-type',
      'auth-token',
      'cancelToken',
      'responsetype',
      'x-forwarded-for',
      'x-wallet-address',
      'x-connect-token',
      'x-csrf-token',
      'content-length',
      'x-real-ip'
    ],
    credentials: true, // Enable credentials for sessions
    exposedHeaders: ['auth-token', 'x-forwarded-for']
  })
)

app.disable('x-powered-by')
// TODO(reddwarf03): The trust proxy setting 'loopback, linklocal, uniquelocal' may be too permissive for production environments. Consider using a more specific configuration based on your actual proxy setup.
app.set('trust proxy', 'loopback, linklocal, uniquelocal')

// Apply general rate limiting to all routes
app.use(generalRateLimit)

// Configure secure session with CSRF protection
configureSecureSession(app)

// User context middleware (after authentication/session setup)
app.use(userContextMiddleware)

// Serve static files from public directory
app.use('/api/screenshots', express.static(path.join(__dirname, 'public', 'screenshots')))
app.use('/api/recordings', express.static(path.join(__dirname, 'public', 'recordings')))

// API v1 endpoints
app.use('/api/v1/demonstration', demonstrationApi)
app.use('/api/v1/forge', forgeApi)
app.use('/api/v1/wallet', walletApi)
app.use('/api/v1/referral', referralApi)
app.use('/api/v1/transaction', transactionApi)
app.use('/api/v1/withdrawal', withdrawalApi)

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// Health check endpoint for Fly.io
app.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Not found handler
app.use((_req, res, _next) => {
  res.status(404).json({ message: 'Endpoint not found' })
})

// Error handling with logging
app.use(errorLoggingMiddleware)
app.use(errorHandler)

catchErrors()

// Start server unless running unit tests locally (skip when NODE_ENV=test without Fly.io)
const shouldStartServer = process.env.FLY_APP_NAME || process.env.NODE_ENV !== 'test'
if (shouldStartServer) {
  const host = '0.0.0.0'
  logger.info(`Starting server on ${host}:${port}`)
  httpServer.listen(port, host, () => {
    logger.info(`Clones backend listening on port ${port}`)

    // Connect to database asynchronously - don't block server startup
    connectToDatabase()
      .then(() => logger.info('Database connected successfully'))
      .catch(error => logger.error('Database connection failed:', error))

    connectToRedis()

    // Initialize WebSocket server after Redis connection
    initializeWebSocketServer(httpServer)

    // Start claim lock cleanup service
    startClaimLockCleanupService()
  })
}

// Graceful shutdown logic
const handleShutdown = () => {
  logger.info(`\nReceived shutdown signal. Shutting down gracefully...`)

  // Stop background services first
  stopClaimLockCleanupService()

  httpServer.close(() => {
    logger.info('HTTP server closed.')
    mongoose.disconnect().then(() => {
      logger.info('MongoDB connection closed.')
      if (process.env.NODE_ENV !== 'test') {
        disconnectFromRedis()
        logger.info('Redis connections closed.')
      }
      process.exit(0)
    })
  })
}

// Listen for termination signals
process.on('SIGTERM', handleShutdown)
process.on('SIGINT', handleShutdown)

export { app, httpServer }
