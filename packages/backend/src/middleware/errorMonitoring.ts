import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis';

// Enhanced error interface with monitoring data
interface MonitoredError extends Error {
  statusCode?: number;
  code?: string;
  userId?: string;
  requestId?: string;
  context?: any;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  fingerprint?: string;
  breadcrumbs?: Breadcrumb[];
  timestamp?: number;
}

interface Breadcrumb {
  timestamp: number;
  category: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  data?: any;
}

interface ErrorMetrics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByUser: Record<string, number>;
  errorsByEndpoint: Record<string, number>;
  criticalErrors: number;
  lastError: Date;
  errorRate: number; // errors per minute
}

interface AlertRule {
  id: string;
  name: string;
  condition: (metrics: ErrorMetrics, error?: MonitoredError) => boolean;
  action: 'log' | 'email' | 'webhook';
  cooldown: number; // minutes
  enabled: boolean;
}

class ErrorMonitoringService {
  private errorBuffer: MonitoredError[] = [];
  private alertRules: AlertRule[] = [];
  private alertCooldowns: Map<string, number> = new Map();
  private breadcrumbs: Map<string, Breadcrumb[]> = new Map(); // per session/user
  private errorMetrics: ErrorMetrics = {
    totalErrors: 0,
    errorsByType: {},
    errorsByUser: {},
    errorsByEndpoint: {},
    criticalErrors: 0,
    lastError: new Date(),
    errorRate: 0
  };

  constructor() {
    this.initializeAlertRules();
    this.startMetricsCollection();
  }

  /**
   * Enhanced error handler middleware
   */
  errorHandler = (err: MonitoredError, req: Request, res: Response, _next: NextFunction): void => {
    // Generate error fingerprint for deduplication
    err.fingerprint = this.generateErrorFingerprint(err, req);
    err.requestId = this.getRequestId(req);
    err.userId = req.user?.id;
    err.context = this.extractRequestContext(req);
    err.severity = this.determineSeverity(err, req);
    err.breadcrumbs = this.getBreadcrumbs(err.requestId || req.ip || 'unknown');

    // Log error with full context
    this.logError(err, req);

    // Update metrics
    this.updateErrorMetrics(err, req);

    // Store error for analysis
    this.storeError(err, req);

    // Check alert rules
    this.checkAlerts(err);

    // Send response
    this.sendErrorResponse(err, req, res);
  };

  /**
   * Add breadcrumb for request tracing
   */
  addBreadcrumb(sessionId: string, category: string, message: string, level: 'info' | 'warning' | 'error' = 'info', data?: any): void {
    const breadcrumb: Breadcrumb = {
      timestamp: Date.now(),
      category,
      message,
      level,
      data
    };

    if (!this.breadcrumbs.has(sessionId)) {
      this.breadcrumbs.set(sessionId, []);
    }

    const breadcrumbs = this.breadcrumbs.get(sessionId)!;
    breadcrumbs.push(breadcrumb);

    // Keep only last 50 breadcrumbs per session
    if (breadcrumbs.length > 50) {
      breadcrumbs.shift();
    }

    // Clean up old breadcrumbs (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const validBreadcrumbs = breadcrumbs.filter(b => b.timestamp > oneHourAgo);
    this.breadcrumbs.set(sessionId, validBreadcrumbs);
  }

  /**
   * Middleware to add breadcrumbs for requests
   */
  breadcrumbMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const sessionId = this.getRequestId(req);
    
    // Add request breadcrumb
    this.addBreadcrumb(sessionId, 'http', `${req.method} ${req.path}`, 'info', {
      query: req.query,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Add breadcrumb for response
    const originalSend = res.send;
    res.send = function(body: any) {
      const statusCode = res.statusCode;
      const level = statusCode >= 400 ? (statusCode >= 500 ? 'error' : 'warning') : 'info';
      
      errorMonitoring.addBreadcrumb(sessionId, 'http', `Response ${statusCode}`, level, {
        statusCode,
        contentLength: body?.length || 0
      });
      
      return originalSend.call(this, body);
    };

    next();
  };

  private initializeAlertRules(): void {
    this.alertRules = [
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        condition: (metrics) => metrics.errorRate > 10, // More than 10 errors per minute
        action: 'webhook',
        cooldown: 10, // 10 minutes
        enabled: true
      },
      {
        id: 'critical_error',
        name: 'Critical Error Detected',
        condition: (_metrics, error) => error?.severity === 'critical',
        action: 'email',
        cooldown: 5, // 5 minutes
        enabled: true
      },
      {
        id: 'auth_failures',
        name: 'Multiple Authentication Failures',
        condition: (metrics) => (metrics.errorsByType['AUTH_ERROR'] || 0) > 5,
        action: 'webhook',
        cooldown: 15, // 15 minutes
        enabled: true
      },
      {
        id: 'database_errors',
        name: 'Database Connection Issues',
        condition: (metrics) => (metrics.errorsByType['DATABASE_ERROR'] || 0) > 3,
        action: 'log',
        cooldown: 5,
        enabled: true
      }
    ];
  }

  private startMetricsCollection(): void {
    // Update error rate every minute
    setInterval(() => {
      this.calculateErrorRate();
      this.cleanupOldData();
    }, 60 * 1000);

    // Store metrics snapshot every 5 minutes
    setInterval(() => {
      this.storeMetricsSnapshot();
    }, 5 * 60 * 1000);
  }

  private generateErrorFingerprint(error: MonitoredError, _req: Request): string {
    const crypto = require('crypto');
    const fingerprint = [
      error.name,
      error.message,
      _req.path,
      error.stack?.split('\n')[1]?.trim() || ''
    ].join('|');
    
    return crypto.createHash('md5').update(fingerprint).digest('hex');
  }

  private getRequestId(req: Request): string {
    // Try to get existing request ID or generate one
    return req.headers['x-request-id'] as string || 
           `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractRequestContext(req: Request): any {
    return {
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      headers: this.sanitizeHeaders(req.headers),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      referrer: req.get('Referrer'),
      body: this.sanitizeBody(req.body),
      timestamp: new Date().toISOString()
    };
  }

  private sanitizeHeaders(headers: any): any {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    const sanitized = { ...headers };
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    const sanitized = { ...body };
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  private determineSeverity(error: MonitoredError, _req: Request): 'low' | 'medium' | 'high' | 'critical' {
    // Critical errors
    if (error.name === 'DatabaseConnectionError' || 
        error.message.includes('Redis connection failed') ||
        error.statusCode === 500) {
      return 'critical';
    }
    
    // High severity errors
    if (error.statusCode === 401 || 
        error.statusCode === 403 ||
        error.name === 'ValidationError') {
      return 'high';
    }
    
    // Medium severity errors
    if (error.statusCode === 404 || 
        error.statusCode === 429) {
      return 'medium';
    }
    
    // Default to low severity
    return 'low';
  }

  private getBreadcrumbs(sessionId: string): Breadcrumb[] {
    return this.breadcrumbs.get(sessionId) || [];
  }

  private logError(error: MonitoredError, _req: Request): void {
    const logData = {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        fingerprint: error.fingerprint,
        severity: error.severity
      },
      request: error.context,
      user: error.userId,
      breadcrumbs: error.breadcrumbs?.slice(-10) || [], // Last 10 breadcrumbs
      timestamp: new Date().toISOString()
    };

    switch (error.severity) {
      case 'critical':
        logger.error('CRITICAL ERROR:', logData);
        break;
      case 'high':
        logger.error('HIGH SEVERITY ERROR:', logData);
        break;
      case 'medium':
        logger.warn('MEDIUM SEVERITY ERROR:', logData);
        break;
      default:
        logger.info('LOW SEVERITY ERROR:', logData);
    }
  }

  private updateErrorMetrics(error: MonitoredError, req: Request): void {
    this.errorMetrics.totalErrors++;
    this.errorMetrics.lastError = new Date();

    // Update by type
    const errorType = error.name || 'UnknownError';
    this.errorMetrics.errorsByType[errorType] = (this.errorMetrics.errorsByType[errorType] || 0) + 1;

    // Update by user
    if (error.userId) {
      this.errorMetrics.errorsByUser[error.userId] = (this.errorMetrics.errorsByUser[error.userId] || 0) + 1;
    }

    // Update by endpoint
    const endpoint = req.path;
    this.errorMetrics.errorsByEndpoint[endpoint] = (this.errorMetrics.errorsByEndpoint[endpoint] || 0) + 1;

    // Update critical errors
    if (error.severity === 'critical') {
      this.errorMetrics.criticalErrors++;
    }
  }

  private async storeError(error: MonitoredError, _req: Request): Promise<void> {
    try {
      const errorData = {
        fingerprint: error.fingerprint,
        name: error.name,
        message: error.message,
        stack: error.stack,
        severity: error.severity,
        statusCode: error.statusCode,
        userId: error.userId,
        context: error.context,
        breadcrumbs: error.breadcrumbs,
        timestamp: Date.now()
      };

      // Store in Redis with 24-hour TTL
      await redisService.storeTemp(
        `error:${error.fingerprint}:${Date.now()}`,
        JSON.stringify(errorData),
        24 * 60 * 60 // 24 hours
      );

      // Also store error count by fingerprint for deduplication
      const existingCount = await redisService.getTemp(`error_count:${error.fingerprint}`) || '0';
      const newCount = parseInt(existingCount) + 1;
      await redisService.storeTemp(`error_count:${error.fingerprint}`, newCount.toString(), 24 * 60 * 60);

    } catch (storageError) {
      logger.error('Failed to store error data:', storageError);
    }
  }

  private checkAlerts(error?: MonitoredError): void {
    this.alertRules.forEach(rule => {
      if (!rule.enabled) return;

      // Check cooldown
      const lastAlert = this.alertCooldowns.get(rule.id);
      const now = Date.now();
      if (lastAlert && (now - lastAlert) < (rule.cooldown * 60 * 1000)) {
        return;
      }

      // Check condition
      if (rule.condition(this.errorMetrics, error)) {
        this.triggerAlert(rule, error);
        this.alertCooldowns.set(rule.id, now);
      }
    });
  }

  private triggerAlert(rule: AlertRule, error?: MonitoredError): void {
    const alertData = {
      rule: rule.name,
      metrics: this.errorMetrics,
      error: error ? {
        name: error.name,
        message: error.message,
        severity: error.severity,
        userId: error.userId
      } : undefined,
      timestamp: new Date().toISOString()
    };

    logger.error(`ALERT TRIGGERED: ${rule.name}`, alertData);

    switch (rule.action) {
      case 'webhook':
        this.sendWebhookAlert(rule, alertData);
        break;
      case 'email':
        this.sendEmailAlert(rule, alertData);
        break;
      case 'log':
        // Already logged above
        break;
    }
  }

  private async sendWebhookAlert(rule: AlertRule, data: any): Promise<void> {
    try {
      const webhookUrl = process.env.ERROR_WEBHOOK_URL;
      if (!webhookUrl) return;

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 Alert: ${rule.name}`,
          attachments: [{
            color: 'danger',
            fields: [
              { title: 'Rule', value: rule.name, short: true },
              { title: 'Total Errors', value: data.metrics.totalErrors.toString(), short: true },
              { title: 'Error Rate', value: `${data.metrics.errorRate}/min`, short: true },
              { title: 'Critical Errors', value: data.metrics.criticalErrors.toString(), short: true }
            ]
          }]
        })
      });

      if (!response.ok) {
        logger.error(`Webhook alert failed: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to send webhook alert:', error);
    }
  }

  private async sendEmailAlert(rule: AlertRule, data: any): Promise<void> {
    // Email implementation would go here
    // For now, just log that an email would be sent
    logger.info(`EMAIL ALERT: ${rule.name}`, data);
  }

  private calculateErrorRate(): void {
    // Calculate errors per minute based on errors in the last hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentErrors = this.errorBuffer.filter(err => err.timestamp && err.timestamp > oneHourAgo);
    this.errorMetrics.errorRate = recentErrors.length / 60; // errors per minute
  }

  private cleanupOldData(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    // Cleanup error buffer
    this.errorBuffer = this.errorBuffer.filter(err => err.timestamp && err.timestamp > oneHourAgo);
    
    // Cleanup breadcrumbs
    for (const [sessionId, breadcrumbs] of this.breadcrumbs.entries()) {
      const validBreadcrumbs = breadcrumbs.filter(b => b.timestamp > oneHourAgo);
      if (validBreadcrumbs.length === 0) {
        this.breadcrumbs.delete(sessionId);
      } else {
        this.breadcrumbs.set(sessionId, validBreadcrumbs);
      }
    }
  }

  private async storeMetricsSnapshot(): Promise<void> {
    try {
      await redisService.storeTemp(
        `error_metrics:${Date.now()}`,
        JSON.stringify(this.errorMetrics),
        24 * 60 * 60 // 24 hours
      );
    } catch (error) {
      logger.error('Failed to store metrics snapshot:', error);
    }
  }

  private sendErrorResponse(error: MonitoredError, _req: Request, res: Response): void {
    const statusCode = error.statusCode || 500;
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    const errorResponse = {
      error: true,
      message: isDevelopment ? error.message : 'An error occurred',
      ...(isDevelopment && { stack: error.stack }),
      requestId: error.requestId,
      timestamp: new Date().toISOString()
    };

    res.status(statusCode).json(errorResponse);
  }

  // Public methods for getting error data
  getMetrics(): ErrorMetrics {
    return { ...this.errorMetrics };
  }

  async getRecentErrors(limit: number = 50): Promise<any[]> {
    try {
      const keys = await redisService.getClient().keys('error:*');
      const recentKeys = keys
        .sort((a, b) => {
          const timestampA = parseInt(a.split(':').pop() || '0');
          const timestampB = parseInt(b.split(':').pop() || '0');
          return timestampB - timestampA;
        })
        .slice(0, limit);

      const errors = await Promise.all(
        recentKeys.map(async key => {
          const data = await redisService.getTemp(key);
          return data ? JSON.parse(data) : null;
        })
      );

      return errors.filter(Boolean);
    } catch (error) {
      logger.error('Failed to get recent errors:', error);
      return [];
    }
  }

  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean {
    const rule = this.alertRules.find(r => r.id === ruleId);
    if (rule) {
      Object.assign(rule, updates);
      logger.info(`Updated alert rule ${ruleId}:`, updates);
      return true;
    }
    return false;
  }
}

// Export singleton instance
export const errorMonitoring = new ErrorMonitoringService();

// Export middleware functions
export const { errorHandler, breadcrumbMiddleware } = errorMonitoring;

export default ErrorMonitoringService;