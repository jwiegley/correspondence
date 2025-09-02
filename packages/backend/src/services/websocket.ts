import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { redisService } from './redis';

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  authenticated?: boolean;
}

export interface WebSocketMetrics {
  totalConnections: number;
  authenticatedConnections: number;
  messagesSent: number;
  messagesReceived: number;
  connectionErrors: number;
  lastActivity: Date;
}

/**
 * WebSocket service for real-time email sync updates
 * Handles Socket.io server setup, authentication, and message broadcasting
 */
export class WebSocketService {
  private io: SocketIOServer | null = null;
  private authenticatedSockets = new Map<string, Set<string>>(); // userId -> Set of socketIds
  private socketUserMap = new Map<string, string>(); // socketId -> userId
  private metrics: WebSocketMetrics = {
    totalConnections: 0,
    authenticatedConnections: 0,
    messagesSent: 0,
    messagesReceived: 0,
    connectionErrors: 0,
    lastActivity: new Date(),
  };

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 60000; // 1 minute

  /**
   * Initialize WebSocket server
   */
  initialize(httpServer: HttpServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: this.CONNECTION_TIMEOUT,
      pingInterval: this.HEARTBEAT_INTERVAL / 2,
      allowEIO3: true,
    });

    this.setupEventHandlers();
    this.startHeartbeat();

    logger.info('WebSocket server initialized');
  }

  /**
   * Set up Socket.io event handlers
   */
  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: AuthenticatedSocket) => {
      this.handleConnection(socket);
    });

    this.io.on('error', (error) => {
      logger.error('WebSocket server error:', error);
      this.metrics.connectionErrors++;
    });

    logger.debug('WebSocket event handlers set up');
  }

  /**
   * Handle new socket connection
   */
  private handleConnection(socket: AuthenticatedSocket): void {
    this.metrics.totalConnections++;
    this.metrics.lastActivity = new Date();

    logger.debug(`New WebSocket connection: ${socket.id}`);

    // Set up connection event handlers
    socket.on('authenticate', (data) => this.handleAuthentication(socket, data));
    socket.on('subscribe', (data) => this.handleSubscribe(socket, data));
    socket.on('unsubscribe', (data) => this.handleUnsubscribe(socket, data));
    socket.on('ping', () => this.handlePing(socket));
    socket.on('disconnect', (reason) => this.handleDisconnect(socket, reason));
    socket.on('error', (error) => this.handleSocketError(socket, error));

    // Send initial connection acknowledgment
    socket.emit('connected', {
      socketId: socket.id,
      serverTime: new Date().toISOString(),
    });
  }

  /**
   * Handle authentication request
   */
  private async handleAuthentication(socket: AuthenticatedSocket, data: any): Promise<void> {
    try {
      this.metrics.messagesReceived++;
      
      // In a real implementation, you would validate the session/token here
      // For now, we'll use a simple userId validation
      if (!data.userId || typeof data.userId !== 'string') {
        socket.emit('auth_error', { message: 'Invalid authentication data' });
        return;
      }

      // Validate user exists (check if user has tokens in Redis)
      const userTokens = await redisService.getUserTokens(data.userId);
      if (!userTokens) {
        socket.emit('auth_error', { message: 'User not authenticated' });
        return;
      }

      // Authenticate the socket
      socket.userId = data.userId;
      socket.authenticated = true;

      // Track authenticated socket
      if (!this.authenticatedSockets.has(data.userId)) {
        this.authenticatedSockets.set(data.userId, new Set());
      }
      this.authenticatedSockets.get(data.userId)!.add(socket.id);
      this.socketUserMap.set(socket.id, data.userId);

      this.metrics.authenticatedConnections++;

      // Join user-specific room
      socket.join(`user:${data.userId}`);

      logger.info(`Socket ${socket.id} authenticated for user ${data.userId}`);

      socket.emit('authenticated', {
        userId: data.userId,
        socketId: socket.id,
      });

    } catch (error) {
      logger.error(`Authentication error for socket ${socket.id}:`, error);
      socket.emit('auth_error', { message: 'Authentication failed' });
      this.metrics.connectionErrors++;
    }
  }

  /**
   * Handle subscription to specific topics
   */
  private handleSubscribe(socket: AuthenticatedSocket, data: any): void {
    if (!socket.authenticated || !socket.userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    this.metrics.messagesReceived++;

    const { topics } = data;
    if (!Array.isArray(topics)) {
      socket.emit('error', { message: 'Invalid topics format' });
      return;
    }

    // Join topic-specific rooms
    for (const topic of topics) {
      if (typeof topic === 'string') {
        const roomName = `user:${socket.userId}:${topic}`;
        socket.join(roomName);
        logger.debug(`Socket ${socket.id} subscribed to ${topic}`);
      }
    }

    socket.emit('subscribed', { topics });
  }

  /**
   * Handle unsubscription from topics
   */
  private handleUnsubscribe(socket: AuthenticatedSocket, data: any): void {
    if (!socket.authenticated || !socket.userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    this.metrics.messagesReceived++;

    const { topics } = data;
    if (!Array.isArray(topics)) {
      socket.emit('error', { message: 'Invalid topics format' });
      return;
    }

    // Leave topic-specific rooms
    for (const topic of topics) {
      if (typeof topic === 'string') {
        const roomName = `user:${socket.userId}:${topic}`;
        socket.leave(roomName);
        logger.debug(`Socket ${socket.id} unsubscribed from ${topic}`);
      }
    }

    socket.emit('unsubscribed', { topics });
  }

  /**
   * Handle ping for connection health check
   */
  private handlePing(socket: AuthenticatedSocket): void {
    this.metrics.messagesReceived++;
    this.metrics.lastActivity = new Date();
    
    socket.emit('pong', {
      serverTime: new Date().toISOString(),
    });
    
    this.metrics.messagesSent++;
  }

  /**
   * Handle socket disconnect
   */
  private handleDisconnect(socket: AuthenticatedSocket, reason: string): void {
    logger.debug(`Socket ${socket.id} disconnected: ${reason}`);

    if (socket.userId) {
      // Remove from authenticated sockets tracking
      const userSockets = this.authenticatedSockets.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.authenticatedSockets.delete(socket.userId);
        }
      }

      this.socketUserMap.delete(socket.id);

      if (socket.authenticated) {
        this.metrics.authenticatedConnections = Math.max(0, this.metrics.authenticatedConnections - 1);
      }
    }

    this.metrics.totalConnections = Math.max(0, this.metrics.totalConnections - 1);
  }

  /**
   * Handle socket error
   */
  private handleSocketError(socket: AuthenticatedSocket, error: any): void {
    logger.error(`Socket ${socket.id} error:`, error);
    this.metrics.connectionErrors++;
  }

  /**
   * Broadcast sync event to specific user
   */
  broadcastSyncEvent(userId: string, eventType: string, data: any): void {
    if (!this.io) return;

    const roomName = `user:${userId}`;
    
    this.io.to(roomName).emit('sync_event', {
      type: eventType,
      userId,
      data,
      timestamp: new Date().toISOString(),
    });

    this.metrics.messagesSent++;
    this.metrics.lastActivity = new Date();

    logger.debug(`Broadcast sync event ${eventType} to user ${userId}`, {
      roomName,
      dataKeys: Object.keys(data),
    });
  }

  /**
   * Broadcast message change event to specific user
   */
  broadcastMessageChanges(userId: string, changes: {
    added: any[];
    deleted: string[];
    updated: any[];
  }): void {
    if (!this.io) return;

    const roomName = `user:${userId}:messages`;
    
    this.io.to(roomName).emit('messages_changed', {
      userId,
      changes,
      timestamp: new Date().toISOString(),
    });

    this.metrics.messagesSent++;
    this.metrics.lastActivity = new Date();

    logger.debug(`Broadcast message changes to user ${userId}`, {
      added: changes.added.length,
      deleted: changes.deleted.length,
      updated: changes.updated.length,
    });
  }

  /**
   * Send sync status update to user
   */
  sendSyncStatus(userId: string, status: {
    state: string;
    lastSync?: Date;
    nextSync?: Date;
    error?: string;
  }): void {
    if (!this.io) return;

    const roomName = `user:${userId}:sync`;
    
    this.io.to(roomName).emit('sync_status', {
      userId,
      status,
      timestamp: new Date().toISOString(),
    });

    this.metrics.messagesSent++;
    this.metrics.lastActivity = new Date();

    logger.debug(`Send sync status to user ${userId}:`, status);
  }

  /**
   * Get connected users
   */
  getConnectedUsers(): string[] {
    return Array.from(this.authenticatedSockets.keys());
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId: string): boolean {
    return this.authenticatedSockets.has(userId);
  }

  /**
   * Get connection count for user
   */
  getUserConnectionCount(userId: string): number {
    const userSockets = this.authenticatedSockets.get(userId);
    return userSockets ? userSockets.size : 0;
  }

  /**
   * Get WebSocket metrics
   */
  getMetrics(): WebSocketMetrics {
    return { ...this.metrics };
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.io) return;

      // Send heartbeat to all connected sockets
      this.io.emit('heartbeat', {
        timestamp: new Date().toISOString(),
        connectedUsers: this.authenticatedSockets.size,
      });

      this.metrics.messagesSent += this.metrics.totalConnections;

    }, this.HEARTBEAT_INTERVAL);

    logger.debug(`WebSocket heartbeat started (interval: ${this.HEARTBEAT_INTERVAL}ms)`);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.debug('WebSocket heartbeat stopped');
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket server');

    this.stopHeartbeat();

    if (this.io) {
      // Notify all clients about shutdown
      this.io.emit('server_shutdown', {
        message: 'Server is shutting down',
        timestamp: new Date().toISOString(),
      });

      // Close all connections
      this.io.close();
      this.io = null;
    }

    // Clear tracking maps
    this.authenticatedSockets.clear();
    this.socketUserMap.clear();

    logger.info('WebSocket server shutdown complete');
  }

  /**
   * Health check
   */
  healthCheck(): {
    healthy: boolean;
    metrics: WebSocketMetrics;
    connectedUsers: number;
  } {
    return {
      healthy: this.io !== null,
      metrics: this.getMetrics(),
      connectedUsers: this.authenticatedSockets.size,
    };
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();