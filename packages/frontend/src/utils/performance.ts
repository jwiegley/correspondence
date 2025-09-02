import { getCLS, getFID, getFCP, getLCP, getTTFB, Metric } from 'web-vitals';

// Performance metrics tracking
interface PerformanceMetrics {
  cls: number | null;
  fid: number | null;
  fcp: number | null;
  lcp: number | null;
  ttfb: number | null;
  timestamp: number;
  url: string;
  userAgent: string;
}

interface CustomMetric {
  name: string;
  value: number;
  timestamp: number;
  url: string;
  context?: any;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    cls: null,
    fid: null,
    fcp: null,
    lcp: null,
    ttfb: null,
    timestamp: Date.now(),
    url: window.location.href,
    userAgent: navigator.userAgent
  };

  private customMetrics: CustomMetric[] = [];
  private reportingEndpoint: string;
  private reportingEnabled: boolean;
  private samplingRate: number;

  constructor() {
    this.reportingEndpoint = process.env.REACT_APP_PERFORMANCE_ENDPOINT || '/api/performance';
    this.reportingEnabled = process.env.NODE_ENV === 'production';
    this.samplingRate = parseFloat(process.env.REACT_APP_PERFORMANCE_SAMPLING_RATE || '0.1');
    
    this.initializeWebVitals();
    this.initializeCustomMetrics();
  }

  private initializeWebVitals() {
    const shouldSample = Math.random() < this.samplingRate;
    
    if (!shouldSample) {
      return;
    }

    // Core Web Vitals
    getCLS((metric) => {
      this.metrics.cls = metric.value;
      this.reportMetric('CLS', metric);
    });

    getFID((metric) => {
      this.metrics.fid = metric.value;
      this.reportMetric('FID', metric);
    });

    getFCP((metric) => {
      this.metrics.fcp = metric.value;
      this.reportMetric('FCP', metric);
    });

    getLCP((metric) => {
      this.metrics.lcp = metric.value;
      this.reportMetric('LCP', metric);
    });

    getTTFB((metric) => {
      this.metrics.ttfb = metric.value;
      this.reportMetric('TTFB', metric);
    });
  }

  private initializeCustomMetrics() {
    // Performance observer for custom metrics
    if ('PerformanceObserver' in window) {
      try {
        // Navigation timing
        const navObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'navigation') {
              const navEntry = entry as PerformanceNavigationTiming;
              this.recordCustomMetric('domContentLoaded', navEntry.domContentLoadedEventEnd - navEntry.domContentLoadedEventStart);
              this.recordCustomMetric('loadComplete', navEntry.loadEventEnd - navEntry.loadEventStart);
            }
          }
        });
        navObserver.observe({ entryTypes: ['navigation'] });

        // Resource timing for large resources
        const resourceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const resource = entry as PerformanceResourceTiming;
            
            // Track slow resources (> 1s)
            if (resource.duration > 1000) {
              this.recordCustomMetric('slowResource', resource.duration, {
                name: resource.name,
                type: this.getResourceType(resource.name)
              });
            }
          }
        });
        resourceObserver.observe({ entryTypes: ['resource'] });

        // Long tasks
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              this.recordCustomMetric('longTask', entry.duration);
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch (error) {
        console.warn('Performance Observer not fully supported:', error);
      }
    }
  }

  private reportMetric(name: string, metric: Metric) {
    if (!this.reportingEnabled) {
      console.log(`Performance metric ${name}:`, metric.value);
      return;
    }

    // Report to analytics or monitoring service
    try {
      fetch(this.reportingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'web-vital',
          name,
          value: metric.value,
          id: metric.id,
          delta: metric.delta,
          timestamp: Date.now(),
          url: window.location.href,
          userAgent: navigator.userAgent,
          rating: this.getRating(name, metric.value)
        }),
      }).catch(console.error);
    } catch (error) {
      console.error('Failed to report metric:', error);
    }
  }

  private getRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
    const thresholds = {
      CLS: [0.1, 0.25],
      FID: [100, 300],
      FCP: [1800, 3000],
      LCP: [2500, 4000],
      TTFB: [800, 1800]
    };

    const threshold = thresholds[name as keyof typeof thresholds];
    if (!threshold) return 'good';

    if (value <= threshold[0]) return 'good';
    if (value <= threshold[1]) return 'needs-improvement';
    return 'poor';
  }

  recordCustomMetric(name: string, value: number, context?: any) {
    const metric: CustomMetric = {
      name,
      value,
      timestamp: Date.now(),
      url: window.location.href,
      context
    };

    this.customMetrics.push(metric);

    // Keep only last 100 metrics to avoid memory issues
    if (this.customMetrics.length > 100) {
      this.customMetrics.shift();
    }

    // Report custom metric
    if (this.reportingEnabled && Math.random() < this.samplingRate) {
      try {
        fetch(this.reportingEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'custom-metric',
            ...metric
          }),
        }).catch(console.error);
      } catch (error) {
        console.error('Failed to report custom metric:', error);
      }
    }
  }

  // Email-specific performance metrics
  recordEmailLoadTime(startTime: number, emailCount: number) {
    const duration = performance.now() - startTime;
    this.recordCustomMetric('emailLoadTime', duration, { emailCount });
  }

  recordEmailActionTime(action: string, startTime: number) {
    const duration = performance.now() - startTime;
    this.recordCustomMetric('emailActionTime', duration, { action });
  }

  recordSyncTime(startTime: number, success: boolean, emailsProcessed?: number) {
    const duration = performance.now() - startTime;
    this.recordCustomMetric('syncTime', duration, { 
      success, 
      emailsProcessed 
    });
  }

  recordVirtualScrollPerformance(visibleItems: number, totalItems: number, renderTime: number) {
    this.recordCustomMetric('virtualScrollRender', renderTime, {
      visibleItems,
      totalItems,
      efficiency: visibleItems / totalItems
    });
  }

  // Memory usage monitoring
  recordMemoryUsage() {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      this.recordCustomMetric('memoryUsage', memory.usedJSHeapSize, {
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit
      });
    }
  }

  private getResourceType(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase();
    const typeMap: Record<string, string> = {
      'js': 'script',
      'css': 'stylesheet',
      'png': 'image',
      'jpg': 'image',
      'jpeg': 'image',
      'gif': 'image',
      'svg': 'image',
      'woff': 'font',
      'woff2': 'font',
      'ttf': 'font'
    };
    return typeMap[extension || ''] || 'other';
  }

  // Get current metrics summary
  getMetrics(): PerformanceMetrics & { customMetrics: CustomMetric[] } {
    return {
      ...this.metrics,
      customMetrics: [...this.customMetrics]
    };
  }

  // Performance budget checking
  checkPerformanceBudget(): { passed: boolean; violations: string[] } {
    const violations: string[] = [];
    
    if (this.metrics.lcp && this.metrics.lcp > 2500) {
      violations.push(`LCP too slow: ${this.metrics.lcp}ms (budget: 2500ms)`);
    }
    
    if (this.metrics.fid && this.metrics.fid > 100) {
      violations.push(`FID too slow: ${this.metrics.fid}ms (budget: 100ms)`);
    }
    
    if (this.metrics.cls && this.metrics.cls > 0.1) {
      violations.push(`CLS too high: ${this.metrics.cls} (budget: 0.1)`);
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }

  // Start timing for custom operations
  startTiming(name: string): () => void {
    const startTime = performance.now();
    return () => {
      const duration = performance.now() - startTime;
      this.recordCustomMetric(name, duration);
    };
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

// Performance mark helpers
export const createPerformanceMark = (name: string) => {
  if ('performance' in window && 'mark' in performance) {
    performance.mark(`${name}-start`);
    return () => {
      performance.mark(`${name}-end`);
      performance.measure(name, `${name}-start`, `${name}-end`);
    };
  }
  return () => {};
};

// React hooks for performance monitoring
export const usePerformanceMetric = (name: string) => {
  const startTime = performance.now();
  
  return () => {
    const duration = performance.now() - startTime;
    performanceMonitor.recordCustomMetric(name, duration);
  };
};

// Higher-order component for component performance monitoring
export function withPerformanceMonitoring<T extends object>(
  Component: React.ComponentType<T>,
  componentName?: string
) {
  return function PerformanceMonitoredComponent(props: T) {
    React.useEffect(() => {
      const name = componentName || Component.displayName || Component.name || 'Unknown';
      const endTiming = performanceMonitor.startTiming(`component-${name}`);
      
      return () => {
        endTiming();
      };
    }, []);

    return React.createElement(Component, props);
  };
}

export default performanceMonitor;