import { google } from 'googleapis';
import { logger } from '../utils/logger';
import { redisService } from './redis';
import { encryptTokens, decryptTokens, areTokensExpired } from '../utils/crypto';

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiryDate?: number;
}

interface RefreshResult {
  success: boolean;
  tokens?: TokenData;
  error?: string;
  shouldReAuth?: boolean;
}

interface PendingRequest {
  resolve: (tokens: TokenData) => void;
  reject: (error: Error) => void;
}

class TokenRefreshService {
  private oauth2Client: any;
  private refreshPromises: Map<string, Promise<RefreshResult>> = new Map();
  private pendingRequests: Map<string, PendingRequest[]> = new Map();
  private maxRetries = 3;
  private baseDelay = 1000; // Base delay for exponential backoff

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    );
  }

  /**
   * Get valid tokens for a user, refreshing if necessary
   */
  async getValidTokens(userId: string): Promise<TokenData> {
    try {
      // Get encrypted tokens from Redis
      const encryptedTokensData = await redisService.getUserTokens(userId);
      
      if (!encryptedTokensData) {
        throw new Error('No tokens found for user');
      }

      const encryptedTokens = JSON.parse(encryptedTokensData);
      const tokens = decryptTokens(encryptedTokens);

      // Check if tokens are expired
      if (!areTokensExpired(tokens)) {
        logger.debug(`Valid tokens found for user ${userId}`);
        return tokens;
      }

      logger.info(`Tokens expired for user ${userId}, attempting refresh`);
      
      // Check if refresh is already in progress
      if (this.refreshPromises.has(userId)) {
        logger.debug(`Token refresh already in progress for user ${userId}, waiting...`);
        const result = await this.refreshPromises.get(userId)!;
        
        if (result.success && result.tokens) {
          return result.tokens;
        } else {
          throw new Error(result.error || 'Token refresh failed');
        }
      }

      // Start token refresh
      const refreshPromise = this.refreshTokensForUser(userId, tokens);
      this.refreshPromises.set(userId, refreshPromise);

      try {
        const result = await refreshPromise;
        
        if (result.success && result.tokens) {
          logger.info(`Successfully refreshed tokens for user ${userId}`);
          return result.tokens;
        } else if (result.shouldReAuth) {
          throw new Error('Re-authentication required');
        } else {
          throw new Error(result.error || 'Token refresh failed');
        }
      } finally {
        this.refreshPromises.delete(userId);
      }

    } catch (error) {
      logger.error(`Error getting valid tokens for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Refresh tokens for a specific user with retry logic
   */
  private async refreshTokensForUser(userId: string, currentTokens: TokenData): Promise<RefreshResult> {
    if (!currentTokens.refreshToken) {
      logger.error(`No refresh token available for user ${userId}`);
      return {
        success: false,
        error: 'No refresh token available',
        shouldReAuth: true
      };
    }

    let lastError: any;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Token refresh attempt ${attempt}/${this.maxRetries} for user ${userId}`);
        
        // Set refresh token in OAuth client
        this.oauth2Client.setCredentials({
          refresh_token: currentTokens.refreshToken,
        });

        // Refresh the access token
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        
        if (!credentials.access_token) {
          throw new Error('No access token received from refresh');
        }

        // Calculate expiry date
        const expiryDate = credentials.expiry_date || (Date.now() + (60 * 60 * 1000)); // Default 1 hour

        // Create new token data
        const newTokens: TokenData = {
          accessToken: credentials.access_token,
          refreshToken: credentials.refresh_token || currentTokens.refreshToken, // Keep old refresh token if new one not provided
          tokenType: 'Bearer',
          expiryDate: expiryDate,
        };

        // Encrypt and store the new tokens
        const encryptedTokens = encryptTokens(newTokens);
        await redisService.storeUserTokens(userId, JSON.stringify(encryptedTokens));

        logger.info(`Successfully refreshed and stored tokens for user ${userId}`);
        
        return {
          success: true,
          tokens: newTokens
        };

      } catch (error: any) {
        lastError = error;
        logger.warn(`Token refresh attempt ${attempt} failed for user ${userId}:`, error.message);

        // Check for specific error types
        if (error.message?.includes('invalid_grant') || error.code === 400) {
          logger.error(`Invalid refresh token for user ${userId}, re-authentication required`);
          return {
            success: false,
            error: 'Invalid refresh token',
            shouldReAuth: true
          };
        }

        // If this is not the last attempt, wait before retrying
        if (attempt < this.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          logger.debug(`Waiting ${delay}ms before retry ${attempt + 1} for user ${userId}`);
          await this.sleep(delay);
        }
      }
    }

    logger.error(`All token refresh attempts failed for user ${userId}:`, lastError);
    
    return {
      success: false,
      error: `Token refresh failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      shouldReAuth: lastError?.message?.includes('invalid_grant')
    };
  }

  /**
   * Revoke tokens for a user (for logout)
   */
  async revokeTokens(userId: string): Promise<void> {
    try {
      const encryptedTokensData = await redisService.getUserTokens(userId);
      
      if (!encryptedTokensData) {
        logger.debug(`No tokens to revoke for user ${userId}`);
        return;
      }

      const encryptedTokens = JSON.parse(encryptedTokensData);
      const tokens = decryptTokens(encryptedTokens);

      // Revoke the access token with Google
      if (tokens.accessToken) {
        try {
          await this.oauth2Client.revokeToken(tokens.accessToken);
          logger.info(`Successfully revoked access token for user ${userId}`);
        } catch (error) {
          logger.warn(`Failed to revoke access token for user ${userId}:`, error);
          // Continue with cleanup even if revocation fails
        }
      }

      // Clean up stored tokens
      await redisService.deleteUserData(userId);
      logger.info(`Cleaned up stored tokens for user ${userId}`);

    } catch (error) {
      logger.error(`Error revoking tokens for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if tokens will expire soon and proactively refresh
   */
  async checkAndRefreshIfNeeded(userId: string, bufferMinutes: number = 10): Promise<boolean> {
    try {
      const encryptedTokensData = await redisService.getUserTokens(userId);
      
      if (!encryptedTokensData) {
        return false;
      }

      const encryptedTokens = JSON.parse(encryptedTokensData);
      const tokens = decryptTokens(encryptedTokens);

      // Check if tokens will expire within buffer time
      const bufferMs = bufferMinutes * 60 * 1000;
      const willExpireSoon = tokens.expiryDate && (tokens.expiryDate - Date.now()) < bufferMs;

      if (willExpireSoon) {
        logger.info(`Tokens for user ${userId} will expire soon, proactively refreshing`);
        await this.getValidTokens(userId);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error checking token expiry for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get token info for monitoring
   */
  async getTokenInfo(userId: string): Promise<any> {
    try {
      const encryptedTokensData = await redisService.getUserTokens(userId);
      
      if (!encryptedTokensData) {
        return { hasTokens: false };
      }

      const encryptedTokens = JSON.parse(encryptedTokensData);
      const tokens = decryptTokens(encryptedTokens);

      return {
        hasTokens: true,
        hasAccessToken: !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        expiryDate: tokens.expiryDate,
        isExpired: areTokensExpired(tokens),
        expiresInMinutes: tokens.expiryDate ? Math.floor((tokens.expiryDate - Date.now()) / (60 * 1000)) : null,
      };
    } catch (error) {
      logger.error(`Error getting token info for user ${userId}:`, error);
      return { hasTokens: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    return Math.min(this.baseDelay * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up token refresh service...');
    
    // Wait for any pending refresh operations to complete
    const pendingRefreshes = Array.from(this.refreshPromises.values());
    if (pendingRefreshes.length > 0) {
      logger.info(`Waiting for ${pendingRefreshes.length} pending token refreshes to complete...`);
      await Promise.allSettled(pendingRefreshes);
    }

    this.refreshPromises.clear();
    this.pendingRequests.clear();
    
    logger.info('Token refresh service cleanup completed');
  }
}

// Export singleton instance
export const tokenRefreshService = new TokenRefreshService();

// Export the class for testing
export default TokenRefreshService;