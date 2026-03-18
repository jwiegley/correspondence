import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import { List, ListImperativeAPI, RowComponentProps } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import EmailListItem from './EmailListItem';
import performanceMonitor from '../utils/performance';
import './VirtualEmailList.css';

interface Email {
  id: string;
  subject: string;
  sender: string;
  date: string;
  isRead: boolean;
  isSelected: boolean;
  snippet: string;
  labels?: string[];
  hasAttachments?: boolean;
}

interface VirtualEmailListProps {
  emails: Email[];
  onEmailClick: (email: Email) => void;
  onEmailSelect: (email: Email, selected: boolean) => void;
  onLoadMore?: () => Promise<void>;
  hasNextPage?: boolean;
  isLoading?: boolean;
  height: number;
  itemHeight?: number;
  overscanCount?: number;
  threshold?: number;
  className?: string;
}

interface ItemData {
  emails: Email[];
  onEmailClick: (email: Email) => void;
  onEmailSelect: (email: Email, selected: boolean) => void;
  isLoading: boolean;
  hasNextPage: boolean;
}

// Memoized email item component
const EmailItem = React.memo<RowComponentProps<ItemData>>(({ index, style, emails, isLoading }) => {
  // Show loading placeholder for items that haven't loaded yet
  if (index >= emails.length) {
    if (isLoading) {
      return (
        <div style={style} className="virtual-email-item virtual-email-loading">
          <div className="loading-skeleton">
            <div className="loading-line loading-line-short"></div>
            <div className="loading-line loading-line-medium"></div>
            <div className="loading-line loading-line-long"></div>
          </div>
        </div>
      );
    }
    return null;
  }

  const email = emails[index];

  return (
    <div style={style} className="virtual-email-item">
      <EmailListItem
        email={email as any}
      />
    </div>
  );
});

EmailItem.displayName = 'EmailItem';

export const VirtualEmailList: React.FC<VirtualEmailListProps> = ({
  emails,
  onEmailClick,
  onEmailSelect,
  onLoadMore,
  hasNextPage = false,
  isLoading = false,
  height,
  itemHeight = 80,
  overscanCount = 5,
  threshold = 15,
  className = ''
}) => {
  const listRef = useRef<ListImperativeAPI | null>(null);
  const infiniteLoaderRef = useRef<InfiniteLoader>(null);
  const scrollPosition = 0;

  // Performance monitoring
  const renderStartTime = useRef<number>(0);

  useEffect(() => {
    renderStartTime.current = performance.now();
  });

  useEffect(() => {
    if (renderStartTime.current) {
      const renderTime = performance.now() - renderStartTime.current;
      performanceMonitor.recordVirtualScrollPerformance(
        Math.ceil(height / itemHeight),
        emails.length,
        renderTime
      );
    }
  }, [emails.length, height, itemHeight]);

  // Calculate total item count including potential loading items
  const itemCount = hasNextPage ? emails.length + 1 : emails.length;

  // Check if item is loaded
  const isItemLoaded = useCallback((index: number) => {
    return index < emails.length;
  }, [emails.length]);

  // Load more items
  const loadMoreItems = useCallback(async (startIndex: number, stopIndex: number) => {
    if (onLoadMore && hasNextPage && !isLoading) {
      const loadStart = performance.now();
      try {
        await onLoadMore();
        performanceMonitor.recordCustomMetric('emailLoadMore', performance.now() - loadStart, {
          startIndex,
          stopIndex,
          requestedCount: stopIndex - startIndex + 1
        });
      } catch (error) {
        console.error('Failed to load more emails:', error);
        performanceMonitor.recordCustomMetric('emailLoadMoreError', performance.now() - loadStart);
      }
    }
    return Promise.resolve();
  }, [onLoadMore, hasNextPage, isLoading]);

  // Item data for react-window
  const itemData: ItemData = useMemo(() => ({
    emails,
    onEmailClick,
    onEmailSelect,
    isLoading,
    hasNextPage
  }), [emails, onEmailClick, onEmailSelect, isLoading, hasNextPage]);

  // Scroll event handlers (available for future use)
  // const handleScroll = useCallback(({ scrollOffset, scrollDirection }: { scrollOffset: number; scrollDirection: string }) => { ... });

  // Keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!listRef.current) return;

    const currentIndex = Math.floor(scrollPosition / itemHeight);
    let newIndex = currentIndex;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        newIndex = Math.min(currentIndex + 1, emails.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        newIndex = Math.max(currentIndex - 1, 0);
        break;
      case 'PageDown':
        event.preventDefault();
        newIndex = Math.min(currentIndex + Math.floor(height / itemHeight), emails.length - 1);
        break;
      case 'PageUp':
        event.preventDefault();
        newIndex = Math.max(currentIndex - Math.floor(height / itemHeight), 0);
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        newIndex = emails.length - 1;
        break;
      case 'Enter':
        event.preventDefault();
        if (emails[currentIndex]) {
          onEmailClick(emails[currentIndex]);
        }
        break;
      case ' ':
        event.preventDefault();
        if (emails[currentIndex]) {
          onEmailSelect(emails[currentIndex], !emails[currentIndex].isSelected);
        }
        break;
      default:
        return;
    }

    if (newIndex !== currentIndex) {
      listRef.current.scrollToRow({ index: newIndex, align: 'smart' });
    }
  }, [scrollPosition, itemHeight, height, emails, onEmailClick, onEmailSelect]);

  // Dynamic item size calculation (if needed)
  const getItemSize = useCallback((_index: number) => {
    // You could implement dynamic sizing based on email content
    // For now, we'll use fixed size
    return itemHeight;
  }, [itemHeight]);

  // Render loading state
  if (emails.length === 0 && isLoading) {
    return (
      <div className={`virtual-email-list-loading ${className}`} style={{ height }}>
        <div className="loading-message">Loading emails...</div>
      </div>
    );
  }

  // Render empty state
  if (emails.length === 0 && !isLoading) {
    return (
      <div className={`virtual-email-list-empty ${className}`} style={{ height }}>
        <div className="empty-message">No emails to display</div>
      </div>
    );
  }

  return (
    <div
      className={`virtual-email-list ${className}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="list"
      aria-label="Email list"
    >
      <InfiniteLoader
        ref={infiniteLoaderRef}
        isItemLoaded={isItemLoaded}
        itemCount={itemCount}
        loadMoreItems={loadMoreItems}
        threshold={threshold}
      >
        {({ onItemsRendered, ref }) => (
          <List
            listRef={(list: ListImperativeAPI | null) => {
              ref(list);
              listRef.current = list;
            }}
            rowCount={itemCount}
            rowHeight={getItemSize}
            rowProps={itemData}
            onRowsRendered={({ startIndex, stopIndex }: { startIndex: number; stopIndex: number }) => {
              onItemsRendered({ overscanStartIndex: startIndex, overscanStopIndex: stopIndex, visibleStartIndex: startIndex, visibleStopIndex: stopIndex });
            }}
            overscanCount={overscanCount}
            style={{ height }}
            rowComponent={EmailItem}
          />
        )}
      </InfiniteLoader>

      {/* Scroll indicator */}
      {emails.length > Math.ceil(height / itemHeight) && (
        <div className="scroll-indicator">
          <div
            className="scroll-progress"
            style={{
              height: `${(scrollPosition / ((emails.length - 1) * itemHeight)) * 100}%`
            }}
          />
        </div>
      )}

      {/* Performance overlay in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="performance-overlay">
          <div>Items: {emails.length}</div>
          <div>Visible: {Math.ceil(height / itemHeight)}</div>
          <div>Scroll: {Math.round(scrollPosition)}</div>
        </div>
      )}
    </div>
  );
};

// Export utility functions
export const virtualScrollUtils = {
  scrollToTop: (ref: React.RefObject<ListImperativeAPI | null>) => {
    ref.current?.scrollToRow({ index: 0, align: 'start' });
  },

  scrollToItem: (ref: React.RefObject<ListImperativeAPI | null>, index: number, align: 'start' | 'center' | 'end' | 'smart' = 'smart') => {
    ref.current?.scrollToRow({ index, align });
  },

  scrollToEmail: (ref: React.RefObject<ListImperativeAPI | null>, emails: Email[], emailId: string) => {
    const index = emails.findIndex(email => email.id === emailId);
    if (index !== -1) {
      ref.current?.scrollToRow({ index, align: 'center' });
    }
  }
};

export default VirtualEmailList;
