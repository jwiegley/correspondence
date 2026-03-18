import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './useAuth';

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastPing: Date | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

export interface SyncEvent {
  type: string;
  userId: string;
  data: any;
  timestamp: string;
}

export interface MessageChanges {
  userId: string;
  changes: {
    added: any[];
    deleted: string[];
    updated: any[];
  };
  timestamp: string;
}

export interface SyncStatus {
  userId: string;
  status: {
    state: 'idle' | 'syncing' | 'error';
    lastSync?: string;
    nextSync?: string;
    error?: string;
  };
  timestamp: string;
}

export interface UseWebSocketOptions {
  url?: string;
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  topics?: string[];
}

export interface UseWebSocketReturn {
  state: WebSocketState;
  connect: () => void;
  disconnect: () => void;
  subscribe: (topics: string[]) => void;
  unsubscribe: (topics: string[]) => void;
  isConnected: boolean;
  onSyncEvent: (callback: (event: SyncEvent) => void) => () => void;
  onMessageChanges: (callback: (changes: MessageChanges) => void) => () => void;
  onSyncStatus: (callback: (status: SyncStatus) => void) => () => void;
}

/**
 * Custom hook for WebSocket connection with automatic reconnection
 * and state management for email sync updates
 */
export const useWebSocket = (options: UseWebSocketOptions = {}): UseWebSocketReturn => {
  const {
    url = process.env.REACT_APP_WEBSOCKET_URL || 'http://localhost:3001',
    autoConnect = true,
    reconnectInterval = 1000,
    maxReconnectAttempts = 10,
    topics = ['messages', 'sync'],
  } = options;

  const { user, isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const eventCallbacksRef = useRef<Map<string, Set<(...args: any[]) => void>>>(new Map());

  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
    lastPing: null,
    reconnectAttempts: 0,
    maxReconnectAttempts,
  });

  const updateState = useCallback((updates: Partial<WebSocketState>) => {
    setState(prevState => ({ ...prevState, ...updates }));
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const calculateReconnectDelay = useCallback((attempt: number) => {
    // Exponential backoff with jitter: base delay * 2^attempt + random jitter
    const baseDelay = reconnectInterval;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), 30000); // Max 30 seconds
    const jitter = Math.random() * 1000; // Up to 1 second jitter
    return exponentialDelay + jitter;
  }, [reconnectInterval]);

  const emitToCallbacks = useCallback((eventType: string, data: any) => {
    const callbacks = eventCallbacksRef.current.get(eventType);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in WebSocket callback for ${eventType}:`, error);
        }
      });
    }
  }, []);

  const setupSocketEventListeners = useCallback((socket: Socket) => {
    socket.on('connect', () => {
      console.log('WebSocket connected');
      reconnectAttemptsRef.current = 0;
      
      updateState({
        connected: true,
        connecting: false,
        error: null,
        reconnectAttempts: 0,
      });

      // Authenticate if user is logged in
      if (isAuthenticated && user) {
        socket.emit('authenticate', { userId: user.id });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      
      updateState({
        connected: false,
        connecting: false,
        error: reason === 'io server disconnect' ? 'Server disconnected' : null,
      });

      // Attempt reconnection if it wasn't a manual disconnect
      if (reason !== 'io client disconnect' && reconnectAttemptsRef.current < maxReconnectAttempts) {
        scheduleReconnect();
      }
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      
      updateState({
        connected: false,
        connecting: false,
        error: error.message || 'Connection failed',
      });

      scheduleReconnect();
    });

    socket.on('authenticated', (data) => {
      console.log('WebSocket authenticated:', data);
      
      // Subscribe to initial topics
      if (topics.length > 0) {
        socket.emit('subscribe', { topics });
      }
    });

    socket.on('auth_error', (error) => {
      console.error('WebSocket auth error:', error);
      updateState({
        error: error.message || 'Authentication failed',
      });
    });

    socket.on('subscribed', (data) => {
      console.log('Subscribed to topics:', data.topics);
    });

    socket.on('unsubscribed', (data) => {
      console.log('Unsubscribed from topics:', data.topics);
    });

    socket.on('sync_event', (event: SyncEvent) => {
      console.log('Received sync event:', event.type);
      emitToCallbacks('syncEvent', event);
    });

    socket.on('messages_changed', (changes: MessageChanges) => {
      console.log('Received message changes:', {
        added: changes.changes.added.length,
        deleted: changes.changes.deleted.length,
        updated: changes.changes.updated.length,
      });
      emitToCallbacks('messageChanges', changes);
    });

    socket.on('sync_status', (status: SyncStatus) => {
      console.log('Received sync status:', status.status.state);
      emitToCallbacks('syncStatus', status);
    });

    socket.on('pong', (data) => {
      updateState({
        lastPing: new Date(data.serverTime),
      });
    });

    socket.on('heartbeat', (data) => {
      // Server heartbeat received
      updateState({
        lastPing: new Date(data.timestamp),
      });
    });

    socket.on('server_shutdown', (data) => {
      console.warn('Server is shutting down:', data.message);
      updateState({
        error: 'Server is shutting down',
      });
    });

    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      updateState({
        error: error.message || 'WebSocket error',
      });
    });
  }, [isAuthenticated, user, topics, maxReconnectAttempts, updateState, emitToCallbacks]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      updateState({
        error: 'Max reconnection attempts reached',
      });
      return;
    }

    const delay = calculateReconnectDelay(reconnectAttemptsRef.current);
    reconnectAttemptsRef.current++;

    console.log(`Scheduling reconnection attempt ${reconnectAttemptsRef.current} in ${Math.round(delay)}ms`);
    
    updateState({
      reconnectAttempts: reconnectAttemptsRef.current,
    });

    clearReconnectTimeout();
    reconnectTimeoutRef.current = setTimeout(() => {
      if (socketRef.current) {
        updateState({ connecting: true });
        socketRef.current.connect();
      }
    }, delay);
  }, [maxReconnectAttempts, calculateReconnectDelay, updateState, clearReconnectTimeout]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      console.log('WebSocket already connected');
      return;
    }

    console.log('Connecting to WebSocket:', url);
    
    updateState({
      connecting: true,
      error: null,
    });

    // Create new socket if doesn't exist
    if (!socketRef.current) {
      socketRef.current = io(url, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        autoConnect: false,
      });

      setupSocketEventListeners(socketRef.current);
    }

    // Clear any pending reconnection
    clearReconnectTimeout();
    reconnectAttemptsRef.current = 0;

    // Connect
    socketRef.current.connect();
  }, [url, updateState, setupSocketEventListeners, clearReconnectTimeout]);

  const disconnect = useCallback(() => {
    console.log('Disconnecting WebSocket');
    
    clearReconnectTimeout();
    
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    updateState({
      connected: false,
      connecting: false,
      error: null,
      reconnectAttempts: 0,
    });

    reconnectAttemptsRef.current = 0;
  }, [clearReconnectTimeout, updateState]);

  const subscribe = useCallback((newTopics: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe', { topics: newTopics });
    }
  }, []);

  const unsubscribe = useCallback((topicsToRemove: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe', { topics: topicsToRemove });
    }
  }, []);

  // Event subscription methods
  const onSyncEvent = useCallback((callback: (event: SyncEvent) => void) => {
    const eventType = 'syncEvent';
    if (!eventCallbacksRef.current.has(eventType)) {
      eventCallbacksRef.current.set(eventType, new Set());
    }
    eventCallbacksRef.current.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = eventCallbacksRef.current.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          eventCallbacksRef.current.delete(eventType);
        }
      }
    };
  }, []);

  const onMessageChanges = useCallback((callback: (changes: MessageChanges) => void) => {
    const eventType = 'messageChanges';
    if (!eventCallbacksRef.current.has(eventType)) {
      eventCallbacksRef.current.set(eventType, new Set());
    }
    eventCallbacksRef.current.get(eventType)!.add(callback);

    return () => {
      const callbacks = eventCallbacksRef.current.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          eventCallbacksRef.current.delete(eventType);
        }
      }
    };
  }, []);

  const onSyncStatus = useCallback((callback: (status: SyncStatus) => void) => {
    const eventType = 'syncStatus';
    if (!eventCallbacksRef.current.has(eventType)) {
      eventCallbacksRef.current.set(eventType, new Set());
    }
    eventCallbacksRef.current.get(eventType)!.add(callback);

    return () => {
      const callbacks = eventCallbacksRef.current.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          eventCallbacksRef.current.delete(eventType);
        }
      }
    };
  }, []);

  // Auto-connect on mount if enabled and user is authenticated
  useEffect(() => {
    if (autoConnect && isAuthenticated) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, isAuthenticated]);

  // Reconnect when authentication status changes
  useEffect(() => {
    if (isAuthenticated && !socketRef.current?.connected && autoConnect) {
      connect();
    } else if (!isAuthenticated && socketRef.current?.connected) {
      disconnect();
    }
  }, [isAuthenticated, autoConnect, connect, disconnect]);

  // Periodic ping for connection health
  useEffect(() => {
    if (!state.connected) return;

    const pingInterval = setInterval(() => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('ping');
      }
    }, 30000); // Ping every 30 seconds

    return () => clearInterval(pingInterval);
  }, [state.connected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearReconnectTimeout();
      eventCallbacksRef.current.clear();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [clearReconnectTimeout]);

  return {
    state,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    isConnected: state.connected,
    onSyncEvent,
    onMessageChanges,
    onSyncStatus,
  };
};