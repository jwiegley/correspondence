import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import axios from 'axios';
import EmailListItem from '../components/EmailListItem';
import RefreshControl from '../components/RefreshControl';
import { useVirtualScroll } from '../hooks/useVirtualScroll';
import { Email } from '../../../shared/src/types/email';
import './EmailList.css';

type SortField = 'date' | 'from' | 'subject';
type SortDirection = 'asc' | 'desc';
type FilterType = 'all' | 'unread' | 'notify' | 'action-item';

const ITEM_HEIGHT = 72; // Height of each email item in pixels
const CONTAINER_HEIGHT = 600; // Approximate height of the scrollable container

export default function EmailList() {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filter, setFilter] = useState<FilterType>('all');
  const [useVirtualScrolling, setUseVirtualScrolling] = useState(true);

  const { data: emails = [], isLoading, error } = useQuery<Email[]>({
    queryKey: ['emails'],
    queryFn: async () => {
      const response = await axios.get('/api/emails', {
        withCredentials: true,
      });
      return response.data.emails;
    },
  });

  const sortedAndFilteredEmails = useMemo(() => {
    let filtered = emails;

    // Apply filters
    switch (filter) {
      case 'unread':
        filtered = emails.filter(email => email.isUnread);
        break;
      case 'notify':
        filtered = emails.filter(email => email.labels.includes('Notify'));
        break;
      case 'action-item':
        filtered = emails.filter(email => email.labels.includes('Action-Item'));
        break;
      default:
        filtered = emails;
    }

    // Apply sorting
    return [...filtered].sort((a, b) => {
      let aValue: string | Date;
      let bValue: string | Date;

      switch (sortField) {
        case 'date':
          aValue = new Date(a.date);
          bValue = new Date(b.date);
          break;
        case 'from':
          aValue = a.from.toLowerCase();
          bValue = b.from.toLowerCase();
          break;
        case 'subject':
          aValue = a.subject.toLowerCase();
          bValue = b.subject.toLowerCase();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [emails, sortField, sortDirection, filter]);

  // Use virtual scrolling for large lists (>100 items)
  const shouldUseVirtualScrolling = useVirtualScrolling && sortedAndFilteredEmails.length > 100;
  
  const virtualScroll = useVirtualScroll(sortedAndFilteredEmails, {
    itemHeight: ITEM_HEIGHT,
    containerHeight: CONTAINER_HEIGHT,
    overscan: 5,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

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

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="email-list">
      <div className="email-list-controls">
        <div className="filter-controls">
          <label htmlFor="filter">Filter:</label>
          <select 
            id="filter" 
            value={filter} 
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="filter-select"
          >
            <option value="all">All Emails</option>
            <option value="unread">Unread Only</option>
            <option value="notify">Notify Label</option>
            <option value="action-item">Action Items</option>
          </select>
        </div>
        <div className="performance-controls">
          <label>
            <input
              type="checkbox"
              checked={useVirtualScrolling}
              onChange={(e) => setUseVirtualScrolling(e.target.checked)}
            />
            Virtual scrolling ({shouldUseVirtualScrolling ? 'active' : 'disabled'})
          </label>
        </div>
        <div className="email-count">
          {sortedAndFilteredEmails.length} emails
        </div>
      </div>

      <RefreshControl />

      <div className="email-list-header">
        <div 
          className="email-col-from sortable" 
          onClick={() => handleSort('from')}
          role="button"
          tabIndex={0}
        >
          From {getSortIcon('from')}
        </div>
        <div 
          className="email-col-subject sortable" 
          onClick={() => handleSort('subject')}
          role="button"
          tabIndex={0}
        >
          Subject {getSortIcon('subject')}
        </div>
        <div 
          className="email-col-date sortable" 
          onClick={() => handleSort('date')}
          role="button"
          tabIndex={0}
        >
          Date {getSortIcon('date')}
        </div>
        <div className="email-col-actions">Actions</div>
      </div>
      
      <div 
        className="email-list-body" 
        style={{ height: shouldUseVirtualScrolling ? `${CONTAINER_HEIGHT}px` : 'auto' }}
        onScroll={shouldUseVirtualScrolling ? virtualScroll.handleScroll : undefined}
      >
        {shouldUseVirtualScrolling ? (
          <div style={{ height: virtualScroll.totalHeight, position: 'relative' }}>
            <div 
              style={{ 
                transform: `translateY(${virtualScroll.offsetY}px)`,
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
              }}
            >
              {virtualScroll.visibleItems.map((email) => (
                <div key={email.id} style={{ height: ITEM_HEIGHT }}>
                  <EmailListItem email={email} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          sortedAndFilteredEmails.map((email) => (
            <EmailListItem key={email.id} email={email} />
          ))
        )}
      </div>
    </div>
  );
}