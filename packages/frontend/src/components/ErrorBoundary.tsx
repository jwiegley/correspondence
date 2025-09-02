import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorDisplay, createErrorInfo } from './ErrorDisplay';
import './ErrorBoundary.css';

// Error reporting service interface
interface ErrorReportingService {
  reportError: (error: Error, errorInfo: ErrorInfo, context?: any) => void;
}

// Simple error reporting service (can be replaced with Sentry, etc.)
class SimpleErrorReporting implements ErrorReportingService {
  reportError(error: Error, errorInfo: ErrorInfo, context?: any): void {
    // In production, this would send to a monitoring service
    console.error('Error Boundary caught an error:', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      errorInfo,
      context,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });

    // Optionally send to external service
    if (process.env.REACT_APP_ERROR_REPORTING_ENDPOINT) {
      fetch(process.env.REACT_APP_ERROR_REPORTING_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          context,
          timestamp: new Date().toISOString()
        })
      }).catch(console.error);
    }
  }
}

const errorReporter = new SimpleErrorReporting();

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorId?: string;
  retryCount: number;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: 'app' | 'page' | 'component' | 'feature';
  context?: string;
  enableRetry?: boolean;
  maxRetries?: number;
  resetOnPropsChange?: boolean;
  resetKeys?: Array<string | number>;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId?: NodeJS.Timeout;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    
    this.state = {
      hasError: false,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorId: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, context, level = 'component' } = this.props;
    
    // Update state with error info
    this.setState({ errorInfo });
    
    // Report error
    errorReporter.reportError(error, errorInfo, {
      context,
      level,
      retryCount: this.state.retryCount,
      props: this.props
    });
    
    // Call custom error handler
    onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetOnPropsChange, resetKeys } = this.props;
    const { hasError } = this.state;
    
    if (hasError && prevProps.resetOnPropsChange && resetOnPropsChange) {
      this.resetErrorBoundary();
    }
    
    if (hasError && resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (key, index) => key !== prevProps.resetKeys?.[index]
      );
      
      if (hasResetKeyChanged) {
        this.resetErrorBoundary();
      }
    }
  }

  resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
    
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      errorId: undefined,
      retryCount: 0
    });
  };

  handleRetry = () => {
    const { maxRetries = 3 } = this.props;
    const { retryCount } = this.state;
    
    if (retryCount < maxRetries) {
      this.setState(prevState => ({
        hasError: false,
        error: undefined,
        errorInfo: undefined,
        errorId: undefined,
        retryCount: prevState.retryCount + 1
      }));
      
      // Auto-retry after a delay for certain error types
      this.resetTimeoutId = setTimeout(() => {
        if (this.state.hasError) {
          this.handleRetry();
        }
      }, 5000);
    }
  };

  render() {
    const { hasError, error, retryCount } = this.state;
    const { children, fallback, enableRetry = true, maxRetries = 3, level = 'component' } = this.props;
    
    if (hasError && error) {
      // Custom fallback UI
      if (fallback) {
        return fallback;
      }
      
      // Default fallback UI based on error boundary level
      return this.renderDefaultFallback(error, retryCount, maxRetries, enableRetry, level);
    }
    
    return children;
  }

  private renderDefaultFallback(error: Error, retryCount: number, maxRetries: number, enableRetry: boolean, level: string) {
    const canRetry = enableRetry && retryCount < maxRetries;
    const errorInfo = createErrorInfo(error);
    
    return (
      <div className={`error-boundary error-boundary-${level}`}>
        <ErrorDisplay
          error={{
            ...errorInfo,
            title: this.getErrorTitle(level),
            message: this.getErrorMessage(error, level),
            retryable: canRetry
          }}
          onRetry={canRetry ? this.handleRetry : undefined}
          className="error-boundary-display"
        />
        
        {level === 'app' && (
          <div className="error-boundary-debug">
            <details>
              <summary>Technical Details</summary>
              <pre>{error.stack}</pre>
            </details>
          </div>
        )}
        
        {retryCount > 0 && (
          <div className="error-boundary-retry-info">
            Retry attempt {retryCount} of {maxRetries}
          </div>
        )}
      </div>
    );
  }

  private getErrorTitle(level: string): string {
    switch (level) {
      case 'app':
        return 'Application Error';
      case 'page':
        return 'Page Error';
      case 'feature':
        return 'Feature Unavailable';
      default:
        return 'Something went wrong';
    }
  }

  private getErrorMessage(error: Error, level: string): string {
    // Network errors
    if (error.message.includes('fetch') || error.message.includes('Network')) {
      return 'Unable to connect to the server. Please check your connection and try again.';
    }
    
    // Permission errors
    if (error.message.includes('permission') || error.message.includes('unauthorized')) {
      return 'You don\'t have permission to access this feature. Please sign in again.';
    }
    
    // Quota errors
    if (error.message.includes('quota') || error.message.includes('rate limit')) {
      return 'Service temporarily unavailable due to high usage. Please try again in a few minutes.';
    }
    
    // Generic messages based on level
    switch (level) {
      case 'app':
        return 'The application encountered an unexpected error. Please refresh the page or try again later.';
      case 'page':
        return 'This page failed to load properly. Please try refreshing the page.';
      case 'feature':
        return 'This feature is temporarily unavailable. Please try again later.';
      default:
        return 'A component failed to render. Please try refreshing the page.';
    }
  }
}

// Specialized error boundaries for different parts of the app
export class AppErrorBoundary extends Component<Omit<ErrorBoundaryProps, 'level'>> {
  render() {
    return <ErrorBoundary {...this.props} level="app" maxRetries={1} />;
  }
}

export class PageErrorBoundary extends Component<Omit<ErrorBoundaryProps, 'level'>> {
  render() {
    return <ErrorBoundary {...this.props} level="page" maxRetries={2} />;
  }
}

export class FeatureErrorBoundary extends Component<Omit<ErrorBoundaryProps, 'level'>> {
  render() {
    return <ErrorBoundary {...this.props} level="feature" maxRetries={3} />;
  }
}

export class ComponentErrorBoundary extends Component<Omit<ErrorBoundaryProps, 'level'>> {
  render() {
    return <ErrorBoundary {...this.props} level="component" maxRetries={2} />;
  }
}

// HOC for wrapping components with error boundary
export function withErrorBoundary<T extends object>(
  Component: React.ComponentType<T>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: T) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );
  
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
}

// Error context for sharing error state across components
interface ErrorContextValue {
  reportError: (error: Error, context?: any) => void;
  clearError: () => void;
  hasGlobalError: boolean;
  globalError?: Error;
}

const ErrorContext = React.createContext<ErrorContextValue>({
  reportError: () => {},
  clearError: () => {},
  hasGlobalError: false
});

export const useErrorHandler = () => React.useContext(ErrorContext);

interface ErrorProviderProps {
  children: ReactNode;
}

interface ErrorProviderState {
  hasGlobalError: boolean;
  globalError?: Error;
}

export class ErrorProvider extends Component<ErrorProviderProps, ErrorProviderState> {
  constructor(props: ErrorProviderProps) {
    super(props);
    
    this.state = {
      hasGlobalError: false
    };
  }

  reportError = (error: Error, context?: any) => {
    console.error('Global error reported:', error, context);
    
    this.setState({
      hasGlobalError: true,
      globalError: error
    });
    
    // Report to error service
    errorReporter.reportError(error, { componentStack: '' }, context);
  };

  clearError = () => {
    this.setState({
      hasGlobalError: false,
      globalError: undefined
    });
  };

  render() {
    const { children } = this.props;
    const { hasGlobalError, globalError } = this.state;
    
    const contextValue: ErrorContextValue = {
      reportError: this.reportError,
      clearError: this.clearError,
      hasGlobalError,
      globalError
    };
    
    return (
      <ErrorContext.Provider value={contextValue}>
        {children}
      </ErrorContext.Provider>
    );
  }
}

export default ErrorBoundary;