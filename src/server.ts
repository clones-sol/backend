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
import { catchErrors } from './hooks/errors.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { connectToDatabase } from './services/database.ts'
import { connectToRedis, disconnectFromRedis } from './services/redis.ts'
import { initializeWebSocketServer } from './services/websockets/socketManager.ts'
import { configureSecureSession } from './middleware/secureSession.ts'
import { generalRateLimit } from './middleware/rateLimiter.ts'

const app = express()
const port = parseInt(process.env.PORT || '8001', 10)

// Create HTTP server
const httpServer = createServer(app)

// Get current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
app.use(
  cors({
    origin: [
      'tauri://localhost',
      'http://tauri.localhost',
      'http://localhost:1420',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8001',
      'http://18.157.122.205',
      'https://clones-ai.com',
      'https://clones-website-test.fly.dev',
      'https://clones-backend-test.fly.dev'
    ],
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

// Serve static files from public directory
app.use('/api/screenshots', express.static(path.join(__dirname, 'public', 'screenshots')))
app.use('/api/recordings', express.static(path.join(__dirname, 'public', 'recordings')))

// API v1 endpoints
app.use('/api/v1/demonstration', demonstrationApi)
app.use('/api/v1/forge', forgeApi)
app.use('/api/v1/wallet', walletApi)
app.use('/api/v1/referral', referralApi)
app.use('/api/v1/transaction', transactionApi)

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// Not found handler
app.use((_req, res, _next) => {
  res.status(404).json({ message: 'Endpoint not found' })
})

// Error handling
app.use(errorHandler)

catchErrors()

// Start server
if (process.env.NODE_ENV !== 'test') {
  const host = '0.0.0.0'
  httpServer.listen(port, host, async () => {
    console.log(`Clones backend listening on port ${port}`)
    await connectToDatabase().catch(console.dir)
    connectToRedis()

    // Initialize WebSocket server after Redis connection
    initializeWebSocketServer(httpServer)
  })
}

// Graceful shutdown logic
const handleShutdown = () => {
  console.log(`\nReceived shutdown signal. Shutting down gracefully...`)
  httpServer.close(() => {
    console.log('HTTP server closed.')
    mongoose.disconnect().then(() => {
      console.log('MongoDB connection closed.')
      if (process.env.NODE_ENV !== 'test') {
        disconnectFromRedis()
        console.log('Redis connections closed.')
      }
      process.exit(0)
    })
  })
}

// Listen for termination signals
process.on('SIGTERM', handleShutdown)
process.on('SIGINT', handleShutdown)

export { app, httpServer }
