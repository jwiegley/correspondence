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
    
    await this.client.del([tokenKey, profileKey]);
    logger.info(`Deleted all data for user ${userId}`);
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
   * Get Redis stats
   */
  async getStats(): Promise<any> {
    try {
      const info = await this.client.info('memory');
      const dbSize = await this.client.dbSize();
      
      return {
        connected: this.isConnected,
        dbSize,
        memoryInfo: info,
        reconnectAttempts: this.reconnectAttempts,
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