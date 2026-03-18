import { Request, Response, NextFunction } from 'express';
import Tokens from 'csrf';
import { logger } from '../utils/logger';

// Initialize CSRF tokens generator
const tokens = new Tokens();

// Secret for CSRF token generation (should be stored securely)
const _CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-secret-change-in-production';

interface CSRFRequest extends Request {
  csrfToken?: string;
  session: any;
}

// Generate and store CSRF secret in session if not exists
const ensureCSRFSecret = (req: CSRFRequest): string => {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  return req.session.csrfSecret;
};

// Generate CSRF token
export const generateCSRFToken = (req: CSRFRequest): string => {
  const secret = ensureCSRFSecret(req);
  return tokens.create(secret);
};

// Verify CSRF token
export const verifyCSRFToken = (req: CSRFRequest, token: string): boolean => {
  if (!req.session.csrfSecret) {
    return false;
  }
  return tokens.verify(req.session.csrfSecret, token);
};

// CSRF protection middleware
export const csrfProtection = (req: CSRFRequest, res: Response, next: NextFunction): void => {
  // Skip CSRF protection for safe methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Skip CSRF for WebSocket upgrade requests
  if (req.headers.upgrade === 'websocket') {
    return next();
  }

  // Skip CSRF for API endpoints that use other authentication (like OAuth)
  const skipPaths = ['/auth/google', '/auth/google/callback', '/api/webhook'];
  if (skipPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Get token from header, body, or query
  const token = req.headers['x-csrf-token'] as string ||
                req.body?._csrf ||
                req.query._csrf as string;

  if (!token) {
    logger.warn('CSRF token missing', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id
    });

    res.status(403).json({
      error: 'CSRF token missing',
      type: 'CSRF_TOKEN_MISSING'
    });
    return;
  }

  if (!verifyCSRFToken(req, token)) {
    logger.warn('Invalid CSRF token', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      providedToken: token.substring(0, 10) + '...' // Log partial token for debugging
    });

    res.status(403).json({
      error: 'Invalid CSRF token',
      type: 'CSRF_TOKEN_INVALID'
    });
    return;
  }

  next();
};

// Middleware to add CSRF token to response
export const addCSRFToken = (req: CSRFRequest, res: Response, next: NextFunction): void => {
  // Generate token and add to request object for easy access
  req.csrfToken = generateCSRFToken(req);
  
  // Add token to response headers for single-page applications
  res.setHeader('X-CSRF-Token', req.csrfToken);
  
  next();
};

// Route handler to get CSRF token
export const getCSRFToken = (req: CSRFRequest, res: Response): void => {
  const token = generateCSRFToken(req);
  
  res.json({
    csrfToken: token
  });
};

// Double Submit Cookie pattern implementation
export const doubleSubmitCookieCSRF = (req: CSRFRequest, res: Response, next: NextFunction): void => {
  // Skip for safe methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    // Set cookie for non-safe methods preparation
    const token = generateCSRFToken(req);
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false, // Allow JavaScript access for frontend
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    return next();
  }

  // For non-safe methods, verify token matches cookie
  const headerToken = req.headers['x-csrf-token'] as string || req.headers['x-xsrf-token'] as string;
  const cookieToken = req.cookies['XSRF-TOKEN'];

  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing in double submit cookie check', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      hasHeaderToken: !!headerToken,
      hasCookieToken: !!cookieToken,
      userId: req.user?.id
    });

    res.status(403).json({
      error: 'CSRF protection failed - tokens missing',
      type: 'CSRF_DOUBLE_SUBMIT_FAILED'
    });
    return;
  }

  if (headerToken !== cookieToken) {
    logger.warn('CSRF token mismatch in double submit cookie check', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userId: req.user?.id
    });

    res.status(403).json({
      error: 'CSRF protection failed - token mismatch',
      type: 'CSRF_DOUBLE_SUBMIT_FAILED'
    });
    return;
  }

  next();
};

// Configuration for different CSRF strategies
export const CSRFConfig = {
  // Use session-based CSRF (more secure but requires server-side sessions)
  session: [addCSRFToken, csrfProtection],
  
  // Use double submit cookie pattern (stateless, good for distributed systems)
  doubleSubmit: [doubleSubmitCookieCSRF],
  
  // Token generation only (for manual implementation)
  tokenOnly: [addCSRFToken]
};

export default {
  csrfProtection,
  addCSRFToken,
  getCSRFToken,
  doubleSubmitCookieCSRF,
  generateCSRFToken,
  verifyCSRFToken,
  CSRFConfig
};