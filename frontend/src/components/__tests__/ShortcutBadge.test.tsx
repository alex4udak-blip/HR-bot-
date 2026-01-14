import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShortcutBadge, { ShortcutHint, ButtonWithShortcut } from '../ShortcutBadge';

/**
 * Tests for ShortcutBadge component and related utilities
 */

describe('ShortcutBadge', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should render simple key', () => {
    render(<ShortcutBadge shortcut="N" />);
    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('should render key with Ctrl modifier on Windows', () => {
    render(<ShortcutBadge shortcut="Ctrl+K" />);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('should render key with Cmd modifier on Mac', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    render(<ShortcutBadge shortcut="Cmd+K" />);
    // On Mac, Cmd should render as command icon
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('should render sequence shortcuts', () => {
    render(<ShortcutBadge shortcut="G then C" />);
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('should apply size classes', () => {
    const { container, rerender } = render(<ShortcutBadge shortcut="N" size="xs" />);
    let kbd = container.querySelector('kbd');
    expect(kbd).toHaveClass('text-[10px]');

    rerender(<ShortcutBadge shortcut="N" size="md" />);
    kbd = container.querySelector('kbd');
    expect(kbd).toHaveClass('text-xs');
  });

  it('should apply variant classes', () => {
    const { container, rerender } = render(<ShortcutBadge shortcut="N" variant="subtle" />);
    let kbd = container.querySelector('kbd');
    expect(kbd).toHaveClass('bg-white/5');

    rerender(<ShortcutBadge shortcut="N" variant="outline" />);
    kbd = container.querySelector('kbd');
    expect(kbd).toHaveClass('bg-transparent');
  });

  it('should apply showOnHover class', () => {
    const { container } = render(<ShortcutBadge shortcut="N" showOnHover />);
    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('opacity-0');
    expect(wrapper).toHaveClass('group-hover:opacity-100');
  });

  it('should format special keys', () => {
    const { rerender, container } = render(<ShortcutBadge shortcut="Escape" />);
    expect(screen.getByText('Esc')).toBeInTheDocument();

    rerender(<ShortcutBadge shortcut="Space" />);
    expect(screen.getByText('Space')).toBeInTheDocument();

    rerender(<ShortcutBadge shortcut="Enter" />);
    // Enter is formatted as a special character (return symbol)
    const kbd = container.querySelector('kbd');
    expect(kbd).toBeInTheDocument();
    expect(kbd?.textContent).toContain('\u21B5'); // Return symbol
  });
});

describe('ShortcutHint', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should render shortcut hint', () => {
    render(<ShortcutHint shortcut="Ctrl+K" />);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<ShortcutHint shortcut="N" className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});

describe('ButtonWithShortcut', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should render button with children', () => {
    render(<ButtonWithShortcut>Click me</ButtonWithShortcut>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('should render button with shortcut badge', () => {
    render(<ButtonWithShortcut shortcut="Ctrl+K">Search</ButtonWithShortcut>);
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('should not render shortcut badge if not provided', () => {
    const { container } = render(<ButtonWithShortcut>Search</ButtonWithShortcut>);
    expect(container.querySelectorAll('kbd')).toHaveLength(0);
  });

  it('should apply button variant styles', () => {
    const { container, rerender } = render(
      <ButtonWithShortcut buttonVariant="primary">Primary</ButtonWithShortcut>
    );
    expect(container.querySelector('button')).toHaveClass('bg-blue-600');

    rerender(<ButtonWithShortcut buttonVariant="ghost">Ghost</ButtonWithShortcut>);
    expect(container.querySelector('button')).toHaveClass('hover:bg-white/5');
  });

  it('should pass button props', () => {
    const onClick = vi.fn();
    render(
      <ButtonWithShortcut onClick={onClick} disabled>
        Disabled
      </ButtonWithShortcut>
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
});
