import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Email } from '../../../shared/src/types/email';
import { useToast } from '../contexts/ToastContext';
import './EmailActions.css';

export interface EmailActionsProps {
  emailId: string;
  isUnread: boolean;
  hasNotifyLabel: boolean;
  hasActionItemLabel: boolean;
}

interface EmailActionButtonProps {
  onClick: () => void;
  disabled: boolean;
  isLoading: boolean;
  title: string;
  'aria-label': string;
  'aria-pressed'?: boolean;
  className?: string;
  children: React.ReactNode;
}

const EmailActionButton: React.FC<EmailActionButtonProps> = ({
  onClick,
  disabled,
  isLoading,
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  className = '',
  children,
}) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <button
      type="button"
      className={`email-action-btn ${className} ${isLoading ? 'loading' : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-busy={isLoading}
      tabIndex={0}
      role="button"
    >
      {children}
    </button>
  );
};

// Helper function to update email in the React Query cache
const updateEmailInList = (
  queryData: any,
  emailId: string,
  updates: Partial<Email>
): any => {
  if (!queryData?.emails) {
    return queryData;
  }

  return {
    ...queryData,
    emails: queryData.emails.map((email: Email) =>
      email.id === emailId ? { ...email, ...updates } : email
    ),
  };
};

const EmailActions: React.FC<EmailActionsProps> = ({
  emailId,
  isUnread,
  hasNotifyLabel,
  hasActionItemLabel,
}) => {
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  // Read status mutation
  const toggleReadMutation = useMutation(
    async (markAsRead: boolean) => {
      const response = await fetch(`/api/emails/${emailId}/read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ markAsRead }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${markAsRead ? 'mark as read' : 'mark as unread'}`);
      }

      return response.json();
    },
    {
      onMutate: async (markAsRead) => {
        // Cancel any outgoing refetches
        await queryClient.cancelQueries(['emails']);
        
        // Snapshot the previous value
        const previousEmails = queryClient.getQueryData(['emails']);
        
        // Optimistically update the cache
        queryClient.setQueryData(['emails'], (old: any) =>
          updateEmailInList(old, emailId, { isUnread: !markAsRead })
        );

        // Return a context object with snapshotted value
        return { previousEmails };
      },
      onSuccess: (data, markAsRead) => {
        success(`Email ${markAsRead ? 'marked as read' : 'marked as unread'}`);
      },
      onError: (err, variables, context) => {
        // Rollback optimistic update on error
        if (context?.previousEmails) {
          queryClient.setQueryData(['emails'], context.previousEmails);
        }
        error(`Failed to ${variables ? 'mark as read' : 'mark as unread'}. Please try again.`);
      },
      onSettled: () => {
        // Refetch to ensure consistency
        queryClient.invalidateQueries(['emails']);
      },
    }
  );

  // Notify label mutation
  const toggleNotifyLabelMutation = useMutation(
    async ({ add }: { add: boolean }) => {
      const method = add ? 'POST' : 'DELETE';
      const url = add 
        ? `/api/emails/${emailId}/labels`
        : `/api/emails/${emailId}/labels/Notify`;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: add ? JSON.stringify({ labelName: 'Notify' }) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Failed to ${add ? 'add' : 'remove'} Notify label`);
      }

      return response.json();
    },
    {
      onMutate: async ({ add }) => {
        await queryClient.cancelQueries(['emails']);
        const previousEmails = queryClient.getQueryData(['emails']);
        
        queryClient.setQueryData(['emails'], (old: any) => {
          if (!old?.emails) return old;
          
          return {
            ...old,
            emails: old.emails.map((email: Email) =>
              email.id === emailId
                ? {
                    ...email,
                    labels: add
                      ? [...email.labels, 'Notify']
                      : email.labels.filter(label => label !== 'Notify'),
                  }
                : email
            ),
          };
        });

        return { previousEmails };
      },
      onSuccess: (data, { add }) => {
        success(`${add ? 'Added' : 'Removed'} Notify label`);
      },
      onError: (err, variables, context) => {
        if (context?.previousEmails) {
          queryClient.setQueryData(['emails'], context.previousEmails);
        }
        error(`Failed to ${variables.add ? 'add' : 'remove'} Notify label. Please try again.`);
      },
      onSettled: () => {
        queryClient.invalidateQueries(['emails']);
      },
    }
  );

  // Action Item label mutation
  const toggleActionItemLabelMutation = useMutation(
    async ({ add }: { add: boolean }) => {
      const method = add ? 'POST' : 'DELETE';
      const url = add 
        ? `/api/emails/${emailId}/labels`
        : `/api/emails/${emailId}/labels/Action-Item`;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: add ? JSON.stringify({ labelName: 'Action-Item' }) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Failed to ${add ? 'add' : 'remove'} Action Item label`);
      }

      return response.json();
    },
    {
      onMutate: async ({ add }) => {
        await queryClient.cancelQueries(['emails']);
        const previousEmails = queryClient.getQueryData(['emails']);
        
        queryClient.setQueryData(['emails'], (old: any) => {
          if (!old?.emails) return old;
          
          return {
            ...old,
            emails: old.emails.map((email: Email) =>
              email.id === emailId
                ? {
                    ...email,
                    labels: add
                      ? [...email.labels, 'Action-Item']
                      : email.labels.filter(label => label !== 'Action-Item'),
                  }
                : email
            ),
          };
        });

        return { previousEmails };
      },
      onSuccess: (data, { add }) => {
        success(`${add ? 'Added' : 'Removed'} Action Item label`);
      },
      onError: (err, variables, context) => {
        if (context?.previousEmails) {
          queryClient.setQueryData(['emails'], context.previousEmails);
        }
        error(`Failed to ${variables.add ? 'add' : 'remove'} Action Item label. Please try again.`);
      },
      onSettled: () => {
        queryClient.invalidateQueries(['emails']);
      },
    }
  );

  // Check if any mutation is loading
  const isAnyLoading = 
    toggleReadMutation.isLoading ||
    toggleNotifyLabelMutation.isLoading ||
    toggleActionItemLabelMutation.isLoading;

  return (
    <div 
      className="email-actions"
      role="group"
      aria-label="Email actions"
    >
      <EmailActionButton
        onClick={() => toggleReadMutation.mutate(!isUnread)}
        disabled={isAnyLoading}
        isLoading={toggleReadMutation.isLoading}
        title={isUnread ? 'Mark as Read' : 'Mark as Unread'}
        aria-label={isUnread ? 'Mark email as read' : 'Mark email as unread'}
        aria-pressed={!isUnread}
        className={isUnread ? '' : 'read'}
      >
        {isUnread ? '📖' : '📕'}
      </EmailActionButton>

      <EmailActionButton
        onClick={() => toggleNotifyLabelMutation.mutate({ add: !hasNotifyLabel })}
        disabled={isAnyLoading}
        isLoading={toggleNotifyLabelMutation.isLoading}
        title={hasNotifyLabel ? 'Remove Notify Label' : 'Add Notify Label'}
        aria-label={hasNotifyLabel ? 'Remove notify label' : 'Add notify label'}
        aria-pressed={hasNotifyLabel}
        className={hasNotifyLabel ? 'active' : ''}
      >
        🔔
      </EmailActionButton>

      <EmailActionButton
        onClick={() => toggleActionItemLabelMutation.mutate({ add: !hasActionItemLabel })}
        disabled={isAnyLoading}
        isLoading={toggleActionItemLabelMutation.isLoading}
        title={hasActionItemLabel ? 'Remove Action Item Label' : 'Add Action Item Label'}
        aria-label={hasActionItemLabel ? 'Remove action item label' : 'Add action item label'}
        aria-pressed={hasActionItemLabel}
        className={hasActionItemLabel ? 'active' : ''}
      >
        📌
      </EmailActionButton>
    </div>
  );
};

export default EmailActions;