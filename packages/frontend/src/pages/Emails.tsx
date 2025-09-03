import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Mail, Bell, Flag, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  unread: boolean;
  labels: string[];
}

interface EmailsResponse {
  emails: Email[];
  nextPageToken?: string;
}

function Emails() {
  const queryClient = useQueryClient();
  const { showSuccess, showError, showInfo } = useToast();

  // Fetch emails from the backend
  const { data, isLoading, error, refetch } = useQuery<EmailsResponse>({
    queryKey: ['emails'],
    queryFn: async () => {
      const res = await fetch('/api/emails', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch emails');
      }
      return res.json();
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Mark as read/unread mutation
  const toggleReadMutation = useMutation({
    mutationFn: async ({ emailId, unread }: { emailId: string; unread: boolean }) => {
      const res = await fetch(`/api/emails/${emailId}/read`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ unread: !unread }),
      });
      if (!res.ok) throw new Error('Failed to update read status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      showSuccess('Read status updated');
    },
    onError: () => {
      showError('Failed to update read status');
    },
  });

  // Toggle label mutation
  const toggleLabelMutation = useMutation({
    mutationFn: async ({ emailId, label, hasLabel }: { emailId: string; label: string; hasLabel: boolean }) => {
      if (hasLabel) {
        // DELETE request - label name goes in URL
        const res = await fetch(`/api/emails/${emailId}/labels/${encodeURIComponent(label)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to remove label');
        return res.json();
      } else {
        // POST request - label name goes in body
        const res = await fetch(`/api/emails/${emailId}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ labelName: label }),
        });
        if (!res.ok) throw new Error('Failed to add label');
        return res.json();
      }
    },
    onSuccess: (data, variables) => {
      // Force immediate refetch to update the list
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.refetchQueries({ queryKey: ['emails'] });
      
      // Show success message with label info
      const action = variables.hasLabel ? 'Removed' : 'Added';
      showSuccess(`${action} ${variables.label} label`);
    },
    onError: () => {
      showError('Failed to update label');
    },
  });


  const handleRefresh = () => {
    refetch();
    showInfo('Refreshing emails...');
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg bg-red-50 p-4">
            <p className="text-red-800">Error loading emails: {error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const emails = data?.emails || [];
  
  // Filter to show:
  // 1. Unread messages in inbox (unless they have Ignore label)
  // 2. Messages with "Action-Item" label (read or unread)
  // 3. Messages with "Active Correspondence" label (read or unread)
  // 4. Messages with "Notify" label (read or unread)
  // Never show messages with "Ignore" label
  const filteredEmails = emails.filter(email => {
    // Check for Ignore label - if present, never show
    const hasIgnore = email.labels && email.labels.some(label => 
      typeof label === 'string' && (
        label === 'Ignore' ||
        label.toLowerCase() === 'ignore'
      )
    );
    if (hasIgnore) return false;
    
    // Check if UNREAD
    const isUnread = email.labels && email.labels.includes('UNREAD');
    if (isUnread) return true;
    
    // Check for Action-Item label
    const hasActionItem = email.labels && email.labels.some(label => 
      typeof label === 'string' && (
        label === 'Action-Item' ||
        label === 'Action Item' ||
        label.toLowerCase() === 'action-item' ||
        label.toLowerCase() === 'action item'
      )
    );
    if (hasActionItem) return true;
    
    // Check for Active Correspondence label
    const hasActiveCorrespondence = email.labels && email.labels.some(label => 
      typeof label === 'string' && (
        label === 'Active Correspondence' ||
        label.toLowerCase() === 'active correspondence'
      )
    );
    if (hasActiveCorrespondence) return true;
    
    // Check for Notify label
    const hasNotify = email.labels && email.labels.some(label => 
      typeof label === 'string' && (
        label === 'Notify' ||
        label.toLowerCase() === 'notify'
      )
    );
    
    return hasNotify;
  });

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 print:p-0">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Email Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">Manage your inbox and labels</p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm text-white font-medium hover:bg-teal-700 transition-colors shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {isLoading && filteredEmails.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center space-y-4">
              <div className="relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-20 w-20 bg-blue-200 rounded-full animate-ping opacity-20"></div>
                </div>
                <RefreshCw className="relative h-12 w-12 animate-spin text-blue-600 mx-auto" />
              </div>
              <div>
                <p className="text-lg font-medium text-gray-900">Loading your emails</p>
                <p className="text-sm text-gray-500 mt-1">Fetching messages from Gmail...</p>
              </div>
            </div>
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white to-gray-50 p-16 text-center shadow-xl border border-gray-100">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full blur-2xl opacity-50"></div>
            <div className="absolute bottom-0 left-0 -mb-4 -ml-4 h-32 w-32 bg-gradient-to-tr from-green-100 to-blue-100 rounded-full blur-2xl opacity-50"></div>
            <div className="relative">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl mb-4">
                <Mail className="h-10 w-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">All caught up!</h3>
              <p className="text-gray-500">No emails requiring your attention right now</p>
              <p className="text-gray-400 text-sm mt-4">Check back later for new messages</p>
            </div>
          </div>
        ) : (
          <div style={{ backgroundColor: 'white', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'linear-gradient(90deg, #14b8a6 0%, #0d9488 100%)' }}>
                  <th style={{ padding: '16px 12px', textAlign: 'center', color: 'white', fontWeight: '600', fontSize: '16px', width: '50px' }}>
                    #
                  </th>
                  <th style={{ padding: '16px 24px', textAlign: 'left', color: 'white', fontWeight: '600', fontSize: '16px' }}>
                    Date  
                  </th>
                  <th style={{ padding: '16px 24px', textAlign: 'left', color: 'white', fontWeight: '600', fontSize: '16px' }}>
                    From
                  </th>
                  <th style={{ padding: '16px 24px', textAlign: 'left', color: 'white', fontWeight: '600', fontSize: '16px' }}>
                    Subject
                  </th>
                  <th style={{ padding: '16px 24px', textAlign: 'center', color: 'white', fontWeight: '600', fontSize: '16px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEmails.map((email, index) => {
                  const hasNotify = email.labels.some(l => 
                    l === 'Notify' || l.toLowerCase() === 'notify'
                  );
                  const hasActionItem = email.labels.some(l => 
                    l === 'Action-Item' || l === 'Action Item' || 
                    l.toLowerCase() === 'action-item' || l.toLowerCase() === 'action item'
                  );
                  const hasIgnore = email.labels.some(l => 
                    l === 'Ignore' || l.toLowerCase() === 'ignore'
                  );
                  const isoDate = new Date(email.date).toISOString().split('T')[0];
                  const truncatedFrom = email.from.length > 20 ? email.from.substring(0, 20) + '...' : email.from;
                  const truncatedSubject = (email.subject || '(No subject)').length > 50 
                    ? (email.subject || '(No subject)').substring(0, 50) + '...' 
                    : (email.subject || '(No subject)');

                  // Determine background color based on labels
                  let backgroundColor;
                  if (hasActionItem) {
                    backgroundColor = '#fee2e2'; // Light red for Action Items
                  } else if (hasNotify) {
                    backgroundColor = '#fef3c7'; // Yellow for Notify
                  } else if (index % 2 === 0) {
                    backgroundColor = 'white';
                  } else {
                    backgroundColor = '#f9fafb';
                  }

                  return (
                    <tr 
                      key={email.id}
                      style={{
                        backgroundColor,
                        borderBottom: '1px solid #e5e7eb',
                        borderLeft: hasActionItem ? '4px solid #dc2626' : hasNotify ? '4px solid #f59e0b' : email.labels && email.labels.includes('UNREAD') ? '4px solid #14b8a6' : 'none',
                        transition: 'background-color 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = hasActionItem ? '#fecaca' : hasNotify ? '#fde68a' : '#f0fdfa'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = backgroundColor}
                    >
                      <td style={{ padding: '16px 12px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: '16px', color: '#374151', width: '50px' }}>
                        {index + 1}
                      </td>
                      <td style={{ 
                        padding: '16px 24px', 
                        whiteSpace: 'nowrap', 
                        fontSize: '16px', 
                        color: '#374151',
                        fontWeight: (email.labels && email.labels.includes('UNREAD')) ? 'bold' : 'normal'
                      }}>
                        {isoDate}
                      </td>
                      <td style={{ padding: '16px 24px', whiteSpace: 'nowrap', fontSize: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ 
                            fontSize: '16px',
                            color: (email.labels && email.labels.includes('UNREAD')) ? '#111827' : '#374151',
                            fontWeight: (email.labels && email.labels.includes('UNREAD')) ? 'bold' : 'normal'
                          }}>
                            {truncatedFrom}
                          </span>
                          {email.labels && email.labels.includes('UNREAD') && (
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: '500',
                              backgroundColor: '#99f6e4',
                              color: '#0f766e'
                            }}>
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '16px 24px', fontSize: '16px' }}>
                        <a 
                          href={`https://mail.google.com/mail/u/0/#inbox/${email.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ 
                            fontSize: '16px',
                            color: (email.labels && email.labels.includes('UNREAD')) ? '#111827' : '#374151',
                            fontWeight: (email.labels && email.labels.includes('UNREAD')) ? 'bold' : 'normal',
                            textDecoration: 'none',
                            cursor: 'pointer'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {truncatedSubject}
                        </a>
                      </td>
                      <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => toggleReadMutation.mutate({ emailId: email.id, unread: email.labels && email.labels.includes('UNREAD') })}
                            className={`rounded p-1.5 transition-all duration-150 ${
                              email.labels && email.labels.includes('UNREAD')
                                ? 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                            title={email.labels && email.labels.includes('UNREAD') ? "Mark as read" : "Mark as unread"}
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => toggleLabelMutation.mutate({ emailId: email.id, label: 'Notify', hasLabel: hasNotify })}
                            className={`rounded p-1.5 transition-all duration-150 ${
                              hasNotify
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                            }`}
                            title={hasNotify ? 'Remove Notify label' : 'Add Notify label'}
                          >
                            <Bell className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => toggleLabelMutation.mutate({ emailId: email.id, label: 'Action-Item', hasLabel: hasActionItem })}
                            className={`rounded p-1.5 transition-all duration-150 ${
                              hasActionItem
                                ? 'bg-orange-500 text-white hover:bg-orange-600'
                                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                            }`}
                            title={hasActionItem ? 'Remove Action Item label' : 'Add Action Item label'}
                          >
                            <Flag className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => toggleLabelMutation.mutate({ emailId: email.id, label: 'Ignore', hasLabel: hasIgnore })}
                            className={`rounded p-1.5 transition-all duration-150 ${
                              hasIgnore
                                ? 'bg-red-500 text-white hover:bg-red-600'
                                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                            }`}
                            title={hasIgnore ? 'Remove Ignore label' : 'Add Ignore label'}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-400 print:hidden">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Last refreshed: {new Date().toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          })}</span>
        </div>
      </div>
    </div>
  );
}

export default Emails;