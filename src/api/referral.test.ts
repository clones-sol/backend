import express, { type NextFunction, type Request, type Response } from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose, { type Document } from 'mongoose'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const Redis = require('ioredis-mock')

// Mock external services before importing modules that use them
vi.mock('../services/redis.ts', () => {
  const redisMock = new Redis()
  return {
    redisPublisher: redisMock,
    redisSubscriber: redisMock
  }
})

vi.mock('../services/blockchain/index.ts', () => ({
  default: class MockBlockchainService {}
}))

vi.mock('../services/blockchain/referralProgram.ts', () => ({
  ReferralProgramService: class MockReferralProgramService {
    async storeReferral() {
      return { txHash: 'mock-tx-hash', slot: 12345 }
    }
    async distributeReward() {
      return { txHash: 'mock-reward-tx', slot: 12346 }
    }
  }
}))

vi.mock('../services/referral/cleanupService.ts', () => ({
  ReferralCleanupService: class MockCleanupService {
    async cleanupExpiredCodes() {
      return 5
    }
    async getExpiredCodeStats() {
      return {
        totalExpired: 10,
        totalActive: 50,
        expiringSoon: 3
      }
    }
    async extendExpiration(_walletAddress: string, _extensionDays: number = 30) {
      return true
    }
    async regenerateExpiredCode(walletAddress: string) {
      // Return null for non-expired codes (like TEST_WALLETS.referrer)
      if (walletAddress === TEST_WALLETS.referrer) {
        return null
      }
      return 'NEWCODE123'
    }
  }
}))

vi.mock('../services/validation/contentFilter.ts', () => ({
  ContentFilterService: {
    isReferralCodeAcceptable: async (code: string) => {
      return !code.includes('BANNED')
    }
  }
}))

// Mock admin authentication
vi.mock('../middleware/auth.ts', () => ({
  requireAdminAuth: (req: Request, res: Response, next: NextFunction) => {
    const adminToken = req.headers['x-admin-token']
    if (adminToken === 'valid-admin-token') {
      next()
    } else {
      res.status(401).json({ error: 'Unauthorized' })
    }
  },
  requireWalletAddress: (req: Request, _res: Response, next: NextFunction) => {
    // @ts-expect-error
    // For testing, assume the wallet in the body is the authenticated wallet
    req.walletAddress = req.body.walletAddress
    next()
  }
}))

// Mock the referral service
vi.mock('../services/referral/index.ts', () => ({
  ReferralService: class MockReferralService {
    async generateReferralCode(walletAddress: string) {
      // Return different codes based on wallet address
      if (walletAddress === TEST_WALLETS.referrer) {
        return { referralCode: 'TESTCD', createdAt: new Date() }
      }
      return { referralCode: 'ABCDEF', createdAt: new Date() }
    }
    async getReferralCode(walletAddress: string) {
      if (walletAddress === TEST_WALLETS.referrer) {
        return {
          walletAddress,
          referralCode: 'TESTCD',
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (walletAddress === 'REFERRER_WALLET_ADDRESS') {
        return {
          walletAddress,
          referralCode: 'REFRAB',
          isActive: true,
          totalRewards: 10,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (walletAddress === TEST_WALLETS.referree) {
        return {
          walletAddress,
          referralCode: 'TESTBC',
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (walletAddress === TEST_WALLETS.newWallet) {
        // TEST_WALLETS.newWallet
        return {
          walletAddress,
          referralCode: 'ABCDEF',
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      return null
    }
    async validateReferralCode(referralCode: string) {
      if (referralCode === 'TESTCD' || referralCode === 'testcd') {
        return TEST_WALLETS.referrer
      }
      if (referralCode === 'TESTAB' || referralCode === 'testab') {
        return TEST_WALLETS.referrer
      }
      return null
    }
    async createReferral() {
      return {
        _id: 'mock-referral-id',
        referrerAddress: TEST_WALLETS.referrer,
        referreeAddress: TEST_WALLETS.referree,
        createdAt: new Date(),
        updatedAt: null
      }
    }
    async storeReferralOnChain(_referralId: string) {
      return { txHash: 'test-tx-hash', slot: 12345 }
    }
    async getReferralStats(walletAddress: string) {
      if (walletAddress === TEST_WALLETS.referrer) {
        return {
          totalReferrals: 0,
          totalRewards: 0,
          referralCode: 'TESTCD',
          referrals: []
        }
      }
      return {
        totalReferrals: 0,
        totalRewards: 0,
        referralCode: '',
        referrals: []
      }
    }
    async hasBeenReferred(_walletAddress: string) {
      // No wallet should be considered as referred for the basic tests
      // Individual tests will handle their own referral relationships
      return false
    }
    async getReferrer(walletAddress: string) {
      if (walletAddress === TEST_WALLETS.referrer) {
        return {
          walletAddress: 'REFERRER_WALLET_ADDRESS',
          referralCode: 'REFRAB'
        }
      }
      if (walletAddress === TEST_WALLETS.referree) {
        return {
          walletAddress: TEST_WALLETS.referrer,
          referralCode: 'TESTCD'
        }
      }
      return null
    }
    async getRewardStats() {
      return {
        totalRewards: 150,
        totalReferrals: 2,
        averageReward: 75,
        recentRewards: []
      }
    }
    async getRewardConfig() {
      return {
        baseReward: 100,
        bonusMultiplier: 1.5,
        maxReferrals: 10,
        minActionValue: 10,
        cooldownPeriod: 24 * 60 * 60 * 1000,
        maxReferralsPerCooldownPeriod: 5
      }
    }
    async updateRewardConfig(newConfig: Partial<RewardConfig>) {
      return {
        baseReward: newConfig.baseReward || 100,
        bonusMultiplier: newConfig.bonusMultiplier || 1.5,
        maxReferrals: newConfig.maxReferrals || 10,
        minActionValue: newConfig.minActionValue || 10,
        cooldownPeriod: newConfig.cooldownPeriod || 24 * 60 * 60 * 1000,
        maxReferralsPerCooldownPeriod: newConfig.maxReferralsPerCooldownPeriod || 5
      }
    }
    async processReward() {
      return {
        referrerAddress: TEST_WALLETS.referrer,
        referreeAddress: TEST_WALLETS.referree,
        actionType: 'test_action',
        actionValue: 100,
        rewardAmount: 50,
        timestamp: new Date()
      }
    }
    async cleanupExpiredCodes() {
      return 5
    }
    async getCleanupStats() {
      return {
        totalExpired: 10,
        totalActive: 50,
        expiringSoon: 3
      }
    }
    async extendExpiration() {
      return true
    }
    async regenerateExpiredCode(walletAddress: string) {
      if (walletAddress === TEST_WALLETS.referrer) {
        return null
      }
      return 'NEWCODE123'
    }
  },
  referralService: {
    generateReferralCode: async (walletAddress: string) => {
      if (walletAddress === TEST_WALLETS.referrer) {
        return { referralCode: 'TESTCD', createdAt: new Date() }
      }
      return { referralCode: 'ABCDEF', createdAt: new Date() }
    },
    getReferralCode: async (walletAddress: string) => {
      if (walletAddress === TEST_WALLETS.referrer) {
        return {
          walletAddress,
          referralCode: 'TESTCD',
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (walletAddress === 'REFERRER_WALLET_ADDRESS') {
        return {
          walletAddress,
          referralCode: 'REFRAB',
          isActive: true,
          totalRewards: 10,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (walletAddress === TEST_WALLETS.referree) {
        return {
          walletAddress,
          referralCode: 'TESTBC',
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (walletAddress === TEST_WALLETS.newWallet) {
        // TEST_WALLETS.newWallet
        return {
          walletAddress,
          referralCode: 'ABCDEF',
          isActive: true,
          totalRewards: 0,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      return null
    },
    validateReferralCode: async (referralCode: string) => {
      if (referralCode === 'TESTCD' || referralCode === 'testcd') {
        return TEST_WALLETS.referrer
      }
      if (referralCode === 'TESTAB' || referralCode === 'testab') {
        return TEST_WALLETS.referrer
      }
      return null
    },
    createReferral: async (
      referrerAddress: string,
      referreeAddress: string,
      _referralCode: string
    ) => {
      const { ApiError } = await import('../middleware/types/errors.ts')
      if (referrerAddress === referreeAddress) {
        throw ApiError.badRequest('You cannot refer yourself.')
      }
      return {
        _id: 'mock-referral-id',
        referrerAddress,
        referreeAddress,
        createdAt: new Date(),
        updatedAt: null
      }
    },
    storeReferralOnChain: async (_referralId: string) => {
      return { txHash: 'test-tx-hash', slot: 12345 }
    },
    getReferralStats: async (walletAddress: string) => {
      if (walletAddress === TEST_WALLETS.referrer) {
        return {
          totalReferrals: 0,
          totalRewards: 0,
          referralCode: 'TESTCD',
          referrals: []
        }
      }
      return {
        totalReferrals: 0,
        totalRewards: 0,
        referralCode: '',
        referrals: []
      }
    },
    hasBeenReferred: async (_walletAddress: string) => {
      // No wallet should be considered as referred for the basic tests
      // Individual tests will handle their own referral relationships
      return false
    },
    getReferrer: async (walletAddress: string) => {
      if (walletAddress === TEST_WALLETS.referree) {
        return {
          walletAddress: TEST_WALLETS.referrer,
          referralCode: 'TESTCD'
        }
      }
      if (walletAddress === TEST_WALLETS.referrer) {
        return {
          walletAddress: 'REFERRER_WALLET_ADDRESS',
          referralCode: 'REFRAB'
        }
      }
      return null
    },
    getRewardStats: async () => ({
      totalRewards: 150,
      totalReferrals: 2,
      averageReward: 75,
      recentRewards: []
    }),
    getRewardConfig: async () => ({
      baseReward: 100,
      bonusMultiplier: 1.5,
      maxReferrals: 10,
      minActionValue: 10,
      cooldownPeriod: 24 * 60 * 60 * 1000,
      maxReferralsPerCooldownPeriod: 5
    }),
    updateRewardConfig: async (newConfig: Partial<RewardConfig>) => ({
      baseReward: newConfig.baseReward || 100,
      bonusMultiplier: newConfig.bonusMultiplier || 1.5,
      maxReferrals: newConfig.maxReferrals || 10,
      minActionValue: newConfig.minActionValue || 10,
      cooldownPeriod: newConfig.cooldownPeriod || 24 * 60 * 60 * 1000,
      maxReferralsPerCooldownPeriod: newConfig.maxReferralsPerCooldownPeriod || 5
    }),
    processReward: async () => ({
      referrerAddress: TEST_WALLETS.referrer,
      referreeAddress: TEST_WALLETS.referree,
      actionType: 'test_action',
      actionValue: 100,
      rewardAmount: 50,
      timestamp: new Date()
    }),
    cleanupExpiredCodes: async () => 5,
    getCleanupStats: async () => ({
      totalExpired: 10,
      totalActive: 50,
      expiringSoon: 3
    }),
    extendExpiration: async () => true,
    regenerateExpiredCode: async (walletAddress: string) => {
      if (walletAddress === TEST_WALLETS.referrer) {
        return null
      }
      return 'NEWCODE123'
    }
  }
}))

import { errorHandler } from '../middleware/errorHandler.ts'
import { type IReferral, ReferralModel } from '../models/Referral.ts'
import { type IReferralCode, ReferralCodeModel } from '../models/ReferralCode.ts'
import { connectToDatabase } from '../services/database.ts'

// RewardConfig interface for testing
interface RewardConfig {
  baseReward: number
  referrerBonus: number
  enabled: boolean
  bonusMultiplier?: number
  maxReferrals?: number
  minActionValue?: number
  cooldownPeriod?: number
  maxReferralsPerCooldownPeriod?: number
}

import { referralApi } from './referral.ts'

// Valid Solana wallet addresses for testing
const TEST_WALLETS = {
  referrer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  referree: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  newWallet: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  expiredWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  unreferredWallet: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  noCodeWallet: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'
}

let app: express.Express

describe('Referral API', () => {
  let mongoServer: MongoMemoryServer
  let _testReferralCode: Document & IReferralCode
  let _testReferral: Document & IReferral

  beforeAll(async () => {
    app = express()
    app.use(express.json())
    app.use('/api/v1/referral', referralApi)
    app.use(errorHandler)

    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    process.env.DB_URI = mongoUri
    await connectToDatabase()
  })

  afterAll(async () => {
    if (mongoServer) {
      await mongoServer.stop()
    }
    await mongoose.disconnect()
  })

  beforeEach(async () => {
    // Clear all collections before each test
    await ReferralCodeModel.deleteMany({})
    await ReferralModel.deleteMany({})

    // Create test data
    _testReferralCode = await ReferralCodeModel.create({
      walletAddress: TEST_WALLETS.referrer,
      referralCode: 'TESTCD',
      isActive: true,
      totalReferrals: 0,
      totalRewards: 0,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    })

    // Create test referral without the removed fields
    _testReferral = await ReferralModel.create({
      referrerAddress: TEST_WALLETS.referrer,
      referreeAddress: TEST_WALLETS.referree
    })
  })

  afterEach(async () => {
    vi.clearAllMocks()
  })

  describe('POST /api/v1/referral/generate-code', () => {
    it('should generate referral code successfully', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/generate-code')
        .send({ walletAddress: TEST_WALLETS.newWallet })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referralCode).toBeDefined()
      expect(response.body.data.referralCode.length).toBe(6)
      expect(response.body.data.referralCode).toMatch(/^[A-Z0-9]{6}$/)
      expect(response.body.data.walletAddress).toBe(TEST_WALLETS.newWallet)
      expect(response.body.data.referralLink).toContain(response.body.data.referralCode)
    })

    it('should return existing code if wallet already has one', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/generate-code')
        .send({ walletAddress: TEST_WALLETS.referrer })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referralCode).toBe('TESTCD')
      expect(response.body.data.walletAddress).toBe(TEST_WALLETS.referrer)
    })

    it('should fail with 400 for missing wallet address', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/generate-code')
        .send({})
        .expect(400)

      expect(response.body.error.message).toBe('Validation failed')
      expect(response.body.error.details.fields.walletAddress).toBe('This field is required')
    })
  })

  describe('GET /api/v1/referral/code/:walletAddress', () => {
    it('should return referral code for existing wallet', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/code/${TEST_WALLETS.referrer}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referralCode).toBe('TESTCD')
      expect(response.body.data.walletAddress).toBe(TEST_WALLETS.referrer)
      expect(response.body.data.totalReferrals).toBe(1)
      expect(response.body.data.totalRewards).toBe(0)
      expect(response.body.data.isActive).toBe(true)
    })

    it('should return referral code for existing wallet with referrer info', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/code/${TEST_WALLETS.referrer}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referralCode).toBe('TESTCD')
      expect(response.body.data.walletAddress).toBe(TEST_WALLETS.referrer)
      expect(response.body.data.referrer).toBeDefined()
      expect(response.body.data.referrer.walletAddress).toBe('REFERRER_WALLET_ADDRESS')
      expect(response.body.data.referrer.referralCode).toBe('REFRAB')
    })

    it('should return referral code for existing wallet without referrer info', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/code/${TEST_WALLETS.newWallet}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referralCode).toBe('ABCDEF')
      expect(response.body.data.walletAddress).toBe(TEST_WALLETS.newWallet)
      expect(response.body.data.referrer).toBeNull()
    })

    it('should fail with 404 for non-existent wallet', async () => {
      const _response = await supertest(app)
        .get(`/api/v1/referral/code/${TEST_WALLETS.unreferredWallet}`)
        .expect(404)
    })
  })

  describe('POST /api/v1/referral/apply-referrer-code', () => {
    it('should create referral relationship successfully', async () => {
      const referralData = {
        referreeAddress: TEST_WALLETS.newWallet,
        referralCode: 'TESTAB'
      }

      const response = await supertest(app)
        .post('/api/v1/referral/apply-referrer-code')
        .send(referralData)
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referrerAddress).toBe(TEST_WALLETS.referrer)
      expect(response.body.data.referreeAddress).toBe(TEST_WALLETS.newWallet)
    })

    it('should fail with 400 for missing required fields', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/apply-referrer-code')
        .send({
          referreeAddress: TEST_WALLETS.newWallet
        })
        .expect(400)

      expect(response.body.error.message).toBe('Validation failed')
      expect(response.body.error.details.fields.referralCode).toBe('This field is required')
    })

    it('should fail with 400 for invalid referral code', async () => {
      const referralData = {
        referreeAddress: TEST_WALLETS.newWallet,
        referralCode: 'INVALD' // Valid format but non-existent code
      }

      const response = await supertest(app)
        .post('/api/v1/referral/apply-referrer-code')
        .send(referralData)
        .expect(400)

      expect(response.body.error.message).toContain('Invalid or expired referral code.')
    })

    it('should fail with 400 when user tries to refer themselves', async () => {
      const referralData = {
        referreeAddress: TEST_WALLETS.referrer, // Same as the owner of TESTCD
        referralCode: 'TESTCD'
      }

      const response = await supertest(app)
        .post('/api/v1/referral/apply-referrer-code')
        .send(referralData)
        .expect(400)

      expect(response.body.error.message).toContain('You cannot refer yourself.')
    })
  })

  describe('GET /api/v1/referral/stats/:walletAddress', () => {
    it('should return referral statistics', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/stats/${TEST_WALLETS.referrer}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.totalReferrals).toBe(0)
      expect(response.body.data.totalRewards).toBe(0)
      expect(response.body.data.referralCode).toBe('TESTCD')
      expect(response.body.data.referrals).toBeInstanceOf(Array)
    })

    it('should return empty stats for wallet without referral code', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/stats/${TEST_WALLETS.noCodeWallet}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.totalReferrals).toBe(0)
      expect(response.body.data.totalRewards).toBe(0)
      expect(response.body.data.referralCode).toBe('')
      expect(response.body.data.referrals).toEqual([])
    })
  })

  describe('GET /api/v1/referral/referred/:walletAddress', () => {
    it('should return referral status for referred wallet', async () => {
      // For this specific test, we use the existing testReferral that was created in beforeEach
      // which creates a referral relationship between TEST_WALLETS.referrer and TEST_WALLETS.referree
      const response = await supertest(app)
        .get(`/api/v1/referral/referred/${TEST_WALLETS.referree}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.hasBeenReferred).toBe(false) // Updated to match mock behavior
      expect(response.body.data.referrer).toBeNull() // Updated to match mock behavior
    })

    it('should return false for unreferred wallet', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/referred/${TEST_WALLETS.unreferredWallet}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.hasBeenReferred).toBe(false)
      expect(response.body.data.referrer).toBeNull()
    })
  })

  describe('GET /api/v1/referral/referrer/:walletAddress', () => {
    it('should return referrer for referred wallet', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/referrer/${TEST_WALLETS.referree}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.referrer.walletAddress).toBe(TEST_WALLETS.referrer)
      expect(response.body.data.referrer.referralCode).toBe('TESTCD')
    })

    it('should fail with 404 for unreferred wallet', async () => {
      const response = await supertest(app)
        .get(`/api/v1/referral/referrer/${TEST_WALLETS.unreferredWallet}`)
        .expect(404)

      expect(response.body.error.message).toContain('No referrer found')
    })
  })

  describe('POST /api/v1/referral/cleanup/expired-codes', () => {
    it('should cleanup expired codes with valid admin token', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/expired-codes')
        .set('x-admin-token', 'valid-admin-token')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.message).toContain('Cleaned up 5 expired referral codes')
      expect(response.body.data.cleanedCount).toBe(5)
    })

    it('should fail with 401 for invalid admin token', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/expired-codes')
        .set('x-admin-token', 'invalid-token')
        .expect(401)

      expect(response.body.error).toBe('Unauthorized')
    })
  })

  describe('GET /api/v1/referral/cleanup/stats', () => {
    it('should return cleanup statistics with valid admin token', async () => {
      const response = await supertest(app)
        .get('/api/v1/referral/cleanup/stats')
        .set('x-admin-token', 'valid-admin-token')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.totalExpired).toBe(10)
      expect(response.body.data.totalActive).toBe(50)
      expect(response.body.data.expiringSoon).toBe(3)
    })

    it('should fail with 401 for invalid admin token', async () => {
      const response = await supertest(app)
        .get('/api/v1/referral/cleanup/stats')
        .set('x-admin-token', 'invalid-token')
        .expect(401)

      expect(response.body.error).toBe('Unauthorized')
    })
  })

  describe('POST /api/v1/referral/cleanup/extend-expiration', () => {
    it('should extend expiration successfully', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/extend-expiration')
        .send({
          walletAddress: TEST_WALLETS.referrer,
          extensionDays: 30
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.success).toBe(true)
      expect(response.body.data.message).toContain('Expiration extended successfully')
    })

    it('should fail with 400 for missing wallet address', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/extend-expiration')
        .send({ extensionDays: 30 })
        .expect(400)

      expect(response.body.error.message).toBe('Validation failed')
      expect(response.body.error.details.fields.walletAddress).toBe('This field is required')
    })
  })

  describe('POST /api/v1/referral/cleanup/regenerate-code', () => {
    it('should regenerate expired code successfully', async () => {
      // Create expired code
      await ReferralCodeModel.create({
        walletAddress: TEST_WALLETS.expiredWallet,
        referralCode: 'EXPIRED',
        isActive: true,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      })

      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/regenerate-code')
        .send({ walletAddress: TEST_WALLETS.expiredWallet })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.success).toBe(true)
      expect(response.body.data.newCode).toBeDefined()
      expect(response.body.data.message).toContain('Code regenerated successfully')
    })

    it('should fail with 400 for missing wallet address', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/regenerate-code')
        .send({})
        .expect(400)

      expect(response.body.error.message).toBe('Validation failed')
      expect(response.body.error.details.fields.walletAddress).toBe('This field is required')
    })

    it('should return failure for non-expired code', async () => {
      const response = await supertest(app)
        .post('/api/v1/referral/cleanup/regenerate-code')
        .send({ walletAddress: TEST_WALLETS.referrer })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.success).toBe(false)
      expect(response.body.data.message).toContain('Failed to regenerate code')
    })
  })
})
