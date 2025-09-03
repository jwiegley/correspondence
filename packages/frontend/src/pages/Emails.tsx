import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Mail, Bell, Flag } from 'lucide-react';
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
      const res = await fetch(`/api/emails/${emailId}/labels`, {
        method: hasLabel ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error('Failed to update label');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      showSuccess('Label updated');
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
  // For demonstration, show all recent emails
  // In production, filter by: email.unread || email.labels.includes('Notify') || email.labels.includes('Action-Item')
  const filteredEmails = emails;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 print:bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 print:p-0">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inbox Manager</h1>
            <p className="mt-1 text-sm text-gray-500">Monitor and manage important emails</p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-white font-medium hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading}
          >
            <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
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
          <div className="overflow-hidden rounded-xl shadow-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    From
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Subject
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider print:hidden">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filteredEmails.map((email) => {
                  const hasNotify = email.labels.includes('Notify');
                  const hasActionItem = email.labels.includes('Action-Item');
                  const isoDate = new Date(email.date).toISOString().split('T')[0];
                  const truncatedFrom = email.from.length > 20 ? email.from.substring(0, 20) + '...' : email.from;
                  const truncatedSubject = (email.subject || '(No subject)').length > 50 
                    ? (email.subject || '(No subject)').substring(0, 50) + '...' 
                    : (email.subject || '(No subject)');

                  return (
                    <tr 
                      key={email.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        hasActionItem ? 'bg-orange-50 border-l-4 border-orange-400' :
                        hasNotify ? 'bg-green-50 border-l-4 border-green-400' :
                        email.unread ? 'bg-blue-50 border-l-4 border-blue-400' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {isoDate}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className={`text-sm ${email.unread ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                            {truncatedFrom}
                          </span>
                          {email.unread && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className={`text-sm ${email.unread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {truncatedSubject}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center print:hidden">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => toggleReadMutation.mutate({ emailId: email.id, unread: email.unread })}
                            className={`group relative rounded-lg p-2 transition-all duration-200 transform hover:scale-105 ${
                              email.unread
                                ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md hover:shadow-lg hover:from-blue-600 hover:to-blue-700'
                                : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:shadow-md'
                            }`}
                            title={email.unread ? 'Mark as read' : 'Mark as unread'}
                          >
                            <Mail className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleLabelMutation.mutate({ emailId: email.id, label: 'Notify', hasLabel: hasNotify })}
                            className={`group relative rounded-lg p-2 transition-all duration-200 transform hover:scale-105 ${
                              hasNotify
                                ? 'bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-md hover:shadow-lg hover:from-emerald-600 hover:to-green-700'
                                : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:shadow-md'
                            }`}
                            title={hasNotify ? 'Remove Notify label' : 'Add Notify label'}
                          >
                            <Bell className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleLabelMutation.mutate({ emailId: email.id, label: 'Action-Item', hasLabel: hasActionItem })}
                            className={`group relative rounded-lg p-2 transition-all duration-200 transform hover:scale-105 ${
                              hasActionItem
                                ? 'bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md hover:shadow-lg hover:from-orange-600 hover:to-red-600'
                                : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:shadow-md'
                            }`}
                            title={hasActionItem ? 'Remove Action Item label' : 'Add Action Item label'}
                          >
                            <Flag className="h-4 w-4" />
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