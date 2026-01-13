import { useEffect, useCallback, useRef, useContext, createContext, useState, useMemo } from 'react';

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  /** Unique identifier for the shortcut */
  id?: string;
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
  /** Category for grouping in help modal */
  category?: ShortcutCategory;
  /** Whether this is a global shortcut (shown everywhere) */
  global?: boolean;
  /** Sequence keys (e.g., ['g', 'c'] for G then C) */
  sequence?: string[];
}

/**
 * Shortcut categories for grouping
 */
export type ShortcutCategory =
  | 'navigation'
  | 'actions'
  | 'candidates'
  | 'vacancies'
  | 'kanban'
  | 'general';

/**
 * Options for useKeyboardShortcuts hook
 */
export interface UseKeyboardShortcutsOptions {
  /** Whether keyboard shortcuts are enabled (default: true) */
  enabled?: boolean;
  /** Target element to attach listeners (default: window) */
  target?: Window | HTMLElement | null;
  /** Context identifier for contextual shortcuts */
  context?: string;
}

/**
 * Global shortcut registry entry
 */
interface RegisteredShortcut extends KeyboardShortcut {
  context: string;
  priority: number;
}

/**
 * Shortcut context value
 */
interface ShortcutContextValue {
  /** All registered shortcuts */
  shortcuts: RegisteredShortcut[];
  /** Register a new shortcut */
  register: (shortcut: KeyboardShortcut, context: string, priority?: number) => () => void;
  /** Unregister shortcuts by context */
  unregisterContext: (context: string) => void;
  /** Current active sequence */
  activeSequence: string[];
  /** Show help modal */
  showHelp: boolean;
  /** Set show help modal */
  setShowHelp: (show: boolean) => void;
  /** Current context */
  currentContext: string;
  /** Set current context */
  setCurrentContext: (context: string) => void;
}

// Create context
export const ShortcutContext = createContext<ShortcutContextValue | null>(null);

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
 * Format shortcut for display
 */
export const formatShortcut = (shortcut: KeyboardShortcut): string => {
  const parts: string[] = [];
  const isMacPlatform = isMac();

  if (shortcut.ctrlOrCmd) {
    parts.push(isMacPlatform ? '⌘' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push(isMacPlatform ? '⇧' : 'Shift');
  }
  if (shortcut.alt) {
    parts.push(isMacPlatform ? '⌥' : 'Alt');
  }

  if (shortcut.sequence && shortcut.sequence.length > 0) {
    return shortcut.sequence.map(k => k.toUpperCase()).join(' затем ');
  }

  // Format key
  let key = shortcut.key;
  if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';
  else if (key === 'Escape') key = 'Esc';
  else if (key === 'Enter') key = '↵';
  else if (key === ' ') key = 'Space';
  else if (key === 'Delete') key = 'Del';
  else if (key === 'Backspace') key = '⌫';
  else key = key.toUpperCase();

  parts.push(key);

  return parts.join(isMacPlatform ? '' : '+');
};

/**
 * Category labels in Russian
 */
export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Навигация',
  actions: 'Действия',
  candidates: 'Кандидаты',
  vacancies: 'Вакансии',
  kanban: 'Kanban',
  general: 'Общие',
};

// Sequence timeout in milliseconds
const SEQUENCE_TIMEOUT = 1000;

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
 * // With sequence shortcuts
 * useKeyboardShortcuts([
 *   { sequence: ['g', 'c'], handler: () => navigate('/candidates'), description: 'Go to candidates' },
 * ]);
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
): void {
  const { enabled = true, target = typeof window !== 'undefined' ? window : null } = options;
  const shortcutsRef = useRef(shortcuts);
  const sequenceRef = useRef<string[]>([]);
  const sequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep shortcuts ref up to date
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const clearSequence = useCallback(() => {
    sequenceRef.current = [];
    if (sequenceTimeoutRef.current) {
      clearTimeout(sequenceTimeoutRef.current);
      sequenceTimeoutRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    const isInput = isInputElement(event.target);

    // Check for sequence shortcuts first
    const key = event.key.toLowerCase();

    // Add key to sequence
    sequenceRef.current.push(key);

    // Clear sequence after timeout
    if (sequenceTimeoutRef.current) {
      clearTimeout(sequenceTimeoutRef.current);
    }
    sequenceTimeoutRef.current = setTimeout(() => {
      sequenceRef.current = [];
    }, SEQUENCE_TIMEOUT);

    // Check sequence shortcuts
    for (const shortcut of shortcutsRef.current) {
      if (shortcut.sequence && shortcut.sequence.length > 0) {
        const sequence = shortcut.sequence.map(k => k.toLowerCase());
        const currentSequence = sequenceRef.current;

        // Check if sequence matches
        if (
          currentSequence.length === sequence.length &&
          currentSequence.every((k, i) => k === sequence[i])
        ) {
          // Skip if in input and shortcut doesn't allow it
          if (isInput && !shortcut.allowInInput) continue;

          event.preventDefault();
          shortcut.handler();
          clearSequence();
          return;
        }

        // Check if current sequence is a prefix of the target sequence
        if (
          currentSequence.length < sequence.length &&
          currentSequence.every((k, i) => k === sequence[i])
        ) {
          // Partial match - wait for more keys
          return;
        }
      }
    }

    // Process regular shortcuts
    for (const shortcut of shortcutsRef.current) {
      // Skip sequence shortcuts (already handled)
      if (shortcut.sequence && shortcut.sequence.length > 0) continue;

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

      // Clear sequence on regular shortcut
      clearSequence();

      // Execute handler
      shortcut.handler();

      // Only handle one shortcut per keypress
      break;
    }
  }, [enabled, clearSequence]);

  useEffect(() => {
    if (!target) return;

    const eventTarget = target as EventTarget;
    eventTarget.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      eventTarget.removeEventListener('keydown', handleKeyDown as EventListener);
      clearSequence();
    };
  }, [target, handleKeyDown, clearSequence]);
}

/**
 * Provider component for global keyboard shortcuts
 */
export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [shortcuts, setShortcuts] = useState<RegisteredShortcut[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [currentContext, setCurrentContext] = useState('global');
  const [activeSequence, setActiveSequence] = useState<string[]>([]);
  const sequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((shortcut: KeyboardShortcut, context: string, priority = 0): () => void => {
    const id = shortcut.id || `${context}-${shortcut.key}-${Date.now()}`;
    const registeredShortcut: RegisteredShortcut = {
      ...shortcut,
      id,
      context,
      priority,
    };

    setShortcuts(prev => [...prev, registeredShortcut]);

    return () => {
      setShortcuts(prev => prev.filter(s => s.id !== id));
    };
  }, []);

  const unregisterContext = useCallback((context: string) => {
    setShortcuts(prev => prev.filter(s => s.context !== context));
  }, []);

  // Handle keyboard events for global shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isInput = isInputElement(event.target);
      const key = event.key.toLowerCase();

      // Update active sequence
      setActiveSequence(prev => {
        const newSeq = [...prev, key];

        // Clear sequence after timeout
        if (sequenceTimeoutRef.current) {
          clearTimeout(sequenceTimeoutRef.current);
        }
        sequenceTimeoutRef.current = setTimeout(() => {
          setActiveSequence([]);
        }, SEQUENCE_TIMEOUT);

        return newSeq;
      });

      // Show help modal on Cmd+/ or ?
      if ((event.key === '/' && isCtrlOrCmd(event)) || event.key === '?') {
        if (!isInput) {
          event.preventDefault();
          setShowHelp(true);
          return;
        }
      }

      // Close help modal on Escape
      if (event.key === 'Escape' && showHelp) {
        event.preventDefault();
        setShowHelp(false);
        return;
      }

      // Sort shortcuts by priority and process
      const sortedShortcuts = [...shortcuts]
        .filter(s => s.context === 'global' || s.context === currentContext)
        .sort((a, b) => b.priority - a.priority);

      for (const shortcut of sortedShortcuts) {
        // Check sequence shortcuts
        if (shortcut.sequence && shortcut.sequence.length > 0) {
          // This is handled in activeSequence effect
          continue;
        }

        // Skip if in input and shortcut doesn't allow it
        if (isInput && !shortcut.allowInInput) {
          if (shortcut.key !== 'Escape') continue;
        }

        // Check key match
        const keyMatch =
          event.key.toLowerCase() === shortcut.key.toLowerCase() ||
          event.key === shortcut.key;

        if (!keyMatch) continue;

        // Check modifiers
        if (shortcut.ctrlOrCmd && !isCtrlOrCmd(event)) continue;
        if (shortcut.shift && !event.shiftKey) continue;
        if (shortcut.alt && !event.altKey) continue;
        if (!shortcut.ctrlOrCmd && isCtrlOrCmd(event)) continue;

        // Prevent default if specified
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }

        shortcut.handler();
        break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (sequenceTimeoutRef.current) {
        clearTimeout(sequenceTimeoutRef.current);
      }
    };
  }, [shortcuts, showHelp, currentContext]);

  // Handle sequence shortcuts
  useEffect(() => {
    if (activeSequence.length === 0) return;

    const sortedShortcuts = [...shortcuts]
      .filter(s => s.context === 'global' || s.context === currentContext)
      .filter(s => s.sequence && s.sequence.length > 0)
      .sort((a, b) => b.priority - a.priority);

    for (const shortcut of sortedShortcuts) {
      if (!shortcut.sequence) continue;
      const sequence = shortcut.sequence.map(k => k.toLowerCase());

      if (
        activeSequence.length === sequence.length &&
        activeSequence.every((k, i) => k === sequence[i])
      ) {
        shortcut.handler();
        setActiveSequence([]);
        return;
      }
    }
  }, [activeSequence, shortcuts, currentContext]);

  const value = useMemo<ShortcutContextValue>(() => ({
    shortcuts,
    register,
    unregisterContext,
    activeSequence,
    showHelp,
    setShowHelp,
    currentContext,
    setCurrentContext,
  }), [shortcuts, register, unregisterContext, activeSequence, showHelp, currentContext]);

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Hook to access shortcut context
 */
export function useShortcutContext(): ShortcutContextValue {
  const context = useContext(ShortcutContext);
  if (!context) {
    throw new Error('useShortcutContext must be used within a ShortcutProvider');
  }
  return context;
}

/**
 * Hook to register global shortcuts
 */
export function useGlobalShortcuts(
  shortcuts: KeyboardShortcut[],
  context: string = 'global',
  enabled: boolean = true
): void {
  const ctx = useContext(ShortcutContext);

  useEffect(() => {
    if (!ctx || !enabled) return;

    const unregisters = shortcuts.map(shortcut =>
      ctx.register(shortcut, context, shortcut.global ? 100 : 0)
    );

    return () => {
      unregisters.forEach(unregister => unregister());
    };
  }, [ctx, shortcuts, context, enabled]);
}

/**
 * Get formatted shortcuts grouped by category
 */
export function useGroupedShortcuts(): Record<ShortcutCategory, KeyboardShortcut[]> {
  const ctx = useContext(ShortcutContext);

  return useMemo(() => {
    const grouped: Record<ShortcutCategory, KeyboardShortcut[]> = {
      navigation: [],
      actions: [],
      candidates: [],
      vacancies: [],
      kanban: [],
      general: [],
    };

    if (!ctx) return grouped;

    // Filter unique shortcuts and group by category
    const seen = new Set<string>();
    for (const shortcut of ctx.shortcuts) {
      const key = `${shortcut.key}-${shortcut.ctrlOrCmd}-${shortcut.shift}-${shortcut.alt}-${shortcut.sequence?.join('-')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const category = shortcut.category || 'general';
      grouped[category].push(shortcut);
    }

    return grouped;
  }, [ctx]);
}

export default useKeyboardShortcuts;
