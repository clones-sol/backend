/**
 * Circuit breaker pattern implementation to prevent cascade failures
 * Especially important for blockchain RPC calls and external service dependencies
 */
export class CircuitBreaker {
  private failures: number = 0
  private lastFailTime: number = 0
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeMs: number = 60000, // 1 minute
    private readonly timeoutMs: number = 10000 // 10 seconds
  ) {}

  /**
   * Execute a function with circuit breaker protection
   */
  private handleOpenState<T>(fallback?: () => Promise<T>): Promise<T | void> {
    if (Date.now() - this.lastFailTime > this.recoveryTimeMs) {
      this.state = 'HALF_OPEN'
      return Promise.resolve()
    }

    if (fallback) {
      return fallback()
    }

    throw new Error('Circuit breaker is OPEN - service temporarily unavailable')
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined

    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Operation timeout')), this.timeoutMs)
        })
      ])

      if (timeoutId) clearTimeout(timeoutId)
      return result
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      throw error
    }
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const openResult = await this.handleOpenState(fallback)
      if (openResult !== undefined) return openResult
    }

    try {
      const result = await this.executeWithTimeout(operation)

      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED'
        this.failures = 0
      }

      return result
    } catch (error) {
      this.failures++
      this.lastFailTime = Date.now()

      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN'
      }

      if (fallback && this.state === 'OPEN') {
        return await fallback()
      }

      throw error
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): {
    state: string
    failures: number
    lastFailTime: number
    isHealthy: boolean
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime,
      isHealthy: this.state === 'CLOSED'
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED'
    this.failures = 0
    this.lastFailTime = 0
  }
}

/**
 * Global circuit breakers for different services
 */
const breakers = new Map<string, CircuitBreaker>()

export function getBreaker(
  name: string,
  config?: {
    failureThreshold?: number
    recoveryTimeMs?: number
    timeoutMs?: number
  }
): CircuitBreaker {
  if (!breakers.has(name)) {
    breakers.set(
      name,
      new CircuitBreaker(config?.failureThreshold, config?.recoveryTimeMs, config?.timeoutMs)
    )
  }
  const breaker = breakers.get(name)
  if (!breaker) {
    throw new Error(`Circuit breaker '${name}' not found`)
  }
  return breaker
}

export function getBlockchainBreaker(): CircuitBreaker {
  return getBreaker('blockchain', {
    failureThreshold: 3,
    recoveryTimeMs: 30000, // 30 seconds
    timeoutMs: 15000 // 15 seconds for blockchain calls
  })
}

export function getGasEstimationBreaker(): CircuitBreaker {
  return getBreaker('gas-estimation', {
    failureThreshold: 5,
    recoveryTimeMs: 60000, // 1 minute
    timeoutMs: 10000 // 10 seconds
  })
}

export function getAllStatus(): Record<
  string,
  { state: string; failures: number; lastFailTime: number; isHealthy: boolean }
> {
  const status: Record<
    string,
    { state: string; failures: number; lastFailTime: number; isHealthy: boolean }
  > = {}
  for (const [name, breaker] of breakers) {
    status[name] = breaker.getStatus()
  }
  return status
}

// Backwards compatibility object
export const CircuitBreakerManager = {
  getBreaker,
  getBlockchainBreaker,
  getGasEstimationBreaker,
  getAllStatus
}
