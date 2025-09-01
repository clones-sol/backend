import { ethers } from 'ethers';
import { createFactoryService, ClaimData } from './factoryTransactionService.ts';
import { tokenCache } from '../../utils/tokenCache.js';
import BlockchainService from './index.ts';

/**
 * Constants for gas estimation and analysis.
 */
// Safety buffer for gas limit estimation to prevent out-of-gas errors.
const GAS_LIMIT_BUFFER = 1.2;

// Default token information, assuming USDC-like tokens.
const DEFAULT_TOKEN_DECIMALS = 6;
const DEFAULT_TOKEN_PRICE_USD = 1;

// Fee percentage applied to calculate net rewards.
const NET_REWARD_FEE_PERCENTAGE = 0.9;

// Thresholds for gas cost warnings as a percentage of the net reward.
const GAS_WARNING_THRESHOLD_PERCENTAGE = 10;
const VERY_HIGH_GAS_COST_THRESHOLD = 50;
const HIGH_GAS_COST_THRESHOLD = 25;
const MODERATE_GAS_COST_THRESHOLD = 10;

// Default maximum gas cost in USD for batch optimization.
const DEFAULT_MAX_GAS_COST_USD = 50;
const OPTIMIZATION_BATCH_SIZE = 10;

// Default and fallback gas price settings.
const DEFAULT_GAS_PRICE = ethers.parseUnits("2", "gwei");
const DEFAULT_PRIORITY_FEE_RATIO = 10n;
const FALLBACK_PRIORITY_FEE = ethers.parseUnits("0.5", "gwei");

// Gas price levels in Gwei for providing user advice.
const GAS_PRICE_LEVELS = {
    LOW: 0.5,
    MEDIUM: 1.0,
    HIGH: 2.0,
};

/**
 * @title GasEstimationService
 * @notice Service for estimating gas costs and implementing smart gas alerts
 * @dev Provides gas estimation with warnings when gas costs exceed net reward
 */

const CLAIM_ROUTER_ABI = [
    'function claimAll((address vault, address account, uint256 cumulativeAmount, bytes signature)[] calldata claims) external returns (uint256 successful, uint256 failed)',
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
            const gasPrice = feeData.gasPrice || DEFAULT_GAS_PRICE;
            return {
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: gasPrice / DEFAULT_PRIORITY_FEE_RATIO
            };
        } catch (error) {
            console.error('Failed to get gas price:', error);
            // Conservative fallback
            return {
                maxFeePerGas: DEFAULT_GAS_PRICE,
                maxPriorityFeePerGas: FALLBACK_PRIORITY_FEE
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

            // Add buffer for safety
            const safeGasLimit = BigInt(Math.floor(Number(gasLimit) * GAS_LIMIT_BUFFER));

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

            // Sophisticated fallback based on transaction complexity
            const batchCount = claims.length;
            let estimatedGas: bigint;

            if (batchCount === 1) {
                // Single claim: base cost + signature verification
                estimatedGas = 80000n; // More accurate for single claims
            } else if (batchCount <= 5) {
                // Small batch: linear scaling with reduced overhead
                estimatedGas = 60000n + (BigInt(batchCount) * 45000n);
            } else if (batchCount <= 20) {
                // Medium batch: sub-linear scaling due to shared overhead
                estimatedGas = 80000n + (BigInt(batchCount) * 35000n);
            } else {
                // Large batch: further efficiency gains
                estimatedGas = 120000n + (BigInt(batchCount) * 25000n);
            }

            // Apply safety buffer (20%)
            const safeGasLimit = BigInt(Math.floor(Number(estimatedGas) * GAS_LIMIT_BUFFER));

            const totalGasCost = safeGasLimit * gasPrice.maxFeePerGas;
            const totalGasCostEth = ethers.formatEther(totalGasCost);
            const ethPriceUsd = await BlockchainService.getEthPriceInUSD();
            const totalGasCostUsd = parseFloat(totalGasCostEth) * ethPriceUsd;

            console.log(`Fallback gas estimation: ${batchCount} claims = ${safeGasLimit.toString()} gas (${totalGasCostUsd.toFixed(2)} USD)`);

            return {
                gasLimit: safeGasLimit,
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
        tokenPriceUsd: number = DEFAULT_TOKEN_PRICE_USD
    ): Promise<ClaimGasAnalysis> {
        const gasEstimate = await this.estimateBatchClaimGas(claims, fromAddress);

        // Calculate total net reward by fetching actual token decimals
        let totalGrossReward = 0;

        for (const claim of claims) {
            // Get token contract from vault to fetch decimals
            const vault = new ethers.Contract(claim.vault, [
                'function token() external view returns (address)'
            ], this.provider);
            const tokenAddress = await vault.token();

            const metadata = await tokenCache.getTokenMetadata(tokenAddress, this.provider);
            const claimAmount = parseFloat(ethers.formatUnits(claim.cumulativeAmount, metadata.decimals));
            totalGrossReward += claimAmount;
        }
        // Approximate fee
        const totalNetReward = totalGrossReward * NET_REWARD_FEE_PERCENTAGE;
        // Display with up to 6 decimals for readability
        const netRewardStr = totalNetReward.toFixed(6);
        const netRewardUsd = totalNetReward * tokenPriceUsd;

        // Calculate gas cost as percentage of net reward
        const gasCostVsReward = netRewardUsd > 0 ? (gasEstimate.totalGasCostUsd / netRewardUsd) * 100 : Infinity;

        // Determine if we should warn (gas cost > 10% of net reward)
        const shouldWarn = gasCostVsReward > GAS_WARNING_THRESHOLD_PERCENTAGE;

        let recommendation: string;
        if (gasCostVsReward > VERY_HIGH_GAS_COST_THRESHOLD) {
            recommendation = "Gas cost is very high compared to reward. Consider waiting for lower gas prices or accumulating more rewards.";
        } else if (gasCostVsReward > HIGH_GAS_COST_THRESHOLD) {
            recommendation = "Gas cost is significant. You might want to wait for better gas conditions.";
        } else if (gasCostVsReward > MODERATE_GAS_COST_THRESHOLD) {
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
        maxGasCostUsd: number = DEFAULT_MAX_GAS_COST_USD
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
        const batchSize = Math.min(maxBatchSize, OPTIMIZATION_BATCH_SIZE);

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

        if (gasPriceGwei < GAS_PRICE_LEVELS.LOW) {
            gasPriceLevel = 'low';
            recommendation = "Gas prices are very low! Excellent time to claim rewards.";
        } else if (gasPriceGwei < GAS_PRICE_LEVELS.MEDIUM) {
            gasPriceLevel = 'medium';
            recommendation = "Gas prices are reasonable. Good time to claim if you have significant rewards.";
        } else if (gasPriceGwei < GAS_PRICE_LEVELS.HIGH) {
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