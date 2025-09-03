import { gmail_v1, google } from 'googleapis';
import { logger } from '../utils/logger';
import { tokenRefreshService } from './tokenRefresh';
import { redisService } from './redis';
import { Email, EmailLabel, EmailFilter, EmailListRequest, EmailListResponse, EmailUpdate } from '../../../shared/src/types/email';

// Custom error classes for Gmail API operations
export class GmailError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, code: string, statusCode?: number, isRetryable: boolean = false) {
    super(message);
    this.name = 'GmailError';
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export class GmailAuthError extends GmailError {
  constructor(message: string = 'Authentication failed', statusCode?: number) {
    super(message, 'AUTH_ERROR', statusCode, false);
    this.name = 'GmailAuthError';
  }
}

export class GmailRateLimitError extends GmailError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, true);
    this.name = 'GmailRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class GmailNotFoundError extends GmailError {
  constructor(message: string = 'Resource not found') {
    super(message, 'NOT_FOUND', 404, false);
    this.name = 'GmailNotFoundError';
  }
}

export class GmailQuotaExceededError extends GmailError {
  constructor(message: string = 'API quota exceeded') {
    super(message, 'QUOTA_EXCEEDED', 403, false);
    this.name = 'GmailQuotaExceededError';
  }
}

export class GmailNetworkError extends GmailError {
  constructor(message: string = 'Network error occurred') {
    super(message, 'NETWORK_ERROR', undefined, true);
    this.name = 'GmailNetworkError';
  }
}

export class GmailServerError extends GmailError {
  constructor(message: string = 'Gmail server error', statusCode?: number) {
    super(message, 'SERVER_ERROR', statusCode, true);
    this.name = 'GmailServerError';
  }
}

export class GmailValidationError extends GmailError {
  constructor(message: string = 'Invalid request parameters') {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'GmailValidationError';
  }
}

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiryDate?: number;
}

interface EmailCache {
  emails: Email[];
  timestamp: number;
  nextPageToken?: string;
}

interface LabelCache {
  labels: EmailLabel[];
  timestamp: number;
}

class GmailService {
  private gmail: gmail_v1.Gmail | null = null;
  private currentUserId: string | null = null;
  private emailCacheTTL = 5 * 60 * 1000; // 5 minutes
  private labelCacheTTL = 30 * 60 * 1000; // 30 minutes
  private maxRetries = 3;
  private baseDelay = 1000;

  constructor() {
    // Service starts without authentication - will authenticate per request
  }

  /**
   * Initialize Gmail API client with OAuth2 credentials for a specific user
   */
  private async initializeGmailClient(userId: string): Promise<void> {
    try {
      // Get valid tokens (this will refresh if needed)
      const tokens = await tokenRefreshService.getValidTokens(userId);

      // Create OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );

      // Set credentials
      oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
        expiry_date: tokens.expiryDate,
      });

      // Initialize Gmail API client
      this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      this.currentUserId = userId;

      logger.debug(`Gmail client initialized for user: ${userId}`);
    } catch (error) {
      logger.error(`Failed to initialize Gmail client for user ${userId}:`, error);
      throw new Error('Failed to initialize Gmail API client');
    }
  }

  /**
   * Ensure Gmail client is initialized for the given user
   */
  private async ensureAuthenticated(userId: string): Promise<void> {
    if (!this.gmail || this.currentUserId !== userId) {
      await this.initializeGmailClient(userId);
    }
  }

  /**
   * Execute Gmail API operation with retry logic and comprehensive error handling
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    userId: string
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        const gmailError = this.handleGmailError(error, operationName, userId);
        
        logger.warn(`${operationName} attempt ${attempt} failed for user ${userId}:`, {
          errorType: gmailError.name,
          errorCode: gmailError.code,
          statusCode: gmailError.statusCode,
          message: gmailError.message,
          isRetryable: gmailError.isRetryable,
        });

        // If error is not retryable, throw immediately
        if (!gmailError.isRetryable) {
          throw gmailError;
        }

        // Handle specific retryable error types
        if (gmailError instanceof GmailAuthError) {
          // Token might be expired, try to reinitialize
          logger.info(`Reinitializing Gmail client for user ${userId} due to auth error`);
          try {
            await this.initializeGmailClient(userId);
          } catch (initError) {
            logger.error(`Failed to reinitialize Gmail client for user ${userId}:`, initError);
            throw new GmailAuthError('Failed to refresh authentication');
          }
        } else if (gmailError instanceof GmailRateLimitError) {
          // Rate limit hit, use exponential backoff or respect Retry-After header
          const delay = gmailError.retryAfter 
            ? gmailError.retryAfter * 1000 
            : this.calculateBackoffDelay(attempt);
          
          logger.info(`Rate limit hit, waiting ${delay}ms before retry ${attempt + 1}`);
          await this.sleep(delay);
        } else if (gmailError instanceof GmailServerError || gmailError instanceof GmailNetworkError) {
          // Server or network error, retry with backoff
          const delay = this.calculateBackoffDelay(attempt);
          logger.info(`${gmailError.name}, waiting ${delay}ms before retry ${attempt + 1}`);
          await this.sleep(delay);
        }

        // If this is the last attempt, throw the custom error
        if (attempt >= this.maxRetries) {
          throw gmailError;
        }
      }
    }

    // This should never be reached, but TypeScript requires it
    throw this.handleGmailError(lastError, operationName, userId);
  }

  /**
   * Convert generic errors to specific Gmail error types
   */
  private handleGmailError(error: any, operationName: string, userId: string): GmailError {
    // Handle Google API errors
    if (error.response?.status || error.code) {
      const statusCode = error.response?.status || error.code;
      const message = error.message || error.response?.statusText || 'Unknown error';
      const errorDetails = error.response?.data?.error || {};

      switch (statusCode) {
        case 400:
          if (errorDetails.reason === 'invalid_grant' || message.includes('invalid_grant')) {
            return new GmailAuthError('Invalid or expired refresh token', 400);
          }
          return new GmailValidationError(message);
        
        case 401:
          return new GmailAuthError(message, 401);
        
        case 403:
          if (errorDetails.reason === 'quotaExceeded' || message.includes('quota')) {
            return new GmailQuotaExceededError(message);
          }
          return new GmailAuthError('Permission denied', 403);
        
        case 404:
          return new GmailNotFoundError(message);
        
        case 429:
          const retryAfter = error.response?.headers['retry-after'] 
            ? parseInt(error.response.headers['retry-after']) 
            : undefined;
          return new GmailRateLimitError(message, retryAfter);
        
        case 500:
        case 502:
        case 503:
        case 504:
          return new GmailServerError(message, statusCode);
        
        default:
          if (statusCode >= 400 && statusCode < 500) {
            return new GmailValidationError(message);
          } else if (statusCode >= 500) {
            return new GmailServerError(message, statusCode);
          }
      }
    }

    // Handle network errors
    if (error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.message?.includes('network') ||
        error.message?.includes('timeout')) {
      return new GmailNetworkError(error.message || 'Network error occurred');
    }

    // Handle token refresh errors
    if (error.message?.includes('refresh') || error.message?.includes('token')) {
      return new GmailAuthError(error.message || 'Token error');
    }

    // Generic error fallback
    return new GmailError(
      error.message || 'Unknown Gmail API error',
      'UNKNOWN_ERROR',
      undefined,
      false // Unknown errors are not retryable by default
    );
  }

  /**
   * Get cached emails or fetch from API
   */
  private async getCachedEmails(userId: string, cacheKey: string): Promise<EmailCache | null> {
    try {
      const cachedData = await redisService.getTemp(cacheKey);
      if (!cachedData) {
        return null;
      }

      const cache: EmailCache = JSON.parse(cachedData);
      const isExpired = Date.now() - cache.timestamp > this.emailCacheTTL;

      if (isExpired) {
        await redisService.deleteTemp(cacheKey);
        return null;
      }

      logger.debug(`Using cached emails for user ${userId}`);
      return cache;
    } catch (error) {
      logger.warn(`Error retrieving cached emails for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Cache emails for future use
   */
  private async cacheEmails(userId: string, cacheKey: string, emails: Email[], nextPageToken?: string): Promise<void> {
    try {
      const cache: EmailCache = {
        emails,
        timestamp: Date.now(),
        nextPageToken,
      };

      const ttlSeconds = Math.ceil(this.emailCacheTTL / 1000);
      await redisService.storeTemp(cacheKey, JSON.stringify(cache), ttlSeconds);

      logger.debug(`Cached ${emails.length} emails for user ${userId}`);
    } catch (error) {
      logger.warn(`Error caching emails for user ${userId}:`, error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Get cached labels or fetch from API
   */
  private async getCachedLabels(userId: string): Promise<LabelCache | null> {
    try {
      const cacheKey = `gmail:${userId}:labels`;
      const cachedData = await redisService.getTemp(cacheKey);
      
      if (!cachedData) {
        return null;
      }

      const cache: LabelCache = JSON.parse(cachedData);
      const isExpired = Date.now() - cache.timestamp > this.labelCacheTTL;

      if (isExpired) {
        await redisService.deleteTemp(cacheKey);
        return null;
      }

      logger.debug(`Using cached labels for user ${userId}`);
      return cache;
    } catch (error) {
      logger.warn(`Error retrieving cached labels for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Cache labels for future use
   */
  private async cacheLabels(userId: string, labels: EmailLabel[]): Promise<void> {
    try {
      const cacheKey = `gmail:${userId}:labels`;
      const cache: LabelCache = {
        labels,
        timestamp: Date.now(),
      };

      const ttlSeconds = Math.ceil(this.labelCacheTTL / 1000);
      await redisService.storeTemp(cacheKey, JSON.stringify(cache), ttlSeconds);

      logger.debug(`Cached ${labels.length} labels for user ${userId}`);
    } catch (error) {
      logger.warn(`Error caching labels for user ${userId}:`, error);
      // Don't throw - caching is optional
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
   * Validate user ID
   */
  private validateUserId(userId: string): void {
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new GmailValidationError('Invalid user ID provided');
    }
  }

  /**
   * Validate message ID
   */
  private validateMessageId(messageId: string): void {
    if (!messageId || typeof messageId !== 'string' || messageId.trim().length === 0) {
      throw new GmailValidationError('Invalid message ID provided');
    }
  }

  /**
   * Validate message IDs array
   */
  private validateMessageIds(messageIds: string[]): void {
    if (!Array.isArray(messageIds)) {
      throw new GmailValidationError('Message IDs must be an array');
    }
    if (messageIds.length === 0) {
      throw new GmailValidationError('At least one message ID is required');
    }
    if (messageIds.length > 1000) {
      throw new GmailValidationError('Too many message IDs (maximum 1000 allowed)');
    }
    messageIds.forEach((id, index) => {
      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        throw new GmailValidationError(`Invalid message ID at index ${index}`);
      }
    });
  }

  /**
   * Validate email list request
   */
  private validateEmailListRequest(request?: EmailListRequest): void {
    if (!request) return;

    if (request.pageSize !== undefined) {
      if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 500) {
        throw new GmailValidationError('Page size must be between 1 and 500');
      }
    }

    if (request.filter) {
      const filter = request.filter;
      
      if (filter.labels && (!Array.isArray(filter.labels) || filter.labels.some(l => typeof l !== 'string'))) {
        throw new GmailValidationError('Labels filter must be an array of strings');
      }
      
      if (filter.from !== undefined && typeof filter.from !== 'string') {
        throw new GmailValidationError('From filter must be a string');
      }
      
      if (filter.subject !== undefined && typeof filter.subject !== 'string') {
        throw new GmailValidationError('Subject filter must be a string');
      }
      
      if (filter.after !== undefined && !(filter.after instanceof Date)) {
        throw new GmailValidationError('After filter must be a Date object');
      }
      
      if (filter.before !== undefined && !(filter.before instanceof Date)) {
        throw new GmailValidationError('Before filter must be a Date object');
      }
      
      if (filter.after && filter.before && filter.after > filter.before) {
        throw new GmailValidationError('After date cannot be later than before date');
      }
    }
  }

  /**
   * Fetch emails with parallel queries for different label combinations
   */
  async fetchEmails(userId: string, request?: EmailListRequest): Promise<EmailListResponse> {
    this.validateUserId(userId);
    this.validateEmailListRequest(request);
    
    await this.ensureAuthenticated(userId);

    const cacheKey = this.generateCacheKey(userId, request);
    
    // Try to get from cache first
    const cachedResult = await this.getCachedEmails(userId, cacheKey);
    if (cachedResult) {
      return {
        emails: cachedResult.emails,
        nextPageToken: cachedResult.nextPageToken,
        totalCount: cachedResult.emails.length,
      };
    }

    // Fetch all labels to map IDs to names
    const labels = await this.listLabels(userId);
    const labelMap = new Map<string, string>();
    labels.forEach(label => {
      if (label.id) {
        labelMap.set(label.id, label.name || label.id);
      }
    });

    return await this.executeWithRetry(
      async () => {
        const queries = this.buildQueries(request);
        const pageSize = request?.pageSize || 50;
        const pageToken = request?.pageToken;

        // Execute all queries in parallel
        const queryPromises = queries.map(async (query) => {
          try {
            const response = await this.gmail!.users.messages.list({
              userId: 'me',
              q: query,
              maxResults: pageSize,
              pageToken: pageToken,
            });

            return {
              query,
              messageIds: response.data.messages || [],
              nextPageToken: response.data.nextPageToken,
            };
          } catch (error) {
            logger.error(`Error executing query "${query}" for user ${userId}:`, error);
            return {
              query,
              messageIds: [],
              nextPageToken: undefined,
            };
          }
        });

        const queryResults = await Promise.all(queryPromises);
        
        // Collect all unique message IDs
        const allMessageIds = new Set<string>();
        let globalNextPageToken: string | undefined;

        queryResults.forEach(result => {
          result.messageIds.forEach(msg => {
            if (msg.id) {
              allMessageIds.add(msg.id);
            }
          });
          // Use the first available next page token
          if (result.nextPageToken && !globalNextPageToken) {
            globalNextPageToken = result.nextPageToken;
          }
        });

        const uniqueMessageIds = Array.from(allMessageIds);
        logger.info(`Found ${uniqueMessageIds.length} unique messages for user ${userId}`);

        // Fetch full message details
        const emails = await this.fetchMessageDetails(userId, uniqueMessageIds, labelMap);

        // Apply additional filtering if needed
        const filteredEmails = this.applyFilters(emails, request?.filter);

        // Apply sorting
        const sortedEmails = this.applySort(filteredEmails, request?.sortBy, request?.sortOrder);

        // Cache the results
        await this.cacheEmails(userId, cacheKey, sortedEmails, globalNextPageToken);

        return {
          emails: sortedEmails,
          nextPageToken: globalNextPageToken,
          totalCount: sortedEmails.length,
        };
      },
      'fetchEmails',
      userId
    );
  }

  /**
   * Build Gmail search queries based on filters
   */
  private buildQueries(request?: EmailListRequest): string[] {
    const queries: string[] = [];
    
    if (!request?.filter) {
      // Default queries when no filter is specified
      queries.push('is:unread in:inbox');
      queries.push('label:Notify');
      queries.push('label:Action-Item');
    } else {
      const filter = request.filter;
      let query = '';

      // Build query parts
      const queryParts: string[] = [];

      if (filter.isUnread !== undefined) {
        queryParts.push(filter.isUnread ? 'is:unread' : '-is:unread');
      }

      if (filter.labels && filter.labels.length > 0) {
        filter.labels.forEach(label => {
          queryParts.push(`label:${label}`);
        });
      }

      if (filter.from) {
        queryParts.push(`from:${filter.from}`);
      }

      if (filter.subject) {
        queryParts.push(`subject:${filter.subject}`);
      }

      if (filter.after) {
        const afterDate = filter.after.toISOString().split('T')[0];
        queryParts.push(`after:${afterDate}`);
      }

      if (filter.before) {
        const beforeDate = filter.before.toISOString().split('T')[0];
        queryParts.push(`before:${beforeDate}`);
      }

      if (filter.hasAttachment !== undefined) {
        queryParts.push(filter.hasAttachment ? 'has:attachment' : '-has:attachment');
      }

      queries.push(queryParts.join(' '));
    }

    return queries.filter(q => q.length > 0);
  }

  /**
   * Generate cache key based on request parameters
   */
  private generateCacheKey(userId: string, request?: EmailListRequest): string {
    let keyParts = [`gmail:${userId}:emails`];
    
    if (!request?.filter) {
      keyParts.push('default');
    } else {
      const filter = request.filter;
      
      if (filter.isUnread !== undefined) {
        keyParts.push(filter.isUnread ? 'unread' : 'read');
      }
      
      if (filter.labels && filter.labels.length > 0) {
        keyParts.push(`labels:${filter.labels.sort().join(',')}`);
      }
      
      if (filter.from) {
        keyParts.push(`from:${filter.from}`);
      }
    }

    if (request?.pageToken) {
      keyParts.push(`page:${request.pageToken}`);
    }

    return keyParts.join(':');
  }

  /**
   * Fetch full message details for a list of message IDs
   */
  private async fetchMessageDetails(userId: string, messageIds: string[], labelMap?: Map<string, string>): Promise<Email[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const batchSize = 50; // Process messages in batches to avoid rate limits
    const emails: Email[] = [];

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (messageId) => {
        try {
          const response = await this.gmail!.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full', // Get full message including body
          });

          return this.parseGmailMessage(response.data, labelMap);
        } catch (error) {
          logger.warn(`Error fetching message ${messageId} for user ${userId}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const validEmails = batchResults.filter((email): email is Email => email !== null);
      emails.push(...validEmails);

      // Add delay between batches to respect rate limits
      if (i + batchSize < messageIds.length) {
        await this.sleep(100); // 100ms delay between batches
      }
    }

    logger.debug(`Successfully parsed ${emails.length} out of ${messageIds.length} messages for user ${userId}`);
    return emails;
  }

  /**
   * Parse Gmail message format into application's Email interface
   */
  private parseGmailMessage(message: gmail_v1.Schema$Message, labelMap?: Map<string, string>): Email | null {
    try {
      if (!message.id || !message.payload) {
        return null;
      }

      const headers = message.payload.headers || [];
      const subject = this.getHeaderValue(headers, 'Subject') || '(No Subject)';
      const from = this.getHeaderValue(headers, 'From') || '';
      const to = this.getHeaderValue(headers, 'To')?.split(',').map(addr => addr.trim()) || [];
      const date = this.getHeaderValue(headers, 'Date') || new Date().toISOString();

      // Extract email address from "Name <email>" format
      const fromEmailMatch = from.match(/<([^>]+)>/);
      const fromEmail = fromEmailMatch ? fromEmailMatch[1] : from;

      // Parse body content
      const body = this.extractEmailBody(message.payload);
      
      // Get labels
      const labelIds = message.labelIds || [];
      const isUnread = labelIds.includes('UNREAD');
      
      // Map label IDs to names if we have a label map
      const labels = labelMap 
        ? labelIds.map(id => labelMap.get(id) || id)
        : labelIds;

      // Parse attachments if any
      const attachments = this.extractAttachments(message.payload);

      return {
        id: message.id,
        threadId: message.threadId || message.id,
        subject,
        from,
        fromEmail,
        to,
        date: new Date(date).toISOString(),
        snippet: message.snippet || '',
        body,
        labels: labels,
        labelIds: labelIds,
        isUnread,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    } catch (error) {
      logger.error(`Error parsing Gmail message ${message.id}:`, error);
      return null;
    }
  }

  /**
   * Get header value by name
   */
  private getHeaderValue(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string | undefined {
    const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
    return header?.value;
  }

  /**
   * Extract email body from message payload
   */
  private extractEmailBody(payload: gmail_v1.Schema$MessagePart): string {
    try {
      // Try to find HTML part first
      let htmlPart = this.findPartByMimeType(payload, 'text/html');
      if (htmlPart && htmlPart.body?.data) {
        const htmlBody = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
        return this.htmlToText(htmlBody);
      }

      // Fall back to plain text
      let textPart = this.findPartByMimeType(payload, 'text/plain');
      if (textPart && textPart.body?.data) {
        return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }

      // If direct body data is available
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }

      return '';
    } catch (error) {
      logger.warn('Error extracting email body:', error);
      return '';
    }
  }

  /**
   * Find message part by MIME type
   */
  private findPartByMimeType(payload: gmail_v1.Schema$MessagePart, mimeType: string): gmail_v1.Schema$MessagePart | null {
    if (payload.mimeType === mimeType) {
      return payload;
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        const found = this.findPartByMimeType(part, mimeType);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Convert HTML to plain text (basic implementation)
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Extract attachments from message payload
   */
  private extractAttachments(payload: gmail_v1.Schema$MessagePart): any[] {
    const attachments: any[] = [];

    const findAttachments = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }

      if (part.parts) {
        part.parts.forEach(findAttachments);
      }
    };

    findAttachments(payload);
    return attachments;
  }

  /**
   * Apply additional filters to emails (for filters not supported by Gmail API)
   */
  private applyFilters(emails: Email[], filter?: EmailFilter): Email[] {
    if (!filter) {
      return emails;
    }

    return emails.filter(email => {
      // All Gmail API supported filters are already applied
      // This is for any additional client-side filtering if needed
      return true;
    });
  }

  /**
   * Apply sorting to emails
   */
  private applySort(emails: Email[], sortBy?: string, sortOrder?: string): Email[] {
    if (!sortBy) {
      // Default sort by date descending (newest first)
      return emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const isAsc = sortOrder === 'asc';

    return emails.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'from':
          comparison = a.from.localeCompare(b.from);
          break;
        case 'subject':
          comparison = a.subject.localeCompare(b.subject);
          break;
        default:
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
      }

      return isAsc ? comparison : -comparison;
    });
  }

  /**
   * List all available Gmail labels for the user
   */
  async listLabels(userId: string): Promise<EmailLabel[]> {
    this.validateUserId(userId);
    await this.ensureAuthenticated(userId);

    // Try to get from cache first
    const cachedLabels = await this.getCachedLabels(userId);
    if (cachedLabels) {
      return cachedLabels.labels;
    }

    return await this.executeWithRetry(
      async () => {
        const response = await this.gmail!.users.labels.list({
          userId: 'me',
        });

        const labels: EmailLabel[] = (response.data.labels || []).map(label => ({
          id: label.id!,
          name: label.name!,
          type: this.getLabelType(label.type),
          color: label.color ? {
            backgroundColor: label.color.backgroundColor || '#000000',
            textColor: label.color.textColor || '#ffffff',
          } : undefined,
        }));

        // Cache the labels
        await this.cacheLabels(userId, labels);

        logger.debug(`Retrieved ${labels.length} labels for user ${userId}`);
        return labels;
      },
      'listLabels',
      userId
    );
  }

  /**
   * Get label type from Gmail API label type
   */
  private getLabelType(type?: string): 'system' | 'user' {
    return type === 'system' ? 'system' : 'user';
  }

  /**
   * Toggle label on a message (add or remove)
   */
  async toggleLabel(userId: string, messageId: string, labelName: string, add: boolean): Promise<void> {
    this.validateUserId(userId);
    this.validateMessageId(messageId);
    
    if (!labelName || typeof labelName !== 'string' || labelName.trim().length === 0) {
      throw new GmailValidationError('Invalid label name provided');
    }
    
    await this.ensureAuthenticated(userId);

    return await this.executeWithRetry(
      async () => {
        // Get all labels to find the label ID
        const labels = await this.listLabels(userId);
        
        // First try exact match
        let label = labels.find(l => l.name === labelName);
        
        // If not found, try case-insensitive match
        if (!label) {
          label = labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
        }
        
        // If still not found, try with space/hyphen variations
        if (!label) {
          const variations = [
            labelName.replace(/-/g, ' '),  // Replace hyphens with spaces
            labelName.replace(/ /g, '-'),  // Replace spaces with hyphens
            labelName.replace(/-/g, ''),   // Remove hyphens
            labelName.replace(/ /g, ''),   // Remove spaces
          ];
          
          for (const variation of variations) {
            label = labels.find(l => l.name.toLowerCase() === variation.toLowerCase());
            if (label) break;
          }
        }

        if (!label) {
          // Try to create the label if it doesn't exist (for user labels)
          if (this.isValidCustomLabelName(labelName)) {
            try {
              const createdLabel = await this.createLabel(userId, labelName);
              if (createdLabel) {
                await this.modifyMessageLabels(userId, messageId, add ? [createdLabel.id] : [], add ? [] : [createdLabel.id]);
                return;
              }
            } catch (createError: any) {
              // If creation failed due to conflict, try to find the label again with variations
              if (createError.message?.includes('exists') || createError.message?.includes('conflict')) {
                logger.warn(`Label creation failed due to conflict, attempting to find existing label with variations`);
                
                // Clear the label cache and retry
                const labelCacheKey = `gmail:${userId}:labels`;
                await redisService.deleteTemp(labelCacheKey);
                
                // Get fresh labels
                const freshLabels = await this.listLabels(userId);
                
                // Try all variations again with fresh labels
                const variations = [
                  labelName,
                  labelName.replace(/-/g, ' '),
                  labelName.replace(/ /g, '-'),
                  labelName.replace(/-/g, ''),
                  labelName.replace(/ /g, ''),
                ];
                
                for (const variation of variations) {
                  label = freshLabels.find(l => l.name.toLowerCase() === variation.toLowerCase());
                  if (label) {
                    logger.info(`Found existing label "${label.name}" as variation of "${labelName}"`);
                    break;
                  }
                }
                
                if (!label) {
                  throw new Error(`Label "${labelName}" exists but could not be found with any variation`);
                }
              } else {
                throw createError;
              }
            }
          } else {
            throw new Error(`Label "${labelName}" not found and could not be created`);
          }
        }

        await this.modifyMessageLabels(
          userId, 
          messageId, 
          add ? [label.id] : [], 
          add ? [] : [label.id]
        );

        logger.debug(`${add ? 'Added' : 'Removed'} label "${label.name}" ${add ? 'to' : 'from'} message ${messageId} for user ${userId}`);
      },
      'toggleLabel',
      userId
    );
  }

  /**
   * Create a new user label
   */
  async createLabel(userId: string, labelName: string, color?: { backgroundColor: string; textColor: string }): Promise<EmailLabel | null> {
    await this.ensureAuthenticated(userId);

    if (!this.isValidCustomLabelName(labelName)) {
      throw new Error(`Invalid label name: ${labelName}`);
    }

    return await this.executeWithRetry(
      async () => {
        const labelRequest: gmail_v1.Schema$Label = {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        };

        if (color) {
          labelRequest.color = {
            backgroundColor: color.backgroundColor,
            textColor: color.textColor,
          };
        }

        const response = await this.gmail!.users.labels.create({
          userId: 'me',
          requestBody: labelRequest,
        });

        if (!response.data.id || !response.data.name) {
          throw new Error('Failed to create label - no ID returned');
        }

        const createdLabel: EmailLabel = {
          id: response.data.id,
          name: response.data.name,
          type: 'user',
          color: response.data.color ? {
            backgroundColor: response.data.color.backgroundColor || '#000000',
            textColor: response.data.color.textColor || '#ffffff',
          } : undefined,
        };

        // Clear labels cache to force refresh
        const labelCacheKey = `gmail:${userId}:labels`;
        await redisService.deleteTemp(labelCacheKey);

        logger.info(`Created label "${labelName}" for user ${userId}`);
        return createdLabel;
      },
      'createLabel',
      userId
    );
  }

  /**
   * Delete a user label
   */
  async deleteLabel(userId: string, labelId: string): Promise<void> {
    await this.ensureAuthenticated(userId);

    return await this.executeWithRetry(
      async () => {
        // Verify it's a user label (not system label)
        const labels = await this.listLabels(userId);
        const label = labels.find(l => l.id === labelId);
        
        if (!label) {
          throw new Error(`Label with ID "${labelId}" not found`);
        }

        if (label.type === 'system') {
          throw new Error('Cannot delete system labels');
        }

        await this.gmail!.users.labels.delete({
          userId: 'me',
          id: labelId,
        });

        // Clear labels cache to force refresh
        const labelCacheKey = `gmail:${userId}:labels`;
        await redisService.deleteTemp(labelCacheKey);

        logger.info(`Deleted label "${label.name}" for user ${userId}`);
      },
      'deleteLabel',
      userId
    );
  }

  /**
   * Batch toggle labels on multiple messages
   */
  async batchToggleLabel(userId: string, messageIds: string[], labelName: string, add: boolean): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    await this.ensureAuthenticated(userId);

    // Get the label ID
    const labels = await this.listLabels(userId);
    let label = labels.find(l => l.name === labelName);

    if (!label && this.isValidCustomLabelName(labelName)) {
      // Create the label if it doesn't exist
      label = await this.createLabel(userId, labelName);
    }

    if (!label) {
      throw new Error(`Label "${labelName}" not found and could not be created`);
    }

    const batchSize = 100; // Gmail API batch limit
    
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(messageId =>
        this.executeWithRetry(
          async () => {
            await this.modifyMessageLabels(
              userId,
              messageId,
              add ? [label!.id] : [],
              add ? [] : [label!.id]
            );
          },
          'batchToggleLabel',
          userId
        ).catch(error => {
          logger.warn(`Failed to ${add ? 'add' : 'remove'} label "${labelName}" ${add ? 'to' : 'from'} message ${messageId}:`, error);
        })
      );

      await Promise.all(batchPromises);

      // Add delay between batches to respect rate limits
      if (i + batchSize < messageIds.length) {
        await this.sleep(200); // 200ms delay between batches
      }
    }

    logger.info(`${add ? 'Added' : 'Removed'} label "${labelName}" ${add ? 'to' : 'from'} ${messageIds.length} messages for user ${userId}`);
  }

  /**
   * Modify message labels using Gmail API
   */
  private async modifyMessageLabels(userId: string, messageId: string, addLabelIds: string[], removeLabelIds: string[]): Promise<void> {
    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      return;
    }

    await this.gmail!.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: addLabelIds.length > 0 ? addLabelIds : undefined,
        removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
      },
    });

    // Clear email caches since labels have changed
    await this.clearEmailCaches(userId);
  }

  /**
   * Check if a label name is valid for custom labels
   */
  private isValidCustomLabelName(labelName: string): boolean {
    // Gmail label name restrictions
    return (
      labelName.length > 0 &&
      labelName.length <= 50 &&
      !labelName.startsWith('CATEGORY_') &&
      !labelName.startsWith('CHAT') &&
      !labelName.includes('/')
    );
  }

  /**
   * Toggle read/unread status of a message
   */
  async toggleReadStatus(userId: string, messageId: string, markAsRead: boolean): Promise<void> {
    this.validateUserId(userId);
    this.validateMessageId(messageId);
    await this.ensureAuthenticated(userId);

    return await this.executeWithRetry(
      async () => {
        const request = markAsRead 
          ? { removeLabelIds: ['UNREAD'] }
          : { addLabelIds: ['UNREAD'] };

        await this.gmail!.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: request,
        });

        // Clear email caches since read status has changed
        await this.clearEmailCaches(userId);

        logger.debug(`Marked message ${messageId} as ${markAsRead ? 'read' : 'unread'} for user ${userId}`);
      },
      'toggleReadStatus',
      userId
    );
  }

  /**
   * Mark multiple messages as read or unread
   */
  async batchToggleReadStatus(userId: string, messageIds: string[], markAsRead: boolean): Promise<void> {
    this.validateUserId(userId);
    this.validateMessageIds(messageIds);
    
    if (messageIds.length === 0) {
      return;
    }

    await this.ensureAuthenticated(userId);

    const batchSize = 100; // Gmail API batch limit
    
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(messageId =>
        this.executeWithRetry(
          async () => {
            await this.toggleReadStatus(userId, messageId, markAsRead);
          },
          'batchToggleReadStatus',
          userId
        ).catch(error => {
          logger.warn(`Failed to mark message ${messageId} as ${markAsRead ? 'read' : 'unread'}:`, error);
        })
      );

      await Promise.all(batchPromises);

      // Add delay between batches to respect rate limits
      if (i + batchSize < messageIds.length) {
        await this.sleep(200); // 200ms delay between batches
      }
    }

    logger.info(`Marked ${messageIds.length} messages as ${markAsRead ? 'read' : 'unread'} for user ${userId}`);
  }

  /**
   * Update email with multiple operations (read status and labels)
   */
  async updateEmail(userId: string, messageId: string, update: EmailUpdate): Promise<void> {
    await this.ensureAuthenticated(userId);

    return await this.executeWithRetry(
      async () => {
        const addLabelIds: string[] = [];
        const removeLabelIds: string[] = [];

        // Handle read/unread status
        if (update.markAsRead === true) {
          removeLabelIds.push('UNREAD');
        } else if (update.markAsUnread === true) {
          addLabelIds.push('UNREAD');
        }

        // Handle label additions
        if (update.addLabels && update.addLabels.length > 0) {
          const labels = await this.listLabels(userId);
          
          for (const labelName of update.addLabels) {
            const label = labels.find(l => l.name === labelName);
            if (label) {
              addLabelIds.push(label.id);
            } else if (this.isValidCustomLabelName(labelName)) {
              // Create label if it doesn't exist
              const createdLabel = await this.createLabel(userId, labelName);
              if (createdLabel) {
                addLabelIds.push(createdLabel.id);
              }
            }
          }
        }

        // Handle label removals
        if (update.removeLabels && update.removeLabels.length > 0) {
          const labels = await this.listLabels(userId);
          
          for (const labelName of update.removeLabels) {
            const label = labels.find(l => l.name === labelName);
            if (label) {
              removeLabelIds.push(label.id);
            }
          }
        }

        // Apply all changes in a single API call
        if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
          await this.modifyMessageLabels(userId, messageId, addLabelIds, removeLabelIds);
        }

        logger.debug(`Updated message ${messageId} for user ${userId}:`, {
          addedLabels: addLabelIds.length,
          removedLabels: removeLabelIds.length,
          markAsRead: update.markAsRead,
          markAsUnread: update.markAsUnread,
        });
      },
      'updateEmail',
      userId
    );
  }

  /**
   * Batch update multiple emails with the same operations
   */
  async batchUpdateEmails(userId: string, messageIds: string[], update: EmailUpdate): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    await this.ensureAuthenticated(userId);

    const batchSize = 50; // Smaller batch size for complex operations
    
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(messageId =>
        this.executeWithRetry(
          async () => {
            await this.updateEmail(userId, messageId, update);
          },
          'batchUpdateEmails',
          userId
        ).catch(error => {
          logger.warn(`Failed to update message ${messageId}:`, error);
        })
      );

      await Promise.all(batchPromises);

      // Add delay between batches to respect rate limits
      if (i + batchSize < messageIds.length) {
        await this.sleep(300); // 300ms delay between batches for complex operations
      }
    }

    logger.info(`Updated ${messageIds.length} messages for user ${userId}`);
  }

  /**
   * Get message details by ID (useful for checking current status)
   */
  async getEmailById(userId: string, messageId: string): Promise<Email | null> {
    await this.ensureAuthenticated(userId);

    return await this.executeWithRetry(
      async () => {
        const response = await this.gmail!.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        });

        return this.parseGmailMessage(response.data);
      },
      'getEmailById',
      userId
    );
  }

  /**
   * Clear email caches (called when labels are modified)
   */
  private async clearEmailCaches(userId: string): Promise<void> {
    const emailCacheKeys = [
      `gmail:${userId}:emails:unread`,
      `gmail:${userId}:emails:notify`,
      `gmail:${userId}:emails:action`,
      `gmail:${userId}:emails:default`,
    ];

    await Promise.all(emailCacheKeys.map(key => redisService.deleteTemp(key)));
  }

  /**
   * Clear all cached data for a user
   */
  async clearCache(userId: string): Promise<void> {
    try {
      // Clear email caches
      const emailCacheKeys = [
        `gmail:${userId}:emails:unread`,
        `gmail:${userId}:emails:notify`,
        `gmail:${userId}:emails:action`,
        `gmail:${userId}:emails:all`,
      ];

      // Clear label cache
      const labelCacheKey = `gmail:${userId}:labels`;

      await Promise.all([
        ...emailCacheKeys.map(key => redisService.deleteTemp(key)),
        redisService.deleteTemp(labelCacheKey),
      ]);

      logger.info(`Cleared Gmail cache for user ${userId}`);
    } catch (error) {
      logger.warn(`Error clearing Gmail cache for user ${userId}:`, error);
    }
  }

  /**
   * Get the current history ID for a user's mailbox
   */
  async getHistoryId(userId: string): Promise<string> {
    this.validateUserId(userId);
    await this.ensureAuthenticated(userId);

    return await this.executeWithRetry(
      async () => {
        const response = await this.gmail!.users.getProfile({
          userId: 'me',
        });

        if (!response.data.historyId) {
          throw new GmailError('No history ID returned from Gmail API', 'NO_HISTORY_ID');
        }

        logger.debug(`Got history ID ${response.data.historyId} for user ${userId}`);
        return response.data.historyId;
      },
      'getHistoryId',
      userId
    );
  }

  /**
   * Get history changes since a specific history ID
   */
  async getHistoryChanges(userId: string, startHistoryId: string, pageToken?: string): Promise<{
    history: gmail_v1.Schema$History[];
    nextPageToken?: string;
    newHistoryId: string;
  }> {
    this.validateUserId(userId);
    await this.ensureAuthenticated(userId);

    if (!startHistoryId) {
      throw new GmailValidationError('Start history ID is required');
    }

    return await this.executeWithRetry(
      async () => {
        const response = await this.gmail!.users.history.list({
          userId: 'me',
          startHistoryId: startHistoryId,
          pageToken: pageToken,
          maxResults: 500, // Maximum allowed by Gmail API
          historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        });

        const history = response.data.history || [];
        const nextPageToken = response.data.nextPageToken;
        const newHistoryId = response.data.historyId || startHistoryId;

        logger.debug(`Retrieved ${history.length} history entries for user ${userId}`, {
          startHistoryId,
          newHistoryId,
          hasNextPage: !!nextPageToken,
        });

        return {
          history,
          nextPageToken,
          newHistoryId,
        };
      },
      'getHistoryChanges',
      userId
    );
  }

  /**
   * Perform full initial sync to get current state and history ID
   */
  async performInitialSync(userId: string): Promise<{
    emails: Email[];
    historyId: string;
    totalCount: number;
  }> {
    this.validateUserId(userId);
    await this.ensureAuthenticated(userId);

    logger.info(`Performing initial sync for user ${userId}`);

    return await this.executeWithRetry(
      async () => {
        // Get current history ID first
        const historyId = await this.getHistoryId(userId);

        // Fetch emails using existing fetchEmails method
        const emailResponse = await this.fetchEmails(userId, {
          pageSize: 100, // Larger batch for initial sync
        });

        logger.info(`Initial sync completed for user ${userId}`, {
          emailCount: emailResponse.emails.length,
          historyId,
        });

        return {
          emails: emailResponse.emails,
          historyId,
          totalCount: emailResponse.totalCount,
        };
      },
      'performInitialSync',
      userId
    );
  }

  /**
   * Process a single history entry and return affected message IDs
   */
  private processHistoryEntry(historyEntry: gmail_v1.Schema$History): {
    addedMessageIds: string[];
    deletedMessageIds: string[];
    labelChangedMessageIds: string[];
  } {
    const addedMessageIds: string[] = [];
    const deletedMessageIds: string[] = [];
    const labelChangedMessageIds: string[] = [];

    // Process message additions
    if (historyEntry.messagesAdded) {
      for (const added of historyEntry.messagesAdded) {
        if (added.message?.id) {
          addedMessageIds.push(added.message.id);
        }
      }
    }

    // Process message deletions
    if (historyEntry.messagesDeleted) {
      for (const deleted of historyEntry.messagesDeleted) {
        if (deleted.message?.id) {
          deletedMessageIds.push(deleted.message.id);
        }
      }
    }

    // Process label changes (both additions and removals)
    if (historyEntry.labelsAdded) {
      for (const labelAdded of historyEntry.labelsAdded) {
        if (labelAdded.message?.id) {
          labelChangedMessageIds.push(labelAdded.message.id);
        }
      }
    }

    if (historyEntry.labelsRemoved) {
      for (const labelRemoved of historyEntry.labelsRemoved) {
        if (labelRemoved.message?.id) {
          labelChangedMessageIds.push(labelRemoved.message.id);
        }
      }
    }

    return {
      addedMessageIds,
      deletedMessageIds,
      labelChangedMessageIds,
    };
  }

  /**
   * Process history changes and return structured change data
   */
  async processHistoryChanges(userId: string, startHistoryId: string): Promise<{
    changes: {
      addedMessages: Email[];
      deletedMessageIds: string[];
      updatedMessages: Email[];
    };
    newHistoryId: string;
    hasMoreChanges: boolean;
  }> {
    this.validateUserId(userId);

    let allAddedMessageIds = new Set<string>();
    let allDeletedMessageIds = new Set<string>();
    let allLabelChangedMessageIds = new Set<string>();
    let currentHistoryId = startHistoryId;
    let hasMoreChanges = false;
    let nextPageToken: string | undefined;

    // Fetch all history changes (handle pagination)
    do {
      const historyResponse = await this.getHistoryChanges(userId, currentHistoryId, nextPageToken);
      
      // Process each history entry
      for (const historyEntry of historyResponse.history) {
        const changes = this.processHistoryEntry(historyEntry);
        
        changes.addedMessageIds.forEach(id => allAddedMessageIds.add(id));
        changes.deletedMessageIds.forEach(id => allDeletedMessageIds.add(id));
        changes.labelChangedMessageIds.forEach(id => allLabelChangedMessageIds.add(id));
      }

      currentHistoryId = historyResponse.newHistoryId;
      nextPageToken = historyResponse.nextPageToken;
      hasMoreChanges = !!nextPageToken;

      // Break if no more pages (for this batch)
      if (!nextPageToken) {
        break;
      }
    } while (nextPageToken);

    // Remove deleted messages from other sets to avoid conflicts
    allDeletedMessageIds.forEach(id => {
      allAddedMessageIds.delete(id);
      allLabelChangedMessageIds.delete(id);
    });

    // Fetch full details for added and updated messages
    const addedMessageIds = Array.from(allAddedMessageIds);
    const labelChangedMessageIds = Array.from(allLabelChangedMessageIds);
    const deletedMessageIds = Array.from(allDeletedMessageIds);

    const [addedMessages, updatedMessages] = await Promise.all([
      addedMessageIds.length > 0 ? this.fetchMessageDetails(userId, addedMessageIds) : [],
      labelChangedMessageIds.length > 0 ? this.fetchMessageDetails(userId, labelChangedMessageIds) : [],
    ]);

    logger.info(`Processed history changes for user ${userId}`, {
      addedCount: addedMessages.length,
      deletedCount: deletedMessageIds.length,
      updatedCount: updatedMessages.length,
      newHistoryId: currentHistoryId,
    });

    return {
      changes: {
        addedMessages,
        deletedMessageIds,
        updatedMessages,
      },
      newHistoryId: currentHistoryId,
      hasMoreChanges,
    };
  }
}

// Export singleton instance
export const gmailService = new GmailService();

// Export the class for testing
export default GmailService;