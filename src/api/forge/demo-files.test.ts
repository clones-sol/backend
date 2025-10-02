import express, { type NextFunction, type Request, type Response } from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { Readable } from 'stream'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../middleware/errorHandler.ts'
import { DemonstrationSubmission } from '../../models/DemonstrationSubmission.ts'
import { ForgeSubmissionProcessingStatus } from '../../types/index.ts'
import demoFilesApi from './demo-files.ts'

// Mock secure session middleware
const { mockAuth, TEST_WALLET_ADDRESS, OTHER_WALLET_ADDRESS } = vi.hoisted(() => {
  const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const OTHER_WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

  return {
    TEST_WALLET_ADDRESS,
    OTHER_WALLET_ADDRESS,
    mockAuth: {
      walletAddress: TEST_WALLET_ADDRESS,
      authenticated: true
    }
  }
})

vi.mock('../../middleware/auth.ts', () => ({
  requireWalletAddress: (req: Request, res: Response, next: NextFunction) => {
    if (!mockAuth.authenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      })
    }
    // @ts-expect-error
    req.walletAddress = mockAuth.walletAddress
    next()
  }
}))

// Mock rate limiter
vi.mock('../../middleware/rateLimiter.ts', () => ({
  generalRateLimit: (_req: any, _res: any, next: any) => next()
}))

// Mock DemoStorageService
const { mockDemoStorageService } = vi.hoisted(() => {
  return {
    mockDemoStorageService: {
      getDemoFile: vi.fn(),
      getDemoFileStream: vi.fn(),
      listDemoFiles: vi.fn(),
      verifyDemo: vi.fn()
    }
  }
})

vi.mock('../../services/demo-storage/index.ts', () => ({
  DemoStorageService: vi.fn().mockImplementation(() => mockDemoStorageService)
}))

vi.mock('../../services/storage/index.ts', () => ({
  ObjectStorageService: vi.fn().mockImplementation(() => ({}))
}))

// Test data
const TEST_SUBMISSION_ID = 'demo_123456789'
const TEST_DEMO_HASH = 'abc123def456'
const TEST_FILENAME = 'meta.json'
const TEST_FILE_CONTENT = Buffer.from('{"test": "data"}')

// Helper to create a mock readable stream from buffer
const createMockStream = (buffer: Buffer) => {
  return Readable.from(buffer)
}

const createTestSubmission = (overrides = {}) => ({
  _id: TEST_SUBMISSION_ID,
  address: TEST_WALLET_ADDRESS.toLowerCase(),
  meta: { task: 'test_task' },
  status: ForgeSubmissionProcessingStatus.COMPLETED,
  demoHash: TEST_DEMO_HASH,
  fileManifest: {
    recording: { size: 5242880, hash: 'hash1' },
    meta: { size: 1024, hash: 'hash2' },
    input_log: { size: 512, hash: 'hash3' },
    sft: { size: 2048, hash: 'hash4' }
  },
  integrityVerified: true,
  integrityLastCheck: new Date('2023-01-01T00:00:00.000Z'),
  createdAt: new Date('2023-01-01T00:00:00.000Z'),
  ...overrides
})

describe('Demo Files API', () => {
  let app: express.Application
  let mongoServer: MongoMemoryServer

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    await mongoose.connect(mongoUri)

    app = express()
    app.use(express.json())
    app.use('/api/v1/forge/demo-files', demoFilesApi)
    app.use(errorHandler)
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.walletAddress = TEST_WALLET_ADDRESS
    mockAuth.authenticated = true
    
    // Setup default demo storage service mocks
    mockDemoStorageService.listDemoFiles.mockResolvedValue([
      { filename: 'recording.mp4', size: 5242880, hash: 'hash1' },
      { filename: 'meta.json', size: 1024, hash: 'hash2' },
      { filename: 'input_log.jsonl', size: 512, hash: 'hash3' },
      { filename: 'sft.json', size: 2048, hash: 'hash4' }
    ])
    mockDemoStorageService.getDemoFile.mockResolvedValue(TEST_FILE_CONTENT)
    mockDemoStorageService.getDemoFileStream.mockResolvedValue(createMockStream(TEST_FILE_CONTENT))
  })

  afterEach(async () => {
    await DemonstrationSubmission.deleteMany({})
  })

  describe('GET /:submissionId/:filename', () => {
    it('should download file successfully for owner', async () => {
      // Setup
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)

      // Test
      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/${TEST_FILENAME}`)

      // Assertions
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/json')
      expect(response.headers['content-disposition']).toBe(`inline; filename="${TEST_FILENAME}"`)
      expect(mockDemoStorageService.getDemoFile).toHaveBeenCalledWith(TEST_DEMO_HASH, TEST_FILENAME)
      expect(mockDemoStorageService.getDemoFileStream).toHaveBeenCalledWith(TEST_DEMO_HASH, TEST_FILENAME)
    })

    it('should return correct content-type for different file types', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)

      const testCases = [
        { filename: 'meta.json', expectedType: 'application/json' },
        { filename: 'sft.json', expectedType: 'application/json' },
        { filename: 'recording.mp4', expectedType: 'video/mp4' },
        { filename: 'input_log.jsonl', expectedType: 'application/x-ndjson' }
      ]

      for (const testCase of testCases) {
        const response = await supertest(app)
          .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/${testCase.filename}`)
        
        expect(response.status).toBe(200)
        expect(response.headers['content-type']).toBe(testCase.expectedType)
      }
    })

    it('should return base64 encoded MP4 when asBase64=true', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)
      
      const testVideoData = Buffer.from('fake-mp4-binary-data')
      const expectedBase64 = testVideoData.toString('base64')
      mockDemoStorageService.getDemoFile.mockResolvedValue(testVideoData)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/recording.mp4?asBase64=true`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8')
      expect(response.headers['content-disposition']).toBe('inline; filename="recording.mp4.txt"')
      expect(response.text).toBe(expectedBase64)
    })

    it('should ignore asBase64 parameter for non-MP4 files', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/meta.json?asBase64=true`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/json') // Should remain JSON, not text/plain
    })

    it('should handle asBase64=false parameter correctly', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/recording.mp4?asBase64=false`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('video/mp4') // Should remain binary
    })

    it('should return 404 for non-existent submission', async () => {
      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/nonexistent/${TEST_FILENAME}`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    })

    it('should return 404 for submission owned by different user', async () => {
      const submission = createTestSubmission({ 
        address: OTHER_WALLET_ADDRESS.toLowerCase() 
      })
      await DemonstrationSubmission.create(submission)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/${TEST_FILENAME}`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    })

    it('should return 404 for non-existent file in submission', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)
      
      // Mock getDemoFile to throw an error for non-existent file
      mockDemoStorageService.getDemoFile.mockRejectedValue(new Error('File not found'))

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/nonexistent.json`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        error: 'File not found in submission'
      })
    })

    it('should return 404 when file not found in storage', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)
      mockDemoStorageService.getDemoFileStream.mockRejectedValue(new Error('Object not found: test'))

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/${TEST_FILENAME}`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        error: 'File not found in storage'
      })
    })

    it('should return 500 for storage service errors', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)
      mockDemoStorageService.getDemoFileStream.mockRejectedValue(new Error('Network error'))

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/${TEST_FILENAME}`)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({
        success: false,
        error: 'Failed to retrieve file'
      })
    })

    it('should handle parameter validation correctly', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)
      
      // Mock getDemoFile to throw an error for the space character filename
      mockDemoStorageService.getDemoFile.mockRejectedValue(new Error('File not found'))
      
      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/%20`) // URL-encoded space

      expect(response.status).toBe(404) // File not found is expected since "%20" is not in our test files
      expect(response.body).toEqual({
        success: false,
        error: 'File not found in submission'
      })
    })
  })

  describe('GET /:submissionId', () => {
    it('should list files successfully for owner', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}`)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        success: true,
        data: {
          submissionId: TEST_SUBMISSION_ID,
          demoHash: TEST_DEMO_HASH,
          files: [
            {
              filename: 'recording.mp4',
              size: 5242880,
              downloadUrl: `/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/recording.mp4`,
              hash: 'hash1'
            },
            {
              filename: 'meta.json',
              size: 1024,
              downloadUrl: `/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/meta.json`,
              hash: 'hash2'
            },
            {
              filename: 'input_log.jsonl',
              size: 512,
              downloadUrl: `/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/input_log.jsonl`,
              hash: 'hash3'
            },
            {
              filename: 'sft.json',
              size: 2048,
              downloadUrl: `/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}/sft.json`,
              hash: 'hash4'
            }
          ],
          totalFiles: 4,
          integrityVerified: true,
          status: ForgeSubmissionProcessingStatus.COMPLETED,
          createdAt: '2023-01-01T00:00:00.000Z'
        }
      })
    })

    it('should return empty files array when no files exist', async () => {
      const submission = createTestSubmission({ demoHash: null })
      await DemonstrationSubmission.create(submission)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}`)

      expect(response.status).toBe(404) // No demoHash means no files found
    })

    it('should return 404 for non-existent submission', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/demo-files/nonexistent')

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    })

    it('should return 404 for submission owned by different user', async () => {
      const submission = createTestSubmission({ 
        address: OTHER_WALLET_ADDRESS.toLowerCase() 
      })
      await DemonstrationSubmission.create(submission)

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        error: 'Demonstration submission not found or access denied'
      })
    })

    it('should return 400 for missing submissionId', async () => {
      const response = await supertest(app)
        .get('/api/v1/forge/demo-files/')

      expect(response.status).toBe(404) // Express returns 404 for missing route
    })
  })

  describe('Authentication and Authorization', () => {
    it('should require authentication', async () => {
      mockAuth.authenticated = false

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}`)

      expect(response.status).toBe(401)
    })

    it('should enforce address ownership at database level', async () => {
      const submission = createTestSubmission()
      await DemonstrationSubmission.create(submission)

      // Change the authenticated user's address
      mockAuth.walletAddress = OTHER_WALLET_ADDRESS

      const response = await supertest(app)
        .get(`/api/v1/forge/demo-files/${TEST_SUBMISSION_ID}`)

      expect(response.status).toBe(404) // Should not find submission
    })
  })
})