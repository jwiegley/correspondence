import React from 'react';
import { useSyncUpdates, useWebSocketContext } from '../contexts/WebSocketContext';

export interface SyncStatusProps {
  className?: string;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({ className }) => {
  const { state: wsState, isOnline } = useWebSocketContext();
  const { syncState, lastSync, syncError, isSyncing } = useSyncUpdates();

  const getStatusColor = () => {
    if (!wsState.connected || !isOnline) return 'text-red-500';
    if (isSyncing) return 'text-blue-500';
    if (syncError) return 'text-red-500';
    return 'text-green-500';
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (!wsState.connected) return 'Disconnected';
    if (wsState.connecting) return 'Connecting...';
    if (isSyncing) return 'Syncing...';
    if (syncError) return `Error: ${syncError}`;
    return 'Connected';
  };

  const getStatusIcon = () => {
    if (!wsState.connected || !isOnline || syncError) return '●'; // Red dot
    if (isSyncing) return '◉'; // Blue pulsing dot
    return '●'; // Green dot
  };

  const formatLastSync = () => {
    if (!lastSync) return 'Never';
    
    const now = new Date();
    const diff = now.getTime() - lastSync.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    return lastSync.toLocaleDateString();
  };

  return (
    <div className={`flex items-center space-x-2 text-sm ${className}`}>
      <span className={`${getStatusColor()} animate-pulse`}>
        {getStatusIcon()}
      </span>
      <div className="flex flex-col">
        <span className={getStatusColor()}>
          {getStatusText()}
        </span>
        {wsState.connected && (
          <span className="text-xs text-gray-500">
            Last sync: {formatLastSync()}
          </span>
        )}
        {wsState.reconnectAttempts > 0 && (
          <span className="text-xs text-yellow-500">
            Reconnect attempts: {wsState.reconnectAttempts}/{wsState.maxReconnectAttempts}
          </span>
        )}
      </div>
    </div>
  );
};