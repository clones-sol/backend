import express, { type NextFunction, type Request, type Response } from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../middleware/errorHandler.ts'
import { FactoryModel } from '../../models/Factory.ts'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import { FactoryStatus } from '../../types/factory.ts'
import { factoriesApi } from './factories.ts'

// Mock auth middleware
const { mockAuth, TEST_WALLET_ADDRESS, OTHER_WALLET_ADDRESS } = vi.hoisted(() => {
  const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const OTHER_WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

  return {
    TEST_WALLET_ADDRESS,
    OTHER_WALLET_ADDRESS,
    mockAuth: {
      walletAddress: TEST_WALLET_ADDRESS
    }
  }
})
vi.mock('../../middleware/auth.ts', () => ({
  requireWalletAddress: (req: Request, _res: Response, next: NextFunction) => {
    // @ts-expect-error
    req.walletAddress = mockAuth.walletAddress
    next()
  }
}))

// Mock factory service
const { mockGenerateApps } = vi.hoisted(() => {
  return { mockGenerateApps: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../../services/factory/factoryDatabaseService.ts', () => ({
  generateAppsForFactory: mockGenerateApps,
  createFactory: vi.fn().mockResolvedValue({ id: 'mock-factory-id' })
}))

// Mock blockchain tokens service
const { mockSupportedTokens } = vi.hoisted(() => {
  return {
    mockSupportedTokens: {
      USDC: { name: 'USD Coin', address: '0xusdcaddress' },
      WETH: { name: 'Wrapped Ether', address: '0xwethaddress' }
    }
  }
})
vi.mock('../../services/blockchain/tokens.ts', () => ({
  supportedTokens: mockSupportedTokens,
  getTokenContractAddress: vi.fn(
    (tokenSymbol: string) =>
      mockSupportedTokens[tokenSymbol as keyof typeof mockSupportedTokens]?.address ||
      `0xaddress_for_${tokenSymbol}`
  ),
  getSupportedTokenSymbols: vi.fn(() => Object.keys(mockSupportedTokens))
}))

// Mock blockchain factory service
const { mockFactoryService } = vi.hoisted(() => {
  return {
    mockFactoryService: {
      prepareCreatePoolTransaction: vi.fn(),
      predictPoolAddress: vi.fn(),
      getPoolInfo: vi.fn(),
      prepareFundPoolTransaction: vi.fn(),
      prepareClaimSignatureData: vi.fn(),
      prepareBatchClaimData: vi.fn(),
      getPublisherInfo: vi.fn()
    }
  }
})
vi.mock('../../services/blockchain/factoryTransactionService.ts', () => ({
  createFactoryService: () => mockFactoryService
}))

// Mock tokenCache to prevent network calls
vi.mock('../../utils/tokenCache.js', () => ({
  tokenCache: {
    getTokenMetadata: vi.fn(),
    validateAndParseAmountWithMetadata: vi.fn(),
    cleanup: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn()
  }
}))

// Mock blockchain service to prevent network calls
vi.mock('../../services/blockchain/index.ts', () => ({
  default: vi.fn().mockImplementation(() => ({
    getTokenBalance: vi.fn(),
    getFeeData: vi.fn(),
    getEthPriceInUSD: vi.fn()
  }))
}))

// Mock address validation to prevent network calls
vi.mock('../../utils/addressValidation.ts', () => ({
  isValidAddress: vi.fn((address: string) => {
    return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address)
  }),
  validateAddress: vi.fn((address: string) => {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error('Must be a valid Ethereum address')
    }
  }),
  mongooseAddressValidator: vi.fn(() => true)
}))

// Mock ethers to prevent any real provider instantiation
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    Contract: vi.fn(),
    parseUnits: vi.fn(),
    formatUnits: vi.fn()
  }
}))

let app: express.Express
let mongoServer: MongoMemoryServer

describe('Forge Factories API', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    await mongoose.connect(mongoUri)

    app = express()
    app.use(express.json())
    app.use('/api/v1/forge/factories', factoriesApi)
    app.use(errorHandler)
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
  })

  beforeEach(async () => {
    await FactoryModel.create([
      {
        _id: new mongoose.Types.ObjectId('60f8e4b4c3b3e4a3b1e8e4a1'),
        name: 'Test Factory 1',
        ownerAddress: TEST_WALLET_ADDRESS.toLowerCase(),
        poolAddress: '0xpool1address',
        skills: ['skill1', 'skill2'],
        status: FactoryStatus.active,
        searchText: 'Test Factory 1 skill1 skill2 type1',
        createdAt: new Date('2023-01-01'),
        demonstrations: 5,
        token: {
          symbol: 'USDC',
          address: '0xusdc',
          decimals: 6,
          type: 'ERC20'
        },
        tasks: [
          {
            id: 'task_1',
            task_name: 'Google Docs Document',
            prompt: 'Write a document in Google Docs',
            categories: ['productivity', 'writing'],
            apps_used: [
              {
                name: 'Google Docs',
                domain: 'docs.google.com',
                description: 'Online document editor'
              }
            ],
            uploadLimit: 10,
            rewardLimit: 5.0
          },
          {
            id: 'task_2',
            task_name: 'PowerPoint Presentation',
            prompt: 'Create a presentation in PowerPoint',
            categories: ['productivity', 'presentation'],
            apps_used: [
              {
                name: 'Microsoft PowerPoint',
                domain: 'desktop',
                description: 'Desktop presentation software'
              }
            ],
            uploadLimit: 5,
            rewardLimit: 3.0
          }
        ]
      },
      {
        _id: new mongoose.Types.ObjectId('60f8e4b4c3b3e4a3b1e8e4a2'),
        name: 'Another Factory 2',
        ownerAddress: OTHER_WALLET_ADDRESS.toLowerCase(),
        poolAddress: '0xpool2address',
        skills: ['skill3', 'skill4'],
        status: FactoryStatus.paused,
        searchText: 'Another Factory 2 skill3 skill4 type2',
        createdAt: new Date('2023-01-02'),
        demonstrations: 10,
        token: {
          symbol: 'WETH',
          address: '0xweth',
          decimals: 18,
          type: 'ERC20'
        },
        tasks: [
          {
            id: 'task_3',
            task_name: 'Poster Design',
            prompt: 'Design a poster using Photoshop and Figma',
            categories: ['design', 'graphics'],
            apps_used: [
              {
                name: 'Adobe Photoshop',
                domain: 'desktop',
                description: 'Professional image editing software'
              },
              {
                name: 'Figma',
                domain: 'figma.com',
                description: 'Collaborative design tool'
              }
            ],
            uploadLimit: 15,
            rewardLimit: 7.5
          }
        ]
      }
    ])
    mockAuth.walletAddress = TEST_WALLET_ADDRESS
  })

  afterEach(async () => {
    await FactoryModel.deleteMany({})
    await DemonstrationSubmission.deleteMany({})
    vi.clearAllMocks()
  })

  describe('GET /supported-tokens', () => {
    it('should return a list of supported tokens', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/factories/supported-tokens')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual([
        { symbol: 'USDC', name: 'USD Coin' },
        { symbol: 'WETH', name: 'Wrapped Ether' }
      ])
    })
  })

  describe('POST /search', () => {
    it('should return all factories with no criteria', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/factories/search')
        .send({})
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.factories).toHaveLength(2)
      expect(response.body.data.total).toBe(2)
    })

    it('should filter by searchTerm', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/factories/search')
        .send({ searchTerm: 'Another' })
        .expect(200)

      expect(response.body.data.factories).toHaveLength(1)
      expect(response.body.data.factories[0].name).toBe('Another Factory 2')
    })

    it('should filter by creator', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/factories/search')
        .send({ creator: TEST_WALLET_ADDRESS })
        .expect(200)

      expect(response.body.data.factories).toHaveLength(1)
      expect(response.body.data.factories[0].name).toBe('Test Factory 1')
    })
  })

  describe('GET /', () => {
    it('should return factories for the authenticated user', async () => {
      const response = await supertest(app).get('/api/v1/forge/factories/').expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.factories).toHaveLength(1)
      expect(response.body.data.factories[0].ownerAddress).toBe(TEST_WALLET_ADDRESS.toLowerCase())
    })
  })

  describe('GET /:id', () => {
    it('should return a factory by id', async () => {
      const factoryId = '60f8e4b4c3b3e4a3b1e8e4a1'
      const response = await supertest(app).get(`/api/v1/forge/factories/${factoryId}`).expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.name).toBe('Test Factory 1')
    })

    it('should return 404 for a non-existent factory id', async () => {
      const nonExistentId = '60f8e4b4c3b3e4a3b1e8e4a9'
      await supertest(app).get(`/api/v1/forge/factories/${nonExistentId}`).expect(404)
    })
  })

  describe('PUT /:id', () => {
    const factoryId = '60f8e4b4c3b3e4a3b1e8e4a1'

    it('should update the factory if user is owner', async () => {
      const response = await supertest(app)
        .put(`/api/v1/forge/factories/${factoryId}`)
        .send({ name: 'Updated Factory Name' })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.name).toBe('Updated Factory Name')
    })

    it('should return 403 if user is not owner', async () => {
      mockAuth.walletAddress = OTHER_WALLET_ADDRESS

      await supertest(app)
        .put(`/api/v1/forge/factories/${factoryId}`)
        .send({ name: 'Should Fail' })
        .expect(403)
    })

    it('should return 404 if factory does not exist', async () => {
      const nonExistentId = '60f8e4b4c3b3e4a3b1e8e4a9'
      await supertest(app)
        .put(`/api/v1/forge/factories/${nonExistentId}`)
        .send({ name: 'Should Fail' })
        .expect(404)
    })
  })

  describe('POST /pools', () => {
    it('should prepare a create pool transaction', async () => {
      mockFactoryService.prepareCreatePoolTransaction.mockResolvedValue({
        to: '0xFactoryContract',
        data: '0xcalldata'
      })

      const creator = TEST_WALLET_ADDRESS
      const token = 'USDC'

      const response = await supertest(app)
        .post('/api/v1/forge/factories/pools')
        .send({ token, creator })
        .expect(200)

      expect(mockFactoryService.prepareCreatePoolTransaction).toHaveBeenCalledWith(
        mockSupportedTokens.USDC.address,
        creator
      )
      expect(response.body.data.to).toBe('0xFactoryContract')
    })

    it('should return 403 if authenticated user does not match creator', async () => {
      await supertest(app)
        .post('/api/v1/forge/factories/pools')
        .send({ token: 'USDC', creator: OTHER_WALLET_ADDRESS })
        .expect(403)
    })
  })

  describe('POST /pools/predict-address', () => {
    it('should predict a pool address', async () => {
      mockFactoryService.predictPoolAddress.mockResolvedValue({
        predicted: '0xPredictedAddress',
        salt: '0xSalt'
      })

      const creator = TEST_WALLET_ADDRESS
      const token = 'WETH'

      const response = await supertest(app)
        .post('/api/v1/forge/factories/pools/predict-address')
        .send({ creator, token })
        .expect(200)

      expect(mockFactoryService.predictPoolAddress).toHaveBeenCalledWith(
        creator,
        mockSupportedTokens.WETH.address
      )
      expect(response.body.data.predicted).toBe('0xPredictedAddress')
    })
  })

  describe('GET /pools/:poolAddress', () => {
    it('should get pool info', async () => {
      const poolAddress = '0x1234567890123456789012345678901234567890' // Must be a valid address format
      mockFactoryService.getPoolInfo.mockResolvedValue({
        owner: TEST_WALLET_ADDRESS
      })

      const response = await supertest(app)
        .get(`/api/v1/forge/factories/pools/${poolAddress}`)
        .expect(200)

      expect(mockFactoryService.getPoolInfo).toHaveBeenCalledWith(poolAddress, undefined)
      expect(response.body.data.owner).toBe(TEST_WALLET_ADDRESS)
    })
  })

  describe('GET /:id/grading-results', () => {
    const factoryId = '60f8e4b4c3b3e4a3b1e8e4a1'

    beforeEach(async () => {
      await DemonstrationSubmission.create([
        {
          _id: 'sub1',
          address: '0x123',
          meta: { quest: { pool_id: factoryId } },
          status: 'completed',
          grade_result: {
            score: 80,
            confidence: 0.9,
            outcomeAchievement: 0.85,
            processQuality: 0.75,
            efficiency: 0.95
          },
          createdAt: new Date('2023-01-02T10:00:00.000Z')
        },
        {
          _id: 'sub2',
          address: '0x123',
          meta: { quest: { pool_id: factoryId } },
          status: 'completed',
          grade_result: {
            score: 90,
            confidence: 0.95,
            outcomeAchievement: 0.9,
            processQuality: 0.8,
            efficiency: 1.0
          },
          createdAt: new Date('2023-01-01T10:00:00.000Z')
        },
        {
          // another factory
          _id: 'sub3',
          address: '0x123',
          meta: { quest: { pool_id: '60f8e4b4c3b3e4a3b1e8e4a2' } },
          status: 'completed',
          grade_result: { score: 50 }
        },
        {
          // not completed status
          _id: 'sub4',
          address: '0x123',
          meta: { quest: { pool_id: factoryId } },
          status: 'pending',
          grade_result: { score: 100 }
        },
        {
          // completed but no grade
          _id: 'sub5',
          address: '0x123',
          meta: { quest: { pool_id: factoryId } },
          status: 'completed'
        }
      ])
    })

    it("should return a list of a factory's grading results, sorted by creation date", async () => {
      const response = await supertest(app)
        .get(`/api/v1/forge/factories/${factoryId}/grading-results`)
        .expect(200)

      expect(response.body.success).toBe(true)
      const results = response.body.data
      expect(results).toHaveLength(2)

      // Check sorting (most recent first)
      expect(results[0].submissionId).toBe('sub1')
      expect(results[1].submissionId).toBe('sub2')

      // Check structure of a result
      expect(results[0]).toEqual({
        submissionId: 'sub1',
        createdAt: '2023-01-02T10:00:00.000Z',
        score: 80,
        confidence: 0.9,
        outcomeAchievement: 0.85,
        processQuality: 0.75,
        efficiency: 0.95
      })
    })

    it('should return 404 if factory does not exist', async () => {
      const nonExistentId = '60f8e4b4c3b3e4a3b1e8e4a9'
      await supertest(app)
        .get(`/api/v1/forge/factories/${nonExistentId}/grading-results`)
        .expect(404)
    })

    it('should return an empty array if no completed submissions with grades are found', async () => {
      await DemonstrationSubmission.deleteMany({})
      const response = await supertest(app)
        .get(`/api/v1/forge/factories/${factoryId}/grading-results`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual([])
    })
  })
})
