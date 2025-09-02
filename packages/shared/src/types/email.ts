export interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string[];
  date: string;
  snippet: string;
  body: string;
  labels: string[];
  labelIds: string[];
  isUnread: boolean;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  color?: {
    backgroundColor: string;
    textColor: string;
  };
}

export interface EmailFilter {
  labels?: string[];
  isUnread?: boolean;
  from?: string;
  subject?: string;
  after?: Date;
  before?: Date;
  hasAttachment?: boolean;
}

export interface EmailUpdate {
  addLabels?: string[];
  removeLabels?: string[];
  markAsRead?: boolean;
  markAsUnread?: boolean;
}

export type EmailSortField = 'date' | 'from' | 'subject';
export type EmailSortOrder = 'asc' | 'desc';

export interface EmailListRequest {
  filter?: EmailFilter;
  sortBy?: EmailSortField;
  sortOrder?: EmailSortOrder;
  pageSize?: number;
  pageToken?: string;
}

export interface EmailListResponse {
  emails: Email[];
  nextPageToken?: string;
  totalCount: number;
}