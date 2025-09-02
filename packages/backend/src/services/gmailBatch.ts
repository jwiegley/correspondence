import { gmail_v1 } from 'googleapis';
import { logger } from '../utils/logger';
import { redisService } from './redis';

interface BatchRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  uri: string;
  body?: any;
  priority: number;
  timestamp: number;
  userId: string;
  retries: number;
  maxRetries: number;
}

interface BatchResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
}

interface BatchResult {
  responses: BatchResponse[];
  totalRequests: number;
  successCount: number;
  errorCount: number;
  executionTime: number;
}

class GmailBatchProcessor {
  private requestQueue: Map<string, BatchRequest> = new Map();
  private processingQueue: Set<string> = new Set();
  private batchConfig = {
    maxBatchSize: 100, // Gmail API limit
    maxWaitTime: 2000, // 2 seconds max wait
    minBatchSize: 5, // Minimum requests before processing
    concurrentBatches: 3, // Max concurrent batch requests
    defaultRetries: 2
  };
  private activeBatches = 0;
  private batchTimer?: NodeJS.Timeout;

  constructor() {
    // Start the batch processor
    this.startBatchProcessor();
  }

  /**
   * Add a request to the batch queue
   */
  async addRequest(
    userId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    uri: string,
    body?: any,
    priority: number = 5,
    maxRetries: number = this.batchConfig.defaultRetries
  ): Promise<string> {
    const requestId = this.generateRequestId();
    
    const request: BatchRequest = {
      id: requestId,
      method,
      uri,
      body,
      priority,
      timestamp: Date.now(),
      userId,
      retries: 0,
      maxRetries
    };

    this.requestQueue.set(requestId, request);
    
    logger.debug(`Added batch request ${requestId} for user ${userId}: ${method} ${uri}`);
    
    // Process immediately if we have enough requests or a high priority request
    if (this.requestQueue.size >= this.batchConfig.minBatchSize || priority >= 9) {
      this.processBatch();
    }
    
    return requestId;
  }

  /**
   * Get the status of a batch request
   */
  async getRequestStatus(requestId: string): Promise<{ status: string; result?: any }> {
    // Check if request is still in queue
    if (this.requestQueue.has(requestId)) {
      return { status: 'queued' };
    }
    
    // Check if request is being processed
    if (this.processingQueue.has(requestId)) {
      return { status: 'processing' };
    }
    
    // Check cache for completed requests
    const cached = await redisService.getTemp(`batch_result:${requestId}`);
    if (cached) {
      try {
        const result = JSON.parse(cached);
        return { status: 'completed', result };
      } catch (error) {
        logger.warn(`Failed to parse batch result for ${requestId}:`, error);
      }
    }
    
    return { status: 'not_found' };
  }

  /**
   * Start the batch processor timer
   */
  private startBatchProcessor(): void {
    this.batchTimer = setInterval(() => {
      if (this.requestQueue.size > 0) {
        this.processBatch();
      }
    }, this.batchConfig.maxWaitTime);
  }

  /**
   * Process a batch of requests
   */
  private async processBatch(): Promise<void> {
    if (this.activeBatches >= this.batchConfig.concurrentBatches) {
      logger.debug('Maximum concurrent batches reached, delaying batch processing');
      return;
    }

    const requests = this.getBatchRequests();
    if (requests.length === 0) {
      return;
    }

    this.activeBatches++;
    const startTime = Date.now();
    
    try {
      // Move requests to processing queue
      requests.forEach(req => {
        this.requestQueue.delete(req.id);
        this.processingQueue.add(req.id);
      });

      logger.info(`Processing batch of ${requests.length} requests`);
      
      const result = await this.executeBatch(requests);
      await this.handleBatchResult(result, requests);
      
      const executionTime = Date.now() - startTime;
      logger.info(`Batch completed in ${executionTime}ms: ${result.successCount}/${result.totalRequests} successful`);
      
      // Record batch performance
      await redisService.storeTemp(
        `batch_stats:${Date.now()}`,
        JSON.stringify({
          totalRequests: result.totalRequests,
          successCount: result.successCount,
          executionTime,
          timestamp: Date.now()
        }),
        300 // 5 minutes TTL
      );
      
    } catch (error) {
      logger.error('Batch processing failed:', error);
      
      // Return failed requests to queue for retry
      requests.forEach(req => {
        this.processingQueue.delete(req.id);
        if (req.retries < req.maxRetries) {
          req.retries++;
          this.requestQueue.set(req.id, req);
        }
      });
      
    } finally {
      this.activeBatches--;
    }
  }

  /**
   * Get the next batch of requests to process
   */
  private getBatchRequests(): BatchRequest[] {
    const requests = Array.from(this.requestQueue.values());
    
    // Sort by priority (highest first) then by timestamp (oldest first)
    requests.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });
    
    // Take up to maxBatchSize requests
    return requests.slice(0, this.batchConfig.maxBatchSize);
  }

  /**
   * Execute a batch request using Gmail's batch API
   */
  private async executeBatch(requests: BatchRequest[]): Promise<BatchResult> {
    const responses: BatchResponse[] = [];
    const startTime = Date.now();
    
    try {
      // Group requests by user to handle auth properly
      const requestsByUser = this.groupRequestsByUser(requests);
      
      for (const [userId, userRequests] of requestsByUser.entries()) {
        const userResponses = await this.executeBatchForUser(userId, userRequests);
        responses.push(...userResponses);
      }
      
    } catch (error) {
      logger.error('Batch execution failed:', error);
      
      // Create error responses for all requests
      requests.forEach(req => {
        responses.push({
          id: req.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }
    
    const successCount = responses.filter(r => r.success).length;
    
    return {
      responses,
      totalRequests: requests.length,
      successCount,
      errorCount: responses.length - successCount,
      executionTime: Date.now() - startTime
    };
  }

  /**
   * Group requests by user ID for proper authentication handling
   */
  private groupRequestsByUser(requests: BatchRequest[]): Map<string, BatchRequest[]> {
    const grouped = new Map<string, BatchRequest[]>();
    
    requests.forEach(req => {
      if (!grouped.has(req.userId)) {
        grouped.set(req.userId, []);
      }
      grouped.get(req.userId)!.push(req);
    });
    
    return grouped;
  }

  /**
   * Execute batch for a specific user
   */
  private async executeBatchForUser(userId: string, requests: BatchRequest[]): Promise<BatchResponse[]> {
    // Note: Gmail API batch requests require proper multipart formatting
    // This is a simplified version - in production, you'd use the actual Gmail batch endpoint
    
    const responses: BatchResponse[] = [];
    
    // For now, execute requests individually with some concurrency
    // In a full implementation, you'd format these as proper batch requests
    const promises = requests.map(req => this.executeSingleRequest(userId, req));
    const results = await Promise.allSettled(promises);
    
    results.forEach((result, index) => {
      const request = requests[index];
      
      if (result.status === 'fulfilled') {
        responses.push({
          id: request.id,
          success: true,
          data: result.value,
          statusCode: 200
        });
      } else {
        responses.push({
          id: request.id,
          success: false,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
          statusCode: 500
        });
      }
    });
    
    return responses;
  }

  /**
   * Execute a single request (placeholder for actual Gmail API calls)
   */
  private async executeSingleRequest(userId: string, request: BatchRequest): Promise<any> {
    // This would be replaced with actual Gmail API calls
    // For now, return a simulated response
    
    await new Promise(resolve => setTimeout(resolve, 10)); // Simulate API delay
    
    // Simulate some failures for testing
    if (Math.random() < 0.05) { // 5% failure rate
      throw new Error('Simulated API error');
    }
    
    return {
      id: request.id,
      method: request.method,
      uri: request.uri,
      timestamp: Date.now()
    };
  }

  /**
   * Handle batch result by caching responses and cleaning up
   */
  private async handleBatchResult(result: BatchResult, requests: BatchRequest[]): Promise<void> {
    // Cache individual responses
    const cachePromises = result.responses.map(response => 
      redisService.storeTemp(
        `batch_result:${response.id}`,
        JSON.stringify(response),
        300 // 5 minutes TTL
      )
    );
    
    await Promise.all(cachePromises);
    
    // Remove from processing queue
    requests.forEach(req => {
      this.processingQueue.delete(req.id);
    });
    
    // Cache batch operation result
    await redisService.cacheBatchOperation(
      'system',
      'batch_execution',
      {
        totalRequests: result.totalRequests,
        successCount: result.successCount,
        errorCount: result.errorCount,
        executionTime: result.executionTime
      }
    );
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get batch processor statistics
   */
  getStats(): any {
    return {
      queuedRequests: this.requestQueue.size,
      processingRequests: this.processingQueue.size,
      activeBatches: this.activeBatches,
      config: this.batchConfig,
      timestamp: Date.now()
    };
  }

  /**
   * Shutdown the batch processor
   */
  shutdown(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    logger.info('Gmail batch processor shutdown complete');
  }

  /**
   * Update batch configuration
   */
  updateConfig(newConfig: Partial<typeof this.batchConfig>): void {
    this.batchConfig = { ...this.batchConfig, ...newConfig };
    logger.info('Updated batch processor configuration:', newConfig);
  }

  /**
   * Force process all queued requests immediately
   */
  async forceProcessAll(): Promise<void> {
    while (this.requestQueue.size > 0 && this.activeBatches < this.batchConfig.concurrentBatches) {
      await this.processBatch();
    }
  }

  /**
   * Clear all queued requests (emergency stop)
   */
  clearQueue(): number {
    const count = this.requestQueue.size;
    this.requestQueue.clear();
    logger.warn(`Cleared ${count} requests from batch queue`);
    return count;
  }

  /**
   * Get detailed queue information
   */
  getQueueInfo(): any {
    const requests = Array.from(this.requestQueue.values());
    const userCounts = new Map<string, number>();
    const priorityCounts = new Map<number, number>();
    let oldestRequest = Date.now();
    
    requests.forEach(req => {
      userCounts.set(req.userId, (userCounts.get(req.userId) || 0) + 1);
      priorityCounts.set(req.priority, (priorityCounts.get(req.priority) || 0) + 1);
      oldestRequest = Math.min(oldestRequest, req.timestamp);
    });
    
    return {
      totalRequests: requests.length,
      requestsByUser: Object.fromEntries(userCounts),
      requestsByPriority: Object.fromEntries(priorityCounts),
      oldestRequestAge: Date.now() - oldestRequest,
      averageWaitTime: requests.reduce((sum, req) => sum + (Date.now() - req.timestamp), 0) / requests.length || 0
    };
  }
}

// Export singleton instance
export const gmailBatchProcessor = new GmailBatchProcessor();

// Export utility functions for Gmail batch operations
export const gmailBatchUtils = {
  // High-level batch operations for common Gmail tasks
  batchMarkAsRead: async (userId: string, messageIds: string[]): Promise<string[]> => {
    const requestIds: string[] = [];
    
    for (const messageId of messageIds) {
      const requestId = await gmailBatchProcessor.addRequest(
        userId,
        'POST',
        `/gmail/v1/users/me/messages/${messageId}/modify`,
        { removeLabelIds: ['UNREAD'] },
        7 // High priority for user actions
      );
      requestIds.push(requestId);
    }
    
    return requestIds;
  },
  
  batchArchive: async (userId: string, messageIds: string[]): Promise<string[]> => {
    const requestIds: string[] = [];
    
    for (const messageId of messageIds) {
      const requestId = await gmailBatchProcessor.addRequest(
        userId,
        'POST',
        `/gmail/v1/users/me/messages/${messageId}/modify`,
        { removeLabelIds: ['INBOX'] },
        7 // High priority for user actions
      );
      requestIds.push(requestId);
    }
    
    return requestIds;
  },
  
  batchGetMessages: async (userId: string, messageIds: string[]): Promise<string[]> => {
    const requestIds: string[] = [];
    
    for (const messageId of messageIds) {
      const requestId = await gmailBatchProcessor.addRequest(
        userId,
        'GET',
        `/gmail/v1/users/me/messages/${messageId}`,
        undefined,
        5 // Normal priority for fetching
      );
      requestIds.push(requestId);
    }
    
    return requestIds;
  }
};

export default GmailBatchProcessor;