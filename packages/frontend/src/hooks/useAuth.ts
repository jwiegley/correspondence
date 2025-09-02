import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

interface AuthStatus {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
}

export const useAuth = () => {
  const { data, isLoading, error, refetch } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: async () => {
      const response = await axios.get('/auth/status', {
        withCredentials: true,
      });
      return response.data;
    },
    retry: false,
  });

  return {
    isAuthenticated: data?.authenticated ?? false,
    user: data?.user,
    isLoading,
    error,
    refetch,
  };
};