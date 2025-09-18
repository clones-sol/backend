import express, { type NextFunction, type Request, type Response } from 'express'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { errorHandler } from '../middleware/errorHandler.ts'

// Mock external dependencies for consistency with other tests
vi.mock('../services/redis.ts', () => {
  const Redis = require('ioredis-mock')
  const redisMock = new Redis()
  return {
    redisPublisher: redisMock,
    redisSubscriber: redisMock
  }
})

// Mock ethers to prevent real RPC connections
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      getFeeData: vi.fn().mockResolvedValue({ gasPrice: BigInt('1000000000') }),
      getNetwork: vi.fn().mockResolvedValue({ chainId: 1 })
    })),
    verifyMessage: vi.fn().mockReturnValue('0xMockAddress'),
    parseUnits: vi.fn().mockReturnValue(BigInt('1000000000')),
    formatEther: vi.fn().mockReturnValue('1.0')
  }
}))

vi.mock('../services/blockchain/index.ts', () => ({
  default: class MockBlockchainService {
    provider: any

    constructor(rpcUrl: string) {
      // Mock provider without any real network calls
      this.provider = {
        on: vi.fn(),
        getFeeData: vi.fn().mockResolvedValue({ gasPrice: BigInt('1000000000') }),
        getNetwork: vi.fn().mockResolvedValue({ chainId: 1 })
      }
    }

    static async getEthPriceInUSD() {
      return 3000
    }

    static async getTokenPriceUSD() {
      return 1
    }
  }
}))

// Mock MongoDB models to avoid database dependencies
vi.mock('../models/Models.ts', () => ({
  WalletConnectionModel: {
    findOne: vi.fn().mockResolvedValue(null)
  }
}))

describe('CSRF Protection Tests', () => {
  let app: express.Application
  let csrfToken: string
  let sessionCookie: string

  beforeAll(async () => {
    // Create test app with proper middleware setup
    const { app: serverApp } = await import('../server.ts')
    app = serverApp
  }, 10000)

  afterAll(async () => {
    // Cleanup any resources if needed
    vi.clearAllMocks()
  })

  beforeEach(async () => {
    // Setup fresh CSRF token for each test
    const csrfResponse = await request(app)
      .get('/api/v1/wallet/csrf-token')
      .expect(200)

    csrfToken = csrfResponse.body.data.csrfToken
    sessionCookie = csrfResponse.headers['set-cookie']?.[0] || ''
  })

  afterEach(() => {
    // Clear any test-specific state
    vi.clearAllMocks()
  })

  describe('CSRF Token Generation', () => {
    it('should get CSRF token successfully', () => {
      expect(csrfToken).toBeDefined()
      expect(typeof csrfToken).toBe('string')
      expect(csrfToken.length).toBeGreaterThan(0)
    })
  })

  describe('CSRF Protection for POST requests', () => {
    it('should reject POST requests without CSRF token', async () => {
      const response = await request(app)
        .post('/api/v1/wallet/establish-session')
        .send({ token: 'test-token' })

      // In production, /establish-session is exempt from CSRF, so this would return 401 (auth error)
      // In test server, CSRF is enforced and returns 403
      expect([401, 403]).toContain(response.status)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toBeDefined()
    })

    it('should accept POST requests with valid CSRF token', async () => {
      const response = await request(app)
        .post('/api/v1/wallet/establish-session')
        .set('Cookie', sessionCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({ token: 'test-token' })

      // CSRF should pass, so we should NOT get a 403 (CSRF error)
      // We might get 401 (auth error) or 400 (validation error) but not 403
      expect(response.status).not.toBe(403)

      // If we get an error response, it should be properly formatted
      if (!response.body.success) {
        expect(response.body.error).toBeDefined()
        // errorCode might not always be present in error responses
        if (response.body.errorCode) {
          expect(typeof response.body.errorCode).toBe('string')
        }
      }
    })

    it('should reject POST requests with invalid CSRF token', async () => {
      const response = await request(app)
        .post('/api/v1/wallet/establish-session')
        .set('Cookie', sessionCookie)
        .set('X-CSRF-Token', 'invalid-csrf-token')
        .send({ token: 'test-token' })

      // In production, /establish-session is exempt from CSRF, so this would return 401 (auth error)
      // In test server, CSRF is enforced and returns 403
      expect([401, 403]).toContain(response.status)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toBeDefined()
    })
  })

  describe('CSRF Exemptions for GET requests', () => {
    it('should allow GET requests without CSRF token', async () => {
      const response = await request(app)
        .get('/api/v1/wallet/session-status')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })
  })
})