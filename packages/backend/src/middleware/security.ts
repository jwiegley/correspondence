import helmet from 'helmet';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Nonce generator for CSP
const generateNonce = (): string => {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('base64');
};

// Content Security Policy configuration
const getCSPDirectives = (nonce?: string) => {
  const baseDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      // Allow Google APIs and OAuth
      "https://apis.google.com",
      "https://accounts.google.com",
      // Allow inline scripts with nonce in development
      process.env.NODE_ENV === 'development' ? "'unsafe-inline'" : `'nonce-${nonce}'`
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'", // Required for styled-components and CSS-in-JS
      "https://fonts.googleapis.com"
    ],
    imgSrc: [
      "'self'",
      "data:",
      "https:", // Allow HTTPS images (for user avatars, etc.)
      "https://lh3.googleusercontent.com" // Google profile pictures
    ],
    connectSrc: [
      "'self'",
      "https://api.gmail.com",
      "https://www.googleapis.com",
      "wss:" + (process.env.FRONTEND_URL?.replace('http', '') || '//localhost:3000'), // WebSocket
      process.env.FRONTEND_URL || 'http://localhost:3000'
    ],
    fontSrc: [
      "'self'",
      "https://fonts.gstatic.com"
    ],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: [
      "https://accounts.google.com" // Google OAuth
    ],
    childSrc: ["'none'"],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"]
  };

  // Add report-uri in production
  if (process.env.NODE_ENV === 'production' && process.env.CSP_REPORT_URI) {
    (baseDirectives as any).reportUri = [process.env.CSP_REPORT_URI];
  }

  return baseDirectives;
};

// Security headers middleware using Helmet
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    useDefaults: false,
    directives: getCSPDirectives()
  },
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // X-Frame-Options
  frameguard: {
    action: 'deny'
  },
  
  // X-Content-Type-Options
  noSniff: true,
  
  // X-XSS-Protection (legacy, but still useful)
  xssFilter: true,
  
  // Referrer Policy
  referrerPolicy: {
    policy: ['strict-origin-when-cross-origin']
  },
  
  // Permissions Policy (formerly Feature Policy) - commented out for compatibility
  // permissionsPolicy: {
  //   features: {
  //     camera: ["'none'"],
  //     microphone: ["'none'"],
  //     geolocation: ["'none'"],
  //     payment: ["'none'"],
  //     usb: ["'none'"],
  //     accelerometer: ["'none'"],
  //     gyroscope: ["'none'"],
  //     magnetometer: ["'none'"]
  //   }
  // },
  
  // Cross-Origin Embedder Policy
  crossOriginEmbedderPolicy: false, // Disabled for now as it can break third-party integrations
  
  // Cross-Origin Opener Policy
  crossOriginOpenerPolicy: {
    policy: 'same-origin'
  },
  
  // Cross-Origin Resource Policy
  crossOriginResourcePolicy: {
    policy: 'cross-origin'
  }
});

// Custom security middleware for additional checks
export const customSecurityChecks = (req: Request, res: Response, next: NextFunction): void => {
  // Check for common attack patterns in request
  const suspiciousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    /onclick\s*=/gi
  ];

  const checkString = (str: string): boolean => {
    return suspiciousPatterns.some(pattern => pattern.test(str));
  };

  // Check URL parameters
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  for (const [key, value] of urlParams.entries()) {
    if (checkString(value)) {
      logger.warn('Suspicious pattern detected in URL parameter', {
        ip: req.ip,
        path: req.path,
        parameter: key,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id
      });
      
      res.status(400).json({
        error: 'Invalid request parameters',
        type: 'SECURITY_VIOLATION'
      });
      return;
    }
  }

  // Check request body for suspicious content
  if (req.body && typeof req.body === 'object') {
    const bodyStr = JSON.stringify(req.body);
    if (checkString(bodyStr)) {
      logger.warn('Suspicious pattern detected in request body', {
        ip: req.ip,
        path: req.path,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id
      });
      
      res.status(400).json({
        error: 'Invalid request content',
        type: 'SECURITY_VIOLATION'
      });
      return;
    }
  }

  next();
};

// Session security middleware
export const sessionSecurity = (req: Request, res: Response, next: NextFunction): void => {
  // Session security temporarily disabled - TODO: fix session type
  next();
};

// IP-based security checks
export const ipSecurityChecks = (req: Request, res: Response, next: NextFunction): void => {
  const clientIp = req.ip || req.socket.remoteAddress;
  
  // Check for private/internal IP addresses trying to access external resources
  const isInternalRequest = req.path.includes('/internal/') || req.path.includes('/admin/');
  const isPrivateIP = /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|127\.|::1|localhost)/.test(clientIp || '');
  
  if (isInternalRequest && !isPrivateIP) {
    logger.warn('External IP attempting to access internal endpoint', {
      ip: clientIp,
      path: req.path,
      userAgent: req.get('User-Agent')
    });
    
    res.status(403).json({
      error: 'Access denied',
      type: 'ACCESS_FORBIDDEN'
    });
    return;
  }

  next();
};

// Request size limits
export const requestSizeLimits = (req: Request, res: Response, next: NextFunction): void => {
  const contentLength = parseInt(req.get('Content-Length') || '0');
  const maxSizes = {
    '/api/emails/send': 10 * 1024 * 1024, // 10MB for email attachments
    '/api/upload': 25 * 1024 * 1024, // 25MB for file uploads
    default: 1024 * 1024 // 1MB for other requests
  };

  const maxSize = Object.keys(maxSizes).find(path => req.path.startsWith(path)) || 'default';
  const limit = maxSizes[maxSize as keyof typeof maxSizes];

  if (contentLength > limit) {
    logger.warn('Request size exceeded limit', {
      ip: req.ip,
      path: req.path,
      contentLength,
      limit,
      userId: req.user?.id
    });
    
    res.status(413).json({
      error: 'Request entity too large',
      type: 'REQUEST_TOO_LARGE',
      maxSize: limit
    });
    return;
  }

  next();
};

// Combined security middleware stack
export const securityMiddleware = [
  securityHeaders,
  customSecurityChecks,
  sessionSecurity,
  ipSecurityChecks,
  requestSizeLimits
];

// CSP Nonce middleware for dynamic script injection
export const cspNonceMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  res.locals.nonce = generateNonce();
  
  // Update CSP header with nonce
  res.setHeader('Content-Security-Policy', 
    `default-src 'self'; script-src 'self' 'nonce-${res.locals.nonce}' https://apis.google.com https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: https://lh3.googleusercontent.com; connect-src 'self' https://api.gmail.com https://www.googleapis.com wss:${process.env.FRONTEND_URL?.replace('http', '') || '//localhost:3000'}; font-src 'self' https://fonts.gstatic.com; object-src 'none'; frame-src https://accounts.google.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`
  );
  
  next();
};

export default {
  securityHeaders,
  customSecurityChecks,
  sessionSecurity,
  ipSecurityChecks,
  requestSizeLimits,
  securityMiddleware,
  cspNonceMiddleware
};