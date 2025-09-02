import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useToast } from '../contexts/ToastContext';

interface TestConnectionResponse {
  success: boolean;
  message: string;
  isConnected?: boolean;
  email?: string;
  lastSync?: string;
  tokenExpiry?: string;
  scopes?: string[];
  messagesTotal?: number;
  threadsTotal?: number;
  error?: string;
  code?: string;
}

export const useTestConnection = () => {
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const { showSuccess, showError } = useToast();
  const queryClient = useQueryClient();

  const testConnectionMutation = useMutation<TestConnectionResponse>({
    mutationFn: async () => {
      const response = await axios.get('/auth/test-connection');
      return response.data;
    },
    onSuccess: (data) => {
      showSuccess(
        'Connection successful!',
        `Gmail connection is working properly. Found ${data.messagesTotal || 0} messages.`
      );
      
      // Invalidate connection status queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['connection-status'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
    onError: (error: any) => {
      let title = 'Connection test failed';
      let message = 'Unable to test Gmail connection';

      if (error.response?.data) {
        const errorData = error.response.data;
        title = errorData.error || title;
        message = errorData.message || message;

        // Provide specific guidance based on error code
        switch (errorData.code) {
          case 'AUTH_EXPIRED':
            message = 'Your Gmail connection has expired. Please click "Reconnect" to sign in again.';
            break;
          case 'INSUFFICIENT_PERMISSIONS':
            message = 'Gmail permissions are insufficient. Please reconnect and grant all requested permissions.';
            break;
          case 'NETWORK_ERROR':
            message = 'Unable to reach Gmail servers. Please check your internet connection and try again.';
            break;
          case 'QUOTA_EXCEEDED':
            message = 'Gmail API usage limit exceeded. Please try again in a few minutes.';
            break;
          case 'NO_TOKENS':
          case 'INVALID_TOKENS':
            message = 'No valid authentication found. Please reconnect your Gmail account.';
            break;
        }
      } else if (error.code === 'NETWORK_ERROR' || !error.response) {
        title = 'Network error';
        message = 'Unable to reach the server. Please check your connection and try again.';
      }

      showError(title, message);
    },
  });

  const testConnection = async () => {
    if (isTestingConnection) return;

    setIsTestingConnection(true);
    try {
      await testConnectionMutation.mutateAsync();
    } finally {
      setIsTestingConnection(false);
    }
  };

  return {
    testConnection,
    isTestingConnection: isTestingConnection || testConnectionMutation.isPending,
    error: testConnectionMutation.error,
    data: testConnectionMutation.data,
  };
};