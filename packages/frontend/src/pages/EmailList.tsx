import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import EmailListItem from '../components/EmailListItem';
import './EmailList.css';

interface Email {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
}

export default function EmailList() {
  const { data: emails = [], isLoading, error } = useQuery<Email[]>({
    queryKey: ['emails'],
    queryFn: async () => {
      const response = await axios.get('/api/emails', {
        withCredentials: true,
      });
      return response.data.emails;
    },
  });

  if (isLoading) {
    return <div className="email-list-loading">Loading emails...</div>;
  }

  if (error) {
    return <div className="email-list-error">Error loading emails</div>;
  }

  if (emails.length === 0) {
    return (
      <div className="email-list-empty">
        <p>No emails found</p>
        <p className="email-list-empty-hint">
          Check that you have emails with the Notify or Action-Item labels
        </p>
      </div>
    );
  }

  return (
    <div className="email-list">
      <div className="email-list-header">
        <div className="email-col-from">From</div>
        <div className="email-col-subject">Subject</div>
        <div className="email-col-date">Date</div>
        <div className="email-col-actions">Actions</div>
      </div>
      <div className="email-list-body">
        {emails.map((email) => (
          <EmailListItem key={email.id} email={email} />
        ))}
      </div>
    </div>
  );
}