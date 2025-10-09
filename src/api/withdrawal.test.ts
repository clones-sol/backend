import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.ts'
import { withdrawalApi } from './withdrawal.ts'

// Mock setup with vi.hoisted
const {
    mockCreatorReputationModel,
    mockValidationService,
    mockMonitorService,
    mockCreateWithdrawalValidationService,
    mockGetWithdrawalMonitorService
} = vi.hoisted(() => {
    const mockValidationService = {
        getPoolState: vi.fn(),
        validateWithdrawal: vi.fn(),
        checkPoolHealth: vi.fn(),
        formatPoolStateForAPI: vi.fn(),
        provider: {
            getContract: vi.fn()
        }
    }

    const mockMonitorService = {
        getStatus: vi.fn()
    }

    const mockCreatorReputationModel = {
        findOne: vi.fn(),
        getTopCreators: vi.fn(),
        getFlaggedCreators: vi.fn()
    }

    const mockCreateWithdrawalValidationService = vi.fn().mockReturnValue(mockValidationService)
    const mockGetWithdrawalMonitorService = vi.fn().mockReturnValue(mockMonitorService)

    return {
        mockCreatorReputationModel,
        mockValidationService,
        mockMonitorService,
        mockCreateWithdrawalValidationService,
        mockGetWithdrawalMonitorService
    }
})

vi.mock('../models/Models.ts', () => ({
    CreatorReputationModel: mockCreatorReputationModel
}))

vi.mock('../services/blockchain/withdrawalValidationService.ts', () => ({
    createWithdrawalValidationService: mockCreateWithdrawalValidationService
}))

vi.mock('../services/blockchain/withdrawalMonitorService.ts', () => ({
    getWithdrawalMonitorService: mockGetWithdrawalMonitorService
}))

// Mock ethers
vi.mock('ethers', () => ({
    ethers: {
        Contract: vi.fn().mockImplementation(() => ({
            decimals: vi.fn().mockResolvedValue(18)
        })),
        parseUnits: vi.fn().mockImplementation((value, decimals) => {
            return BigInt(value) * BigInt(10 ** decimals)
        }),
        formatUnits: vi.fn().mockImplementation((value, decimals) => {
            const divisor = BigInt(10 ** decimals)
            return (Number(value) / Number(divisor)).toString()
        }),
        formatEther: vi.fn().mockImplementation((value) => {
            return (Number(value) / 1e18).toString()
        }),
        getAddress: vi.fn().mockImplementation((address) => address)
    },
    isAddress: vi.fn().mockImplementation((value) => {
        if (typeof value !== 'string') return false
        return /^0x[a-fA-F0-9]{40}$/.test(value)
    })
}))

// Mock requireWalletAddress middleware
vi.mock('../middleware/auth.ts', () => ({
    requireWalletAddress: (req: any, res: any, next: any) => {
        const walletAddress = req.headers['x-wallet-address']
        if (!walletAddress) {
            return res.status(401).json({ error: { message: 'Wallet address required', code: 'UNAUTHORIZED' } })
        }
        req.walletAddress = walletAddress
        next()
    }
}))

const app = express()
app.use(express.json())
app.use('/api/v1/withdrawal', withdrawalApi)
app.use(errorHandler)

describe('Withdrawal API', () => {
    const mockPoolAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const mockCreatorAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    const mockTokenAddress = '0xAbCdEf1234567890123456789012345678901234'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('POST /validate', () => {
        it('should validate a safe withdrawal', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: mockCreatorAddress,
                token: mockTokenAddress,
                balance: BigInt('1000000000000000000000'), // 1000 tokens
                totalPending: BigInt('400000000000000000000'), // 400 tokens
                totalAllocated: BigInt('500000000000000000000'),
                totalClaimed: BigInt('100000000000000000000'),
                allocations: [
                    {
                        poolAddress: mockPoolAddress,
                        farmerAddress: '0xfarmer1',
                        cumulativeAmount: BigInt('200000000000000000000'),
                        alreadyClaimed: BigInt('0'),
                        pendingAmount: BigInt('200000000000000000000'),
                        submissionId: 'sub1'
                    }
                ]
            }

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)
            mockValidationService.validateWithdrawal.mockResolvedValue({
                allowed: true,
                maxWithdrawable: BigInt('500000000000000000000'),
                safetyBuffer: BigInt('48400000000000000000'),
                poolState: mockPoolState
            })
            mockValidationService.formatPoolStateForAPI.mockReturnValue({
                address: mockPoolAddress,
                balance: '1000',
                totalPending: '400'
            })

            const response = await request(app)
                .post('/api/v1/withdrawal/validate')
                .set('x-wallet-address', mockCreatorAddress)
                .send({
                    poolAddress: mockPoolAddress,
                    amount: '100'
                })

            expect(response.status).toBe(200)
            expect(response.body.data.allowed).toBe(true)
            expect(response.body.data.maxSafeWithdrawal).toBeDefined()
            expect(mockValidationService.getPoolState).toHaveBeenCalledWith(mockPoolAddress)
        })

        it('should reject unsafe withdrawal', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: mockCreatorAddress,
                token: mockTokenAddress,
                balance: BigInt('500000000000000000000'), // 500 tokens
                totalPending: BigInt('450000000000000000000'), // 450 tokens pending
                totalAllocated: BigInt('500000000000000000000'),
                totalClaimed: BigInt('50000000000000000000'),
                allocations: []
            }

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)
            mockValidationService.validateWithdrawal.mockResolvedValue({
                allowed: false,
                reason: 'Insufficient balance for pending claims',
                maxWithdrawable: BigInt('0'),
                safetyBuffer: BigInt('49500000000000000000'),
                poolState: mockPoolState
            })
            mockValidationService.formatPoolStateForAPI.mockReturnValue({
                address: mockPoolAddress,
                balance: '500',
                totalPending: '450'
            })

            const response = await request(app)
                .post('/api/v1/withdrawal/validate')
                .set('x-wallet-address', mockCreatorAddress)
                .send({
                    poolAddress: mockPoolAddress,
                    amount: '200'
                })

            expect(response.status).toBe(200)
            expect(response.body.data.allowed).toBe(false)
            expect(response.body.data.reason).toBeDefined()
        })

        it('should reject validation when user is not creator', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: '0x3C44CdDdB6a900fa2b585dd299e03d12fa4293BC',
                token: mockTokenAddress,
                balance: BigInt('1000000000000000000000'),
                totalPending: BigInt('0'),
                totalAllocated: BigInt('0'),
                totalClaimed: BigInt('0'),
                allocations: []
            }

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)

            const response = await request(app)
                .post('/api/v1/withdrawal/validate')
                .set('x-wallet-address', mockCreatorAddress)
                .send({
                    poolAddress: mockPoolAddress,
                    amount: '100'
                })

            expect(response.status).toBe(403)
            expect(response.body.error.message).toContain('Only the pool creator')
        })

        it('should require poolAddress parameter', async () => {
            const response = await request(app)
                .post('/api/v1/withdrawal/validate')
                .set('x-wallet-address', mockCreatorAddress)
                .send({
                    amount: '100'
                })

            expect(response.status).toBe(400)
        })

        it('should require amount parameter', async () => {
            const response = await request(app)
                .post('/api/v1/withdrawal/validate')
                .set('x-wallet-address', mockCreatorAddress)
                .send({
                    poolAddress: mockPoolAddress
                })

            expect(response.status).toBe(400)
        })
    })

    describe('GET /pools/:poolAddress/health', () => {
        it('should return healthy pool status', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: mockCreatorAddress,
                token: mockTokenAddress,
                balance: BigInt('1000000000000000000000'),
                totalPending: BigInt('400000000000000000000'),
                allocations: []
            }

            mockValidationService.checkPoolHealth.mockResolvedValue({
                healthy: true,
                alerts: [],
                metrics: {
                    utilization: 40,
                    coverage: 2.27,
                    pendingClaimsCount: 5,
                    totalPendingWithFees: '440'
                }
            })

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)
            mockValidationService.formatPoolStateForAPI.mockReturnValue({
                address: mockPoolAddress,
                balance: '1000',
                totalPending: '400'
            })

            const response = await request(app)
                .get(`/api/v1/withdrawal/pools/${mockPoolAddress}/health`)

            expect(response.status).toBe(200)
            expect(response.body.data.healthy).toBe(true)
            expect(response.body.data.metrics).toBeDefined()
            expect(response.body.data.metrics.utilization).toBe(40)
        })

        it('should return unhealthy pool status with alerts', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: mockCreatorAddress,
                token: mockTokenAddress,
                balance: BigInt('500000000000000000000'),
                totalPending: BigInt('480000000000000000000'),
                allocations: []
            }

            mockValidationService.checkPoolHealth.mockResolvedValue({
                healthy: false,
                alerts: [
                    '⚠️ Low coverage ratio: 0.95x (should be >1.1x)',
                    '⚠️ High utilization: 96.0% (should be <80%)'
                ],
                metrics: {
                    utilization: 96,
                    coverage: 0.95,
                    pendingClaimsCount: 8,
                    totalPendingWithFees: '528'
                }
            })

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)
            mockValidationService.formatPoolStateForAPI.mockReturnValue({
                address: mockPoolAddress,
                balance: '500',
                totalPending: '480'
            })

            const response = await request(app)
                .get(`/api/v1/withdrawal/pools/${mockPoolAddress}/health`)

            expect(response.status).toBe(200)
            expect(response.body.data.healthy).toBe(false)
            expect(response.body.data.alerts.length).toBeGreaterThan(0)
        })

        it('should reject invalid pool address', async () => {
            const response = await request(app)
                .get('/api/v1/withdrawal/pools/0xinvalid/health')

            expect(response.status).toBe(400)
        })
    })

    describe('GET /pools/:poolAddress/max-withdrawal', () => {
        it('should return maximum safe withdrawal amount', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: mockCreatorAddress,
                token: mockTokenAddress,
                balance: BigInt('1000000000000000000000'), // 1000 tokens
                totalPending: BigInt('400000000000000000000'), // 400 tokens
                allocations: [{ pendingAmount: BigInt('400000000000000000000') }]
            }

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)
            mockValidationService.validateWithdrawal.mockResolvedValue({
                allowed: true,
                maxWithdrawable: BigInt('515600000000000000000'), // ~516 tokens
                safetyBuffer: BigInt('48400000000000000000'),
                poolState: mockPoolState
            })

            const response = await request(app)
                .get(`/api/v1/withdrawal/pools/${mockPoolAddress}/max-withdrawal`)
                .set('x-wallet-address', mockCreatorAddress)

            expect(response.status).toBe(200)
            expect(response.body.data.maxSafeWithdrawal).toBeDefined()
            expect(response.body.data.pendingClaims).toBeDefined()
            expect(response.body.data.pendingClaimsCount).toBe(1)
        })

        it('should reject when user is not creator', async () => {
            const mockPoolState = {
                address: mockPoolAddress,
                creator: '0x3C44CdDdB6a900fa2b585dd299e03d12fa4293BC',
                token: mockTokenAddress,
                balance: BigInt('1000000000000000000000'),
                totalPending: BigInt('0'),
                allocations: []
            }

            mockValidationService.getPoolState.mockResolvedValue(mockPoolState)

            const response = await request(app)
                .get(`/api/v1/withdrawal/pools/${mockPoolAddress}/max-withdrawal`)
                .set('x-wallet-address', mockCreatorAddress)

            expect(response.status).toBe(403)
        })

        it('should require authentication', async () => {
            const response = await request(app)
                .get(`/api/v1/withdrawal/pools/${mockPoolAddress}/max-withdrawal`)

            expect(response.status).toBe(401)
        })
    })
})

