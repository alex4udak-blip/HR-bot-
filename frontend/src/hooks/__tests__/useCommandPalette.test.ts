import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useCommandPalette, clearCommandHistory } from '../useCommandPalette';
import * as api from '@/services/api';

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
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
);

describe('useCommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCommandHistory();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('initial state', () => {
    it('should start with closed state', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      expect(result.current.isOpen).toBe(false);
      expect(result.current.query).toBe('');
      expect(result.current.selectedIndex).toBe(0);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.results).toEqual([]);
    });
  });

  describe('open/close/toggle', () => {
    it('should open the palette', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);
    });

    it('should close the palette', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.open();
        result.current.close();
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('should toggle the palette', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(false);
    });

    it('should reset query when closing', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.open();
        result.current.setQuery('test');
      });

      expect(result.current.query).toBe('test');

      act(() => {
        result.current.close();
      });

      expect(result.current.query).toBe('');
    });
  });

  describe('keyboard navigation', () => {
    it('should move selection down', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      // First set some query to get results
      act(() => {
        result.current.setQuery('создать');
      });

      // Wait for local results to populate
      expect(result.current.results.length).toBeGreaterThan(0);

      act(() => {
        result.current.moveDown();
      });

      expect(result.current.selectedIndex).toBe(1);
    });

    it('should move selection up', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.setQuery('создать');
      });

      act(() => {
        result.current.setSelectedIndex(2);
        result.current.moveUp();
      });

      expect(result.current.selectedIndex).toBe(1);
    });

    it('should wrap around when moving past bounds', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.setQuery('создать');
      });

      const resultsLength = result.current.results.length;

      act(() => {
        result.current.setSelectedIndex(0);
        result.current.moveUp();
      });

      expect(result.current.selectedIndex).toBe(resultsLength - 1);
    });
  });

  describe('local search', () => {
    it('should filter pages by query', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.setQuery('вакансии');
      });

      const pageResults = result.current.results.filter(r => r.type === 'pages');
      expect(pageResults.length).toBeGreaterThan(0);
      expect(pageResults.some(r => r.title.toLowerCase().includes('вакансии'))).toBe(true);
    });

    it('should filter actions by query', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.setQuery('создать кандидата');
      });

      const actionResults = result.current.results.filter(r => r.type === 'actions');
      expect(actionResults.length).toBeGreaterThan(0);
    });

    it('should match keywords', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.setQuery('upload');
      });

      const actionResults = result.current.results.filter(r => r.type === 'actions');
      expect(actionResults.some(r => r.title.toLowerCase().includes('загрузить'))).toBe(true);
    });
  });

  describe('API search', () => {
    it('should call globalSearch API with debounce', async () => {
      vi.useFakeTimers();
      const mockResponse = {
        candidates: [
          { id: 1, name: 'John Doe', email: 'john@test.com', status: 'new', relevance_score: 100 }
        ],
        vacancies: [],
        total: 1
      };
      vi.mocked(api.globalSearch).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useCommandPalette(100), { wrapper });

      act(() => {
        result.current.setQuery('john');
      });

      // API should not be called immediately
      expect(api.globalSearch).not.toHaveBeenCalled();

      // Fast-forward past debounce
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      await waitFor(() => {
        expect(api.globalSearch).toHaveBeenCalledWith('john', 10);
      });

      vi.useRealTimers();
    });

    it('should not call API for empty query', async () => {
      const { result } = renderHook(() => useCommandPalette(100), { wrapper });

      act(() => {
        result.current.setQuery('');
      });

      expect(api.globalSearch).not.toHaveBeenCalled();
    });
  });

  describe('executeSelected', () => {
    it('should execute action of selected item', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.setQuery('вакансии');
      });

      const pageResults = result.current.results.filter(r => r.type === 'pages');
      expect(pageResults.length).toBeGreaterThan(0);

      act(() => {
        result.current.executeSelected();
      });

      // Should navigate to vacancies page
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('should maintain search history', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      // Execute a search to save to history
      act(() => {
        result.current.setQuery('test query');
      });

      // Execute an action to trigger history save
      const pageResults = result.current.results;
      if (pageResults.length > 0) {
        act(() => {
          result.current.executeSelected();
        });
      }

      // History should be accessible
      expect(result.current.history).toBeDefined();
    });

    it('should clear history', () => {
      const { result } = renderHook(() => useCommandPalette(), { wrapper });

      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.history).toEqual([]);
    });
  });
});
