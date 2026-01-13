import { useMemo } from 'react';
import clsx from 'clsx';
import { Command } from 'lucide-react';

/**
 * Check if the current platform is Mac
 */
const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
};

/**
 * Shortcut badge sizes
 */
type BadgeSize = 'xs' | 'sm' | 'md';

/**
 * Shortcut badge variants
 */
type BadgeVariant = 'default' | 'subtle' | 'outline';

/**
 * Props for ShortcutBadge
 */
interface ShortcutBadgeProps {
  /** Key combination to display (e.g., "Cmd+K", "Ctrl+N", "G then C") */
  shortcut: string;
  /** Size of the badge */
  size?: BadgeSize;
  /** Visual variant */
  variant?: BadgeVariant;
  /** Additional CSS classes */
  className?: string;
  /** Show only on hover of parent element */
  showOnHover?: boolean;
}

/**
 * Size styles
 */
const sizeStyles: Record<BadgeSize, string> = {
  xs: 'text-[10px] px-1 py-0.5 min-w-[16px] h-4',
  sm: 'text-xs px-1.5 py-0.5 min-w-[20px] h-5',
  md: 'text-xs px-2 py-1 min-w-[24px] h-6',
};

/**
 * Variant styles
 */
const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-white/10 border-white/20 text-white/80',
  subtle: 'bg-white/5 border-transparent text-white/60',
  outline: 'bg-transparent border-white/20 text-white/70',
};

/**
 * Format key for display
 */
function formatKey(key: string, isMacPlatform: boolean): React.ReactNode {
  const normalized = key.toLowerCase().trim();

  // Handle special keys
  if (normalized === 'cmd' || normalized === 'command') {
    return isMacPlatform ? <Command className="w-3 h-3" /> : 'Ctrl';
  }
  if (normalized === 'ctrl' || normalized === 'control') {
    return isMacPlatform ? '^' : 'Ctrl';
  }
  if (normalized === 'shift') {
    return isMacPlatform ? '\u21E7' : 'Shift';
  }
  if (normalized === 'alt' || normalized === 'option') {
    return isMacPlatform ? '\u2325' : 'Alt';
  }
  if (normalized === 'enter' || normalized === 'return') {
    return '\u21B5';
  }
  if (normalized === 'esc' || normalized === 'escape') {
    return 'Esc';
  }
  if (normalized === 'space') {
    return 'Space';
  }
  if (normalized === 'delete' || normalized === 'del') {
    return 'Del';
  }
  if (normalized === 'backspace') {
    return '\u232B';
  }
  if (normalized === 'tab') {
    return '\u21E5';
  }
  if (normalized === 'arrowup' || normalized === 'up') {
    return '\u2191';
  }
  if (normalized === 'arrowdown' || normalized === 'down') {
    return '\u2193';
  }
  if (normalized === 'arrowleft' || normalized === 'left') {
    return '\u2190';
  }
  if (normalized === 'arrowright' || normalized === 'right') {
    return '\u2192';
  }

  // Return uppercase for letters
  return key.toUpperCase();
}

/**
 * Parse shortcut string into parts
 */
function parseShortcut(shortcut: string): { parts: string[]; isSequence: boolean } {
  // Check for sequence shortcuts (e.g., "G then C", "G затем C")
  const sequenceMatch = shortcut.match(/(.+?)\s+(?:then|затем)\s+(.+)/i);
  if (sequenceMatch) {
    return {
      parts: [sequenceMatch[1].trim(), sequenceMatch[2].trim()],
      isSequence: true,
    };
  }

  // Check for modifier shortcuts (e.g., "Cmd+K", "Ctrl+Shift+N")
  const parts = shortcut.split(/[+\s]+/).filter(Boolean);
  return { parts, isSequence: false };
}

/**
 * ShortcutBadge - Displays keyboard shortcuts in a styled badge format
 *
 * @example
 * <ShortcutBadge shortcut="Cmd+K" />
 * <ShortcutBadge shortcut="Ctrl+Shift+N" size="sm" />
 * <ShortcutBadge shortcut="G then C" variant="subtle" />
 */
export default function ShortcutBadge({
  shortcut,
  size = 'sm',
  variant = 'default',
  className,
  showOnHover = false,
}: ShortcutBadgeProps) {
  const isMacPlatform = useMemo(() => isMac(), []);
  const { parts, isSequence } = useMemo(() => parseShortcut(shortcut), [shortcut]);

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 font-mono',
        showOnHover && 'opacity-0 group-hover:opacity-100 transition-opacity',
        className
      )}
    >
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-0.5">
          {index > 0 && isSequence && (
            <span className="text-white/30 text-[10px] mx-0.5 font-sans">
              {'\u2192'}
            </span>
          )}
          <kbd
            className={clsx(
              'inline-flex items-center justify-center border rounded',
              sizeStyles[size],
              variantStyles[variant]
            )}
          >
            {formatKey(part, isMacPlatform)}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Inline shortcut hint for buttons
 */
interface ShortcutHintProps {
  /** Key combination */
  shortcut: string;
  /** Additional CSS classes */
  className?: string;
}

export function ShortcutHint({ shortcut, className }: ShortcutHintProps) {
  const isMacPlatform = useMemo(() => isMac(), []);
  const { parts, isSequence } = useMemo(() => parseShortcut(shortcut), [shortcut]);

  return (
    <span
      className={clsx(
        'ml-auto text-white/40 text-xs font-mono inline-flex items-center gap-0.5',
        className
      )}
    >
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center">
          {index > 0 && !isSequence && <span className="mx-0.5">+</span>}
          {index > 0 && isSequence && <span className="mx-1 text-[10px]">{'\u2192'}</span>}
          <span>{formatKey(part, isMacPlatform)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Button with shortcut badge
 */
interface ButtonWithShortcutProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Keyboard shortcut */
  shortcut?: string;
  /** Button content */
  children: React.ReactNode;
  /** Button variant */
  buttonVariant?: 'primary' | 'secondary' | 'ghost';
}

export function ButtonWithShortcut({
  shortcut,
  children,
  buttonVariant = 'secondary',
  className,
  ...props
}: ButtonWithShortcutProps) {
  const buttonStyles = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white',
    secondary: 'bg-white/5 hover:bg-white/10 border border-white/10 text-white',
    ghost: 'hover:bg-white/5 text-white/70 hover:text-white',
  };

  return (
    <button
      className={clsx(
        'group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
        buttonStyles[buttonVariant],
        className
      )}
      {...props}
    >
      {children}
      {shortcut && (
        <ShortcutBadge
          shortcut={shortcut}
          size="xs"
          variant="subtle"
          showOnHover
        />
      )}
    </button>
  );
}
