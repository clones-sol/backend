import express, { type NextFunction, type Request, type Response } from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../middleware/errorHandler.ts'
import { FactoryModel } from '../../models/Factory.ts'
import { FactoryStatus } from '../../types/factory.ts'
import { forgeFactoryAppsApi } from './apps.ts'

// Mock auth middleware
const { mockAuth, TEST_WALLET_ADDRESS } = vi.hoisted(() => {
  const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  return {
    TEST_WALLET_ADDRESS,
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

// Mock OpenAI
const { mockOpenAI } = vi.hoisted(() => {
  return {
    mockOpenAI: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  name: 'Test Workflow',
                  tasks: [
                    {
                      task_name: 'Test Task',
                      prompt: 'Test task',
                      categories: ['test'],
                      apps_used: [
                        {
                          name: 'Test App',
                          domain: 'test.com',
                          description: 'Test application'
                        }
                      ]
                    }
                  ]
                })
              }
            }]
          })
        }
      }
    }
  }
})

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor() {
      return mockOpenAI
    }
  }
}))

// Mock DemonstrationSubmission for submission counting
vi.mock('../../models/Models.ts', async () => {
  const actual = await vi.importActual('../../models/Models.ts')
  return {
    ...actual,
    DemonstrationSubmission: {
      aggregate: vi.fn().mockResolvedValue([])
    }
  }
})

let app: express.Express
let mongoServer: MongoMemoryServer

describe('Forge Apps API', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    await mongoose.connect(mongoUri)

    app = express()
    app.use(express.json())
    app.use('/api/v1/forge/factories/apps', forgeFactoryAppsApi)
    app.use(errorHandler)
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
  })

  beforeEach(async () => {
    const testFactory = await FactoryModel.create({
      _id: 'factory_test',
      name: 'Test Factory',
      ownerAddress: TEST_WALLET_ADDRESS.toLowerCase(),
      poolAddress: '0xpooladdress',
      skills: ['test-skill'],
      status: FactoryStatus.active,
      tasks: [
        {
          id: 'task_1',
          task_name: 'Write Document',
          prompt: 'Write a document',
          categories: ['productivity'],
          apps_used: [
            {
              name: 'Google Docs',
              domain: 'docs.google.com',
              description: 'Online document editor'
            }
          ],
          uploadLimit: 10
        }
      ],
      token: {
        symbol: 'USDC',
        address: '0xusdc',
        decimals: 6,
        type: 'ERC20'
      }
    })
    mockAuth.walletAddress = TEST_WALLET_ADDRESS
  })

  afterEach(async () => {
    await FactoryModel.deleteMany({})
    vi.clearAllMocks()
  })

  describe('POST /workflows', () => {
    it('should generate new workflow tasks and add to factory', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/factories/apps/workflows')
        .send({
          prompt: 'Create productivity workflows',
          factoryId: 'factory_test'
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.content.name).toBe('Test Workflow')
      expect(response.body.data.content.tasks).toHaveLength(1)
      expect(response.body.data.content.tasks[0].prompt).toBe('Test task')

      // Verify task was added to factory
      const updatedFactory = await FactoryModel.findById('factory_test')
      expect(updatedFactory?.tasks).toHaveLength(2) // Original + new
    })

    it('should return generated workflow without adding to factory when no factoryId', async () => {
      const response = await supertest(app)
        .post('/api/v1/forge/factories/apps/workflows')
        .send({
          prompt: 'Create productivity workflows'
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.content.name).toBe('Test Workflow')
      
      // Verify task was NOT added to factory
      const factory = await FactoryModel.findById('factory_test')
      expect(factory?.tasks).toHaveLength(1) // Original only
    })
  })

  describe('GET /tasks', () => {
    it('should return all tasks from factories', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/factories/apps/tasks')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].prompt).toBe('Write a document')
      expect(response.body.data[0].categories).toEqual(['productivity'])
      expect(response.body.data[0].apps_used).toHaveLength(1)
    })

    it('should filter tasks by categories', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/factories/apps/tasks?categories=productivity')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
    })

    it('should filter tasks by query', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/factories/apps/tasks?query=document')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
    })
  })

  describe('GET /apps', () => {
    it('should return apps reconstructed from tasks', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/factories/apps/')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].name).toBe('Google Docs')
      expect(response.body.data[0].domain).toBe('docs.google.com')
      expect(response.body.data[0].tasks).toHaveLength(1)
    })
  })

  describe('PUT /:id/workflows', () => {
    it('should update factory workflow tasks', async () => {
      const newTasks = [
        {
          task_name: 'New Task',
          prompt: 'New task prompt',
          categories: ['new-category'],
          apps_used: [
            {
              name: 'New App',
              domain: 'newapp.com',
              description: 'A new application'
            }
          ],
          uploadLimit: 5
        }
      ]

      const response = await supertest(app)
        .put('/api/v1/forge/factories/apps/factory_test/workflows')
        .send({ tasks: newTasks })
        .expect(200)

      expect(response.body.success).toBe(true)
      
      // Verify factory was updated
      const updatedFactory = await FactoryModel.findById('factory_test')
      expect(updatedFactory?.tasks).toHaveLength(1)
      expect(updatedFactory?.tasks[0].prompt).toBe('New task prompt')
      expect(updatedFactory?.tasks[0].id).toBeTruthy() // Should have generated ID
    })

    it('should return 404 for non-existent factory', async () => {
      const validTasks = [
        {
          task_name: 'Test Task',
          prompt: 'Test task',
          categories: ['test'],
          apps_used: [
            {
              name: 'Test App',
              domain: 'test.com',
              description: 'Test application'
            }
          ]
        }
      ]

      await supertest(app)
        .put('/api/v1/forge/factories/apps/nonexistent/workflows')
        .send({ tasks: validTasks })
        .expect(404)
    })

    it('should return 403 for non-owner', async () => {
      mockAuth.walletAddress = '0xOtherAddress'

      const validTasks = [
        {
          task_name: 'Test Task',
          prompt: 'Test task',
          categories: ['test'],
          apps_used: [
            {
              name: 'Test App',
              domain: 'test.com',
              description: 'Test application'
            }
          ]
        }
      ]

      await supertest(app)
        .put('/api/v1/forge/factories/apps/factory_test/workflows')
        .send({ tasks: validTasks })
        .expect(403)
    })
  })

  describe('GET /categories', () => {
    it('should return unique categories from tasks', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/factories/apps/categories')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toContain('productivity')
    })
  })
})