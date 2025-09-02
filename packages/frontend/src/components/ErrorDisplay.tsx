import React from 'react';
import './ErrorDisplay.css';

export interface ErrorInfo {
  code?: string;
  title?: string;
  message: string;
  type?: 'error' | 'warning' | 'info';
  retryable?: boolean;
  helpUrl?: string;
}

interface ErrorDisplayProps {
  error: ErrorInfo | string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
  compact?: boolean;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onRetry,
  onDismiss,
  className = '',
  compact = false,
}) => {
  // Normalize error to ErrorInfo object
  const errorInfo: ErrorInfo = typeof error === 'string' 
    ? { message: error, type: 'error' }
    : error;

  // Map common error codes to user-friendly information
  const getErrorGuidance = (code?: string): Partial<ErrorInfo> => {
    const errorMap: Record<string, Partial<ErrorInfo>> = {
      'AUTH_EXPIRED': {
        title: 'Connection Expired',
        message: 'Your Gmail connection has expired. Please reconnect to continue.',
        retryable: false,
        helpUrl: '/help/reconnect-gmail'
      },
      'INSUFFICIENT_PERMISSIONS': {
        title: 'Permission Denied',
        message: 'Gmail access permissions are insufficient. Please reconnect and grant all requested permissions.',
        retryable: false,
        helpUrl: '/help/gmail-permissions'
      },
      'NETWORK_ERROR': {
        title: 'Network Error',
        message: 'Unable to reach Gmail servers. Please check your internet connection and try again.',
        retryable: true,
        type: 'warning'
      },
      'QUOTA_EXCEEDED': {
        title: 'Rate Limit Exceeded',
        message: 'Gmail API usage limit exceeded. Please wait a few minutes before trying again.',
        retryable: true,
        type: 'warning'
      },
      'NO_TOKENS': {
        title: 'Not Connected',
        message: 'No Gmail connection found. Please connect your Gmail account to continue.',
        retryable: false,
        helpUrl: '/help/connect-gmail'
      },
      'INVALID_TOKENS': {
        title: 'Invalid Connection',
        message: 'Your Gmail connection is invalid. Please reconnect your account.',
        retryable: false,
        helpUrl: '/help/reconnect-gmail'
      },
      'CONNECTION_FAILED': {
        title: 'Connection Failed',
        message: 'Unable to connect to Gmail. Please check your connection and try again.',
        retryable: true
      },
      'DISCONNECT_ERROR': {
        title: 'Disconnect Failed',
        message: 'There was an error disconnecting from Gmail. Your local data has been cleared.',
        retryable: true,
        type: 'warning'
      }
    };

    return code ? errorMap[code] || {} : {};
  };

  // Merge error info with guidance
  const guidance = getErrorGuidance(errorInfo.code);
  const finalError: ErrorInfo = {
    type: 'error',
    retryable: false,
    ...errorInfo,
    ...guidance,
  };

  const getIcon = () => {
    switch (finalError.type) {
      case 'warning':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        );
      case 'info':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        );
      default:
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        );
    }
  };

  const getActionableSteps = (): string[] => {
    const steps: Record<string, string[]> = {
      'AUTH_EXPIRED': [
        'Click "Reconnect Gmail" in the Settings',
        'Sign in with your Google account',
        'Grant all requested permissions'
      ],
      'INSUFFICIENT_PERMISSIONS': [
        'Click "Reconnect Gmail" in the Settings',
        'Make sure to grant all permissions when prompted',
        'Do not skip any permission screens'
      ],
      'NETWORK_ERROR': [
        'Check your internet connection',
        'Try refreshing the page',
        'Contact support if the issue persists'
      ],
      'NO_TOKENS': [
        'Click "Connect Gmail" to get started',
        'Sign in with your Google account',
        'Grant the requested permissions'
      ],
      'QUOTA_EXCEEDED': [
        'Wait 5-10 minutes before trying again',
        'Avoid making rapid requests',
        'Contact support if this happens frequently'
      ]
    };

    return steps[finalError.code || ''] || [];
  };

  return (
    <div className={`error-display error-display-${finalError.type} ${compact ? 'error-display-compact' : ''} ${className}`} role="alert">
      <div className="error-display-content">
        <div className="error-display-header">
          <div className="error-display-icon">
            {getIcon()}
          </div>
          
          <div className="error-display-text">
            <div className="error-display-title">
              {finalError.title || 'Error'}
            </div>
            <div className="error-display-message">
              {finalError.message}
            </div>
          </div>

          {onDismiss && (
            <button 
              className="error-display-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss error"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {!compact && (
          <>
            {/* Actionable steps */}
            {getActionableSteps().length > 0 && (
              <div className="error-display-steps">
                <h4>How to fix this:</h4>
                <ol>
                  {getActionableSteps().map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Actions */}
            <div className="error-display-actions">
              {finalError.retryable && onRetry && (
                <button 
                  className="error-display-retry"
                  onClick={onRetry}
                >
                  Try Again
                </button>
              )}
              
              {finalError.helpUrl && (
                <a 
                  href={finalError.helpUrl}
                  className="error-display-help"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get Help
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Helper function to create error info from common error patterns
export const createErrorInfo = (error: any): ErrorInfo => {
  if (typeof error === 'string') {
    return { message: error, type: 'error' };
  }

  if (error?.response?.data) {
    const errorData = error.response.data;
    return {
      code: errorData.code,
      title: errorData.error,
      message: errorData.message,
      type: 'error',
    };
  }

  if (error?.code === 'NETWORK_ERROR' || !error?.response) {
    return {
      code: 'NETWORK_ERROR',
      title: 'Network Error',
      message: 'Unable to connect to the server. Please check your connection.',
      type: 'warning',
      retryable: true,
    };
  }

  return {
    message: error?.message || 'An unexpected error occurred',
    type: 'error',
  };
};