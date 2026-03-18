/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'react-window-infinite-loader' {
  import { Component, ReactNode } from 'react';

  interface OnItemsRenderedArgs {
    overscanStartIndex: number;
    overscanStopIndex: number;
    visibleStartIndex: number;
    visibleStopIndex: number;
  }

  interface InfiniteLoaderChildProps {
    onItemsRendered: (args: OnItemsRenderedArgs) => void;
    ref: (instance: unknown) => void;
  }

  interface InfiniteLoaderProps {
    isItemLoaded: (index: number) => boolean;
    itemCount: number;
    loadMoreItems: (startIndex: number, stopIndex: number) => Promise<void> | void;
    children: (props: InfiniteLoaderChildProps) => ReactNode;
    minimumBatchSize?: number;
    threshold?: number;
  }

  export default class InfiniteLoader extends Component<InfiniteLoaderProps> {
    resetloadMoreItemsCache(autoReload?: boolean): void;
  }
}