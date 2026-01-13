import { useEffect, useCallback, useRef } from 'react';

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  /** Key to listen for (e.g., 'n', 'Escape', 'ArrowLeft') */
  key: string;
  /** Callback function when shortcut is triggered */
  handler: () => void;
  /** Require Ctrl (Windows/Linux) or Cmd (Mac) modifier */
  ctrlOrCmd?: boolean;
  /** Require Shift modifier */
  shift?: boolean;
  /** Require Alt modifier */
  alt?: boolean;
  /** Whether to trigger even when focus is on input/textarea */
  allowInInput?: boolean;
  /** Prevent default browser behavior */
  preventDefault?: boolean;
  /** Description for accessibility/documentation */
  description?: string;
}

/**
 * Options for useKeyboardShortcuts hook
 */
export interface UseKeyboardShortcutsOptions {
  /** Whether keyboard shortcuts are enabled (default: true) */
  enabled?: boolean;
  /** Target element to attach listeners (default: window) */
  target?: Window | HTMLElement | null;
}

/**
 * Check if the current platform is Mac
 */
const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
};

/**
 * Check if the Ctrl/Cmd modifier is pressed based on platform
 */
const isCtrlOrCmd = (e: KeyboardEvent): boolean => {
  return isMac() ? e.metaKey : e.ctrlKey;
};

/**
 * Check if the target element is an input or editable element
 */
const isInputElement = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable
  );
};

/**
 * Hook for managing keyboard shortcuts in React components
 *
 * @param shortcuts - Array of keyboard shortcut definitions
 * @param options - Configuration options
 *
 * @example
 * // Basic usage
 * useKeyboardShortcuts([
 *   { key: 'Escape', handler: () => closeModal() },
 *   { key: 'n', ctrlOrCmd: true, handler: () => createNew(), preventDefault: true },
 * ]);
 *
 * @example
 * // With conditional enabling
 * useKeyboardShortcuts(shortcuts, { enabled: isModalOpen });
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
): void {
  const { enabled = true, target = typeof window !== 'undefined' ? window : null } = options;
  const shortcutsRef = useRef(shortcuts);

  // Keep shortcuts ref up to date
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    const isInput = isInputElement(event.target);

    for (const shortcut of shortcutsRef.current) {
      // Skip if in input and shortcut doesn't allow it
      if (isInput && !shortcut.allowInInput) {
        // Exception: Escape should always work
        if (shortcut.key !== 'Escape') continue;
      }

      // Check key match (case-insensitive for letters)
      const keyMatch =
        event.key.toLowerCase() === shortcut.key.toLowerCase() ||
        event.key === shortcut.key;

      if (!keyMatch) continue;

      // Check modifiers
      if (shortcut.ctrlOrCmd && !isCtrlOrCmd(event)) continue;
      if (shortcut.shift && !event.shiftKey) continue;
      if (shortcut.alt && !event.altKey) continue;

      // If ctrlOrCmd is not required, make sure it's not pressed
      // (unless specifically allowed via modifiers)
      if (!shortcut.ctrlOrCmd && isCtrlOrCmd(event)) continue;

      // Prevent default if specified
      if (shortcut.preventDefault !== false) {
        event.preventDefault();
      }

      // Execute handler
      shortcut.handler();

      // Only handle one shortcut per keypress
      break;
    }
  }, [enabled]);

  useEffect(() => {
    if (!target) return;

    const eventTarget = target as EventTarget;
    eventTarget.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      eventTarget.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [target, handleKeyDown]);
}

export default useKeyboardShortcuts;
