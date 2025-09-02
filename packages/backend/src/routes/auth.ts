import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis';
import { requireAuth, logAuthenticatedRequest } from '../middleware/auth';

const router = Router();

// OAuth error types
enum OAuthErrorType {
  ACCESS_DENIED = 'access_denied',
  INVALID_REQUEST = 'invalid_request',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  UNSUPPORTED_RESPONSE_TYPE = 'unsupported_response_type',
  INVALID_SCOPE = 'invalid_scope',
  SERVER_ERROR = 'server_error',
  TEMPORARILY_UNAVAILABLE = 'temporarily_unavailable',
}

/**
 * Initiate Google OAuth flow
 */
router.get('/google', (req: Request, res: Response, next: NextFunction) => {
  // Log the OAuth initiation
  logger.info(`OAuth initiation request from IP: ${req.ip}`);
  
  // Store the original URL for post-auth redirect if provided
  const returnTo = req.query.returnTo as string;
  if (returnTo) {
    req.session.returnTo = returnTo;
  }
  
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ],
    accessType: 'offline', // Request refresh token
    prompt: 'consent', // Force consent screen to get refresh token
  })(req, res, next);
});

/**
 * Handle Google OAuth callback
 */
router.get('/google/callback', (req: Request, res: Response, next: NextFunction) => {
  // Check for OAuth errors in query parameters
  const error = req.query.error as string;
  const errorDescription = req.query.error_description as string;
  
  if (error) {
    logger.warn(`OAuth error: ${error} - ${errorDescription}`);
    return handleOAuthError(error, errorDescription, res);
  }
  
  // Authenticate with Passport
  passport.authenticate('google', {
    failureRedirect: '/auth/failure',
    failureMessage: true,
  })(req, res, async (err?: any) => {
    if (err) {
      logger.error('OAuth authentication error:', err);
      return handleAuthenticationError(err, res);
    }
    
    if (!req.user) {
      logger.error('OAuth callback: No user data received');
      return res.redirect(`${getFrontendUrl()}/auth/error?type=no_user_data`);
    }
    
    try {
      // Log successful authentication
      logger.info(`Successful OAuth authentication for user: ${req.user.id}`);
      
      // Get the return URL from session
      const returnTo = req.session.returnTo;
      delete req.session.returnTo;
      
      // Build success redirect URL
      const baseUrl = getFrontendUrl();
      const successUrl = returnTo 
        ? `${baseUrl}${returnTo}?auth=success`
        : `${baseUrl}/dashboard?auth=success`;
      
      res.redirect(successUrl);
    } catch (error) {
      logger.error('Post-authentication processing error:', error);
      res.redirect(`${getFrontendUrl()}/auth/error?type=processing_error`);
    }
  });
});

/**
 * Handle OAuth errors
 */
function handleOAuthError(error: string, description: string, res: Response) {
  const errorMap: Record<string, { message: string; code: number }> = {
    [OAuthErrorType.ACCESS_DENIED]: {
      message: 'Authentication was cancelled or denied',
      code: 401
    },
    [OAuthErrorType.INVALID_REQUEST]: {
      message: 'Invalid authentication request',
      code: 400
    },
    [OAuthErrorType.UNAUTHORIZED_CLIENT]: {
      message: 'Unauthorized client application',
      code: 401
    },
    [OAuthErrorType.INVALID_SCOPE]: {
      message: 'Invalid permission scope requested',
      code: 400
    },
    [OAuthErrorType.SERVER_ERROR]: {
      message: 'Authentication server error',
      code: 500
    },
    [OAuthErrorType.TEMPORARILY_UNAVAILABLE]: {
      message: 'Authentication service temporarily unavailable',
      code: 503
    }
  };
  
  const errorInfo = errorMap[error] || {
    message: 'Unknown authentication error',
    code: 400
  };
  
  res.redirect(`${getFrontendUrl()}/auth/error?type=${error}&message=${encodeURIComponent(errorInfo.message)}`);
}

/**
 * Handle authentication processing errors
 */
function handleAuthenticationError(error: any, res: Response) {
  let errorType = 'unknown_error';
  let message = 'An unexpected error occurred during authentication';
  
  if (error.code === 'ENOTFOUND') {
    errorType = 'network_error';
    message = 'Network connection error';
  } else if (error.message?.includes('token')) {
    errorType = 'token_error';
    message = 'Error processing authentication tokens';
  } else if (error.message?.includes('profile')) {
    errorType = 'profile_error';
    message = 'Error retrieving user profile';
  }
  
  res.redirect(`${getFrontendUrl()}/auth/error?type=${errorType}&message=${encodeURIComponent(message)}`);
}

/**
 * Logout endpoint with comprehensive cleanup
 */
router.post('/logout', requireAuth, logAuthenticatedRequest, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  
  try {
    // Clear user data from Redis
    if (userId) {
      await redisService.deleteUserData(userId);
      logger.info(`Cleared Redis data for user: ${userId}`);
    }
    
    // Logout from Passport
    req.logout((err) => {
      if (err) {
        logger.error('Passport logout error:', err);
        return res.status(500).json({ 
          error: 'Logout failed',
          message: 'Error during logout process'
        });
      }
      
      // Destroy session
      req.session.destroy((err) => {
        if (err) {
          logger.error('Session destruction error:', err);
          return res.status(500).json({ 
            error: 'Session cleanup failed',
            message: 'Error cleaning up session data'
          });
        }
        
        // Clear session cookie
        res.clearCookie('sessionId');
        res.clearCookie('connect.sid'); // Legacy cookie name
        
        logger.info(`User ${userId} logged out successfully`);
        res.json({ 
          message: 'Logged out successfully',
          timestamp: new Date().toISOString()
        });
      });
    });
  } catch (error) {
    logger.error('Logout cleanup error:', error);
    res.status(500).json({
      error: 'Logout cleanup failed',
      message: 'Error cleaning up user data'
    });
  }
});

/**
 * Check authentication status
 */
router.get('/status', (req: Request, res: Response) => {
  if (req.isAuthenticated() && req.user) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
        provider: req.user.provider,
      },
      sessionId: req.sessionID,
    });
  } else {
    res.json({
      authenticated: false,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Auth failure fallback route
 */
router.get('/failure', (req: Request, res: Response) => {
  logger.warn(`Authentication failure from IP: ${req.ip}`);
  
  // Get failure message from session if available
  const messages = req.session.messages || [];
  const failureMessage = messages.length > 0 ? messages[0] : 'Authentication failed';
  
  res.status(401).json({ 
    error: 'Authentication failed',
    message: failureMessage,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Test protected route
 */
router.get('/test-protected', requireAuth, (req: Request, res: Response) => {
  res.json({
    message: 'Successfully accessed protected route',
    user: req.user,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get user profile endpoint
 */
router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    
    // Get fresh profile data from Redis
    const profileData = await redisService.getUserProfile(userId);
    
    if (!profileData) {
      return res.status(404).json({
        error: 'Profile not found',
        message: 'User profile data is not available'
      });
    }
    
    const profile = JSON.parse(profileData);
    res.json({
      profile,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Profile fetch error for user ${req.user?.id}:`, error);
    res.status(500).json({
      error: 'Profile fetch failed',
      message: 'Error retrieving user profile'
    });
  }
});

/**
 * Helper function to get frontend URL
 */
function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

export default router;