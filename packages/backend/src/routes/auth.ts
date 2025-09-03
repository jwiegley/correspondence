// @ts-nocheck
import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { google } from 'googleapis';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis';
import { requireAuth, logAuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Initialize OAuth2 client for Gmail API calls
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

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
 * Test Gmail connection endpoint
 */
router.get('/test-connection', requireAuth, logAuthenticatedRequest, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    // Get user's OAuth tokens from Redis
    const tokenData = await redisService.getUserTokens(userId);
    if (!tokenData) {
      return res.status(401).json({
        error: 'No authentication tokens found',
        message: 'Please reconnect your Gmail account',
        code: 'NO_TOKENS'
      });
    }
    
    const tokens = JSON.parse(tokenData);
    
    // Check if access token exists
    if (!tokens.access_token) {
      return res.status(401).json({
        error: 'Invalid authentication tokens',
        message: 'Please reconnect your Gmail account',
        code: 'INVALID_TOKENS'
      });
    }
    
    // Test the Gmail API connection by fetching user profile
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    oauth2Client.setCredentials(tokens);
    
    // Make a test API call to verify the connection
    const profileResponse = await gmail.users.getProfile({
      userId: 'me',
    });
    
    if (!profileResponse.data.emailAddress) {
      throw new Error('Unable to retrieve user profile');
    }
    
    // Update last successful connection timestamp
    const connectionStatus = {
      isConnected: true,
      email: profileResponse.data.emailAddress,
      lastSync: new Date().toISOString(),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope ? tokens.scope.split(' ') : [],
      messagesTotal: profileResponse.data.messagesTotal || 0,
      threadsTotal: profileResponse.data.threadsTotal || 0
    };
    
    // Store the connection status in Redis
    await redisService.setUserConnectionStatus(userId, JSON.stringify(connectionStatus));
    
    logger.info(`Connection test successful for user ${userId}: ${profileResponse.data.emailAddress}`);
    
    res.json({
      success: true,
      message: 'Gmail connection is working properly',
      ...connectionStatus
    });
    
  } catch (error: any) {
    logger.error(`Connection test failed for user ${userId}:`, error);
    
    // Handle specific error types
    let errorResponse = {
      success: false,
      error: 'Connection test failed',
      message: 'Unable to connect to Gmail',
      code: 'CONNECTION_FAILED'
    };
    
    if (error.code === 401 || error.status === 401) {
      errorResponse = {
        success: false,
        error: 'Authentication expired',
        message: 'Your Gmail connection has expired. Please reconnect.',
        code: 'AUTH_EXPIRED'
      };
    } else if (error.code === 403 || error.status === 403) {
      errorResponse = {
        success: false,
        error: 'Permission denied',
        message: 'Gmail access permissions are insufficient. Please reconnect and grant all permissions.',
        code: 'INSUFFICIENT_PERMISSIONS'
      };
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorResponse = {
        success: false,
        error: 'Network error',
        message: 'Unable to reach Gmail servers. Please check your internet connection.',
        code: 'NETWORK_ERROR'
      };
    } else if (error.message?.includes('quota')) {
      errorResponse = {
        success: false,
        error: 'API quota exceeded',
        message: 'Gmail API quota exceeded. Please try again later.',
        code: 'QUOTA_EXCEEDED'
      };
    }
    
    // Store failed connection status
    const failedStatus = {
      isConnected: false,
      email: req.user?.email || null,
      lastSync: null,
      error: errorResponse.message,
      lastAttempt: new Date().toISOString()
    };
    
    await redisService.setUserConnectionStatus(userId, JSON.stringify(failedStatus));
    
    res.status(error.status || 500).json(errorResponse);
  }
});

/**
 * Get connection status endpoint
 */
router.get('/connection-status', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    const statusData = await redisService.getUserConnectionStatus(userId);
    if (!statusData) {
      return res.json({
        isConnected: false,
        email: req.user?.email || null,
        lastSync: null,
        message: 'Connection status not available'
      });
    }
    
    const status = JSON.parse(statusData);
    res.json(status);
    
  } catch (error) {
    logger.error(`Connection status fetch error for user ${userId}:`, error);
    res.status(500).json({
      error: 'Unable to fetch connection status',
      message: 'Please try again later'
    });
  }
});

/**
 * Disconnect OAuth endpoint - revokes tokens and clears user data
 */
router.post('/disconnect', requireAuth, logAuthenticatedRequest, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    logger.info(`OAuth disconnect requested for user ${userId}`);
    
    // Get user's OAuth tokens before revoking
    const tokenData = await redisService.getUserTokens(userId);
    
    if (tokenData) {
      try {
        const tokens = JSON.parse(tokenData);
        
        // Revoke tokens via Google OAuth2 API if we have them
        if (tokens.access_token) {
          oauth2Client.setCredentials(tokens);
          
          // Revoke the refresh token (this also revokes the access token)
          if (tokens.refresh_token) {
            await oauth2Client.revokeToken(tokens.refresh_token);
            logger.info(`Revoked refresh token for user ${userId}`);
          } else {
            // If no refresh token, revoke the access token
            await oauth2Client.revokeToken(tokens.access_token);
            logger.info(`Revoked access token for user ${userId}`);
          }
        }
      } catch (revokeError: any) {
        // Log the error but don't fail the disconnect process
        // The tokens might already be expired or revoked
        logger.warn(`Token revocation warning for user ${userId}:`, revokeError.message);
      }
    }
    
    // Clear all user data from Redis regardless of token revocation success
    await redisService.deleteUserData(userId);
    
    // Update connection status to disconnected
    const disconnectedStatus = {
      isConnected: false,
      email: req.user?.email || null,
      lastSync: null,
      disconnectedAt: new Date().toISOString(),
      message: 'Successfully disconnected from Gmail'
    };
    
    await redisService.setUserConnectionStatus(userId, JSON.stringify(disconnectedStatus));
    
    logger.info(`OAuth disconnect completed for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Successfully disconnected from Gmail',
      disconnectedAt: new Date().toISOString()
    });
    
  } catch (error: any) {
    logger.error(`OAuth disconnect failed for user ${userId}:`, error);
    
    // Even if there's an error, try to clear local data
    try {
      await redisService.deleteUserData(userId);
    } catch (cleanupError) {
      logger.error(`Failed to cleanup data after disconnect error for user ${userId}:`, cleanupError);
    }
    
    res.status(500).json({
      success: false,
      error: 'Disconnect failed',
      message: 'There was an error disconnecting from Gmail. Your local data has been cleared.',
      code: 'DISCONNECT_ERROR'
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