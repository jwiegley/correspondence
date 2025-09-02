import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { retryHandler, RetryConfigs, RetryResult } from '../utils/retry';
import { gmailService } from './gmail';
import { redisService } from './redis';

export interface SyncConfig {
  pollInterval: number; // milliseconds
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  batchSize: number;
}

export interface SyncState {
  userId: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'stopped';
  lastSync: Date | null;
  nextSync: Date | null;
  historyId: string | null;
  errorCount: number;
  consecutiveErrors: number;
}

export interface SyncMetrics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  lastSyncDuration: number;
  averageSyncDuration: number;
  messagesProcessed: number;
}

export interface SyncEvent {
  type: 'sync:started' | 'sync:completed' | 'sync:failed' | 'sync:paused' | 'sync:resumed' | 'sync:stopped' | 'messages:changed';
  userId: string;
  data?: any;
  timestamp: Date;
}

/**
 * SyncService manages Gmail synchronization lifecycle for users
 * Provides start, stop, pause, resume capabilities with proper error handling
 */
export class SyncService extends EventEmitter {
  private syncTimers = new Map<string, NodeJS.Timeout>();
  private syncStates = new Map<string, SyncState>();
  private syncMetrics = new Map<string, SyncMetrics>();
  private isShuttingDown = false;
  
  private readonly config: SyncConfig = {
    pollInterval: 30000, // 30 seconds
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    maxDelay: 60000, // 1 minute
    batchSize: 100,
  };

  constructor() {
    super();
    this.setupGracefulShutdown();
  }

  /**
   * Initialize sync for a user
   */
  async initializeSync(userId: string, config?: Partial<SyncConfig>): Promise<void> {
    if (!userId) {
      throw new Error('User ID is required');
    }

    logger.info(`Initializing sync for user ${userId}`);

    // Merge config with defaults
    const userConfig = { ...this.config, ...config };

    // Initialize sync state
    const syncState: SyncState = {
      userId,
      status: 'idle',
      lastSync: null,
      nextSync: null,
      historyId: null,
      errorCount: 0,
      consecutiveErrors: 0,
    };

    // Initialize metrics
    const metrics: SyncMetrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncDuration: 0,
      averageSyncDuration: 0,
      messagesProcessed: 0,
    };

    // Load existing state from Redis if available
    await this.loadSyncState(userId, syncState);
    await this.loadSyncMetrics(userId, metrics);

    this.syncStates.set(userId, syncState);
    this.syncMetrics.set(userId, metrics);

    logger.debug(`Sync initialized for user ${userId}`, {
      status: syncState.status,
      lastSync: syncState.lastSync,
      historyId: syncState.historyId,
    });
  }

  /**
   * Start sync for a user
   */
  async startSync(userId: string): Promise<void> {
    const syncState = this.syncStates.get(userId);
    if (!syncState) {
      throw new Error(`Sync not initialized for user ${userId}`);
    }

    if (syncState.status === 'running') {
      logger.warn(`Sync already running for user ${userId}`);
      return;
    }

    if (this.isShuttingDown) {
      logger.warn(`Cannot start sync during shutdown for user ${userId}`);
      return;
    }

    logger.info(`Starting sync for user ${userId}`);

    syncState.status = 'running';
    syncState.errorCount = 0;
    syncState.consecutiveErrors = 0;

    await this.persistSyncState(userId, syncState);

    // Emit sync started event
    this.emit('sync:started', {
      type: 'sync:started',
      userId,
      timestamp: new Date(),
    } as SyncEvent);

    // Start the sync loop
    await this.scheduleNextSync(userId);
  }

  /**
   * Stop sync for a user
   */
  async stopSync(userId: string): Promise<void> {
    const syncState = this.syncStates.get(userId);
    if (!syncState) {
      logger.warn(`No sync state found for user ${userId}`);
      return;
    }

    logger.info(`Stopping sync for user ${userId}`);

    // Clear timer
    const timer = this.syncTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.syncTimers.delete(userId);
    }

    syncState.status = 'stopped';
    syncState.nextSync = null;

    await this.persistSyncState(userId, syncState);

    // Emit sync stopped event
    this.emit('sync:stopped', {
      type: 'sync:stopped',
      userId,
      timestamp: new Date(),
    } as SyncEvent);

    logger.debug(`Sync stopped for user ${userId}`);
  }

  /**
   * Pause sync for a user
   */
  async pauseSync(userId: string): Promise<void> {
    const syncState = this.syncStates.get(userId);
    if (!syncState) {
      throw new Error(`Sync not initialized for user ${userId}`);
    }

    if (syncState.status !== 'running') {
      logger.warn(`Cannot pause sync that is not running for user ${userId}`);
      return;
    }

    logger.info(`Pausing sync for user ${userId}`);

    // Clear timer
    const timer = this.syncTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.syncTimers.delete(userId);
    }

    syncState.status = 'paused';
    syncState.nextSync = null;

    await this.persistSyncState(userId, syncState);

    // Emit sync paused event
    this.emit('sync:paused', {
      type: 'sync:paused',
      userId,
      timestamp: new Date(),
    } as SyncEvent);

    logger.debug(`Sync paused for user ${userId}`);
  }

  /**
   * Resume sync for a user
   */
  async resumeSync(userId: string): Promise<void> {
    const syncState = this.syncStates.get(userId);
    if (!syncState) {
      throw new Error(`Sync not initialized for user ${userId}`);
    }

    if (syncState.status !== 'paused') {
      logger.warn(`Cannot resume sync that is not paused for user ${userId}`);
      return;
    }

    if (this.isShuttingDown) {
      logger.warn(`Cannot resume sync during shutdown for user ${userId}`);
      return;
    }

    logger.info(`Resuming sync for user ${userId}`);

    syncState.status = 'running';
    syncState.consecutiveErrors = 0;

    await this.persistSyncState(userId, syncState);

    // Emit sync resumed event
    this.emit('sync:resumed', {
      type: 'sync:resumed',
      userId,
      timestamp: new Date(),
    } as SyncEvent);

    // Schedule next sync
    await this.scheduleNextSync(userId);
  }

  /**
   * Get sync state for a user
   */
  getSyncState(userId: string): SyncState | null {
    return this.syncStates.get(userId) || null;
  }

  /**
   * Get sync metrics for a user
   */
  getSyncMetrics(userId: string): SyncMetrics | null {
    return this.syncMetrics.get(userId) || null;
  }

  /**
   * Get retry and circuit breaker information for a user
   */
  getRetryInfo(userId: string): {
    circuitBreaker: { state: string; failures: number } | null;
    syncState: SyncState | null;
  } {
    return {
      circuitBreaker: retryHandler.getCircuitBreakerState(`sync:${userId}`),
      syncState: this.getSyncState(userId),
    };
  }

  /**
   * Reset circuit breaker for a user (useful for manual recovery)
   */
  resetCircuitBreaker(userId: string): void {
    retryHandler.resetCircuitBreaker(`sync:${userId}`);
    logger.info(`Circuit breaker reset for user ${userId}`);
  }

  /**
   * Get all active sync users
   */
  getActiveSyncUsers(): string[] {
    return Array.from(this.syncStates.keys()).filter(userId => {
      const state = this.syncStates.get(userId);
      return state && (state.status === 'running' || state.status === 'paused');
    });
  }

  /**
   * Cleanup resources for a user
   */
  async cleanup(userId: string): Promise<void> {
    logger.info(`Cleaning up sync resources for user ${userId}`);

    // Stop sync first
    await this.stopSync(userId);

    // Remove from memory
    this.syncStates.delete(userId);
    this.syncMetrics.delete(userId);

    // Clear Redis data
    await this.clearSyncData(userId);

    logger.debug(`Cleanup completed for user ${userId}`);
  }

  /**
   * Shutdown all sync operations
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down SyncService');
    this.isShuttingDown = true;

    const activeUsers = this.getActiveSyncUsers();
    logger.info(`Stopping sync for ${activeUsers.length} active users`);

    // Stop all sync operations
    await Promise.all(activeUsers.map(userId => this.stopSync(userId)));

    // Clear all timers
    for (const timer of this.syncTimers.values()) {
      clearTimeout(timer);
    }
    this.syncTimers.clear();

    // Clear all state
    this.syncStates.clear();
    this.syncMetrics.clear();

    logger.info('SyncService shutdown complete');
  }

  /**
   * Schedule next sync for a user
   */
  private async scheduleNextSync(userId: string): Promise<void> {
    const syncState = this.syncStates.get(userId);
    if (!syncState || syncState.status !== 'running' || this.isShuttingDown) {
      return;
    }

    // Calculate delay based on consecutive errors (exponential backoff)
    let delay = this.config.pollInterval;
    if (syncState.consecutiveErrors > 0) {
      delay = Math.min(
        this.config.baseDelay * Math.pow(2, syncState.consecutiveErrors - 1),
        this.config.maxDelay
      );
    }

    syncState.nextSync = new Date(Date.now() + delay);
    await this.persistSyncState(userId, syncState);

    // Clear existing timer
    const existingTimer = this.syncTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule next sync
    const timer = setTimeout(async () => {
      try {
        await this.performSync(userId);
      } catch (error) {
        logger.error(`Error in scheduled sync for user ${userId}:`, error);
      }
    }, delay);

    this.syncTimers.set(userId, timer);

    logger.debug(`Next sync scheduled for user ${userId} in ${delay}ms`);
  }

  /**
   * Perform sync operation using Gmail History API with advanced retry logic
   */
  private async performSync(userId: string): Promise<void> {
    const syncState = this.syncStates.get(userId);
    const metrics = this.syncMetrics.get(userId);
    
    if (!syncState || !metrics) {
      logger.error(`Sync state or metrics not found for user ${userId}`);
      return;
    }

    if (syncState.status !== 'running' || this.isShuttingDown) {
      logger.debug(`Skipping sync for user ${userId} - not in running state or shutting down`);
      return;
    }

    const startTime = Date.now();
    
    // Emit sync started event
    this.emit('sync:started', {
      type: 'sync:started',
      userId,
      timestamp: new Date(),
    } as SyncEvent);

    // Execute sync with retry logic
    const retryResult = await retryHandler.executeWithMetrics(
      () => this.performSyncOperation(userId),
      {
        ...RetryConfigs.background,
        retryableErrors: this.isRetryableError,
      },
      `sync:${userId}`
    );

    // Update metrics with retry information
    metrics.totalSyncs++;
    metrics.lastSyncDuration = retryResult.totalDuration;
    
    if (retryResult.success) {
      // Successful sync
      const syncResult = retryResult.result!;
      
      syncState.lastSync = new Date();
      syncState.historyId = syncResult.newHistoryId;
      syncState.consecutiveErrors = 0;
      syncState.errorCount = 0;
      
      metrics.successfulSyncs++;
      metrics.messagesProcessed += syncResult.messagesProcessed;
      
      // Calculate running average
      if (metrics.totalSyncs > 1) {
        metrics.averageSyncDuration = Math.round(
          (metrics.averageSyncDuration * (metrics.totalSyncs - 1) + metrics.lastSyncDuration) / metrics.totalSyncs
        );
      } else {
        metrics.averageSyncDuration = metrics.lastSyncDuration;
      }

      // Process and emit changes if any
      if (syncResult.hasChanges) {
        logger.info(`Sync found changes for user ${userId}`, {
          added: syncResult.changes.addedMessages.length,
          deleted: syncResult.changes.deletedMessageIds.length,
          updated: syncResult.changes.updatedMessages.length,
          attempts: retryResult.attempts.length,
        });

        // Clear email caches since data has changed
        await gmailService.clearCache(userId);

        // Emit messages changed event
        this.emit('messages:changed', {
          type: 'messages:changed',
          userId,
          data: syncResult.changes,
          timestamp: new Date(),
        } as SyncEvent);
      } else {
        logger.debug(`No changes found in sync for user ${userId}`);
      }

      // Emit sync completed event
      this.emit('sync:completed', {
        type: 'sync:completed',
        userId,
        data: {
          duration: metrics.lastSyncDuration,
          changesFound: syncResult.hasChanges,
          addedCount: syncResult.changes.addedMessages.length,
          deletedCount: syncResult.changes.deletedMessageIds.length,
          updatedCount: syncResult.changes.updatedMessages.length,
          attempts: retryResult.attempts.length,
        },
        timestamp: new Date(),
      } as SyncEvent);

      logger.debug(`Sync completed successfully for user ${userId}`, {
        duration: metrics.lastSyncDuration,
        hasChanges: syncResult.hasChanges,
        newHistoryId: syncResult.newHistoryId,
        attempts: retryResult.attempts.length,
      });

    } else {
      // Failed sync after all retries
      syncState.consecutiveErrors++;
      syncState.errorCount++;
      metrics.failedSyncs++;

      logger.error(`Sync failed for user ${userId} after ${retryResult.attempts.length} attempts:`, retryResult.finalError);

      // Emit sync failed event with detailed retry information
      this.emit('sync:failed', {
        type: 'sync:failed',
        userId,
        data: {
          error: retryResult.finalError instanceof Error ? retryResult.finalError.message : 'Unknown error',
          consecutiveErrors: syncState.consecutiveErrors,
          duration: retryResult.totalDuration,
          attempts: retryResult.attempts.length,
          retryDetails: retryResult.attempts.map(a => ({
            attempt: a.attempt,
            error: a.error.message,
            delay: a.delay,
          })),
        },
        timestamp: new Date(),
      } as SyncEvent);

      // Check circuit breaker state and error patterns
      const circuitBreakerState = retryHandler.getCircuitBreakerState(`sync:${userId}`);
      
      // Check if we should move to error state
      if (syncState.consecutiveErrors >= this.config.maxRetries || 
          (circuitBreakerState && circuitBreakerState.state === 'open')) {
        logger.warn(`Moving sync to error state for user ${userId}`, {
          consecutiveErrors: syncState.consecutiveErrors,
          circuitBreakerState,
        });
        syncState.status = 'error';
        await this.persistSyncState(userId, syncState);
        
        // Don't schedule next sync for error state
        return;
      }
    }

    // Persist updated state and metrics
    await Promise.all([
      this.persistSyncState(userId, syncState),
      this.persistSyncMetrics(userId, metrics),
    ]);

    // Schedule next sync (with appropriate backoff)
    await this.scheduleNextSync(userId);
  }

  /**
   * Core sync operation that can be retried
   */
  private async performSyncOperation(userId: string): Promise<{
    changes: {
      addedMessages: any[];
      deletedMessageIds: string[];
      updatedMessages: any[];
    };
    newHistoryId: string;
    hasChanges: boolean;
    messagesProcessed: number;
  }> {
    const syncState = this.syncStates.get(userId)!;
    
    logger.debug(`Executing sync operation for user ${userId}`, {
      lastSync: syncState.lastSync,
      historyId: syncState.historyId,
    });

    let changes: any;
    let newHistoryId: string;
    let messagesProcessed = 0;

    if (!syncState.historyId) {
      // Initial sync - no history ID yet
      logger.info(`Performing initial sync for user ${userId}`);
      
      const initialSyncResult = await gmailService.performInitialSync(userId);
      newHistoryId = initialSyncResult.historyId;
      
      changes = {
        addedMessages: initialSyncResult.emails,
        deletedMessageIds: [],
        updatedMessages: [],
      };

      messagesProcessed = initialSyncResult.emails.length;
    } else {
      // Incremental sync using history API
      logger.debug(`Performing incremental sync for user ${userId} from history ID ${syncState.historyId}`);
      
      const historyResult = await gmailService.processHistoryChanges(userId, syncState.historyId);
      changes = historyResult.changes;
      newHistoryId = historyResult.newHistoryId;

      messagesProcessed = changes.addedMessages.length + 
                         changes.deletedMessageIds.length + 
                         changes.updatedMessages.length;
    }

    const hasChanges = changes.addedMessages.length > 0 || 
                      changes.deletedMessageIds.length > 0 || 
                      changes.updatedMessages.length > 0;

    return {
      changes,
      newHistoryId,
      hasChanges,
      messagesProcessed,
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError = (error: any): boolean => {
    // Gmail API specific retryable errors
    if (error.name === 'GmailRateLimitError' || 
        error.name === 'GmailServerError' ||
        error.name === 'GmailNetworkError') {
      return true;
    }

    // Generic retryable conditions
    if (error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET') {
      return true;
    }

    // HTTP status codes
    if (error.response?.status) {
      const status = error.response.status;
      return status >= 500 || status === 429 || status === 408;
    }

    // Non-retryable errors
    if (error.name === 'GmailAuthError' ||
        error.name === 'GmailValidationError' ||
        error.name === 'GmailQuotaExceededError') {
      return false;
    }

    // Default to retryable for unknown errors
    return true;
  };

  /**
   * Load sync state from Redis
   */
  private async loadSyncState(userId: string, syncState: SyncState): Promise<void> {
    try {
      const stateData = await redisService.getTemp(`sync:${userId}:state`);
      if (stateData) {
        const savedState = JSON.parse(stateData);
        syncState.lastSync = savedState.lastSync ? new Date(savedState.lastSync) : null;
        syncState.historyId = savedState.historyId;
        syncState.errorCount = savedState.errorCount || 0;
        syncState.consecutiveErrors = savedState.consecutiveErrors || 0;
        // Don't restore running status - restart as idle
        syncState.status = savedState.status === 'running' ? 'idle' : savedState.status || 'idle';
      }
    } catch (error) {
      logger.warn(`Error loading sync state for user ${userId}:`, error);
    }
  }

  /**
   * Load sync metrics from Redis
   */
  private async loadSyncMetrics(userId: string, metrics: SyncMetrics): Promise<void> {
    try {
      const metricsData = await redisService.getTemp(`sync:${userId}:metrics`);
      if (metricsData) {
        const savedMetrics = JSON.parse(metricsData);
        Object.assign(metrics, savedMetrics);
      }
    } catch (error) {
      logger.warn(`Error loading sync metrics for user ${userId}:`, error);
    }
  }

  /**
   * Persist sync state to Redis
   */
  private async persistSyncState(userId: string, syncState: SyncState): Promise<void> {
    try {
      const stateData = {
        userId: syncState.userId,
        status: syncState.status,
        lastSync: syncState.lastSync?.toISOString(),
        nextSync: syncState.nextSync?.toISOString(),
        historyId: syncState.historyId,
        errorCount: syncState.errorCount,
        consecutiveErrors: syncState.consecutiveErrors,
      };

      // Store for 30 days
      await redisService.storeTemp(
        `sync:${userId}:state`,
        JSON.stringify(stateData),
        30 * 24 * 60 * 60
      );
    } catch (error) {
      logger.error(`Error persisting sync state for user ${userId}:`, error);
    }
  }

  /**
   * Persist sync metrics to Redis
   */
  private async persistSyncMetrics(userId: string, metrics: SyncMetrics): Promise<void> {
    try {
      // Store for 30 days
      await redisService.storeTemp(
        `sync:${userId}:metrics`,
        JSON.stringify(metrics),
        30 * 24 * 60 * 60
      );
    } catch (error) {
      logger.error(`Error persisting sync metrics for user ${userId}:`, error);
    }
  }

  /**
   * Clear all sync data for a user from Redis
   */
  private async clearSyncData(userId: string): Promise<void> {
    try {
      await Promise.all([
        redisService.deleteTemp(`sync:${userId}:state`),
        redisService.deleteTemp(`sync:${userId}:metrics`),
      ]);
    } catch (error) {
      logger.error(`Error clearing sync data for user ${userId}:`, error);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdownHandler = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down SyncService gracefully`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception in SyncService:', error);
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      logger.error('Unhandled rejection in SyncService:', reason);
      await this.shutdown();
      process.exit(1);
    });
  }
}

// Export singleton instance
export const syncService = new SyncService();