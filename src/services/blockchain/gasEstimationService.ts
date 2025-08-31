import { ethers } from 'ethers';
import { createFactoryService, ClaimData } from './factoryTransactionService.ts';
import BlockchainService from './index.ts';

/**
 * @title GasEstimationService
 * @notice Service for estimating gas costs and implementing smart gas alerts
 * @dev Provides gas estimation with warnings when gas costs exceed net reward
 */

const CLAIM_ROUTER_ABI = [
    'function claimAll((address vault, address account, uint256 cumulativeAmount, uint256 deadline, bytes signature)[] calldata claims) external returns (uint256 successful, uint256 failed)',
    'function maxBatchSize() external view returns (uint256)'
];

interface GasEstimate {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    totalGasCost: bigint;
    totalGasCostEth: string;
    totalGasCostUsd: number;
}

interface ClaimGasAnalysis {
    estimatedGas: GasEstimate;
    netReward: string;
    netRewardUsd: number;
    gasCostVsReward: number; // percentage
    shouldWarn: boolean;
    recommendation: string;
}

interface BatchOptimization {
    originalClaims: ClaimData[];
    optimizedBatches: ClaimData[][];
    totalGasSavings: string;
    savingsPercentage: number;
    recommendation: string;
}

class GasEstimationService {
    private provider: ethers.JsonRpcProvider;
    private claimRouterAddress: string;

    constructor(rpcUrl: string, claimRouterAddress: string) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.claimRouterAddress = claimRouterAddress;
    }

    /**
     * Get current gas price data from the network
     */
    async getGasPrice(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
        try {
            const feeData = await this.provider.getFeeData();

            if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
                return {
                    maxFeePerGas: feeData.maxFeePerGas,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
                };
            }

            // Fallback for networks without EIP-1559
            const gasPrice = feeData.gasPrice || ethers.parseUnits("2", "gwei");
            return {
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: gasPrice / 10n
            };
        } catch (error) {
            console.error('Failed to get gas price:', error);
            // Conservative fallback
            return {
                maxFeePerGas: ethers.parseUnits("2", "gwei"),
                maxPriorityFeePerGas: ethers.parseUnits("0.5", "gwei")
            };
        }
    }

    /**
     * Estimate gas for a batch claim operation
     */
    async estimateBatchClaimGas(claims: ClaimData[], fromAddress: string): Promise<GasEstimate> {
        const claimRouter = new ethers.Contract(this.claimRouterAddress, CLAIM_ROUTER_ABI, this.provider);
        const gasPrice = await this.getGasPrice();

        try {
            // Estimate gas for the batch claim
            const gasLimit = await claimRouter.claimAll.estimateGas(claims, { from: fromAddress });

            // Add 20% buffer for safety
            const safeGasLimit = (gasLimit * 120n) / 100n;

            const totalGasCost = safeGasLimit * gasPrice.maxFeePerGas;
            const totalGasCostEth = ethers.formatEther(totalGasCost);

            // Get ETH price for USD estimation
            const ethPriceUsd = await BlockchainService.getEthPriceInUSD();
            const totalGasCostUsd = parseFloat(totalGasCostEth) * ethPriceUsd;

            return {
                gasLimit: safeGasLimit,
                maxFeePerGas: gasPrice.maxFeePerGas,
                maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
                totalGasCost,
                totalGasCostEth,
                totalGasCostUsd
            };
        } catch (error) {
            console.error('Gas estimation failed:', error);

            // Fallback estimation based on claim count
            // Conservative estimate: 150k gas per claim + 50k base
            const estimatedGas = BigInt(150000 * claims.length + 50000);
            const totalGasCost = estimatedGas * gasPrice.maxFeePerGas;
            const totalGasCostEth = ethers.formatEther(totalGasCost);
            const ethPriceUsd = await BlockchainService.getEthPriceInUSD();
            const totalGasCostUsd = parseFloat(totalGasCostEth) * ethPriceUsd;

            return {
                gasLimit: estimatedGas,
                maxFeePerGas: gasPrice.maxFeePerGas,
                maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
                totalGasCost,
                totalGasCostEth,
                totalGasCostUsd
            };
        }
    }

    /**
     * Analyze gas cost vs net reward for a batch claim
     */
    async analyzeClaimGasCost(
        claims: ClaimData[],
        fromAddress: string,
        tokenPriceUsd: number = 1 // Default to $1 (for USDC)
    ): Promise<ClaimGasAnalysis> {
        const gasEstimate = await this.estimateBatchClaimGas(claims, fromAddress);

        // Calculate total net reward (approximate - doesn't account for already claimed)
        const totalGrossReward = claims.reduce((sum, claim) =>
            sum + parseFloat(ethers.formatUnits(claim.cumulativeAmount, 6)), 0); // Assuming 6 decimals (USDC)

        // Approximate 10% fee
        const totalNetReward = totalGrossReward * 0.9;
        const netRewardStr = totalNetReward.toFixed(6);
        const netRewardUsd = totalNetReward * tokenPriceUsd;

        // Calculate gas cost as percentage of net reward
        const gasCostVsReward = (gasEstimate.totalGasCostUsd / netRewardUsd) * 100;

        // Determine if we should warn (gas cost > 10% of net reward)
        const shouldWarn = gasCostVsReward > 10;

        let recommendation: string;
        if (gasCostVsReward > 50) {
            recommendation = "Gas cost is very high compared to reward. Consider waiting for lower gas prices or accumulating more rewards.";
        } else if (gasCostVsReward > 25) {
            recommendation = "Gas cost is significant. You might want to wait for better gas conditions.";
        } else if (gasCostVsReward > 10) {
            recommendation = "Gas cost is moderate. Consider if you want to wait for lower fees.";
        } else {
            recommendation = "Gas cost is reasonable relative to your reward.";
        }

        return {
            estimatedGas: gasEstimate,
            netReward: netRewardStr,
            netRewardUsd,
            gasCostVsReward,
            shouldWarn,
            recommendation
        };
    }

    /**
     * Optimize batch size for gas efficiency
     */
    async optimizeBatchSize(
        claims: ClaimData[],
        fromAddress: string,
        maxGasCostUsd: number = 50 // Maximum willing to spend on gas
    ): Promise<BatchOptimization> {
        const claimRouter = new ethers.Contract(this.claimRouterAddress, CLAIM_ROUTER_ABI, this.provider);
        const maxBatchSize = Number(await claimRouter.maxBatchSize());

        if (claims.length <= maxBatchSize) {
            // Single batch is possible
            const gasAnalysis = await this.analyzeClaimGasCost(claims, fromAddress);

            if (gasAnalysis.estimatedGas.totalGasCostUsd <= maxGasCostUsd) {
                return {
                    originalClaims: claims,
                    optimizedBatches: [claims],
                    totalGasSavings: "0",
                    savingsPercentage: 0,
                    recommendation: "Single batch is optimal and within gas budget."
                };
            }
        }

        // Need to split into multiple batches
        const optimizedBatches: ClaimData[][] = [];
        const batchSize = Math.min(maxBatchSize, 10); // Start with smaller batches for gas efficiency

        for (let i = 0; i < claims.length; i += batchSize) {
            const batch = claims.slice(i, i + batchSize);
            optimizedBatches.push(batch);
        }

        // Calculate gas costs for original vs optimized
        const originalGas = await this.estimateBatchClaimGas(claims, fromAddress);

        let totalOptimizedGas = 0n;
        for (const batch of optimizedBatches) {
            const batchGas = await this.estimateBatchClaimGas(batch, fromAddress);
            totalOptimizedGas += batchGas.totalGasCost;
        }

        const gasSavings = originalGas.totalGasCost - totalOptimizedGas;
        const gasSavingsEth = ethers.formatEther(gasSavings);
        const savingsPercentage = Number((gasSavings * 100n) / originalGas.totalGasCost);

        const recommendation = optimizedBatches.length > 1
            ? `Splitting into ${optimizedBatches.length} batches of ~${batchSize} claims each for better gas efficiency.`
            : "Single batch is optimal.";

        return {
            originalClaims: claims,
            optimizedBatches,
            totalGasSavings: gasSavingsEth,
            savingsPercentage,
            recommendation
        };
    }

    /**
     * Monitor gas prices and suggest optimal claiming times
     */
    async getGasOptimizationAdvice(): Promise<{
        currentGasPrice: string;
        gasPriceGwei: number;
        gasPriceLevel: 'low' | 'medium' | 'high' | 'very-high';
        recommendation: string;
        suggestedWaitTime?: string;
    }> {
        const gasPrice = await this.getGasPrice();
        const gasPriceGwei = Number(ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei'));

        let gasPriceLevel: 'low' | 'medium' | 'high' | 'very-high';
        let recommendation: string;
        let suggestedWaitTime: string | undefined;

        if (gasPriceGwei < 0.5) {
            gasPriceLevel = 'low';
            recommendation = "Gas prices are very low! Excellent time to claim rewards.";
        } else if (gasPriceGwei < 1.0) {
            gasPriceLevel = 'medium';
            recommendation = "Gas prices are reasonable. Good time to claim if you have significant rewards.";
        } else if (gasPriceGwei < 2.0) {
            gasPriceLevel = 'high';
            recommendation = "Gas prices are elevated. Consider waiting unless rewards are substantial.";
            suggestedWaitTime = "Consider checking again in a few hours.";
        } else {
            gasPriceLevel = 'very-high';
            recommendation = "Gas prices are very high! Strongly recommend waiting for better conditions.";
            suggestedWaitTime = "Check back during off-peak hours (typically late night/early morning UTC).";
        }

        return {
            currentGasPrice: ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei'),
            gasPriceGwei,
            gasPriceLevel,
            recommendation,
            suggestedWaitTime
        };
    }
}

// Factory function for different networks
export function createGasEstimationService(): GasEstimationService {
    const config = {
        rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
        claimRouterAddress: process.env.CLAIM_ROUTER_ADDRESS || ''
    };

    if (!config.claimRouterAddress) {
        throw new Error(`Missing CLAIM_ROUTER_ADDRESS environment variable`);
    }

    return new GasEstimationService(config.rpcUrl, config.claimRouterAddress);
}

export default GasEstimationService;
export { GasEstimationService };
export type { GasEstimate, ClaimGasAnalysis, BatchOptimization };