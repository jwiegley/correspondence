/**
 * Print utilities for handling print-specific functionality
 */

/**
 * Initialize print event listeners
 */
export function initializePrintHandlers(): void {
  // Handle beforeprint event to inject dynamic print date
  window.addEventListener('beforeprint', handleBeforePrint);
  
  // Handle afterprint event for cleanup if needed
  window.addEventListener('afterprint', handleAfterPrint);
}

/**
 * Handle beforeprint event - inject dynamic content for printing
 */
function handleBeforePrint(): void {
  // Inject print date into document body
  const printDate = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  
  document.body.setAttribute('data-print-date', printDate);
  
  // Add print-ready class for additional styling if needed
  document.body.classList.add('print-ready');
  
  // Apply browser-specific optimizations
  applyBrowserSpecificOptimizations();
  
  // Create fallback header/footer elements if page margin boxes aren't supported
  createFallbackPrintElements(printDate);
}

/**
 * Handle afterprint event - cleanup after printing
 */
function handleAfterPrint(): void {
  // Remove print-ready class
  document.body.classList.remove('print-ready');
  
  // Clean up browser-specific optimizations
  cleanupBrowserSpecificOptimizations();
  
  // Clean up fallback elements
  removeFallbackPrintElements();
}

/**
 * Create fallback header and footer elements for browsers that don't support CSS page margin boxes
 */
function createFallbackPrintElements(printDate: string): void {
  // Check if we need fallback (simplified check - in production you might want more sophisticated detection)
  const testElement = document.createElement('div');
  testElement.style.cssText = '@supports (content: attr(data-test)) { display: none; }';
  
  // Remove any existing fallback elements first
  removeFallbackPrintElements();
  
  // Create header
  const header = document.createElement('div');
  header.className = 'print-header print-fallback';
  header.textContent = 'Gmail Correspondence Manager';
  
  // Create footer
  const footer = document.createElement('div');
  footer.className = 'print-footer print-fallback';
  
  const footerLeft = document.createElement('span');
  footerLeft.className = 'print-footer-left';
  footerLeft.textContent = `Printed: ${printDate}`;
  
  const footerRight = document.createElement('span');
  footerRight.className = 'print-footer-right';
  footerRight.textContent = 'Page numbers unavailable in fallback mode';
  
  footer.appendChild(footerLeft);
  footer.appendChild(footerRight);
  
  // Insert elements at the beginning and end of body
  const emailListContainer = document.querySelector('.email-list');
  if (emailListContainer && emailListContainer.parentNode) {
    emailListContainer.parentNode.insertBefore(header, emailListContainer);
    emailListContainer.parentNode.appendChild(footer);
  }
}

/**
 * Remove fallback header and footer elements
 */
function removeFallbackPrintElements(): void {
  const fallbackElements = document.querySelectorAll('.print-fallback');
  fallbackElements.forEach(element => {
    element.remove();
  });
}

/**
 * Manually trigger print with proper setup
 */
export function printPage(): void {
  // Ensure print handlers are ready
  handleBeforePrint();
  
  // Trigger print dialog
  window.print();
}

/**
 * Check if the browser supports CSS page margin boxes
 */
export function supportsPageMarginBoxes(): boolean {
  // This is a simplified check - actual support detection is complex
  // Modern browsers generally support @page but margin boxes have limited support
  return CSS.supports('content', 'attr(data-test)');
}

/**
 * Detect browser type for specific print handling
 */
function detectBrowser(): string {
  const userAgent = navigator.userAgent;
  
  if (userAgent.includes('Chrome') && !userAgent.includes('Edge')) {
    return 'chrome';
  } else if (userAgent.includes('Firefox')) {
    return 'firefox';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    return 'safari';
  } else if (userAgent.includes('Edge')) {
    return 'edge';
  }
  
  return 'unknown';
}

/**
 * Apply browser-specific print optimizations
 */
function applyBrowserSpecificOptimizations(): void {
  const browser = detectBrowser();
  const body = document.body;
  
  // Add browser-specific classes for CSS targeting
  body.classList.add(`print-browser-${browser}`);
  
  switch (browser) {
    case 'firefox':
      // Firefox sometimes has issues with grid layouts in print
      body.classList.add('print-firefox-fix');
      // Force reflow for Firefox print issues
      setTimeout(() => {
        const elements = document.querySelectorAll('.email-list-item');
        elements.forEach(el => {
          (el as HTMLElement).style.transform = 'translateZ(0)';
        });
      }, 0);
      break;
      
    case 'safari':
      // Safari may need explicit color preservation
      body.classList.add('print-safari-fix');
      document.querySelectorAll('*').forEach(el => {
        (el as HTMLElement).style.printColorAdjust = 'exact';
      });
      break;
      
    case 'edge':
      // Edge legacy compatibility
      body.classList.add('print-edge-fix');
      break;
      
    case 'chrome':
      // Chrome usually works well, but ensure proper rendering
      body.classList.add('print-chrome-fix');
      break;
  }
}

/**
 * Clean up browser-specific optimizations
 */
function cleanupBrowserSpecificOptimizations(): void {
  const body = document.body;
  const browserClasses = ['print-firefox-fix', 'print-safari-fix', 'print-edge-fix', 'print-chrome-fix'];
  
  browserClasses.forEach(className => {
    body.classList.remove(className);
  });
  
  // Remove browser detection classes
  const browser = detectBrowser();
  body.classList.remove(`print-browser-${browser}`);
}

/**
 * Test print compatibility and provide warnings
 */
export function testPrintCompatibility(): { supported: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const browser = detectBrowser();
  
  // Test color adjustment support
  if (!CSS.supports('print-color-adjust', 'exact') && !CSS.supports('-webkit-print-color-adjust', 'exact')) {
    warnings.push('Browser may not preserve background colors in print. Colors may appear as grayscale.');
  }
  
  // Test page margin box support
  if (!supportsPageMarginBoxes()) {
    warnings.push('Browser does not support CSS page margin boxes. Headers and footers will use fallback positioning.');
  }
  
  // Browser-specific warnings
  switch (browser) {
    case 'firefox':
      if (!CSS.supports('break-inside', 'avoid')) {
        warnings.push('Firefox version may have limited page break control.');
      }
      break;
      
    case 'safari':
      warnings.push('Safari may require manual color preservation settings in print dialog.');
      break;
      
    case 'edge':
      if (navigator.userAgent.includes('Edge/')) {
        warnings.push('Legacy Edge detected. Consider upgrading to Chromium-based Edge for better print support.');
      }
      break;
  }
  
  // Test landscape support
  if (!CSS.supports('page', 'landscape') && !CSS.supports('size', 'landscape')) {
    warnings.push('Browser may not support landscape orientation via CSS. Set manually in print dialog.');
  }
  
  return {
    supported: warnings.length === 0,
    warnings
  };
}