import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

export default function Login() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const [authState, setAuthState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Handle OAuth callback parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get('auth');
    const authError = urlParams.get('type');
    const errorMsg = urlParams.get('message');

    if (authSuccess === 'success') {
      setAuthState('success');
      // Clear URL parameters
      window.history.replaceState({}, '', '/login');
    }

    if (authError) {
      setAuthState('error');
      setErrorMessage(getErrorMessage(authError, errorMsg));
      // Clear URL parameters after a delay to show the error
      setTimeout(() => {
        window.history.replaceState({}, '', '/login');
      }, 100);
    }
  }, []);

  // Redirect if already authenticated
  if (isAuthenticated && !isLoading) {
    return <Navigate to="/" replace />;
  }

  const handleGoogleLogin = () => {
    setAuthState('loading');
    setErrorMessage(null);
    login();
  };

  const getErrorMessage = (errorType: string | null, message: string | null): string => {
    const errorMessages: Record<string, string> = {
      'access_denied': 'You cancelled the sign-in process. Please try again.',
      'invalid_request': 'Invalid authentication request. Please try again.',
      'server_error': 'Authentication server error. Please try again later.',
      'network_error': 'Network connection error. Please check your internet connection.',
      'token_error': 'Authentication token error. Please try again.',
      'no_user_data': 'Unable to retrieve user information. Please try again.',
      'processing_error': 'Error processing authentication. Please try again.',
    };

    return errorMessages[errorType || ''] || message || 'Authentication failed. Please try again.';
  };

  const handleRetry = () => {
    setAuthState('idle');
    setErrorMessage(null);
  };

  // Loading state
  if (isLoading || authState === 'success') {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="loading-spinner">
            <div className="spinner"></div>
          </div>
          <p className="loading-text">
            {authState === 'success' ? 'Login successful! Redirecting...' : 'Checking authentication...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>Correspondence</h1>
          <p className="login-subtitle">Secure Gmail Management</p>
        </div>

        {authState === 'error' && errorMessage && (
          <div className="error-message">
            <div className="error-icon">⚠️</div>
            <p>{errorMessage}</p>
            <button onClick={handleRetry} className="btn btn-retry">
              Try Again
            </button>
          </div>
        )}

        <div className="login-actions">
          <button 
            onClick={handleGoogleLogin} 
            className={`btn btn-google ${authState === 'loading' ? 'loading' : ''}`}
            disabled={authState === 'loading'}
          >
            {authState === 'loading' ? (
              <>
                <div className="btn-spinner"></div>
                Connecting...
              </>
            ) : (
              <>
                <svg className="google-icon" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>
        </div>

        <div className="login-footer">
          <p className="privacy-note">
            By signing in, you agree to allow Correspondence to access your Gmail account 
            for reading and managing your emails. Your data is secure and never shared.
          </p>
        </div>
      </div>
    </div>
  );
}