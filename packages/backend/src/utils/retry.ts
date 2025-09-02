import { logger } from './logger';

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  jitter: boolean;
  backoffMultiplier: number;
  retryableErrors?: (error: any) => boolean;
}

export interface RetryAttempt {
  attempt: number;
  error: any;
  delay: number;
  nextRetryAt: Date;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  attempts: RetryAttempt[];
  totalDuration: number;
  finalError?: any;
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
        logger.debug('Circuit breaker transitioning to half-open state');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      logger.warn(`Circuit breaker opened after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }

  getFailureCount(): number {
    return this.failures;
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
    logger.debug('Circuit breaker manually reset');
  }
}

/**
 * Advanced retry utility with exponential backoff, jitter, and circuit breaker pattern
 */
export class RetryHandler {
  private circuitBreakers = new Map<string, CircuitBreaker>();

  /**
   * Execute operation with retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    context?: string
  ): Promise<T> {
    const config: RetryOptions = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      jitter: true,
      backoffMultiplier: 2,
      retryableErrors: this.defaultRetryableErrorCheck,
      ...options,
    };

    const result = await this.executeWithMetrics(operation, config, context);
    
    if (!result.success) {
      throw result.finalError;
    }

    return result.result!;
  }

  /**
   * Execute with detailed metrics and attempt tracking
   */
  async executeWithMetrics<T>(
    operation: () => Promise<T>,
    options: RetryOptions,
    context?: string
  ): Promise<RetryResult<T>> {
    const startTime = Date.now();
    const attempts: RetryAttempt[] = [];
    let lastError: any;

    // Use circuit breaker if context is provided
    const circuitBreaker = context ? this.getCircuitBreaker(context) : null;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        const result = circuitBreaker 
          ? await circuitBreaker.execute(operation)
          : await operation();

        return {
          success: true,
          result,
          attempts,
          totalDuration: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error;
        const isRetryable = options.retryableErrors!(error);
        
        logger.debug(`Attempt ${attempt + 1} failed`, {
          error: error.message,
          isRetryable,
          context,
        });

        // If this is the last attempt or error is not retryable, don't retry
        if (attempt >= options.maxRetries || !isRetryable) {
          attempts.push({
            attempt: attempt + 1,
            error,
            delay: 0,
            nextRetryAt: new Date(),
          });
          break;
        }

        // Calculate delay for next retry
        const delay = this.calculateDelay(attempt + 1, options);
        const nextRetryAt = new Date(Date.now() + delay);

        attempts.push({
          attempt: attempt + 1,
          error,
          delay,
          nextRetryAt,
        });

        // Wait before next retry
        await this.sleep(delay);
      }
    }

    return {
      success: false,
      attempts,
      totalDuration: Date.now() - startTime,
      finalError: lastError,
    };
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateDelay(attempt: number, options: RetryOptions): number {
    let delay = Math.min(
      options.baseDelay * Math.pow(options.backoffMultiplier, attempt - 1),
      options.maxDelay
    );

    // Add jitter to prevent thundering herd
    if (options.jitter) {
      const jitterRange = delay * 0.1; // 10% jitter
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      delay = Math.max(0, delay + jitter);
    }

    return Math.round(delay);
  }

  /**
   * Default error classification for retryable errors
   */
  private defaultRetryableErrorCheck(error: any): boolean {
    // Network errors
    if (error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET') {
      return true;
    }

    // HTTP status codes that are typically retryable
    if (error.response?.status) {
      const status = error.response.status;
      
      // Server errors (5xx) are usually retryable
      if (status >= 500) {
        return true;
      }
      
      // Rate limiting
      if (status === 429) {
        return true;
      }
      
      // Specific client errors that might be temporary
      if (status === 408 || status === 409) { // Request timeout, conflict
        return true;
      }
    }

    // Gmail-specific retryable errors
    if (error.message?.includes('quota') || 
        error.message?.includes('rate limit') ||
        error.message?.includes('backendError') ||
        error.message?.includes('internalError')) {
      return true;
    }

    // Authentication errors are typically not retryable
    if (error.message?.includes('auth') || 
        error.message?.includes('unauthorized') ||
        error.message?.includes('forbidden')) {
      return false;
    }

    return false;
  }

  /**
   * Get or create circuit breaker for context
   */
  private getCircuitBreaker(context: string): CircuitBreaker {
    if (!this.circuitBreakers.has(context)) {
      this.circuitBreakers.set(context, new CircuitBreaker());
    }
    return this.circuitBreakers.get(context)!;
  }

  /**
   * Reset circuit breaker for context
   */
  resetCircuitBreaker(context: string): void {
    const breaker = this.circuitBreakers.get(context);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * Get circuit breaker state for context
   */
  getCircuitBreakerState(context: string): { state: string; failures: number } | null {
    const breaker = this.circuitBreakers.get(context);
    return breaker ? {
      state: breaker.getState(),
      failures: breaker.getFailureCount(),
    } : null;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all circuit breakers
   */
  clearCircuitBreakers(): void {
    this.circuitBreakers.clear();
  }
}

/**
 * Default retry configurations for different scenarios
 */
export const RetryConfigs = {
  // Fast retries for real-time operations
  realtime: {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 1000,
    jitter: true,
    backoffMultiplier: 2,
  },
  
  // Standard retries for API calls
  api: {
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 30000,
    jitter: true,
    backoffMultiplier: 2,
  },
  
  // Aggressive retries for background sync
  background: {
    maxRetries: 8,
    baseDelay: 2000,
    maxDelay: 300000, // 5 minutes
    jitter: true,
    backoffMultiplier: 1.8,
  },
  
  // Conservative retries for critical operations
  critical: {
    maxRetries: 10,
    baseDelay: 5000,
    maxDelay: 600000, // 10 minutes
    jitter: true,
    backoffMultiplier: 1.5,
  },
} as const;

// Export singleton instance
export const retryHandler = new RetryHandler();

// Export for testing and advanced usage
export { RetryHandler as RetryHandlerClass };