import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.ts'
import { transactionApi } from './transaction.ts'

// Mock setup with vi.hoisted
const {
  mockWalletConnectionModel,
  mockTransactionSessionModel,
  mockGetTokenContractAddress,
  mockFactoryService,
  mockCreateFactoryService
} = vi.hoisted(() => {
  const mockWalletConnectionModel = {
    findOne: vi.fn()
  }
  const mockTransactionSessionModel = vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue({})
  }))
  const mockGetTokenContractAddress = vi.fn()
  const mockFactoryService = {
    prepareCreateAndFundTransaction: vi.fn()
  }
  const mockCreateFactoryService = vi.fn()

  return {
    mockWalletConnectionModel,
    mockTransactionSessionModel,
    mockGetTokenContractAddress,
    mockFactoryService,
    mockCreateFactoryService
  }
})

vi.mock('../models/Models.ts', () => ({
  WalletConnectionModel: mockWalletConnectionModel,
  TransactionSessionModel: mockTransactionSessionModel
}))

vi.mock('../services/blockchain/tokens.ts', () => ({
  getTokenContractAddress: mockGetTokenContractAddress
}))

vi.mock('../services/blockchain/factoryTransactionService.ts', () => ({
  createFactoryService: mockCreateFactoryService
}))

vi.mock('../services/factory/factoryDatabaseService.ts', () => ({
  createFactoryWithApps: vi.fn()
}))

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: BigInt('1000000000') // 1 Gwei
      })
    })),
    parseUnits: vi.fn().mockReturnValue(BigInt('1000000000')),
    parseEther: vi.fn().mockImplementation((value) => {
      if (value === '-1') throw new Error('Invalid amount')
      return BigInt('1000000000000000000') // 1 ETH in wei
    }),
    formatEther: vi.fn().mockReturnValue('0.00028'),
    formatUnits: vi.fn().mockReturnValue('1.0')
  },
  isAddress: vi.fn().mockImplementation((addr) => {
    return typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42
  })
}))

const app = express()
app.use(express.json())
app.use('/api/v1/transaction', transactionApi)
app.use(errorHandler)

describe('Transaction API - createAndFundPool', () => {
  const mockSessionToken = 'test-session-token'
  const mockCreatorAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const mockTokenSymbol = 'TEST'
  const mockAmount = '100'

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mocks
    mockWalletConnectionModel.findOne.mockResolvedValue({
      token: mockSessionToken,
      address: mockCreatorAddress
    })

    mockGetTokenContractAddress.mockReturnValue('0x1234567890123456789012345678901234567890')

    mockFactoryService.prepareCreateAndFundTransaction.mockResolvedValue({
      contractAddress: '0xFactoryAddress',
      abi: [],
      functionName: 'createAndFundPool',
      args: ['0x1234567890123456789012345678901234567890', '100000000000000000000'],
      tokenInfo: {
        address: '0x1234567890123456789012345678901234567890',
        decimals: 18,
        amountWei: '100000000000000000000'
      },
      validations: {
        tokenAllowed: true,
        currentNonce: 0,
        sufficientBalance: true,
        sufficientAllowance: true,
        currentBalance: '1000000000000000000000',
        currentAllowance: '1000000000000000000000',
        requiredAmount: '100000000000000000000'
      }
    })

    mockCreateFactoryService.mockReturnValue(mockFactoryService)
  })

  it('should validate createAndFundPool transaction type', async () => {
    const response = await request(app).post('/api/v1/transaction/validate-tx').send({
      type: 'createAndFundPool',
      sessionToken: mockSessionToken,
      userAddress: mockCreatorAddress,
      creator: mockCreatorAddress,
      token: mockTokenSymbol,
      amount: mockAmount,
      timestamp: Date.now()
    })

    expect(response.status).toBe(200)
    expect(response.body.data.type).toBe('createAndFundPool')
    expect(response.body.data.valid).toBe(true)
  })

  it('should estimate gas for createAndFundPool', async () => {
    // Mock ethers provider for gas estimation
    vi.doMock('ethers', () => ({
      ethers: {
        JsonRpcProvider: vi.fn().mockImplementation(() => ({
          getFeeData: vi.fn().mockResolvedValue({
            gasPrice: BigInt('1000000000') // 1 Gwei
          })
        })),
        parseUnits: vi.fn().mockReturnValue(BigInt('1000000000')),
        formatEther: vi.fn().mockReturnValue('0.00028'),
        formatUnits: vi.fn().mockReturnValue('1.0')
      }
    }))

    const response = await request(app).post('/api/v1/transaction/estimate-gas').send({
      type: 'createAndFundPool',
      creator: mockCreatorAddress,
      token: mockTokenSymbol,
      amount: mockAmount
    })

    expect(response.status).toBe(200)
    expect(response.body.data.gasLimit).toBe('280000')
  })

  it('should prepare createAndFundPool transaction', async () => {
    const response = await request(app).post('/api/v1/transaction/prepare-tx').send({
      type: 'createAndFundPool',
      sessionToken: mockSessionToken,
      userAddress: mockCreatorAddress,
      creator: mockCreatorAddress,
      token: mockTokenSymbol,
      amount: mockAmount
    })

    expect(response.status).toBe(200)
    expect(response.body.data.functionName).toBe('createAndFundPool')
    expect(response.body.data.type).toBe('createAndFundPool')
  })

  it('should reject createAndFundPool without required fields', async () => {
    const response = await request(app).post('/api/v1/transaction/prepare-tx').send({
      type: 'createAndFundPool',
      sessionToken: mockSessionToken,
      userAddress: mockCreatorAddress,
      creator: mockCreatorAddress
      // Missing token and amount
    })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe(
      'Token, creator, and amount required for createAndFundPool'
    )
  })

  it('should reject createAndFundPool with invalid amount', async () => {
    const response = await request(app).post('/api/v1/transaction/validate-tx').send({
      type: 'createAndFundPool',
      sessionToken: mockSessionToken,
      userAddress: mockCreatorAddress,
      creator: mockCreatorAddress,
      token: mockTokenSymbol,
      amount: '-1',
      timestamp: Date.now()
    })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('Invalid amount: -1. Must be a positive number.')
  })
})
