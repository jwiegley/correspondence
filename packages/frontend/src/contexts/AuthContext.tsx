import React, { createContext, useContext, ReactNode, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
}

interface AuthStatus {
  authenticated: boolean;
  user?: User;
  sessionId?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: any;
  login: () => void;
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// Configure axios defaults
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
axios.defaults.withCredentials = true;

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const queryClient = useQueryClient();

  // Query for authentication status
  const { 
    data, 
    isLoading, 
    error, 
    refetch 
  } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: async () => {
      try {
        const response = await axios.get('/auth/status');
        return response.data;
      } catch (error: any) {
        // If we get a 401, the user is not authenticated
        if (error.response?.status === 401) {
          return { authenticated: false };
        }
        throw error;
      }
    },
    retry: (failureCount, error: any) => {
      // Don't retry on authentication errors
      if (error.response?.status === 401) {
        return false;
      }
      return failureCount < 3;
    },
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      await axios.post('/auth/logout');
    },
    onSuccess: () => {
      // Clear all cached data
      queryClient.clear();
      // Refetch auth status
      refetch();
    },
    onError: (error: any) => {
      console.error('Logout error:', error);
      // Even if logout fails on the server, clear local state
      queryClient.clear();
      refetch();
    }
  });

  // Login function - redirects to OAuth flow
  const login = () => {
    const returnTo = window.location.pathname;
    const loginUrl = `/auth/google${returnTo !== '/login' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    window.location.href = loginUrl;
  };

  // Logout function
  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  // Handle OAuth callback success/error
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get('auth');
    const authError = urlParams.get('error');
    const errorMessage = urlParams.get('message');

    if (authSuccess === 'success') {
      // Clear URL parameters
      window.history.replaceState({}, '', window.location.pathname);
      // Refetch auth status to update UI
      refetch();
    }

    if (authError) {
      console.error('OAuth error:', authError, errorMessage);
      // You could show a toast notification here
      // Clear URL parameters
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refetch]);

  // Handle token refresh errors
  useEffect(() => {
    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && error.response?.data?.code === 'REAUTH_REQUIRED') {
          console.log('Re-authentication required, clearing auth state');
          queryClient.setQueryData(['auth-status'], { authenticated: false });
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [queryClient]);

  const contextValue: AuthContextType = {
    user: data?.user || null,
    isAuthenticated: data?.authenticated ?? false,
    isLoading,
    error,
    login,
    logout,
    refetch,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};