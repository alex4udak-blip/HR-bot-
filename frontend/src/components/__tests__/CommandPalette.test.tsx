import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import CommandPalette, { CommandPaletteHint } from '../CommandPalette';
import * as api from '@/services/api';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock API
vi.mock('@/services/api', () => ({
  globalSearch: vi.fn(),
}));

// Wrapper with Router
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
);

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('rendering', () => {
    it('should not render when closed (initial state)', () => {
      render(<CommandPalette />, { wrapper: Wrapper });

      // The modal should not be visible initially
      expect(screen.queryByPlaceholderText(/поиск/i)).not.toBeInTheDocument();
    });

    it('should render when opened via Cmd+K', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      // Press Cmd+K (or Ctrl+K)
      await user.keyboard('{Meta>}k{/Meta}');

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/поиск/i)).toBeInTheDocument();
      });
    });

    it('should close when pressing Escape', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      // Open
      await user.keyboard('{Meta>}k{/Meta}');
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/поиск/i)).toBeInTheDocument();
      });

      // Close with Escape
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/поиск/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('search functionality', () => {
    it('should show search input when opened', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      await waitFor(() => {
        const input = screen.getByPlaceholderText(/поиск/i);
        expect(input).toBeInTheDocument();
        expect(input).toHaveFocus();
      });
    });

    it('should filter results based on query', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      const input = await screen.findByPlaceholderText(/поиск/i);
      await user.type(input, 'вакансии');

      // Should show page results
      await waitFor(() => {
        expect(screen.getByText('Страницы')).toBeInTheDocument();
      });
    });

    it('should show actions when searching for create', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      const input = await screen.findByPlaceholderText(/поиск/i);
      await user.type(input, 'создать');

      await waitFor(() => {
        expect(screen.getByText('Действия')).toBeInTheDocument();
      });
    });

    it('should show no results message for unmatched query', async () => {
      const user = userEvent.setup();
      vi.mocked(api.globalSearch).mockResolvedValue({
        candidates: [],
        vacancies: [],
        total: 0
      });

      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      const input = await screen.findByPlaceholderText(/поиск/i);
      await user.type(input, 'xyznonexistent123');

      await waitFor(() => {
        expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument();
      }, { timeout: 1000 });
    });
  });

  describe('keyboard navigation', () => {
    it('should navigate with arrow keys', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      const input = await screen.findByPlaceholderText(/поиск/i);
      await user.type(input, 'создать');

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText('Действия')).toBeInTheDocument();
      });

      // Navigate down
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowUp}');

      // Should still have results visible
      expect(screen.getByText('Действия')).toBeInTheDocument();
    });

    it('should execute selected item on Enter', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      const input = await screen.findByPlaceholderText(/поиск/i);
      await user.type(input, 'вакансии');

      await waitFor(() => {
        expect(screen.getByText('Страницы')).toBeInTheDocument();
      });

      await user.keyboard('{Enter}');

      // Should navigate
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  describe('UI elements', () => {
    it('should show keyboard hints in footer', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      await waitFor(() => {
        expect(screen.getByText('Enter')).toBeInTheDocument();
        expect(screen.getByText('Esc')).toBeInTheDocument();
      });
    });

    it('should show hints when empty', async () => {
      const user = userEvent.setup();
      render(<CommandPalette />, { wrapper: Wrapper });

      await user.keyboard('{Meta>}k{/Meta}');

      await waitFor(() => {
        expect(screen.getByText(/начните вводить/i)).toBeInTheDocument();
      });
    });
  });
});

describe('CommandPaletteHint', () => {
  it('should render keyboard shortcut hint', () => {
    render(<CommandPaletteHint />, { wrapper: Wrapper });

    // Should show K key
    expect(screen.getByText('K')).toBeInTheDocument();
    // Should show modifier (Cmd or Ctrl depending on platform)
    expect(screen.getByText(/cmd|ctrl/i)).toBeInTheDocument();
  });

  it('should show search text on larger screens', () => {
    render(<CommandPaletteHint />, { wrapper: Wrapper });

    expect(screen.getByText(/для поиска/i)).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <CommandPaletteHint className="custom-class" />,
      { wrapper: Wrapper }
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});
