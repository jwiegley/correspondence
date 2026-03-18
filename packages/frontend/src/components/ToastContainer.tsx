import React from 'react';
import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { Toast as ToastData } from '../types/toast';
import './ToastContainer.css';

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  // Create portal to render toasts at the top level
  const toastRoot = document.getElementById('toast-root') || document.body;

  return createPortal(
    <div
      className="toast-container"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          type={toast.variant}
          title={toast.message}
          duration={toast.duration}
          dismissible={toast.dismissible}
          onDismiss={onDismiss}
        />
      ))}
    </div>,
    toastRoot
  );
};

export default ToastContainer;
