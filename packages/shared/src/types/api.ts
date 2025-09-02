export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: any;
}

export interface PaginatedResponse<T> {
  items: T[];
  pageInfo: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface SyncStatus {
  isRunning: boolean;
  lastSyncTime?: string;
  nextSyncTime?: string;
  syncErrors?: string[];
  emailsProcessed: number;
  emailsPending: number;
}

export interface ConnectionStatus {
  gmail: {
    connected: boolean;
    lastChecked: string;
    error?: string;
  };
  redis: {
    connected: boolean;
    lastChecked: string;
    error?: string;
  };
}

export interface RefreshSettings {
  enabled: boolean;
  intervalSeconds: number;
}