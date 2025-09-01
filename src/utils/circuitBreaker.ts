/**
 * Circuit breaker pattern implementation to prevent cascade failures
 * Especially important for blockchain RPC calls and external service dependencies
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeMs: number = 60000, // 1 minute
    private readonly timeoutMs: number = 10000 // 10 seconds
  ) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailTime > this.recoveryTimeMs) {
        this.state = 'HALF_OPEN';
      } else {
        if (fallback) {
          return await fallback();
        }
        throw new Error('Circuit breaker is OPEN - service temporarily unavailable');
      }
    }

    let timeoutId: NodeJS.Timeout | undefined;
    
    try {
      // Add timeout to operation with proper cleanup
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Operation timeout')), this.timeoutMs);
        })
      ]);

      // Clear timeout if operation completed first
      if (timeoutId) clearTimeout(timeoutId);

      // Success - reset if we were in HALF_OPEN
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      // Clear timeout on error as well
      if (timeoutId) clearTimeout(timeoutId);
      
      this.failures++;
      this.lastFailTime = Date.now();

      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
      }

      if (fallback && this.state === 'OPEN') {
        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): {
    state: string;
    failures: number;
    lastFailTime: number;
    isHealthy: boolean;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime,
      isHealthy: this.state === 'CLOSED'
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailTime = 0;
  }
}

/**
 * Global circuit breakers for different services
 */
export class CircuitBreakerManager {
  private static breakers = new Map<string, CircuitBreaker>();

  static getBreaker(name: string, config?: {
    failureThreshold?: number;
    recoveryTimeMs?: number;
    timeoutMs?: number;
  }): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(
        config?.failureThreshold,
        config?.recoveryTimeMs,
        config?.timeoutMs
      ));
    }
    return this.breakers.get(name)!;
  }

  static getBlockchainBreaker(): CircuitBreaker {
    return this.getBreaker('blockchain', {
      failureThreshold: 3,
      recoveryTimeMs: 30000, // 30 seconds
      timeoutMs: 15000 // 15 seconds for blockchain calls
    });
  }

  static getGasEstimationBreaker(): CircuitBreaker {
    return this.getBreaker('gas-estimation', {
      failureThreshold: 5,
      recoveryTimeMs: 60000, // 1 minute
      timeoutMs: 10000 // 10 seconds
    });
  }

  static getAllStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getStatus();
    }
    return status;
  }
}