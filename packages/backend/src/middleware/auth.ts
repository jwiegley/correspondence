// @ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis';
import { decryptTokens, areTokensExpired } from '../utils/crypto';

// Extend Express Request type to include user data
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      picture?: string;
      provider: string;
    }
  }
}

interface _AuthMiddlewareOptions {
  requireScopes?: string[];
  allowExpiredTokens?: boolean;
}

/**
 * Basic authentication middleware - checks if user is logged in
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user) {
    logger.debug(`Authenticated user: ${req.user.id}`);
    return next();
  }
  
  logger.warn(`Unauthenticated request to ${req.path} from IP ${req.ip}`);
  res.status(401).json({ 
    error: 'Authentication required',
    message: 'Please log in to access this resource'
  });
};

/**
 * Advanced authentication middleware with token validation
 */
export const requireValidTokens = async (
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

  try {
    // Get encrypted tokens from Redis
    const encryptedTokens = await redisService.getUserTokens(req.user.id);
    
    if (!encryptedTokens) {
      logger.warn(`No tokens found for user ${req.user.id}`);
      return res.status(401).json({ 
        error: 'Invalid session',
        message: 'Please log in again'
      });
    }

    // Decrypt and validate tokens
    const tokenData = decryptTokens(JSON.parse(encryptedTokens));
    
    if (areTokensExpired(tokenData)) {
      logger.warn(`Expired tokens for user ${req.user.id}`);
      return res.status(401).json({ 
        error: 'Session expired',
        message: 'Please log in again'
      });
    }

    // Attach token data to request for downstream use
    (req as any).tokenData = tokenData;
    
    logger.debug(`Valid tokens confirmed for user: ${req.user.id}`);
    next();
  } catch (error) {
    logger.error(`Token validation error for user ${req.user?.id}:`, error);
    res.status(401).json({ 
      error: 'Invalid session',
      message: 'Please log in again'
    });
  }
};

/**
 * Middleware to check if user is authenticated (for optional auth routes)
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Just pass through, user data will be available if authenticated
  next();
};

/**
 * Role-based access control middleware
 */
export const requireRole = (requiredRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please log in to access this resource'
      });
    }

    // For now, all authenticated users have 'user' role
    // This can be extended when user roles are implemented
    const userRoles = ['user'];
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      logger.warn(`User ${req.user.id} attempted to access route requiring roles: ${requiredRoles.join(', ')}`);
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: 'You do not have permission to access this resource'
      });
    }

    next();
  };
};

/**
 * Rate limiting by user ID
 */
export const rateLimitByUser = (maxRequests: number, windowMs: number) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.isAuthenticated() || !req.user) {
      return next(); // Let requireAuth handle this
    }

    const key = `rate_limit:${req.user.id}:${Math.floor(Date.now() / windowMs)}`;
    
    try {
      const currentCount = await redisService.getTemp(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      if (count >= maxRequests) {
        logger.warn(`Rate limit exceeded for user ${req.user.id}`);
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests, please try again later'
        });
      }

      // Increment counter
      await redisService.storeTemp(key, (count + 1).toString(), Math.ceil(windowMs / 1000));
      next();
    } catch (error) {
      logger.error('Rate limiting error:', error);
      next(); // Continue on Redis error
    }
  };
};

/**
 * Logging middleware for authenticated requests
 */
export const logAuthenticatedRequest = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user) {
    logger.info(`User ${req.user.id} (${req.user.email}) accessed ${req.method} ${req.path}`);
  }
  next();
};

/**
 * Middleware to attach user data to response locals
 */
export const attachUserData = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user) {
    res.locals.user = req.user;
    res.locals.isAuthenticated = true;
  } else {
    res.locals.isAuthenticated = false;
  }
  next();
};