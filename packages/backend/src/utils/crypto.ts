import crypto from 'crypto';
import { logger } from './logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM, this is always 16
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiryDate?: number;
}

interface EncryptedTokens {
  encrypted: string;
  timestamp: number;
}

/**
 * Get encryption key from environment or generate a secure default
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    logger.warn('ENCRYPTION_KEY not set in environment, using development key');
    // In production, this should be a proper 32-byte key
    return crypto.pbkdf2Sync('development-key', 'salt', 100000, 32, 'sha256');
  }
  
  // If key is provided as hex string
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }
  
  // If key is provided as string, derive it
  return crypto.pbkdf2Sync(key, 'correspondence-salt', 100000, 32, 'sha256');
}

/**
 * Encrypt token data using AES-256-GCM
 */
export function encryptTokens(tokenData: TokenData): EncryptedTokens {
  try {
    // Validate input
    if (!tokenData.accessToken) {
      throw new Error('Access token is required for encryption');
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    const cipher = crypto.createCipher(ALGORITHM, key);
    cipher.setAutoPadding(true);
    
    // Serialize the token data
    const plaintext = JSON.stringify({
      ...tokenData,
      timestamp: Date.now(),
    });
    
    // Encrypt the data
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Combine salt + iv + tag + encrypted data
    const combined = Buffer.concat([
      salt,
      iv,
      tag,
      Buffer.from(encrypted, 'hex')
    ]).toString('base64');
    
    return {
      encrypted: combined,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error('Token encryption failed:', error);
    throw new Error('Failed to encrypt tokens');
  }
}

/**
 * Decrypt token data using AES-256-GCM
 */
export function decryptTokens(encryptedTokens: EncryptedTokens): TokenData {
  try {
    if (!encryptedTokens.encrypted) {
      throw new Error('Encrypted data is required for decryption');
    }

    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedTokens.encrypted, 'base64');
    
    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, TAG_POSITION);
    const tag = combined.subarray(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = combined.subarray(ENCRYPTED_POSITION);
    
    const decipher = crypto.createDecipher(ALGORITHM, key);
    decipher.setAuthTag(tag);
    
    // Decrypt the data
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    const tokenData = JSON.parse(decrypted) as TokenData & { timestamp: number };
    
    // Remove internal timestamp and return clean token data
    const { timestamp, ...cleanTokenData } = tokenData;
    
    return cleanTokenData;
  } catch (error) {
    logger.error('Token decryption failed:', error);
    throw new Error('Failed to decrypt tokens');
  }
}

/**
 * Validate if tokens are expired
 */
export function areTokensExpired(tokenData: TokenData): boolean {
  if (!tokenData.expiryDate) {
    return false; // If no expiry date, assume not expired
  }
  
  return Date.now() >= tokenData.expiryDate;
}

/**
 * Generate a secure random string for session secrets
 */
export function generateSecureSecret(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash sensitive data for logging (one-way)
 */
export function hashForLogging(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 8);
}