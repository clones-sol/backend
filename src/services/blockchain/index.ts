import { ethers } from 'ethers'
import { tokenCache } from '../../utils/tokenCache.js'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
]

class BlockchainService {
  provider: ethers.JsonRpcProvider

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl)
  }

  /** Fetch ETH price in USD from CoinGecko */
  static async getEthPriceInUSD(): Promise<number> {
    const fallback = 3000
    try {
      const r = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
      )
      const data = await r.json()
      return data?.ethereum?.usd ?? fallback
    } catch (e) {
      console.error('Error fetching ETH price:', e)
      return fallback
    }
  }

  /** Get ERC-20 balance for an address (adjusted for decimals) */
  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<number> {
    try {
      const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider)
      const [raw, metadata] = await Promise.all([
        erc20.balanceOf(walletAddress),
        tokenCache.getTokenMetadata(tokenAddress, this.provider)
      ])

      return Number(ethers.formatUnits(raw, metadata.decimals))
    } catch (e) {
      console.error('Error getting token balance:', e)
      return 0
    }
  }

  /** Get EIP-1559 fee data (with safe fallbacks) */
  async getFeeData(): Promise<{
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
  }> {
    try {
      const fee = await this.provider.getFeeData()
      if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        return {
          maxFeePerGas: fee.maxFeePerGas,
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas
        }
      }
      if (fee.gasPrice) {
        return {
          maxFeePerGas: fee.gasPrice,
          maxPriorityFeePerGas: fee.gasPrice / 10n
        }
      }
    } catch (e) {
      console.error('Failed to fetch fee data:', e)
    }
    return {
      maxFeePerGas: ethers.parseUnits('2', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
    }
  }
}

export default BlockchainService
