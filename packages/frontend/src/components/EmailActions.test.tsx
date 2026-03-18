import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import EmailActions from './EmailActions';
import { ToastProvider } from '../contexts/ToastContext';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test wrapper component
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { 
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: { 
        retry: false,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div id="toast-root"></div>
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('EmailActions', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    emailId: 'test-email-id',
    isUnread: true,
    hasNotifyLabel: false,
    hasActionItemLabel: false,
  };

  it('renders all action buttons', () => {
    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByLabelText(/mark email as read/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/add notify label/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/add action item label/i)).toBeInTheDocument();
  });

  it('shows correct button states based on props', () => {
    render(
      <TestWrapper>
        <EmailActions
          {...defaultProps}
          isUnread={false}
          hasNotifyLabel={true}
          hasActionItemLabel={true}
        />
      </TestWrapper>
    );

    expect(screen.getByLabelText(/mark email as unread/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove notify label/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove action item label/i)).toBeInTheDocument();
  });

  it('handles read status toggle click', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    const readButton = screen.getByLabelText(/mark email as read/i);
    fireEvent.click(readButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/emails/test-email-id/read',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ markAsRead: true }),
        })
      );
    });
  });

  it('handles notify label toggle click', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    const notifyButton = screen.getByLabelText(/add notify label/i);
    fireEvent.click(notifyButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/emails/test-email-id/labels',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ labelName: 'Notify' }),
        })
      );
    });
  });

  it('handles action item label toggle click', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    const actionButton = screen.getByLabelText(/add action item label/i);
    fireEvent.click(actionButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/emails/test-email-id/labels',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ labelName: 'Action-Item' }),
        })
      );
    });
  });

  it('handles label removal', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <TestWrapper>
        <EmailActions
          {...defaultProps}
          hasNotifyLabel={true}
        />
      </TestWrapper>
    );

    const notifyButton = screen.getByLabelText(/remove notify label/i);
    fireEvent.click(notifyButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/emails/test-email-id/labels/Notify',
        expect.objectContaining({
          method: 'DELETE',
          credentials: 'include',
        })
      );
    });
  });

  it('disables buttons during loading', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    const readButton = screen.getByLabelText(/mark email as read/i);
    fireEvent.click(readButton);

    await waitFor(() => {
      expect(readButton).toBeDisabled();
      expect(screen.getByLabelText(/add notify label/i)).toBeDisabled();
      expect(screen.getByLabelText(/add action item label/i)).toBeDisabled();
    });
  });

  it('supports keyboard navigation', () => {
    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    const readButton = screen.getByLabelText(/mark email as read/i);
    const notifyButton = screen.getByLabelText(/add notify label/i);
    const actionButton = screen.getByLabelText(/add action item label/i);

    expect(readButton).toHaveAttribute('tabIndex', '0');
    expect(notifyButton).toHaveAttribute('tabIndex', '0');
    expect(actionButton).toHaveAttribute('tabIndex', '0');
  });

  it('handles keyboard events', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <TestWrapper>
        <EmailActions {...defaultProps} />
      </TestWrapper>
    );

    const readButton = screen.getByLabelText(/mark email as read/i);
    fireEvent.keyDown(readButton, { key: 'Enter' });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});