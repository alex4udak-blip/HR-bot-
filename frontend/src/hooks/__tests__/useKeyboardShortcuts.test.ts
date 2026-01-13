import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcuts, formatShortcut, CATEGORY_LABELS } from '../useKeyboardShortcuts';
import type { KeyboardShortcut, ShortcutCategory } from '../useKeyboardShortcuts';

/**
 * Tests for useKeyboardShortcuts hook
 * Verifies keyboard shortcut handling with modifiers, input exclusions, sequences, and cross-platform support
 */

describe('useKeyboardShortcuts', () => {
  const mockHandler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /**
   * Helper to dispatch keyboard events
   */
  const dispatchKeyEvent = (
    key: string,
    options: Partial<KeyboardEventInit> = {},
    target: EventTarget = document.body
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });

    // Override target if needed
    if (target !== window) {
      Object.defineProperty(event, 'target', {
        value: target,
        writable: false,
      });
    }

    window.dispatchEvent(event);
    return event;
  };

  describe('Basic shortcut handling', () => {
    it('should call handler when matching key is pressed', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('n');
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle case-insensitive key matching', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'N', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('n');
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler for non-matching keys', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('m');
      });

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should handle Escape key', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'Escape', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('Escape');
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle special keys like ArrowLeft', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'ArrowLeft', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('ArrowLeft');
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modifier key handling', () => {
    it('should require Ctrl modifier when ctrlOrCmd is true (non-Mac)', () => {
      // Mock non-Mac platform
      vi.stubGlobal('navigator', { platform: 'Win32' });

      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', ctrlOrCmd: true, handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Without Ctrl - should not trigger
      act(() => {
        dispatchKeyEvent('n');
      });
      expect(mockHandler).not.toHaveBeenCalled();

      // With Ctrl - should trigger
      act(() => {
        dispatchKeyEvent('n', { ctrlKey: true });
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should require Meta modifier when ctrlOrCmd is true (Mac)', () => {
      // Mock Mac platform
      vi.stubGlobal('navigator', { platform: 'MacIntel' });

      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', ctrlOrCmd: true, handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // With Ctrl on Mac - should not trigger (Mac uses Meta/Cmd)
      act(() => {
        dispatchKeyEvent('n', { ctrlKey: true });
      });
      expect(mockHandler).not.toHaveBeenCalled();

      // With Meta - should trigger
      act(() => {
        dispatchKeyEvent('n', { metaKey: true });
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should require Shift modifier when shift is true', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', shift: true, handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Without Shift - should not trigger
      act(() => {
        dispatchKeyEvent('n');
      });
      expect(mockHandler).not.toHaveBeenCalled();

      // With Shift - should trigger
      act(() => {
        dispatchKeyEvent('n', { shiftKey: true });
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should require Alt modifier when alt is true', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', alt: true, handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Without Alt - should not trigger
      act(() => {
        dispatchKeyEvent('n');
      });
      expect(mockHandler).not.toHaveBeenCalled();

      // With Alt - should trigger
      act(() => {
        dispatchKeyEvent('n', { altKey: true });
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should not trigger when Ctrl is pressed but not required', () => {
      // Mock non-Mac platform to use ctrlKey
      vi.stubGlobal('navigator', { platform: 'Win32' });

      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('n', { ctrlKey: true });
      });

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('Input element exclusion', () => {
    it('should not trigger when focus is on input element', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      const input = document.createElement('input');
      document.body.appendChild(input);

      act(() => {
        dispatchKeyEvent('n', {}, input);
      });

      expect(mockHandler).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('should not trigger when focus is on textarea element', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      act(() => {
        dispatchKeyEvent('n', {}, textarea);
      });

      expect(mockHandler).not.toHaveBeenCalled();
      document.body.removeChild(textarea);
    });

    it('should trigger on input element when allowInInput is true', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler, allowInInput: true },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      const input = document.createElement('input');
      document.body.appendChild(input);

      act(() => {
        dispatchKeyEvent('n', {}, input);
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
      document.body.removeChild(input);
    });

    it('should always allow Escape key in input elements', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'Escape', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      const input = document.createElement('input');
      document.body.appendChild(input);

      act(() => {
        dispatchKeyEvent('Escape', {}, input);
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
      document.body.removeChild(input);
    });
  });

  describe('Enabled option', () => {
    it('should not trigger when enabled is false', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts, { enabled: false }));

      act(() => {
        dispatchKeyEvent('n');
      });

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should trigger when enabled is true', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts, { enabled: true }));

      act(() => {
        dispatchKeyEvent('n');
      });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should respond to enabled changes dynamically', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      const { rerender } = renderHook(
        ({ enabled }) => useKeyboardShortcuts(shortcuts, { enabled }),
        { initialProps: { enabled: false } }
      );

      act(() => {
        dispatchKeyEvent('n');
      });
      expect(mockHandler).not.toHaveBeenCalled();

      rerender({ enabled: true });

      act(() => {
        dispatchKeyEvent('n');
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Multiple shortcuts', () => {
    it('should handle multiple shortcuts', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: handler1 },
        { key: 'm', handler: handler2 },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('n');
      });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      act(() => {
        dispatchKeyEvent('m');
      });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should only trigger first matching shortcut per keypress', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Same key, but should only trigger first
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: handler1 },
        { key: 'n', handler: handler2 },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      act(() => {
        dispatchKeyEvent('n');
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Sequence shortcuts', () => {
    it('should trigger handler for two-key sequence', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'c', sequence: ['g', 'c'], handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Press 'g'
      act(() => {
        dispatchKeyEvent('g');
      });
      expect(mockHandler).not.toHaveBeenCalled();

      // Press 'c' within timeout
      act(() => {
        dispatchKeyEvent('c');
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should not trigger if sequence times out', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'c', sequence: ['g', 'c'], handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Press 'g'
      act(() => {
        dispatchKeyEvent('g');
      });

      // Wait for timeout
      act(() => {
        vi.advanceTimersByTime(1100);
      });

      // Press 'c' after timeout
      act(() => {
        dispatchKeyEvent('c');
      });

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should not trigger for incomplete sequence', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'c', sequence: ['g', 'c'], handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Press only 'g'
      act(() => {
        dispatchKeyEvent('g');
      });

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should handle multiple sequence shortcuts', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const shortcuts: KeyboardShortcut[] = [
        { key: 'c', sequence: ['g', 'c'], handler: handler1 },
        { key: 'v', sequence: ['g', 'v'], handler: handler2 },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      // Trigger first sequence
      act(() => {
        dispatchKeyEvent('g');
        dispatchKeyEvent('c');
      });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      // Reset and trigger second sequence
      act(() => {
        vi.advanceTimersByTime(1100);
      });

      act(() => {
        dispatchKeyEvent('g');
        dispatchKeyEvent('v');
      });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should remove event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      const { unmount } = renderHook(() => useKeyboardShortcuts(shortcuts));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
    });
  });

  describe('preventDefault behavior', () => {
    it('should prevent default by default', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      const event = new KeyboardEvent('keydown', {
        key: 'n',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      act(() => {
        window.dispatchEvent(event);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not prevent default when preventDefault is false', () => {
      const shortcuts: KeyboardShortcut[] = [
        { key: 'n', handler: mockHandler, preventDefault: false },
      ];

      renderHook(() => useKeyboardShortcuts(shortcuts));

      const event = new KeyboardEvent('keydown', {
        key: 'n',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      act(() => {
        window.dispatchEvent(event);
      });

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });
});

describe('formatShortcut', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should format simple key', () => {
    const shortcut: KeyboardShortcut = { key: 'n', handler: () => {} };
    expect(formatShortcut(shortcut)).toBe('N');
  });

  it('should format key with Ctrl modifier (Windows)', () => {
    const shortcut: KeyboardShortcut = { key: 'n', ctrlOrCmd: true, handler: () => {} };
    expect(formatShortcut(shortcut)).toBe('Ctrl+N');
  });

  it('should format key with Shift modifier', () => {
    const shortcut: KeyboardShortcut = { key: 'n', shift: true, handler: () => {} };
    expect(formatShortcut(shortcut)).toBe('Shift+N');
  });

  it('should format key with multiple modifiers', () => {
    const shortcut: KeyboardShortcut = { key: 'n', ctrlOrCmd: true, shift: true, handler: () => {} };
    expect(formatShortcut(shortcut)).toBe('Ctrl+Shift+N');
  });

  it('should format sequence shortcuts', () => {
    const shortcut: KeyboardShortcut = { key: 'c', sequence: ['g', 'c'], handler: () => {} };
    expect(formatShortcut(shortcut)).toContain('G');
    expect(formatShortcut(shortcut)).toContain('C');
  });

  it('should format special keys', () => {
    const escShortcut: KeyboardShortcut = { key: 'Escape', handler: () => {} };
    expect(formatShortcut(escShortcut)).toBe('Esc');

    const enterShortcut: KeyboardShortcut = { key: 'Enter', handler: () => {} };
    expect(formatShortcut(enterShortcut)).toContain('↵');

    const spaceShortcut: KeyboardShortcut = { key: ' ', handler: () => {} };
    expect(formatShortcut(spaceShortcut)).toBe('Space');
  });

  it('should format arrow keys', () => {
    const upShortcut: KeyboardShortcut = { key: 'ArrowUp', handler: () => {} };
    expect(formatShortcut(upShortcut)).toBe('↑');

    const downShortcut: KeyboardShortcut = { key: 'ArrowDown', handler: () => {} };
    expect(formatShortcut(downShortcut)).toBe('↓');
  });
});

describe('CATEGORY_LABELS', () => {
  it('should have labels for all categories', () => {
    const categories: ShortcutCategory[] = [
      'navigation',
      'actions',
      'candidates',
      'vacancies',
      'kanban',
      'general',
    ];

    categories.forEach(category => {
      expect(CATEGORY_LABELS[category]).toBeDefined();
      expect(typeof CATEGORY_LABELS[category]).toBe('string');
    });
  });

  it('should have Russian labels', () => {
    expect(CATEGORY_LABELS.navigation).toBe('Навигация');
    expect(CATEGORY_LABELS.actions).toBe('Действия');
    expect(CATEGORY_LABELS.general).toBe('Общие');
  });
});
