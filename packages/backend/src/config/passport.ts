// @ts-nocheck
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { logger } from '../utils/logger';
import { encryptTokens } from '../utils/crypto';
import { redisService } from '../services/redis';

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
}

interface GoogleProfile {
  id: string;
  displayName: string;
  emails?: Array<{ value: string; verified: boolean }>;
  photos?: Array<{ value: string }>;
  provider: string;
  _raw: string;
  _json: any;
}

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {
      accessToken?: string;
      refreshToken?: string;
    }
  }
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
  clientID: process.env.GOOGLE_CLIENT_ID || 'dummy-client-id',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy-secret',
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify']
}, async (accessToken: string, refreshToken: string, profile: GoogleProfile, done: any) => {
  try {
    logger.info(`OAuth callback for user: ${profile.id}`);
    
    // Prepare user data
    const user: AuthenticatedUser = {
      id: profile.id,
      email: profile.emails?.[0]?.value || '',
      name: profile.displayName,
      picture: profile.photos?.[0]?.value,
      provider: 'google'
    };

    // Encrypt and store tokens in Redis
    const encryptedTokens = encryptTokens({
      accessToken,
      refreshToken
    });

    // Store encrypted tokens (storeUserTokens expects a string)
    await redisService.storeUserTokens(user.id, JSON.stringify(encryptedTokens));
    
    // Store user profile data separately (also expects a string)
    await redisService.storeUserProfile(user.id, JSON.stringify(user));

    logger.info(`User ${user.email} authenticated successfully`);
    
    return done(null, user);
  } catch (error) {
    logger.error('OAuth callback error:', error);
    return done(error);
  }
}));

// Serialize user for session
passport.serializeUser((user: Express.User, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    // Get user profile from Redis
    const profileString = await redisService.getUserProfile(id);
    
    if (!profileString) {
      return done(null, false);
    }

    // Parse the JSON string back to user object
    const profile = JSON.parse(profileString);
    done(null, profile);
  } catch (error) {
    logger.error('Error deserializing user:', error);
    done(error);
  }
});

export default passport;