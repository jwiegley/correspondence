import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface DisconnectResponse {
  success: boolean;
  message: string;
  disconnectedAt?: string;
  error?: string;
  code?: string;
}

export const useOAuthFlow = () => {
  const { showSuccess, showError, showInfo } = useToast();
  const { refetch: refetchAuth } = useAuth();
  const queryClient = useQueryClient();

  // Disconnect mutation
  const disconnectMutation = useMutation<DisconnectResponse>({
    mutationFn: async () => {
      const response = await axios.post('/auth/disconnect');
      return response.data;
    },
    onSuccess: (data) => {
      showSuccess(
        'Disconnected successfully',
        'Your Gmail account has been disconnected. Email data has been cleared.'
      );
      
      // Clear all cached data and refetch auth status
      queryClient.clear();
      refetchAuth();
      
      // Specifically invalidate connection status
      queryClient.invalidateQueries({ queryKey: ['connection-status'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
    onError: (error: any) => {
      let title = 'Disconnect failed';
      let message = 'Unable to disconnect from Gmail';

      if (error.response?.data) {
        const errorData = error.response.data;
        title = errorData.error || title;
        message = errorData.message || message;
      } else if (error.code === 'NETWORK_ERROR' || !error.response) {
        title = 'Network error';
        message = 'Unable to reach the server. Your connection may still be active.';
      }

      showError(title, message);
    },
  });

  // Reconnect function - initiates OAuth flow
  const initiateReconnect = () => {
    showInfo('Redirecting to Gmail...', 'You will be redirected to sign in with Google.');
    
    // Store current URL to return to settings after auth
    const returnTo = window.location.pathname + '?settings=open';
    const loginUrl = `/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    
    // Small delay to show the toast before redirecting
    setTimeout(() => {
      window.location.href = loginUrl;
    }, 1000);
  };

  // Initiate first-time OAuth connection
  const initiateConnection = () => {
    showInfo('Connecting to Gmail...', 'You will be redirected to sign in with Google.');
    
    // Store current URL to return to settings after auth
    const returnTo = window.location.pathname + '?settings=open&auth=first-time';
    const loginUrl = `/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    
    // Small delay to show the toast before redirecting
    setTimeout(() => {
      window.location.href = loginUrl;
    }, 1000);
  };

  const disconnect = async () => {
    if (disconnectMutation.isPending) return;
    
    try {
      await disconnectMutation.mutateAsync();
    } catch (error) {
      // Error is handled in onError callback
      console.error('Disconnect error:', error);
    }
  };

  return {
    // Disconnect functionality
    disconnect,
    isDisconnecting: disconnectMutation.isPending,
    disconnectError: disconnectMutation.error,
    
    // Connect/Reconnect functionality
    initiateConnection,
    initiateReconnect,
  };
};