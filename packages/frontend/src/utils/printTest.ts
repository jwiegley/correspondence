/**
 * Print functionality validation tests
 * This file contains functions to validate print functionality in development
 */

import { testPrintCompatibility, supportsPageMarginBoxes } from './printUtils';

/**
 * Run comprehensive print compatibility tests
 */
export function runPrintTests(): void {
  console.group('📄 Print Compatibility Tests');
  
  // Test 1: Browser compatibility
  const compatibility = testPrintCompatibility();
  console.log('✅ Browser compatibility test completed');
  console.log(`🎯 Print support level: ${compatibility.supported ? 'Full' : 'Partial'}`);
  
  if (compatibility.warnings.length > 0) {
    console.warn('⚠️  Compatibility warnings:');
    compatibility.warnings.forEach((warning, index) => {
      console.warn(`   ${index + 1}. ${warning}`);
    });
  }
  
  // Test 2: Page margin box support
  const marginBoxSupport = supportsPageMarginBoxes();
  console.log(`📋 CSS Page Margin Boxes: ${marginBoxSupport ? '✅ Supported' : '❌ Not supported (using fallback)'}`);
  
  // Test 3: Color adjustment support
  const colorAdjustSupport = CSS.supports('print-color-adjust', 'exact') || CSS.supports('-webkit-print-color-adjust', 'exact');
  console.log(`🎨 Color preservation: ${colorAdjustSupport ? '✅ Supported' : '⚠️  May not preserve colors'}`);
  
  // Test 4: Page break support
  const pageBreakSupport = CSS.supports('break-inside', 'avoid') || CSS.supports('page-break-inside', 'avoid');
  console.log(`📄 Page break control: ${pageBreakSupport ? '✅ Supported' : '⚠️  Limited support'}`);
  
  // Test 5: Landscape orientation support
  const landscapeSupport = CSS.supports('size', 'landscape') || CSS.supports('size', '11in 8.5in landscape');
  console.log(`📐 Landscape orientation: ${landscapeSupport ? '✅ Supported' : '⚠️  May require manual setting'}`);
  
  console.groupEnd();
  
  // Summary
  const issues = compatibility.warnings.length + 
    (marginBoxSupport ? 0 : 1) +
    (colorAdjustSupport ? 0 : 1) +
    (pageBreakSupport ? 0 : 1) +
    (landscapeSupport ? 0 : 1);
    
  if (issues === 0) {
    console.log('🎉 All print tests passed! Print functionality should work optimally.');
  } else if (issues <= 2) {
    console.log('✅ Print tests mostly passed with minor limitations. Functionality should work well.');
  } else {
    console.log('⚠️  Some print limitations detected. Print may work but with reduced functionality.');
  }
}

/**
 * Validate print layout by temporarily applying print styles
 */
export function validatePrintLayout(): void {
  console.group('🖨️  Print Layout Validation');
  
  // Temporarily apply print class to test layout
  document.body.classList.add('print-test-mode');
  
  // Add temporary print styles for testing
  const testStyle = document.createElement('style');
  testStyle.id = 'print-layout-test';
  testStyle.textContent = `
    .print-test-mode {
      font-size: 10pt !important;
      background: white !important;
    }
    
    .print-test-mode .email-list-item {
      break-inside: avoid !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    
    .print-test-mode .email-actions,
    .print-test-mode button,
    .print-test-mode .modal {
      display: none !important;
    }
  `;
  document.head.appendChild(testStyle);
  
  setTimeout(() => {
    // Check if hidden elements are properly hidden
    const hiddenElements = document.querySelectorAll('.email-actions, button, .modal');
    const visibleHiddenElements = Array.from(hiddenElements).filter(el => {
      const style = getComputedStyle(el as Element);
      return style.display !== 'none';
    });
    
    console.log(`🙈 Hidden elements check: ${visibleHiddenElements.length === 0 ? '✅ All hidden' : `⚠️  ${visibleHiddenElements.length} elements still visible`}`);
    
    // Check email list items for proper styling
    const emailItems = document.querySelectorAll('.email-list-item');
    if (emailItems.length > 0) {
      const firstItem = emailItems[0] as HTMLElement;
      const style = getComputedStyle(firstItem);
      console.log(`📧 Email items found: ${emailItems.length}`);
      console.log(`🎨 First item background preserved: ${style.printColorAdjust === 'exact' || style.printColorAdjust === 'exact' ? '✅ Yes' : '⚠️  May not preserve'}`);
    } else {
      console.log('ℹ️  No email items found for testing');
    }
    
    // Clean up test
    document.body.classList.remove('print-test-mode');
    document.head.removeChild(testStyle);
    
    console.groupEnd();
  }, 100);
}

/**
 * Run print tests if in development mode
 */
export function runPrintTestsIfDev(): void {
  if (import.meta.env.DEV) {
    console.log('🧪 Running print functionality tests...');
    runPrintTests();
    validatePrintLayout();
  }
}