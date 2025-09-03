import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisService } from '../services/redis';
import { logger } from '../utils/logger';
import { Request, Response } from 'express';

// Custom key generator that uses user ID when available, falls back to IP
const createKeyGenerator = (prefix: string) => {
  return (req: Request): string => {
    const userId = req.user?.id;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    if (userId) {
      return `${prefix}:user:${userId}`;
    }
    return `${prefix}:ip:${ip}`;
  };
};

// Skip successful requests for certain endpoints to avoid penalizing normal usage
const skipSuccessfulRequests = (req: Request, res: Response): boolean => {
  // Skip counting successful requests for read-only endpoints
  const readOnlyEndpoints = ['/api/emails', '/api/labels', '/api/profile'];
  const isReadOnly = readOnlyEndpoints.some(endpoint => req.path.startsWith(endpoint));
  const isSuccessful = res.statusCode < 400;
  
  return isReadOnly && isSuccessful && req.method === 'GET';
};

// Create Redis store instance (deferred to avoid initialization issues)
const createRedisStore = () => {
  try {
    const client = redisService.getClient();
    if (!client || !client.isOpen) {
      logger.debug('Redis client not ready for rate limiting, using memory store');
      return undefined;
    }
    return new RedisStore({
      sendCommand: (...args: string[]) => client.sendCommand(args),
    });
  } catch (error) {
    logger.warn('Failed to create Redis store for rate limiting, falling back to memory store', { error });
    return undefined;
  }
};

// Lazy store getter to defer Redis connection
let redisStoreCache: RedisStore | undefined;
const getRedisStore = () => {
  if (!redisStoreCache) {
    redisStoreCache = createRedisStore();
  }
  return redisStoreCache;
};

// Authentication endpoints rate limiter (strict)
export const authRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window per IP/user
  message: {
    error: 'Too many authentication attempts, please try again in 15 minutes',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator('auth_limit'),
  handler: (req: Request, res: Response) => {
    logger.warn('Authentication rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Too many authentication attempts, please try again in 15 minutes',
      retryAfter: 15 * 60 * 1000,
      type: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// API endpoints rate limiter (moderate)
export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP/user
  message: {
    error: 'API rate limit exceeded, please slow down your requests',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator('api_limit'),
  skip: skipSuccessfulRequests,
  handler: (req: Request, res: Response) => {
    logger.warn('API rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'API rate limit exceeded, please slow down your requests',
      retryAfter: 15 * 60 * 1000,
      type: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// Public endpoints rate limiter (lenient)
export const publicRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window per IP
  message: {
    error: 'Too many requests, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator('public_limit'),
  handler: (req: Request, res: Response) => {
    logger.warn('Public rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Too many requests, please try again later',
      retryAfter: 15 * 60 * 1000,
      type: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// Gmail API specific rate limiter (very strict due to quota limits)
export const gmailApiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 Gmail API calls per minute per user
  message: {
    error: 'Gmail API rate limit exceeded, please wait before making more requests',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator('gmail_limit'),
  handler: (req: Request, res: Response) => {
    logger.warn('Gmail API rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      error: 'Gmail API rate limit exceeded, please wait before making more requests',
      retryAfter: 60 * 1000,
      type: 'GMAIL_RATE_LIMIT_EXCEEDED'
    });
  }
});

// Email action rate limiter (for send, delete, archive, etc.)
export const emailActionRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 email actions per 5 minutes per user
  message: {
    error: 'Too many email actions, please wait before trying again',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator('email_action_limit'),
  handler: (req: Request, res: Response) => {
    logger.warn('Email action rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      action: req.body?.action
    });
    
    res.status(429).json({
      error: 'Too many email actions, please wait before trying again',
      retryAfter: 5 * 60 * 1000,
      type: 'EMAIL_ACTION_RATE_LIMIT_EXCEEDED'
    });
  }
});

// Export default configurations for easy importing
export const rateLimiters = {
  auth: authRateLimiter,
  api: apiRateLimiter,
  public: publicRateLimiter,
  gmailApi: gmailApiRateLimiter,
  emailAction: emailActionRateLimiter
};

// Rate limit metrics for monitoring
export const getRateLimitMetrics = async () => {
  try {
    const client = redisService.getClient();
    const keys = await client.keys('*_limit:*');
    
    const metrics = {
      totalKeys: keys.length,
      authLimits: keys.filter(k => k.includes('auth_limit')).length,
      apiLimits: keys.filter(k => k.includes('api_limit')).length,
      publicLimits: keys.filter(k => k.includes('public_limit')).length,
      gmailLimits: keys.filter(k => k.includes('gmail_limit')).length,
      emailActionLimits: keys.filter(k => k.includes('email_action_limit')).length
    };
    
    return metrics;
  } catch (error) {
    logger.error('Failed to get rate limit metrics', { error });
    return null;
  }
};