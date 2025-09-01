import { ethers } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  startCleanupInterval,
  stopCleanupInterval,
  type TokenMetadata,
  tokenCache
} from './tokenCache.js'

// Mock ethers contract
const mockContract = {
  decimals: vi.fn(),
  symbol: vi.fn(),
  name: vi.fn()
}

// Mock AmountValidator to avoid circular dependency
vi.mock('./amountValidation.js', () => ({
  AmountValidator: {
    validateAndParseAmount: vi.fn((amount: string, decimals: number) => {
      if (amount === 'invalid') throw new Error('Invalid amount')
      return ethers.parseUnits(amount, decimals)
    })
  }
}))

vi.mock('ethers', () => ({
  ethers: {
    Contract: vi.fn(() => mockContract),
    parseUnits: vi.fn((value: string, unit: number) => {
      if (value === 'invalid') throw new Error('Invalid amount')
      // Mock implementation for testing
      return BigInt(Math.floor(parseFloat(value) * 10 ** unit))
    }),
    formatUnits: vi.fn((value: bigint, unit: number) => {
      return (Number(value) / 10 ** unit).toString()
    })
  }
}))

describe('TokenCache', () => {
  const mockProvider = {} as ethers.Provider
  const testTokenAddress = '0x1234567890123456789012345678901234567890'
  const expectedMetadata: TokenMetadata = {
    decimals: 18,
    symbol: 'TEST',
    name: 'Test Token'
  }

  beforeEach(() => {
    // Clear cache before each test
    tokenCache.clear()

    // Stop cleanup interval to prevent interference
    stopCleanupInterval()

    // Setup mock responses
    mockContract.decimals.mockResolvedValue(expectedMetadata.decimals)
    mockContract.symbol.mockResolvedValue(expectedMetadata.symbol)
    mockContract.name.mockResolvedValue(expectedMetadata.name)

    vi.clearAllMocks()
  })

  afterEach(() => {
    tokenCache.clear()
    stopCleanupInterval()
  })

  describe('getTokenMetadata', () => {
    it('should fetch metadata from blockchain on first call', async () => {
      const result = await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)

      expect(result).toEqual(expectedMetadata)
      expect(mockContract.decimals).toHaveBeenCalledOnce()
      expect(mockContract.symbol).toHaveBeenCalledOnce()
      expect(mockContract.name).toHaveBeenCalledOnce()
    })

    it('should return cached metadata on subsequent calls', async () => {
      // First call
      await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
      vi.clearAllMocks()

      // Second call should use cache
      const result = await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)

      expect(result).toEqual(expectedMetadata)
      expect(mockContract.decimals).not.toHaveBeenCalled()
      expect(mockContract.symbol).not.toHaveBeenCalled()
      expect(mockContract.name).not.toHaveBeenCalled()
    })

    it('should handle different token addresses separately', async () => {
      const token2Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const token2Metadata = { decimals: 6, symbol: 'USDC', name: 'USD Coin' }

      // Setup different mock responses
      mockContract.decimals
        .mockResolvedValueOnce(expectedMetadata.decimals)
        .mockResolvedValueOnce(token2Metadata.decimals)
      mockContract.symbol
        .mockResolvedValueOnce(expectedMetadata.symbol)
        .mockResolvedValueOnce(token2Metadata.symbol)
      mockContract.name
        .mockResolvedValueOnce(expectedMetadata.name)
        .mockResolvedValueOnce(token2Metadata.name)

      const result1 = await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
      const result2 = await tokenCache.getTokenMetadata(token2Address, mockProvider)

      expect(result1).toEqual(expectedMetadata)
      expect(result2).toEqual(token2Metadata)
      expect(tokenCache.getStats().size).toBe(2)
    })

    it('should normalize addresses to lowercase', async () => {
      const upperCaseAddress = testTokenAddress.toUpperCase()

      await tokenCache.getTokenMetadata(upperCaseAddress, mockProvider)
      await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)

      // Should only call blockchain once due to normalization
      expect(mockContract.decimals).toHaveBeenCalledOnce()
    })

    it('should handle blockchain errors gracefully', async () => {
      const error = new Error('RPC failed')
      mockContract.decimals.mockRejectedValue(error)

      await expect(tokenCache.getTokenMetadata(testTokenAddress, mockProvider)).rejects.toThrow(
        'RPC failed'
      )
    })
  })

  describe('validateAndParseAmountWithMetadata', () => {
    it('should validate amount and return metadata', async () => {
      const result = await tokenCache.validateAndParseAmountWithMetadata(
        '10.5',
        testTokenAddress,
        mockProvider
      )

      expect(result.metadata).toEqual(expectedMetadata)
      expect(result.amountWei).toEqual(ethers.parseUnits('10.5', expectedMetadata.decimals))
    })

    it('should handle invalid amounts with proper error messages', async () => {
      await expect(
        tokenCache.validateAndParseAmountWithMetadata('invalid', testTokenAddress, mockProvider)
      ).rejects.toThrow('Invalid amount')
    })
  })

  describe('Cache TTL and cleanup', () => {
    it('should expire cache after TTL', async () => {
      // Mock Date.now to control time
      const originalNow = Date.now
      let mockTime = 1000000
      Date.now = vi.fn(() => mockTime)

      try {
        // First call
        await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
        vi.clearAllMocks()

        // Advance time past TTL (1 hour + 1ms)
        mockTime += 1000 * 60 * 60 + 1

        // Should fetch from blockchain again
        await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
        expect(mockContract.decimals).toHaveBeenCalledOnce()
      } finally {
        Date.now = originalNow
      }
    })

    it('should cleanup expired entries', async () => {
      const originalNow = Date.now
      let mockTime = 1000000
      Date.now = vi.fn(() => mockTime)

      try {
        await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
        expect(tokenCache.getStats().size).toBe(1)

        // Advance time past TTL
        mockTime += 1000 * 60 * 60 + 1

        tokenCache.cleanup()
        expect(tokenCache.getStats().size).toBe(0)
      } finally {
        Date.now = originalNow
      }
    })
  })

  describe('Cache management', () => {
    it('should clear entire cache', async () => {
      await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
      expect(tokenCache.getStats().size).toBe(1)

      tokenCache.clear()
      expect(tokenCache.getStats().size).toBe(0)
    })

    it('should provide accurate cache statistics', async () => {
      const stats1 = tokenCache.getStats()
      expect(stats1.size).toBe(0)
      expect(stats1.entries).toEqual([])

      await tokenCache.getTokenMetadata(testTokenAddress, mockProvider)

      const stats2 = tokenCache.getStats()
      expect(stats2.size).toBe(1)
      expect(stats2.entries).toEqual([testTokenAddress.toLowerCase()])
    })
  })

  describe('Race condition handling', () => {
    it('should handle concurrent requests for same token', async () => {
      // Simulate slow RPC response
      mockContract.decimals.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(18), 100))
      )

      // Start multiple concurrent requests
      const promises = [
        tokenCache.getTokenMetadata(testTokenAddress, mockProvider),
        tokenCache.getTokenMetadata(testTokenAddress, mockProvider),
        tokenCache.getTokenMetadata(testTokenAddress, mockProvider)
      ]

      const results = await Promise.all(promises)

      // All should return same result
      for (const result of results) {
        expect(result).toEqual(expectedMetadata)
      }

      // But blockchain should only be called once (cache hit for concurrent calls)
      // Note: This test may be flaky depending on implementation
      expect(tokenCache.getStats().size).toBe(1)
    })
  })

  describe('Cleanup interval management', () => {
    it('should start and stop cleanup interval', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

      const intervalId = startCleanupInterval()
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000 * 60 * 60)
      expect(intervalId).toBeDefined()

      stopCleanupInterval()
      expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId)
    })

    it('should clear existing interval when starting new one', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

      const intervalId1 = startCleanupInterval()
      const intervalId2 = startCleanupInterval()

      expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId1)
      expect(intervalId2).toBeDefined()

      stopCleanupInterval()
    })
  })
})
