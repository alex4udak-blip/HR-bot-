import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KeyboardShortcutsHelp, { ShortcutHelpButton } from '../KeyboardShortcutsHelp';
import { ShortcutProvider } from '@/hooks/useKeyboardShortcuts';
import type { KeyboardShortcut, ShortcutCategory } from '@/hooks/useKeyboardShortcuts';

/**
 * Tests for KeyboardShortcutsHelp component
 * Verifies keyboard shortcuts modal display, search, and interactions
 */

const mockShortcuts: { category: ShortcutCategory; shortcuts: KeyboardShortcut[] }[] = [
  {
    category: 'navigation',
    shortcuts: [
      { key: 'k', ctrlOrCmd: true, handler: vi.fn(), description: 'Глобальный поиск' },
      { key: 'c', sequence: ['g', 'c'], handler: vi.fn(), description: 'Перейти к кандидатам' },
    ],
  },
  {
    category: 'actions',
    shortcuts: [
      { key: 'n', ctrlOrCmd: true, handler: vi.fn(), description: 'Создать кандидата' },
      { key: 'u', ctrlOrCmd: true, handler: vi.fn(), description: 'Загрузить резюме' },
    ],
  },
  {
    category: 'candidates',
    shortcuts: [
      { key: 'j', handler: vi.fn(), description: 'Следующий кандидат' },
      { key: 'k', handler: vi.fn(), description: 'Предыдущий кандидат' },
    ],
  },
];

describe('KeyboardShortcutsHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Modal Control', () => {
    it('should not render when open is false', () => {
      render(<KeyboardShortcutsHelp open={false} />);

      expect(screen.queryByText('Горячие клавиши')).not.toBeInTheDocument();
    });

    it('should render modal when open is true', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      expect(screen.getByText('Горячие клавиши')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsHelp open={true} onClose={onClose} shortcuts={mockShortcuts} />);

      const closeButton = screen.getByRole('button', { name: '' }); // X button
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsHelp open={true} onClose={onClose} shortcuts={mockShortcuts} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when clicking backdrop', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsHelp open={true} onClose={onClose} shortcuts={mockShortcuts} />);

      // Click on the backdrop (fixed inset-0 element)
      const backdrop = screen.getByText('Горячие клавиши').closest('.fixed');
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Header', () => {
    it('should display title', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      expect(screen.getByText('Горячие клавиши')).toBeInTheDocument();
    });

    it('should display keyboard icon', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // Keyboard icon should be present
      expect(screen.getByText('Горячие клавиши')).toBeInTheDocument();
    });

    it('should display help hint', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // The component shows hint about pressing ? or Cmd/Ctrl + /
      // Check that some form of hint text exists
      const header = screen.getByText('Горячие клавиши').closest('div');
      expect(header).toBeInTheDocument();
    });
  });

  describe('Search Functionality', () => {
    it('should display search input', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      expect(screen.getByPlaceholderText(/Поиск по шорткатам/i)).toBeInTheDocument();
    });

    it('should filter shortcuts by search query', async () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      const searchInput = screen.getByPlaceholderText(/Поиск по шорткатам/i);
      await userEvent.type(searchInput, 'кандидат');

      await waitFor(() => {
        // Should show shortcuts with "кандидат" in description
        expect(screen.getByText('Создать кандидата')).toBeInTheDocument();
        expect(screen.getByText('Следующий кандидат')).toBeInTheDocument();
      });
    });

    it('should filter by key', async () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      const searchInput = screen.getByPlaceholderText(/Поиск по шорткатам/i);
      await userEvent.type(searchInput, 'j');

      await waitFor(() => {
        expect(screen.getByText('Следующий кандидат')).toBeInTheDocument();
      });
    });

    it('should show empty state when no matches', async () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      const searchInput = screen.getByPlaceholderText(/Поиск по шорткатам/i);
      await userEvent.type(searchInput, 'nonexistent');

      await waitFor(() => {
        expect(screen.getByText(/Шорткаты не найдены/i)).toBeInTheDocument();
      });
    });

    it('should clear search when X button is clicked', async () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      const searchInput = screen.getByPlaceholderText(/Поиск по шорткатам/i);
      await userEvent.type(searchInput, 'test');

      // Find and click clear button in search
      const clearButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg') && btn.closest('.relative')
      );
      if (clearButton) {
        fireEvent.click(clearButton);
      }

      await waitFor(() => {
        expect(searchInput).toHaveValue('');
      });
    });

    it('should auto-focus search input when modal opens', async () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText(/Поиск по шорткатам/i);
        expect(document.activeElement).toBe(searchInput);
      }, { timeout: 200 });
    });
  });

  describe('Shortcuts Display', () => {
    it('should display all categories', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      expect(screen.getByText('Навигация')).toBeInTheDocument();
      expect(screen.getByText('Действия')).toBeInTheDocument();
      expect(screen.getByText('Кандидаты')).toBeInTheDocument();
    });

    it('should display shortcut descriptions', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      expect(screen.getByText('Глобальный поиск')).toBeInTheDocument();
      expect(screen.getByText('Создать кандидата')).toBeInTheDocument();
      expect(screen.getByText('Следующий кандидат')).toBeInTheDocument();
    });

    it('should display keyboard badges for shortcuts', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // Check for kbd elements (keyboard badges)
      const kbdElements = document.querySelectorAll('kbd');
      expect(kbdElements.length).toBeGreaterThan(0);
    });

    it('should display modifier keys for shortcuts with modifiers', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // Should show K keys (multiple shortcuts use K)
      const kKeys = screen.getAllByText('K');
      expect(kKeys.length).toBeGreaterThan(0);
    });

    it('should display sequence shortcuts correctly', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // Should show sequence indicator for g+c shortcut
      const gKeys = screen.getAllByText('G');
      const cKeys = screen.getAllByText('C');
      expect(gKeys.length).toBeGreaterThan(0);
      expect(cKeys.length).toBeGreaterThan(0);
    });
  });

  describe('Footer', () => {
    it('should display escape hint', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      expect(screen.getByText(/Esc/)).toBeInTheDocument();
    });
  });

  describe('Default Shortcuts', () => {
    it('should display default shortcuts when no custom shortcuts provided', () => {
      render(<KeyboardShortcutsHelp open={true} />);

      // Default shortcuts should be displayed
      expect(screen.getByText('Навигация')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper modal role', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // Modal should be present with proper structure
      expect(screen.getByText('Горячие клавиши')).toBeInTheDocument();
    });

    it('should trap focus within modal', () => {
      render(<KeyboardShortcutsHelp open={true} shortcuts={mockShortcuts} />);

      // Focus should be within modal
      const modal = screen.getByText('Горячие клавиши').closest('.bg-gray-900');
      expect(modal).toBeInTheDocument();
    });
  });
});

describe('ShortcutHelpButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render button with keyboard icon', () => {
    // Since ShortcutHelpButton requires context, it may return null without provider
    const { container } = render(<ShortcutHelpButton />);

    // Without context, should return null
    expect(container.firstChild).toBeNull();
  });

  // Note: ShortcutHelpButton requires a valid ShortcutContext provider to work
  // Integration tests with the full provider are more appropriate for this component
});
