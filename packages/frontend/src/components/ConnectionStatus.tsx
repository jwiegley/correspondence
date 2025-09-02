import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useRelativeTime } from '../hooks/useRelativeTime';
import './ConnectionStatus.css';

interface ConnectionStatusData {
  isConnected: boolean;
  email?: string;
  lastSync?: string;
  error?: string;
  tokenExpiry?: string;
  scopes?: string[];
}

interface ConnectionStatusProps {
  refreshInterval?: number;
  showDetails?: boolean;
  className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  refreshInterval = 30000, // 30 seconds
  showDetails = true,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  const { 
    data: status, 
    isLoading, 
    error, 
    refetch 
  } = useQuery<ConnectionStatusData>({
    queryKey: ['connection-status'],
    queryFn: async () => {
      const response = await axios.get('/auth/connection-status');
      return response.data;
    },
    refetchInterval: refreshInterval,
    retry: (failureCount, error: any) => {
      // Don't retry on authentication errors
      if (error.response?.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
    refetchOnWindowFocus: true,
  });

  const lastSyncTime = useRelativeTime(status?.lastSync);

  // Auto-refresh on component mount
  useEffect(() => {
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className={`connection-status loading ${className}`}>
        <div className="status-indicator loading">
          <div className="spinner"></div>
        </div>
        <span className="status-text">Checking connection...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`connection-status error ${className}`}>
        <div className="status-indicator error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 7v6m0 4h.01"/>
            <circle cx="12" cy="12" r="10"/>
          </svg>
        </div>
        <span className="status-text">Unable to check connection</span>
        {showDetails && (
          <button 
            className="retry-button"
            onClick={() => refetch()}
            title="Retry connection check"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const isConnected = status?.isConnected ?? false;
  const hasError = !!status?.error;

  return (
    <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'} ${className}`}>
      <div 
        className="status-main"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'} ${hasError ? 'error' : ''}`}>
          {isConnected ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          )}
        </div>
        
        <div className="status-content">
          <div className="status-text">
            {isConnected ? (
              hasError ? 'Connected (with issues)' : 'Connected'
            ) : (
              'Disconnected'
            )}
          </div>
          
          {showDetails && (
            <div className="status-details">
              {status?.email && (
                <div className="email-display">{status.email}</div>
              )}
              
              {isConnected && (
                <div className="last-sync">
                  Last sync: {lastSyncTime}
                </div>
              )}
              
              {hasError && (
                <div className="error-message">
                  {status.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tooltip with detailed information */}
      {showTooltip && (
        <div className="status-tooltip">
          <div className="tooltip-content">
            <div className="tooltip-header">
              <strong>Gmail Connection Status</strong>
            </div>
            
            <div className="tooltip-body">
              <div className="tooltip-row">
                <span className="tooltip-label">Status:</span>
                <span className={`tooltip-value ${isConnected ? 'success' : 'error'}`}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              
              {status?.email && (
                <div className="tooltip-row">
                  <span className="tooltip-label">Account:</span>
                  <span className="tooltip-value">{status.email}</span>
                </div>
              )}
              
              {status?.lastSync && (
                <div className="tooltip-row">
                  <span className="tooltip-label">Last Sync:</span>
                  <span className="tooltip-value">{lastSyncTime}</span>
                </div>
              )}
              
              {status?.tokenExpiry && (
                <div className="tooltip-row">
                  <span className="tooltip-label">Token Expires:</span>
                  <span className="tooltip-value">
                    {useRelativeTime(status.tokenExpiry)}
                  </span>
                </div>
              )}
              
              {status?.scopes && status.scopes.length > 0 && (
                <div className="tooltip-row">
                  <span className="tooltip-label">Permissions:</span>
                  <div className="tooltip-scopes">
                    {status.scopes.map((scope, index) => (
                      <span key={index} className="scope-badge">
                        {scope.replace('https://www.googleapis.com/auth/gmail.', '')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {hasError && (
                <div className="tooltip-row">
                  <span className="tooltip-label">Error:</span>
                  <span className="tooltip-value error">{status.error}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};