export interface Email {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
}

export type SortField = 'date' | 'from' | 'subject';
export type SortDirection = 'asc' | 'desc';
export type FilterType = 'all' | 'unread' | 'notify' | 'action-item';

export interface EmailListState {
  sortField: SortField;
  sortDirection: SortDirection;
  filter: FilterType;
  useVirtualScrolling: boolean;
}