import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { ConnectionStatus } from './ConnectionStatus';
import { ErrorDisplay, createErrorInfo } from './ErrorDisplay';
import { useTestConnection } from '../hooks/useTestConnection';
import { useOAuthFlow } from '../hooks/useOAuthFlow';
import { useAuth } from '../contexts/AuthContext';
import './Settings.css';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const { user, isAuthenticated } = useAuth();
  const { testConnection, isTestingConnection, error: testError } = useTestConnection();
  const { 
    disconnect, 
    isDisconnecting, 
    initiateConnection, 
    initiateReconnect,
    disconnectError
  } = useOAuthFlow();

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [dismissedErrors, setDismissedErrors] = useState<Set<string>>(new Set());

  // Check URL parameters for auth success/settings opening
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const settingsParam = urlParams.get('settings');
    const authParam = urlParams.get('auth');

    if (settingsParam === 'open') {
      // Auto-open settings if returned from OAuth flow
      if (authParam === 'success' || authParam === 'first-time') {
        // Clear URL parameters
        window.history.replaceState({}, '', window.location.pathname);
        
        // Modal will already be open due to settings=open, but show success message
        if (authParam === 'first-time') {
          // First time connection success is handled by the auth context
        }
      }
    }
  }, []);

  const handleDisconnectClick = () => {
    setShowDisconnectConfirm(true);
  };

  const handleDisconnectConfirm = async () => {
    setShowDisconnectConfirm(false);
    await disconnect();
  };

  const handleDisconnectCancel = () => {
    setShowDisconnectConfirm(false);
  };

  const handleDismissError = (errorType: string) => {
    setDismissedErrors(prev => new Set([...prev, errorType]));
  };

  const shouldShowError = (error: any, errorType: string) => {
    return error && !dismissedErrors.has(errorType);
  };

  if (!isAuthenticated) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Settings">
        <div className="settings-unauthenticated">
          <p>Please sign in to access settings.</p>
          <button 
            className="btn btn-primary"
            onClick={initiateConnection}
          >
            Sign in with Google
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div className="settings-content">
        
        {/* Error displays */}
        {shouldShowError(testError, 'test') && (
          <ErrorDisplay
            error={createErrorInfo(testError)}
            onRetry={testConnection}
            onDismiss={() => handleDismissError('test')}
            compact={true}
          />
        )}
        
        {shouldShowError(disconnectError, 'disconnect') && (
          <ErrorDisplay
            error={createErrorInfo(disconnectError)}
            onDismiss={() => handleDismissError('disconnect')}
            compact={true}
          />
        )}

        {/* Gmail Account Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">Gmail Account</h3>
          
          <div className="settings-account-info">
            <div className="account-email">
              <label>Connected Account:</label>
              <input 
                type="email" 
                value={user?.email || ''} 
                disabled 
                className="account-email-input"
              />
            </div>
            
            <ConnectionStatus 
              className="settings-connection-status"
              showDetails={true}
            />
          </div>
          
          <div className="settings-actions">
            <button 
              onClick={testConnection}
              disabled={isTestingConnection}
              className="btn btn-secondary"
            >
              {isTestingConnection ? (
                <>
                  <div className="btn-spinner"></div>
                  Testing Connection...
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            
            <button 
              onClick={initiateReconnect}
              className="btn btn-primary"
            >
              Reconnect Gmail
            </button>
            
            <button 
              onClick={handleDisconnectClick}
              disabled={isDisconnecting}
              className="btn btn-danger"
            >
              {isDisconnecting ? (
                <>
                  <div className="btn-spinner"></div>
                  Disconnecting...
                </>
              ) : (
                'Disconnect'
              )}
            </button>
          </div>
        </div>

        {/* App Information Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">App Information</h3>
          
          <div className="app-info">
            <div className="app-info-item">
              <span className="app-info-label">Version:</span>
              <span className="app-info-value">1.0.0</span>
            </div>
            
            <div className="app-info-item">
              <span className="app-info-label">Last Updated:</span>
              <span className="app-info-value">{new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Permissions Information */}
        <div className="settings-section">
          <h3 className="settings-section-title">Permissions</h3>
          
          <div className="permissions-info">
            <p className="permissions-description">
              This app requires the following Gmail permissions:
            </p>
            
            <ul className="permissions-list">
              <li>
                <strong>Read emails:</strong> View your email messages and metadata
              </li>
              <li>
                <strong>Modify emails:</strong> Update email labels and status
              </li>
              <li>
                <strong>Profile access:</strong> View your email address and basic profile
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Disconnect Confirmation Modal */}
      {showDisconnectConfirm && (
        <div className="confirmation-overlay">
          <div className="confirmation-modal">
            <h3>Disconnect Gmail Account?</h3>
            <p>
              This will remove your Gmail connection and clear all cached email data. 
              You'll need to reconnect to access your emails again.
            </p>
            
            <div className="confirmation-actions">
              <button 
                onClick={handleDisconnectCancel}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button 
                onClick={handleDisconnectConfirm}
                className="btn btn-danger"
                disabled={isDisconnecting}
              >
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};