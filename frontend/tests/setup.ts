import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Vitest setup file for React component tests
 * This file runs before each test file
 */

// Cleanup after each test case (e.g., clearing jsdom)
afterEach(() => {
  cleanup();
});

// Extend Vitest's expect with jest-dom matchers
// This enables matchers like .toBeInTheDocument(), .toHaveTextContent(), etc.
