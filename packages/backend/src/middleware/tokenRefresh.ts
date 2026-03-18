// @ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { tokenRefreshService } from '../services/tokenRefresh';

/**
 * Middleware to ensure valid tokens before API calls
 * Automatically refreshes tokens if they're expired or expiring soon
 */
export const ensureValidTokens = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
  }

  const userId = req.user.id;

  try {
    // Get valid tokens (will refresh if needed)
    const tokens = await tokenRefreshService.getValidTokens(userId);
    
    // Attach tokens to request for downstream use
    (req as any).tokens = tokens;
    
    logger.debug(`Valid tokens ensured for user ${userId}`);
    next();
    
  } catch (error: any) {
    logger.error(`Token validation/refresh failed for user ${userId}:`, error);
    
    // Check if re-authentication is required
    if (error.message?.includes('Re-authentication required') || 
        error.message?.includes('No tokens found') ||
        error.message?.includes('Invalid refresh token')) {
      
      return res.status(401).json({
        error: 'Re-authentication required',
        message: 'Please log in again to continue',
        code: 'REAUTH_REQUIRED'
      });
    }
    
    // For other errors, return a general token error
    return res.status(401).json({
      error: 'Token validation failed',
      message: 'Unable to validate authentication tokens',
      code: 'TOKEN_ERROR'
    });
  }
};

/**
 * Middleware for proactive token refresh
 * Refreshes tokens if they will expire within the specified buffer time
 */
export const proactiveTokenRefresh = (bufferMinutes: number = 10) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.isAuthenticated() || !req.user) {
      return next(); // Let other middleware handle authentication
    }

    const userId = req.user.id;

    try {
      // Check if tokens need proactive refresh
      const refreshed = await tokenRefreshService.checkAndRefreshIfNeeded(userId, bufferMinutes);
      
      if (refreshed) {
        logger.debug(`Proactively refreshed tokens for user ${userId}`);
      }
      
      next();
    } catch (error) {
      logger.warn(`Proactive token refresh failed for user ${userId}:`, error);
      // Continue with request even if proactive refresh fails
      next();
    }
  };
};

/**
 * Middleware to attach token information to response headers for debugging
 */
export const attachTokenInfo = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  if (!req.isAuthenticated() || !req.user || process.env.NODE_ENV === 'production') {
    return next();
  }

  const userId = req.user.id;

  try {
    const tokenInfo = await tokenRefreshService.getTokenInfo(userId);
    
    // Add token info to response headers (development only)
    res.set({
      'X-Token-Status': tokenInfo.hasTokens ? 'present' : 'missing',
      'X-Token-Expired': tokenInfo.isExpired ? 'true' : 'false',
      'X-Token-Expires-In': tokenInfo.expiresInMinutes ? `${tokenInfo.expiresInMinutes}min` : 'unknown'
    });
    
  } catch (error) {
    logger.debug(`Failed to attach token info for user ${userId}:`, error);
  }

  next();
};

/**
 * Error handler specifically for token-related errors
 */
export const handleTokenErrors = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Check if this is a token-related error
  if (error.message?.includes('token') || 
      error.message?.includes('authentication') ||
      error.code === 401) {
    
    logger.error(`Token error for user ${req.user?.id}:`, error);
    
    return res.status(401).json({
      error: 'Authentication error',
      message: 'Please log in again to continue',
      code: 'TOKEN_ERROR',
      timestamp: new Date().toISOString()
    });
  }
  
  // Pass other errors to the next error handler
  next(error);
};

/**
 * Middleware to queue requests during token refresh
 */
interface QueuedRequest {
  req: Request;
  res: Response;
  next: NextFunction;
  timestamp: number;
}

class RequestQueue {
  private queues: Map<string, QueuedRequest[]> = new Map();
  private processing: Map<string, boolean> = new Map();
  private maxQueueSize = 10;
  private maxWaitTime = 30000; // 30 seconds

  async queueRequest(userId: string, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if we're already processing requests for this user
    if (!this.processing.get(userId)) {
      return next(); // Process immediately
    }

    // Add to queue
    const queue = this.queues.get(userId) || [];
    
    if (queue.length >= this.maxQueueSize) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Please wait for previous requests to complete'
      });
    }

    const queuedRequest: QueuedRequest = {
      req,
      res,
      next,
      timestamp: Date.now()
    };

    queue.push(queuedRequest);
    this.queues.set(userId, queue);

    // Set timeout to prevent indefinite waiting
    setTimeout(() => {
      this.removeFromQueue(userId, queuedRequest);
      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request timeout',
          message: 'Request timed out while waiting for authentication'
        });
      }
    }, this.maxWaitTime);
  }

  setProcessing(userId: string, processing: boolean): void {
    this.processing.set(userId, processing);
    
    if (!processing) {
      // Process queued requests
      const queue = this.queues.get(userId) || [];
      this.queues.delete(userId);
      
      queue.forEach(({ req: _req, res, next }) => {
        if (!res.headersSent) {
          next();
        }
      });
    }
  }

  private removeFromQueue(userId: string, request: QueuedRequest): void {
    const queue = this.queues.get(userId) || [];
    const index = queue.indexOf(request);
    if (index > -1) {
      queue.splice(index, 1);
      if (queue.length === 0) {
        this.queues.delete(userId);
      } else {
        this.queues.set(userId, queue);
      }
    }
  }
}

const requestQueue = new RequestQueue();

export const queueDuringTokenRefresh = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    return next();
  }

  await requestQueue.queueRequest(req.user.id, req, res, next);
};