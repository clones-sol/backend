import { ethers } from 'ethers'
import { tokenCache } from '../../utils/tokenCache.js'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)'
]

class BlockchainService {
  provider: ethers.JsonRpcProvider

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl)

    // Handle unhandled RPC connection errors in test environment
    if (process.env.NODE_ENV === 'test') {
      this.provider.on('error', (error) => {
        // Silently handle RPC errors in test environment to prevent unhandled rejections
        console.debug('RPC error suppressed in test environment:', error.message)
      })
    }
  }

  /** Fetch ETH price in USD from CoinGecko */
  static async getEthPriceInUSD(): Promise<number> {
    try {
      return await this.getTokenPriceUSD('ETH')
    } catch (e) {
      console.error('Error fetching ETH price:', e)
      return 3000 // fallback
    }
  }

  /** Fetch token price in USD from CoinGecko */
  static async getTokenPriceUSD(tokenSymbol: string): Promise<number> {
    const supportedTokens = ['ETH', 'WETH', 'USDC', 'CLONES']
    
    if (!supportedTokens.includes(tokenSymbol.toUpperCase())) {
      throw new Error(`Token ${tokenSymbol} is not supported for price fetching`)
    }

    try {
      const apiUrl = process.env.PRICE_USD_API_URL || 'http://localhost:8080'
      const headers: Record<string, string> = {}
      
      if (process.env.NODE_ENV === 'production' && process.env.PRICE_USD_API_KEY) {
        headers['X-API-Key'] = process.env.PRICE_USD_API_KEY
      }
      
      const r = await fetch(`${apiUrl}/price/${tokenSymbol.toUpperCase()}`, { headers })

      if (!r.ok) {
        throw new Error(`Price USD API returned status ${r.status}`)
      }

      const priceText = await r.text()
      const price = parseFloat(priceText)

      if (isNaN(price)) {
        throw new Error(`Invalid price format from Price USD API for ${tokenSymbol}`)
      }

      return price
    } catch (e) {
      if (e instanceof Error) {
        throw new Error(`Failed to fetch ${tokenSymbol} price: ${e.message}`)
      }
      throw new Error(`Failed to fetch ${tokenSymbol} price: Unknown error`)
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
