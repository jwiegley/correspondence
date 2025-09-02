import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { useToast } from '../contexts/ToastContext';
import './RefreshControl.css';

interface RefreshControlProps {
  className?: string;
}

export const RefreshControl: React.FC<RefreshControlProps> = ({ className }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(60); // seconds
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useToast();
  const relativeTime = useRelativeTime(lastRefresh, 10000); // Update every 10 seconds

  // Manual refresh handler
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['emails'] });
      const refreshTime = new Date();
      setLastRefresh(refreshTime);
      showSuccess('Refresh Complete', 'Email list has been updated');
    } catch (error) {
      console.error('Error during manual refresh:', error);
      showError('Refresh Failed', 'Unable to refresh email list');
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, showSuccess, showError]);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: ['emails'] });
        setLastRefresh(new Date());
      } catch (error) {
        console.error('Error during auto-refresh:', error);
        // Don't show toast for auto-refresh errors to avoid spam
      }
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, queryClient]);

  const refreshIntervalOptions = [
    { value: 30, label: '30 seconds' },
    { value: 60, label: '1 minute' },
    { value: 300, label: '5 minutes' },
    { value: 900, label: '15 minutes' },
  ];

  return (
    <div className={`refresh-control ${className || ''}`}>
      <button
        onClick={handleManualRefresh}
        disabled={isRefreshing}
        className="refresh-button"
        type="button"
        aria-label={isRefreshing ? 'Refreshing emails' : 'Refresh emails'}
      >
        <span className={`refresh-icon ${isRefreshing ? 'spinning' : ''}`}>
          ↻
        </span>
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </button>

      <div className="auto-refresh-controls">
        <label className="auto-refresh-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            aria-describedby="auto-refresh-description"
          />
          <span>Auto-refresh every</span>
        </label>
        
        <select
          value={refreshInterval}
          onChange={(e) => setRefreshInterval(Number(e.target.value))}
          disabled={!autoRefresh}
          className="refresh-interval-select"
          aria-label="Auto-refresh interval"
        >
          {refreshIntervalOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="last-refresh" aria-live="polite">
        <span className="last-refresh-label">Last refresh:</span>
        <span className="last-refresh-time">
          {lastRefresh ? relativeTime : 'Never'}
        </span>
      </div>

      <div id="auto-refresh-description" className="sr-only">
        When enabled, automatically refreshes the email list at the selected interval
      </div>
    </div>
  );
};

export default RefreshControl;