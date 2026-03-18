/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';

// Mock fetch for tests
global.fetch = vi.fn();

// Create a mock for portal elements
Object.defineProperty(document, 'getElementById', {
  value: vi.fn((id: string) => {
    if (id === 'toast-root') {
      const div = document.createElement('div');
      div.id = 'toast-root';
      return div;
    }
    return null;
  }),
});