import clsx from 'clsx';
import EmailActions from './EmailActions';
import './EmailListItem.css';

import { Email } from '../../../shared/src/types/email';

interface EmailListItemProps {
  email: Email;
}

export default function EmailListItem({ email }: EmailListItemProps) {
  const hasNotify = email.labels.includes('Notify');
  const hasActionItem = email.labels.includes('Action-Item') || email.labels.includes('Action Item');
  
  const getBackgroundColor = () => {
    if (hasNotify && hasActionItem) return 'email-both';
    if (hasNotify) return 'email-notify';
    if (hasActionItem) return 'email-action';
    return '';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit' 
      });
    }
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <div 
      className={clsx(
        'email-list-item',
        getBackgroundColor(),
        email.isUnread && 'email-unread'
      )}
    >
      <div className="email-col-from">{email.from}</div>
      <div className="email-col-subject">
        <span className="email-subject">{email.subject}</span>
        <span className="email-snippet"> - {email.snippet}</span>
      </div>
      <div className="email-col-date">{formatDate(email.date)}</div>
      <div className="email-col-actions">
        <EmailActions
          emailId={email.id}
          isUnread={email.isUnread}
          hasNotifyLabel={hasNotify}
          hasActionItemLabel={hasActionItem}
        />
      </div>
    </div>
  );
}