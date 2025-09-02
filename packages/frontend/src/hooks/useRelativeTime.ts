import { useState, useEffect } from 'react';

export const useRelativeTime = (date: Date | string | null, updateInterval = 60000) => {
  const [relativeTime, setRelativeTime] = useState<string>('');

  const formatRelativeTime = (date: Date | string | null): string => {
    if (!date) return 'Never';
    
    const now = new Date();
    const target = new Date(date);
    const diffMs = now.getTime() - target.getTime();
    
    if (isNaN(target.getTime())) return 'Invalid date';
    
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSeconds < 60) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      return target.toLocaleDateString();
    }
  };

  useEffect(() => {
    setRelativeTime(formatRelativeTime(date));
    
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(date));
    }, updateInterval);

    return () => clearInterval(interval);
  }, [date, updateInterval]);

  return relativeTime;
};