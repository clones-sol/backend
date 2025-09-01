import { ethers } from 'ethers';

export interface TokenMetadata {
  decimals: number;
  symbol: string;
  name: string;
}

/**
 * Token metadata cache to reduce redundant RPC calls
 * Caches token decimals, symbol, and name for efficient validation
 */
class TokenCache {
  private cache = new Map<string, TokenMetadata>();
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour TTL
  private cacheTimestamps = new Map<string, number>();

  /**
   * Get token metadata with caching
   * @param tokenAddress - Token contract address
   * @param provider - Ethers provider for blockchain calls
   * @returns Promise<TokenMetadata>
   */
  async getTokenMetadata(tokenAddress: string, provider: ethers.Provider): Promise<TokenMetadata> {
    const key = tokenAddress.toLowerCase();
    const now = Date.now();
    
    // Check if cached and not expired
    const cachedTimestamp = this.cacheTimestamps.get(key);
    if (this.cache.has(key) && cachedTimestamp && (now - cachedTimestamp) < this.CACHE_TTL) {
      return this.cache.get(key)!;
    }

    // Fetch from blockchain
    const tokenContract = new ethers.Contract(tokenAddress, [
      'function decimals() external view returns (uint8)',
      'function symbol() external view returns (string)',
      'function name() external view returns (string)'
    ], provider);

    const [decimals, symbol, name] = await Promise.all([
      tokenContract.decimals(),
      tokenContract.symbol(),
      tokenContract.name()
    ]);

    const metadata: TokenMetadata = {
      decimals: Number(decimals),
      symbol,
      name
    };

    // Cache the result
    this.cache.set(key, metadata);
    this.cacheTimestamps.set(key, now);

    return metadata;
  }

  /**
   * Validate and parse amount with cached token metadata
   * @param amount - Amount as string
   * @param tokenAddress - Token contract address  
   * @param provider - Ethers provider
   * @returns Promise<{amountWei: bigint, metadata: TokenMetadata}>
   */
  async validateAndParseAmountWithMetadata(
    amount: string, 
    tokenAddress: string, 
    provider: ethers.Provider
  ): Promise<{amountWei: bigint, metadata: TokenMetadata}> {
    const metadata = await this.getTokenMetadata(tokenAddress, provider);
    
    // Inline validation to avoid circular dependency
    if (typeof amount !== 'string' || amount.trim() === '') {
      throw new Error('Amount must be a non-empty string');
    }

    const amountStr = amount.trim();
    
    if (amountStr.includes('e') || amountStr.includes('E')) {
      throw new Error(`Scientific notation not supported: ${amount}. Please use decimal format.`);
    }

    const numAmount = Number(amountStr);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive number.`);
    }

    const decimalPlaces = (amountStr.split('.')[1] || '').length;
    if (decimalPlaces > metadata.decimals) {
      throw new Error(`Too many decimal places. Maximum ${metadata.decimals} decimals allowed for ${metadata.symbol}.`);
    }

    const minAmount = 1 / Math.pow(10, metadata.decimals);
    if (numAmount < minAmount) {
      throw new Error(`Amount too small. Minimum amount is ${minAmount} ${metadata.symbol}`);
    }

    try {
      const amountWei = ethers.parseUnits(amountStr, metadata.decimals);
      return { amountWei, metadata };
    } catch (error) {
      throw new Error(`Failed to parse amount: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clear expired entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if ((now - timestamp) >= this.CACHE_TTL) {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
      }
    }
  }

  /**
   * Clear entire cache (useful for testing)
   */
  clear(): void {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Singleton instance
export const tokenCache = new TokenCache();

// Cleanup interval management
let cleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Start automatic cleanup (called once at module load)
 */
export function startCleanupInterval(): NodeJS.Timeout {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
  }
  
  cleanupIntervalId = setInterval(() => {
    tokenCache.cleanup();
  }, 1000 * 60 * 60); // 1 hour
  
  return cleanupIntervalId;
}

/**
 * Stop automatic cleanup (useful for testing or graceful shutdown)
 */
export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// Start cleanup automatically when module loads (production behavior)
if (process.env.NODE_ENV !== 'test') {
  startCleanupInterval();
}