import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import './AuthError.css';

export default function AuthError() {
  const [searchParams] = useSearchParams();
  const [errorDetails, setErrorDetails] = useState<{
    type: string;
    message: string;
    suggestion: string;
  }>({
    type: 'Unknown Error',
    message: 'An unexpected error occurred during authentication.',
    suggestion: 'Please try logging in again.'
  });

  useEffect(() => {
    const errorType = searchParams.get('type');
    const errorMessage = searchParams.get('message');

    const errorMap: Record<string, { message: string; suggestion: string }> = {
      'access_denied': {
        message: 'You cancelled the sign-in process or denied permission.',
        suggestion: 'To use Correspondence, please grant the necessary Gmail permissions when signing in.'
      },
      'invalid_request': {
        message: 'The authentication request was invalid or malformed.',
        suggestion: 'This is usually a temporary issue. Please try again.'
      },
      'server_error': {
        message: 'Google\'s authentication service encountered an error.',
        suggestion: 'Please wait a few minutes and try again. If the problem persists, contact support.'
      },
      'network_error': {
        message: 'Unable to connect to the authentication service.',
        suggestion: 'Please check your internet connection and try again.'
      },
      'token_error': {
        message: 'There was an error processing your authentication tokens.',
        suggestion: 'Please try logging in again. If the issue continues, contact support.'
      },
      'no_user_data': {
        message: 'Unable to retrieve your profile information from Google.',
        suggestion: 'Please ensure your Google account has a valid profile and try again.'
      },
      'processing_error': {
        message: 'An error occurred while processing your authentication.',
        suggestion: 'This is usually temporary. Please try again in a few moments.'
      }
    };

    const details = errorMap[errorType || ''];
    
    setErrorDetails({
      type: formatErrorType(errorType),
      message: details?.message || errorMessage || 'An unexpected error occurred during authentication.',
      suggestion: details?.suggestion || 'Please try logging in again.'
    });
  }, [searchParams]);

  const formatErrorType = (type: string | null): string => {
    if (!type) return 'Authentication Error';
    
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleRetry = () => {
    // Clear any error state and redirect to login
    window.location.href = '/login';
  };

  return (
    <div className="auth-error-container">
      <div className="auth-error-card">
        <div className="error-header">
          <div className="error-icon">⚠️</div>
          <h1>Authentication Failed</h1>
          <p className="error-type">{errorDetails.type}</p>
        </div>

        <div className="error-content">
          <div className="error-message">
            <p>{errorDetails.message}</p>
          </div>

          <div className="error-suggestion">
            <p>{errorDetails.suggestion}</p>
          </div>
        </div>

        <div className="error-actions">
          <button onClick={handleRetry} className="btn btn-primary">
            Try Again
          </button>
          <Link to="/" className="btn btn-secondary">
            Go Home
          </Link>
        </div>

        <div className="error-help">
          <h3>Need Help?</h3>
          <div className="help-links">
            <a href="#" className="help-link">
              Check System Status
            </a>
            <a href="#" className="help-link">
              Contact Support
            </a>
            <a href="#" className="help-link">
              FAQ
            </a>
          </div>
        </div>

        <div className="error-details">
          <details>
            <summary>Technical Details</summary>
            <div className="tech-details">
              <p><strong>Error Type:</strong> {searchParams.get('type') || 'unknown'}</p>
              <p><strong>Error Message:</strong> {searchParams.get('message') || 'No additional details'}</p>
              <p><strong>Timestamp:</strong> {new Date().toISOString()}</p>
              <p><strong>User Agent:</strong> {navigator.userAgent}</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}