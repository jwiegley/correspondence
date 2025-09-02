import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { createClient } from 'redis';
import { logger } from '../utils/logger';
import { encryptTokens, decryptTokens } from '../utils/crypto';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Ensure Redis connection
redisClient.connect().catch((err) => {
  logger.error('Redis connection error in passport config:', err);
});

interface GoogleProfile {
  id: string;
  displayName: string;
  emails: Array<{ value: string; verified: boolean }>;
  photos: Array<{ value: string }>;
  provider: string;
}

interface UserTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiryDate?: number;
}

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
}

// Configure Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
}, async (accessToken: string, refreshToken: string, profile: GoogleProfile, done) => {
  try {
    logger.info(`OAuth callback for user: ${profile.id}`);
    
    // Prepare user data
    const user: AuthenticatedUser = {
      id: profile.id,
      email: profile.emails[0]?.value || '',
      name: profile.displayName,
      picture: profile.photos[0]?.value,
      provider: profile.provider,
    };

    // Prepare token data with expiry
    const tokenData: UserTokens = {
      accessToken,
      refreshToken: refreshToken || undefined,
      tokenType: 'Bearer',
      expiryDate: Date.now() + (60 * 60 * 1000), // 1 hour default
    };

    // Encrypt and store tokens in Redis
    const encryptedTokens = encryptTokens(tokenData);
    await redisClient.setEx(
      `user:${profile.id}:tokens`, 
      60 * 60 * 24 * 60, // 60 days TTL for refresh tokens
      JSON.stringify(encryptedTokens)
    );

    // Store user profile data separately
    await redisClient.setEx(
      `user:${profile.id}:profile`,
      60 * 60 * 24 * 7, // 7 days TTL for profile data
      JSON.stringify(user)
    );

    logger.info(`Successfully stored encrypted tokens for user: ${profile.id}`);
    
    return done(null, user);
  } catch (error) {
    logger.error('OAuth strategy error:', error);
    return done(error, null);
  }
}));

// Serialize user for session storage
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const userData = await redisClient.get(`user:${id}:profile`);
    
    if (!userData) {
      logger.warn(`User profile not found for ID: ${id}`);
      return done(null, false);
    }

    const user = JSON.parse(userData) as AuthenticatedUser;
    done(null, user);
  } catch (error) {
    logger.error('User deserialization error:', error);
    done(error, null);
  }
});

export default passport;