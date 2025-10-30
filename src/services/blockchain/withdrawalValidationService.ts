import { ethers } from 'ethers'
import { DemonstrationSubmission } from '../../models/Models.ts'
import { ApiError } from '../../middleware/types/errors.ts'
import { tokenCache } from '../../utils/tokenCache.js'
import { getContractFeeConfig } from './contractConfigService.ts'
import { logger } from "../logger.ts"

/**
 * @title WithdrawalValidationService
 * @notice Validates creator withdrawals against pending claims to prevent insufficient pool balance
 * @dev Backend validation layer ensuring creators maintain adequate pool balance for allocated farmer rewards
 */

// ============================================================================
// Configuration Constants
// ============================================================================

const SAFETY_BUFFER_PERCENT = 10 // 10% buffer for fees and safety margin

// ============================================================================
// Types
// ============================================================================

export interface PoolAllocation {
    poolAddress: string
    farmerAddress: string
    cumulativeAmount: bigint
    alreadyClaimed: bigint
    pendingAmount: bigint
    submissionId: string
}

export interface PoolState {
    address: string
    creator: string
    token: string
    balance: bigint
    totalAllocated: bigint
    totalClaimed: bigint
    totalPending: bigint
    allocations: PoolAllocation[]
}

export interface WithdrawalValidation {
    allowed: boolean
    reason?: string
    maxWithdrawable: bigint
    safetyBuffer: bigint
    poolState: PoolState
}

export interface PoolHealthMetrics {
    healthy: boolean
    alerts: string[]
    metrics: {
        utilization: number // percentage of balance allocated to pending claims
        coverage: number // how many times balance covers pending claims (with fees)
        pendingClaimsCount: number
        totalPendingWithFees: string
    }
}

// ============================================================================
// Core Validation Service
// ============================================================================

export class WithdrawalValidationService {
    private provider: ethers.JsonRpcProvider

    constructor(rpcUrl: string) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl)
    }

    /**
     * Get the provider instance for external use
     * Provides access to the provider instance for external blockchain operations.
     */
    getProvider(): ethers.JsonRpcProvider {
        return this.provider
    }

    /**
     * Calculate total pending claims for a specific pool
     * Queries database for all completed demonstrations with claim authorizations
     * that haven't been fully claimed on-chain yet
     */
    async calculateTotalPending(poolAddress: string): Promise<bigint> {
        // Find all submissions with claim authorizations for this pool
        const submissions = await DemonstrationSubmission.find({
            'claimAuthorization.poolAddress': poolAddress.toLowerCase(),
            status: 'COMPLETED'
        }).lean()

        if (submissions.length === 0) {
            return 0n
        }

        // Get pool contract to check on-chain claimed amounts
        const poolContract = new ethers.Contract(
            poolAddress,
            [
                'function alreadyClaimed(address account) external view returns (uint256)',
                'function token() external view returns (address)'
            ],
            this.provider
        )

        const tokenAddress = await poolContract.token()
        const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider)

        // Group submissions by farmer address to get their cumulative amounts
        const farmerAllocations = new Map<string, bigint>()

        for (const submission of submissions) {
            const farmerAddress = submission.address.toLowerCase()
            const cumulativeAmount = BigInt(submission.claimAuthorization?.cumulativeAmount || '0')

            // Keep the highest cumulative amount for each farmer (most recent allocation)
            const current = farmerAllocations.get(farmerAddress) || 0n
            if (cumulativeAmount > current) {
                farmerAllocations.set(farmerAddress, cumulativeAmount)
            }
        }

        // Calculate pending for each farmer
        let totalPending = 0n

        for (const [farmerAddress, cumulativeAmount] of farmerAllocations) {
            try {
                const alreadyClaimed = await poolContract.alreadyClaimed(farmerAddress)
                const pending = cumulativeAmount - alreadyClaimed

                if (pending > 0n) {
                    totalPending += pending
                }
            } catch (error) {
                logger.error(
                    `Error fetching claimed amount for farmer ${farmerAddress} in pool ${poolAddress}:`,
                    error
                )
                // On error, assume the full cumulative amount is pending (safer)
                totalPending += cumulativeAmount
            }
        }

        return totalPending
    }

    /**
     * Get comprehensive pool state from both blockchain and database
     */
    async getPoolState(poolAddress: string): Promise<PoolState> {
        // Validate address format
        if (!ethers.isAddress(poolAddress)) {
            throw ApiError.badRequest(`Invalid pool address: ${poolAddress}`)
        }

        const poolContract = new ethers.Contract(
            poolAddress,
            [
                'function token() external view returns (address)',
                'function creator() external view returns (address)',
                'function globalAlreadyClaimed() external view returns (uint256)',
                'function alreadyClaimed(address) external view returns (uint256)'
            ],
            this.provider
        )

        // Check if contract exists
        const code = await this.provider.getCode(poolAddress)
        if (code === '0x') {
            throw ApiError.notFound(`No contract found at pool address: ${poolAddress}`)
        }

        // Fetch blockchain data
        const [token, creator, globalClaimed] = await Promise.all([
            poolContract.token(),
            poolContract.creator(),
            poolContract.globalAlreadyClaimed()
        ])

        // Get token balance
        const tokenContract = new ethers.Contract(
            token,
            ['function balanceOf(address) external view returns (uint256)'],
            this.provider
        )
        const balance = await tokenContract.balanceOf(poolAddress)

        // Get all allocations from database
        const submissions = await DemonstrationSubmission.find({
            'claimAuthorization.poolAddress': poolAddress.toLowerCase(),
            status: 'COMPLETED'
        }).lean()

        // Build farmer-specific allocations
        const farmerMap = new Map<string, PoolAllocation>()

        for (const submission of submissions) {
            const farmerAddress = submission.address.toLowerCase()
            const cumulativeAmount = BigInt(submission.claimAuthorization?.cumulativeAmount || '0')

            const existing = farmerMap.get(farmerAddress)

            // Keep the highest cumulative amount (most recent)
            if (!existing || cumulativeAmount > existing.cumulativeAmount) {
                const alreadyClaimed = await poolContract.alreadyClaimed(farmerAddress)
                const pendingAmount = cumulativeAmount - alreadyClaimed

                farmerMap.set(farmerAddress, {
                    poolAddress,
                    farmerAddress,
                    cumulativeAmount,
                    alreadyClaimed,
                    pendingAmount,
                    submissionId: submission._id
                })
            }
        }

        const allocations = Array.from(farmerMap.values())
        const totalPending = allocations.reduce((sum, a) => sum + a.pendingAmount, 0n)
        const totalAllocated = allocations.reduce((sum, a) => sum + a.cumulativeAmount, 0n)

        return {
            address: poolAddress,
            creator,
            token,
            balance,
            totalAllocated,
            totalClaimed: globalClaimed,
            totalPending,
            allocations
        }
    }

    /**
     * Validate if a creator can safely withdraw a specific amount
     * Returns validation result with max safe withdrawal amount
     */
    async validateWithdrawal(poolState: PoolState, withdrawAmount: bigint): Promise<WithdrawalValidation> {
        // Note: totalPending already contains GROSS amounts (including fees)
        // When farmers claim, the smart contract handles fee distribution:
        // - Pool pays: gross amount
        // - Farmer receives: net amount (gross - fee)
        // - Treasury receives: fee amount
        // So we don't need to add fees again - they're already in the gross amounts

        const reserveNeeded = poolState.totalPending  // Already includes fees (gross amounts)
        const safetyBuffer = (reserveNeeded * BigInt(SAFETY_BUFFER_PERCENT)) / 100n
        const totalReserveNeeded = reserveNeeded + safetyBuffer

        // Calculate maximum safe withdrawal
        const maxWithdrawable =
            poolState.balance > totalReserveNeeded ? poolState.balance - totalReserveNeeded : 0n

        // Check if withdrawal amount exceeds safe limit
        if (withdrawAmount > maxWithdrawable) {
            const maxEth = ethers.formatEther(maxWithdrawable)
            const requestedEth = ethers.formatEther(withdrawAmount)
            const pendingEth = ethers.formatEther(poolState.totalPending)

            return {
                allowed: false,
                reason: `Withdrawal of ${requestedEth} would leave insufficient funds for ${poolState.allocations.length} farmer(s) with ${pendingEth} pending claims. Maximum safe withdrawal: ${maxEth}`,
                maxWithdrawable,
                safetyBuffer,
                poolState
            }
        }

        // Check if pool balance is already below safe threshold
        if (poolState.balance < totalReserveNeeded) {
            const balanceEth = ethers.formatEther(poolState.balance)
            const neededEth = ethers.formatEther(totalReserveNeeded)

            return {
                allowed: false,
                reason: `Pool balance (${balanceEth}) is already below safe threshold (${neededEth}) for pending claims. Please fund the pool before withdrawing.`,
                maxWithdrawable: 0n,
                safetyBuffer,
                poolState
            }
        }

        return {
            allowed: true,
            maxWithdrawable,
            safetyBuffer,
            poolState
        }
    }

    /**
     * Check if pool balance is healthy before issuing a new claim allocation
     * Prevents new allocations if pool doesn't have enough balance
     */
    async validateNewAllocation(
        poolAddress: string,
        newAllocationAmount: bigint
    ): Promise<{ allowed: boolean; reason?: string; poolState?: PoolState }> {
        const poolState = await this.getPoolState(poolAddress)

        // Calculate what total pending would be after new allocation
        // Note: Both totalPending and newAllocationAmount are GROSS amounts (already include fees)
        const futureTotal = poolState.totalPending + newAllocationAmount

        if (poolState.balance < futureTotal) {
            const balanceEth = ethers.formatEther(poolState.balance)
            const neededEth = ethers.formatEther(futureTotal)
            const newAllocEth = ethers.formatEther(newAllocationAmount)

            return {
                allowed: false,
                reason: `Insufficient pool balance for new allocation of ${newAllocEth}. Current balance: ${balanceEth}, Would need: ${neededEth}`,
                poolState
            }
        }

        return { allowed: true, poolState }
    }

    /**
     * Check overall pool health and generate alerts
     */
    async checkPoolHealth(poolAddress: string): Promise<PoolHealthMetrics> {
        const poolState = await this.getPoolState(poolAddress)
        const alerts: string[] = []

        if (poolState.totalPending === 0n) {
            return {
                healthy: true,
                alerts: [],
                metrics: {
                    utilization: 0,
                    coverage: Infinity,
                    pendingClaimsCount: 0,
                    totalPendingWithFees: '0'
                }
            }
        }

        // Note: totalPending already contains GROSS amounts (fees included)
        const reserveNeeded = poolState.totalPending
        const coverage = Number((poolState.balance * 100n) / reserveNeeded) / 100
        const utilization = Number((poolState.totalPending * 10000n) / poolState.balance) / 100

        // Alert: Coverage below 110% (minimum safe threshold)
        if (coverage < 1.1) {
            alerts.push(`Low coverage ratio: ${coverage.toFixed(2)}x (should be >1.1x)`)
        }

        // Alert: Utilization above 80%
        if (utilization > 80) {
            alerts.push(`High utilization: ${utilization.toFixed(1)}% (should be <80%)`)
        }

        // Critical: Balance can't cover pending claims
        if (poolState.balance < reserveNeeded) {
            alerts.push(
                `🚨 CRITICAL: Pool balance insufficient to cover ${poolState.allocations.length} pending claim(s)!`
            )
        }

        // Warning: Many pending claims
        if (poolState.allocations.length > 50) {
            alerts.push(
                `⚠️ High number of pending claims: ${poolState.allocations.length} farmer(s) waiting`
            )
        }

        return {
            healthy: alerts.length === 0,
            alerts,
            metrics: {
                utilization,
                coverage,
                pendingClaimsCount: poolState.allocations.length,
                totalPendingWithFees: ethers.formatEther(reserveNeeded)
            }
        }
    }

    /**
     * Format pool state for API responses
     */
    formatPoolStateForAPI(poolState: PoolState) {
        return {
            address: poolState.address,
            creator: poolState.creator,
            token: poolState.token,
            balance: ethers.formatEther(poolState.balance),
            totalAllocated: ethers.formatEther(poolState.totalAllocated),
            totalClaimed: ethers.formatEther(poolState.totalClaimed),
            totalPending: ethers.formatEther(poolState.totalPending),
            allocationCount: poolState.allocations.length,
            allocations: poolState.allocations.map((a) => ({
                farmerAddress: a.farmerAddress,
                cumulativeAmount: ethers.formatEther(a.cumulativeAmount),
                alreadyClaimed: ethers.formatEther(a.alreadyClaimed),
                pendingAmount: ethers.formatEther(a.pendingAmount)
            }))
        }
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create withdrawal validation service instance
 */
export function createWithdrawalValidationService(): WithdrawalValidationService {
    const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org'
    return new WithdrawalValidationService(rpcUrl)
}

