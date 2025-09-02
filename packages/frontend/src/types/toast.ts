export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
  dismissible?: boolean;
}

export interface ToastOptions {
  variant?: ToastVariant;
  duration?: number;
  dismissible?: boolean;
}