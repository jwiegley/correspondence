import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

interface RedisConfig {
  url: string;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
  connectTimeout: number;
  lazyConnect: boolean;
}

class RedisService {
  private client: RedisClientType;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor() {
    const config: RedisConfig = {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      lazyConnect: true,
    };

    this.client = createClient({
      url: config.url,
      socket: {
        connectTimeout: config.connectTimeout,
        reconnectStrategy: (retries) => {
          if (retries >= this.maxReconnectAttempts) {
            logger.error(`Redis reconnection failed after ${retries} attempts`);
            return false;
          }
          const delay = Math.min(retries * 50, 500);
          logger.warn(`Attempting Redis reconnection in ${delay}ms (attempt ${retries})`);
          return delay;
        },
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.reconnectAttempts = 0;
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      logger.error('Redis client error:', err);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      logger.warn('Redis connection ended');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      this.reconnectAttempts++;
      logger.info(`Redis reconnecting (attempt ${this.reconnectAttempts})`);
    });
  }

  async connect(): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
        logger.info('Redis service connected successfully');
      }
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.isConnected) {
        await this.client.disconnect();
        this.isConnected = false;
        logger.info('Redis service disconnected');
      }
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  /**
   * Store user tokens with appropriate TTL (60 days)
   */
  async storeUserTokens(userId: string, tokens: string): Promise<void> {
    const key = `user:${userId}:tokens`;
    const ttl = 60 * 60 * 24 * 60; // 60 days
    
    await this.client.setEx(key, ttl, tokens);
    logger.debug(`Stored tokens for user ${userId} with TTL ${ttl}s`);
  }

  /**
   * Get user tokens
   */
  async getUserTokens(userId: string): Promise<string | null> {
    const key = `user:${userId}:tokens`;
    const tokens = await this.client.get(key);
    
    if (tokens) {
      // Check remaining TTL and log if expiring soon
      const ttl = await this.client.ttl(key);
      if (ttl > 0 && ttl < 7 * 24 * 60 * 60) { // Less than 7 days
        logger.warn(`User ${userId} tokens expire in ${Math.floor(ttl / (24 * 60 * 60))} days`);
      }
    }
    
    return tokens;
  }

  /**
   * Store user profile with shorter TTL (7 days)
   */
  async storeUserProfile(userId: string, profile: string): Promise<void> {
    const key = `user:${userId}:profile`;
    const ttl = 60 * 60 * 24 * 7; // 7 days
    
    await this.client.setEx(key, ttl, profile);
    logger.debug(`Stored profile for user ${userId} with TTL ${ttl}s`);
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<string | null> {
    const key = `user:${userId}:profile`;
    return await this.client.get(key);
  }

  /**
   * Delete user data (tokens and profile)
   */
  async deleteUserData(userId: string): Promise<void> {
    const tokenKey = `user:${userId}:tokens`;
    const profileKey = `user:${userId}:profile`;
    const statusKey = `user:${userId}:connection_status`;
    
    await this.client.del([tokenKey, profileKey, statusKey]);
    logger.info(`Deleted all data for user ${userId}`);
  }

  /**
   * Store user connection status
   */
  async setUserConnectionStatus(userId: string, status: string): Promise<void> {
    const key = `user:${userId}:connection_status`;
    const ttl = 60 * 60 * 24; // 24 hours
    
    await this.client.setEx(key, ttl, status);
    logger.debug(`Updated connection status for user ${userId}`);
  }

  /**
   * Get user connection status
   */
  async getUserConnectionStatus(userId: string): Promise<string | null> {
    const key = `user:${userId}:connection_status`;
    return await this.client.get(key);
  }

  /**
   * Store temporary data with custom TTL
   */
  async storeTemp(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setEx(key, ttlSeconds, value);
  }

  /**
   * Get temporary data
   */
  async getTemp(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  /**
   * Delete temporary data
   */
  async deleteTemp(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Check if Redis is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Get Redis client for session store
   */
  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Get connection status
   */
  isHealthy(): boolean {
    return this.isConnected;
  }

  /**
   * Enhanced Gmail cache methods with TTL strategies
   */
  
  // Email list caching (5 minutes TTL for frequently changing data)
  async cacheEmailList(userId: string, query: string, emails: any[], pageToken?: string): Promise<void> {
    const key = `emails:${userId}:${this.hashQuery(query)}`;
    const ttl = 5 * 60; // 5 minutes
    
    const cacheData = {
      emails,
      pageToken,
      timestamp: Date.now(),
      query
    };
    
    await this.client.setEx(key, ttl, JSON.stringify(cacheData));
    logger.debug(`Cached ${emails.length} emails for user ${userId} with query: ${query}`);
  }

  async getCachedEmailList(userId: string, query: string): Promise<{ emails: any[]; pageToken?: string } | null> {
    const key = `emails:${userId}:${this.hashQuery(query)}`;
    const cached = await this.client.get(key);
    
    if (cached) {
      try {
        const data = JSON.parse(cached);
        logger.debug(`Cache hit for emails: user ${userId}, ${data.emails.length} emails`);
        return { emails: data.emails, pageToken: data.pageToken };
      } catch (error) {
        logger.warn('Failed to parse cached email data:', error);
        await this.client.del(key);
      }
    }
    
    return null;
  }

  // Labels caching (1 hour TTL for rarely changing data)
  async cacheLabels(userId: string, labels: any[]): Promise<void> {
    const key = `labels:${userId}`;
    const ttl = 60 * 60; // 1 hour
    
    const cacheData = {
      labels,
      timestamp: Date.now()
    };
    
    await this.client.setEx(key, ttl, JSON.stringify(cacheData));
    logger.debug(`Cached ${labels.length} labels for user ${userId}`);
  }

  async getCachedLabels(userId: string): Promise<any[] | null> {
    const key = `labels:${userId}`;
    const cached = await this.client.get(key);
    
    if (cached) {
      try {
        const data = JSON.parse(cached);
        logger.debug(`Cache hit for labels: user ${userId}, ${data.labels.length} labels`);
        return data.labels;
      } catch (error) {
        logger.warn('Failed to parse cached labels data:', error);
        await this.client.del(key);
      }
    }
    
    return null;
  }

  // Email thread caching (15 minutes TTL)
  async cacheEmailThread(userId: string, threadId: string, thread: any): Promise<void> {
    const key = `thread:${userId}:${threadId}`;
    const ttl = 15 * 60; // 15 minutes
    
    const cacheData = {
      thread,
      timestamp: Date.now()
    };
    
    await this.client.setEx(key, ttl, JSON.stringify(cacheData));
    logger.debug(`Cached thread ${threadId} for user ${userId}`);
  }

  async getCachedEmailThread(userId: string, threadId: string): Promise<any | null> {
    const key = `thread:${userId}:${threadId}`;
    const cached = await this.client.get(key);
    
    if (cached) {
      try {
        const data = JSON.parse(cached);
        logger.debug(`Cache hit for thread: user ${userId}, thread ${threadId}`);
        return data.thread;
      } catch (error) {
        logger.warn('Failed to parse cached thread data:', error);
        await this.client.del(key);
      }
    }
    
    return null;
  }

  // Batch operations caching (30 seconds TTL for very recent operations)
  async cacheBatchOperation(userId: string, operationType: string, result: any): Promise<void> {
    const key = `batch:${userId}:${operationType}:${Date.now()}`;
    const ttl = 30; // 30 seconds
    
    await this.client.setEx(key, ttl, JSON.stringify(result));
    logger.debug(`Cached batch operation ${operationType} for user ${userId}`);
  }

  // Cache invalidation methods
  async invalidateUserCache(userId: string, pattern?: string): Promise<void> {
    const basePattern = pattern || `*:${userId}:*`;
    const keys = await this.client.keys(basePattern);
    
    if (keys.length > 0) {
      await this.client.del(keys);
      logger.info(`Invalidated ${keys.length} cache keys for user ${userId}`);
    }
  }

  async invalidateEmailCache(userId: string): Promise<void> {
    await this.invalidateUserCache(userId, `emails:${userId}:*`);
  }

  async invalidateThreadCache(userId: string, threadId?: string): Promise<void> {
    const pattern = threadId ? `thread:${userId}:${threadId}` : `thread:${userId}:*`;
    await this.invalidateUserCache(userId, pattern);
  }

  // Cache warming methods
  async warmUserCache(userId: string, basicData: { labels?: any[]; recentEmails?: any[] }): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (basicData.labels) {
      promises.push(this.cacheLabels(userId, basicData.labels));
    }
    
    if (basicData.recentEmails) {
      promises.push(this.cacheEmailList(userId, 'in:inbox', basicData.recentEmails));
    }
    
    await Promise.all(promises);
    logger.info(`Warmed cache for user ${userId}`);
  }

  // Cache statistics and monitoring
  async getCacheStats(): Promise<any> {
    try {
      const pipeline = this.client.multi();
      
      // Count different cache types
      pipeline.eval(`
        local keys = redis.call('keys', '*')
        local stats = {}
        for i=1, #keys do
          local key = keys[i]
          local prefix = string.match(key, '^([^:]+):')
          if prefix then
            stats[prefix] = (stats[prefix] or 0) + 1
          end
        end
        return cjson.encode(stats)
      `, []);
      
      const results = await pipeline.exec();
      const stats = results?.[0] ? JSON.parse(results[0] as string) : {};
      
      return {
        totalKeys: await this.client.dbSize(),
        keysByType: stats,
        memoryUsage: await this.client.info('memory'),
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Cache cleanup for expired or stale data
  async cleanupStaleCache(): Promise<void> {
    try {
      // Get all keys with their TTL
      const keys = await this.client.keys('*');
      let cleanedCount = 0;
      
      for (const key of keys) {
        const ttl = await this.client.ttl(key);
        
        // Remove keys that are set to expire in less than 10 seconds
        // This handles edge cases where TTL might be very low
        if (ttl > 0 && ttl < 10) {
          await this.client.del(key);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} stale cache entries`);
      }
    } catch (error) {
      logger.error('Cache cleanup failed:', error);
    }
  }

  // Utility method to hash query strings for consistent cache keys
  private hashQuery(query: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(query).digest('hex');
  }

  /**
   * Get Redis stats
   */
  async getStats(): Promise<any> {
    try {
      const info = await this.client.info('memory');
      const dbSize = await this.client.dbSize();
      const cacheStats = await this.getCacheStats();
      
      return {
        connected: this.isConnected,
        dbSize,
        memoryInfo: info,
        reconnectAttempts: this.reconnectAttempts,
        cacheStats,
      };
    } catch (error) {
      logger.error('Failed to get Redis stats:', error);
      return {
        connected: this.isConnected,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();

// Export the class for testing
export default RedisService;