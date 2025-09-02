import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useWebSocket, WebSocketState, SyncEvent, MessageChanges, SyncStatus, UseWebSocketReturn } from '../hooks/useWebSocket';
import { useAuth } from '../hooks/useAuth';

export interface WebSocketContextType extends UseWebSocketReturn {
  // Additional context-specific methods
  connectionHistory: ConnectionEvent[];
  clearConnectionHistory: () => void;
  isOnline: boolean;
}

export interface ConnectionEvent {
  type: 'connected' | 'disconnected' | 'error' | 'reconnecting';
  timestamp: Date;
  message?: string;
  attempt?: number;
}

interface WebSocketProviderProps {
  children: React.ReactNode;
  options?: {
    url?: string;
    autoConnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    topics?: string[];
  };
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ 
  children, 
  options = {} 
}) => {
  const { isAuthenticated } = useAuth();
  const [connectionHistory, setConnectionHistory] = useState<ConnectionEvent[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const webSocket = useWebSocket({
    autoConnect: isAuthenticated,
    topics: ['messages', 'sync'],
    ...options,
  });

  const addConnectionEvent = useCallback((event: ConnectionEvent) => {
    setConnectionHistory(prev => {
      const newHistory = [event, ...prev];
      // Keep only last 50 events
      return newHistory.slice(0, 50);
    });
  }, []);

  const clearConnectionHistory = useCallback(() => {
    setConnectionHistory([]);
  }, []);

  // Track connection state changes
  useEffect(() => {
    const { connected, connecting, error, reconnectAttempts } = webSocket.state;
    
    if (connected) {
      addConnectionEvent({
        type: 'connected',
        timestamp: new Date(),
        message: 'WebSocket connected successfully',
      });
    } else if (connecting) {
      addConnectionEvent({
        type: 'reconnecting',
        timestamp: new Date(),
        message: 'Attempting to connect...',
        attempt: reconnectAttempts > 0 ? reconnectAttempts : undefined,
      });
    } else if (error) {
      addConnectionEvent({
        type: 'error',
        timestamp: new Date(),
        message: error,
      });
    } else if (!connecting && !connected) {
      addConnectionEvent({
        type: 'disconnected',
        timestamp: new Date(),
        message: 'WebSocket disconnected',
      });
    }
  }, [webSocket.state.connected, webSocket.state.connecting, webSocket.state.error, webSocket.state.reconnectAttempts, addConnectionEvent]);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Attempt to reconnect when coming back online
      if (isAuthenticated && !webSocket.state.connected) {
        setTimeout(() => webSocket.connect(), 1000);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      addConnectionEvent({
        type: 'disconnected',
        timestamp: new Date(),
        message: 'Network offline',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isAuthenticated, webSocket.state.connected, webSocket.connect, addConnectionEvent]);

  // Auto-connect/disconnect based on authentication
  useEffect(() => {
    if (isAuthenticated && !webSocket.state.connected && isOnline) {
      webSocket.connect();
    } else if (!isAuthenticated && webSocket.state.connected) {
      webSocket.disconnect();
    }
  }, [isAuthenticated, webSocket.state.connected, webSocket.connect, webSocket.disconnect, isOnline]);

  const contextValue: WebSocketContextType = {
    ...webSocket,
    connectionHistory,
    clearConnectionHistory,
    isOnline,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};

// Additional hook for sync-specific functionality
export const useSyncUpdates = () => {
  const { onSyncEvent, onSyncStatus, onMessageChanges, isConnected } = useWebSocketContext();
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Listen for sync status updates
  useEffect(() => {
    const unsubscribe = onSyncStatus((status: SyncStatus) => {
      setSyncState(status.status.state);
      if (status.status.lastSync) {
        setLastSync(new Date(status.status.lastSync));
      }
      setSyncError(status.status.error || null);
    });

    return unsubscribe;
  }, [onSyncStatus]);

  // Listen for sync events
  useEffect(() => {
    const unsubscribe = onSyncEvent((event: SyncEvent) => {
      if (event.type === 'sync:completed') {
        setSyncState('idle');
        setLastSync(new Date());
        setSyncError(null);
      } else if (event.type === 'sync:failed') {
        setSyncState('error');
        setSyncError(event.data.error || 'Sync failed');
      }
    });

    return unsubscribe;
  }, [onSyncEvent]);

  return {
    syncState,
    lastSync,
    syncError,
    isConnected,
    isSyncing: syncState === 'syncing',
    hasError: syncState === 'error',
  };
};

// Hook for message change notifications
export const useMessageUpdates = (onMessagesChanged?: (changes: MessageChanges) => void) => {
  const { onMessageChanges, isConnected } = useWebSocketContext();
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [updateCounts, setUpdateCounts] = useState({
    added: 0,
    deleted: 0,
    updated: 0,
  });

  useEffect(() => {
    const unsubscribe = onMessageChanges((changes: MessageChanges) => {
      setLastUpdate(new Date());
      setUpdateCounts({
        added: changes.changes.added.length,
        deleted: changes.changes.deleted.length,
        updated: changes.changes.updated.length,
      });

      // Call optional callback
      if (onMessagesChanged) {
        onMessagesChanged(changes);
      }
    });

    return unsubscribe;
  }, [onMessageChanges, onMessagesChanged]);

  return {
    lastUpdate,
    updateCounts,
    isConnected,
    hasRecentUpdates: lastUpdate && (Date.now() - lastUpdate.getTime()) < 30000, // 30 seconds
  };
};