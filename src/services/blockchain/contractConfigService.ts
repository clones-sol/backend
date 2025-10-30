import { ethers } from 'ethers'
import { logger } from "../logger.ts"
import RewardPoolImplementationABI from '../../contracts/abis/RewardPoolImplementation.json' with { type: 'json' }

interface ContractFeeConfig {
    feeBps: number
    feeDenominator: number
}

let cachedFeeConfig: ContractFeeConfig | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000

export async function getContractFeeConfig(poolAddress: string): Promise<ContractFeeConfig> {
    const now = Date.now()

    if (cachedFeeConfig && now - cacheTimestamp < CACHE_DURATION) {
        return cachedFeeConfig
    }

    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
        const poolContract = new ethers.Contract(
            poolAddress,
            RewardPoolImplementationABI,
            provider
        )

        const feeBps = await poolContract.FEE_BPS()

        cachedFeeConfig = {
            feeBps: Number(feeBps),
            feeDenominator: 10000
        }
        cacheTimestamp = now

        logger.info(`Fee config loaded from contract: ${cachedFeeConfig.feeBps} bps (${(cachedFeeConfig.feeBps / cachedFeeConfig.feeDenominator * 100).toFixed(1)}%)`)

        return cachedFeeConfig
    } catch (error) {
        logger.error('Failed to read fee config from contract:', error)
        throw new Error(
            `Failed to read platform fee from smart contract: ${error instanceof Error ? error.message : 'Unknown error'}. Cannot calculate reward amounts.`
        )
    }
}

export function calculateFeeAmounts(grossAmount: number, feeBps: number, feeDenominator: number) {
    // Convert to BigInt with 18 decimals of precision
    const PRECISION = 10n ** 18n
    const grossAmountBig = BigInt(Math.round(grossAmount * Number(PRECISION)))
    const feeBpsBig = BigInt(feeBps)
    const feeDenominatorBig = BigInt(feeDenominator)

    // Calculations in BigInt
    const feeAmountBig = (grossAmountBig * feeBpsBig) / feeDenominatorBig
    const netAmountBig = grossAmountBig - feeAmountBig

    // Conversion to number
    const feeAmount = Number(feeAmountBig) / Number(PRECISION)
    const netAmount = Number(netAmountBig) / Number(PRECISION)

    return {
        grossAmount: parseFloat(grossAmount.toFixed(18)),
        feeAmount: parseFloat(feeAmount.toFixed(18)),
        netAmount: parseFloat(netAmount.toFixed(18))
    }
}

