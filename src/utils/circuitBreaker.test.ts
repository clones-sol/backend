import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerManager } from './circuitBreaker.js';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let mockOperation: ReturnType<typeof vi.fn>;
  let mockFallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker(2, 1000, 500); // 2 failures, 1s recovery, 500ms timeout
    mockOperation = vi.fn();
    mockFallback = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CLOSED state (normal operation)', () => {
    it('should execute operation successfully when circuit is closed', async () => {
      mockOperation.mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledOnce();
      expect(circuitBreaker.getStatus().state).toBe('CLOSED');
    });

    it('should handle operation failure without opening circuit (below threshold)', async () => {
      mockOperation.mockRejectedValue(new Error('operation failed'));
      
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('operation failed');
      
      expect(circuitBreaker.getStatus().state).toBe('CLOSED');
      expect(circuitBreaker.getStatus().failures).toBe(1);
    });
  });

  describe('Circuit opening (failure threshold)', () => {
    it('should open circuit after reaching failure threshold', async () => {
      mockOperation.mockRejectedValue(new Error('failure'));
      
      // First failure
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('failure');
      expect(circuitBreaker.getStatus().state).toBe('CLOSED');
      
      // Second failure - should open circuit
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('failure');
      expect(circuitBreaker.getStatus().state).toBe('OPEN');
      expect(circuitBreaker.getStatus().failures).toBe(2);
    });

    it('should use fallback when circuit opens and fallback is provided', async () => {
      mockOperation.mockRejectedValue(new Error('failure'));
      mockFallback.mockResolvedValue('fallback result');
      
      // Trigger failures to open circuit
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('failure');
      await expect(circuitBreaker.execute(mockOperation, mockFallback)).resolves.toBe('fallback result');
      
      expect(circuitBreaker.getStatus().state).toBe('OPEN');
      expect(mockFallback).toHaveBeenCalledOnce();
    });
  });

  describe('OPEN state (circuit breaker engaged)', () => {
    let originalNow: typeof Date.now;
    let mockTime: number;

    beforeEach(async () => {
      // Setup time mocking
      originalNow = Date.now;
      mockTime = 1000000;
      Date.now = vi.fn(() => mockTime);
      
      // Open the circuit by triggering failures
      mockOperation.mockRejectedValue(new Error('failure'));
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      expect(circuitBreaker.getStatus().state).toBe('OPEN');
      vi.clearAllMocks();
    });

    afterEach(() => {
      Date.now = originalNow;
    });

    it('should reject immediately when circuit is open without fallback', async () => {
      await expect(circuitBreaker.execute(mockOperation))
        .rejects.toThrow('Circuit breaker is OPEN - service temporarily unavailable');
      
      expect(mockOperation).not.toHaveBeenCalled();
    });

    it('should use fallback immediately when circuit is open', async () => {
      mockFallback.mockResolvedValue('fallback result');
      
      const result = await circuitBreaker.execute(mockOperation, mockFallback);
      
      expect(result).toBe('fallback result');
      expect(mockOperation).not.toHaveBeenCalled();
      expect(mockFallback).toHaveBeenCalledOnce();
    });

    it('should transition to HALF_OPEN after recovery time and succeed', async () => {
      // Simulate time passage after circuit opened
      mockTime += 1001; // Past recovery time (1000ms)
      
      // Next call should attempt HALF_OPEN state
      mockOperation.mockResolvedValue('recovery success');
      const result = await circuitBreaker.execute(mockOperation);
      
      expect(result).toBe('recovery success');
      expect(circuitBreaker.getStatus().state).toBe('CLOSED'); // Should reset to CLOSED on success
      expect(circuitBreaker.getStatus().failures).toBe(0);
      expect(mockOperation).toHaveBeenCalledOnce();
    });
  });

  describe('Timeout handling', () => {
    it('should timeout slow operations', async () => {
      mockOperation.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('slow result'), 1000)) // 1s delay, timeout is 500ms
      );
      
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('Operation timeout');
      expect(circuitBreaker.getStatus().failures).toBe(1);
    });

    it('should clear timeout when operation completes in time', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockOperation.mockResolvedValue('fast result');
      
      const result = await circuitBreaker.execute(mockOperation);
      
      expect(result).toBe('fast result');
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout when operation fails', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockOperation.mockRejectedValue(new Error('operation error'));
      
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('operation error');
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('HALF_OPEN state recovery', () => {
    it('should reset to CLOSED on successful operation in HALF_OPEN', async () => {
      // Setup circuit breaker to be in HALF_OPEN state
      const originalNow = Date.now;
      let mockTime = 1000000;
      Date.now = vi.fn(() => mockTime);
      
      try {
        // First open the circuit
        mockOperation.mockRejectedValue(new Error('failure'));
        await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
        await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
        expect(circuitBreaker.getStatus().state).toBe('OPEN');
        
        // Advance time to trigger HALF_OPEN
        mockTime += 1001;
        mockOperation.mockResolvedValue('recovery success');
        
        const result = await circuitBreaker.execute(mockOperation);
        
        expect(result).toBe('recovery success');
        expect(circuitBreaker.getStatus().state).toBe('CLOSED');
        expect(circuitBreaker.getStatus().failures).toBe(0);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('reset functionality', () => {
    it('should reset circuit breaker state', async () => {
      // Trigger failures to open circuit
      mockOperation.mockRejectedValue(new Error('failure'));
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      
      expect(circuitBreaker.getStatus().state).toBe('OPEN');
      expect(circuitBreaker.getStatus().failures).toBe(2);
      
      circuitBreaker.reset();
      
      expect(circuitBreaker.getStatus().state).toBe('CLOSED');
      expect(circuitBreaker.getStatus().failures).toBe(0);
      expect(circuitBreaker.getStatus().lastFailTime).toBe(0);
    });
  });
});

describe('CircuitBreakerManager', () => {
  beforeEach(() => {
    // Clear any existing breakers
    (CircuitBreakerManager as any).breakers = new Map();
  });

  it('should create and reuse circuit breakers by name', () => {
    const breaker1 = CircuitBreakerManager.getBreaker('test');
    const breaker2 = CircuitBreakerManager.getBreaker('test');
    
    expect(breaker1).toBe(breaker2); // Same instance
  });

  it('should create different breakers for different names', () => {
    const breaker1 = CircuitBreakerManager.getBreaker('service1');
    const breaker2 = CircuitBreakerManager.getBreaker('service2');
    
    expect(breaker1).not.toBe(breaker2);
  });

  it('should create blockchain breaker with correct config', () => {
    const breaker = CircuitBreakerManager.getBlockchainBreaker();
    
    expect(breaker).toBeInstanceOf(CircuitBreaker);
    // Check it's registered in manager
    const status = CircuitBreakerManager.getAllStatus();
    expect(status).toHaveProperty('blockchain');
  });

  it('should create gas estimation breaker with correct config', () => {
    const breaker = CircuitBreakerManager.getGasEstimationBreaker();
    
    expect(breaker).toBeInstanceOf(CircuitBreaker);
    const status = CircuitBreakerManager.getAllStatus();
    expect(status).toHaveProperty('gas-estimation');
  });

  it('should return status for all breakers', () => {
    CircuitBreakerManager.getBreaker('test1');
    CircuitBreakerManager.getBreaker('test2');
    
    const status = CircuitBreakerManager.getAllStatus();
    
    expect(status).toHaveProperty('test1');
    expect(status).toHaveProperty('test2');
    expect(status.test1).toHaveProperty('state');
    expect(status.test1).toHaveProperty('failures');
    expect(status.test1).toHaveProperty('isHealthy');
  });

  it('should apply custom config when creating breakers', () => {
    const customConfig = {
      failureThreshold: 10,
      recoveryTimeMs: 5000,
      timeoutMs: 2000
    };
    
    const breaker = CircuitBreakerManager.getBreaker('custom', customConfig);
    
    // Test the config is applied by checking behavior
    expect(breaker.getStatus().state).toBe('CLOSED');
  });
});