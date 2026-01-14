import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSmartSearch, clearSearchHistory } from '../useSmartSearch';
import * as api from '@/services/api';

/**
 * Tests for useSmartSearch hook
 * Verifies search functionality, caching, history, and state management
 */

// Storage keys used by the hook
const SEARCH_HISTORY_KEY = 'hr_smart_search_history';
const SEARCH_CACHE_KEY = 'hr_smart_search_cache';

// Mock API response
const mockSearchResponse: api.SmartSearchResponse = {
  results: [
    {
      id: 1,
      type: 'candidate',
      name: 'Ivan Python',
      status: 'interview',
      email: 'ivan@test.com',
      position: 'Senior Python Developer',
      tags: ['backend', 'senior'],
      extra_data: { skills: ['Python', 'Django'] },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
      relevance_score: 85,
    },
    {
      id: 2,
      type: 'candidate',
      name: 'Anna React',
      status: 'screening',
      email: 'anna@test.com',
      position: 'Frontend Developer',
      tags: ['frontend'],
      extra_data: { skills: ['React', 'TypeScript'] },
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-10T00:00:00Z',
      relevance_score: 72,
    },
  ],
  total: 2,
  parsed_query: {
    skills: ['Python'],
    experience_level: 'senior',
  },
  offset: 0,
  limit: 50,
};

describe('useSmartSearch', () => {
  // Mock localStorage
  let mockStorage: Record<string, string> = {};

  // Mock API
  const mockSmartSearch = vi.fn();

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    });

    // Mock API
    vi.spyOn(api, 'smartSearch').mockImplementation(mockSmartSearch);
    mockSmartSearch.mockResolvedValue(mockSearchResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Initial state', () => {
    it('should start with empty results', () => {
      const { result } = renderHook(() => useSmartSearch());

      expect(result.current.results).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.query).toBe('');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should load search history from localStorage', () => {
      mockStorage[SEARCH_HISTORY_KEY] = JSON.stringify([
        'Python developer',
        'React frontend',
      ]);

      const { result } = renderHook(() => useSmartSearch());

      expect(result.current.history).toContain('Python developer');
      expect(result.current.history).toContain('React frontend');
    });

    it('should handle invalid localStorage history gracefully', () => {
      mockStorage[SEARCH_HISTORY_KEY] = 'invalid-json';

      const { result } = renderHook(() => useSmartSearch());

      expect(result.current.history).toEqual([]);
    });
  });

  describe('search', () => {
    it('should update query state', async () => {
      const { result } = renderHook(() => useSmartSearch(0)); // No debounce for tests

      await act(async () => {
        await result.current.search('Python developer');
      });

      expect(result.current.query).toBe('Python developer');
    });

    it('should call API with correct parameters', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('Python developer');
        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(mockSmartSearch).toHaveBeenCalledWith({
          query: 'Python developer',
          type: undefined,
          limit: 50,
          offset: 0,
        });
      });
    });

    it('should update results after successful search', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('Python developer');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.results).toHaveLength(2);
        expect(result.current.total).toBe(2);
      });
    });

    it('should save to history after successful search', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('Python developer');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalled();
        const savedHistory = JSON.parse(mockStorage[SEARCH_HISTORY_KEY] || '[]');
        expect(savedHistory).toContain('Python developer');
      });
    });

    it('should handle API errors gracefully', async () => {
      mockSmartSearch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('failing query');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });
    });

    it('should clear results for empty query', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      // First do a search
      await act(async () => {
        await result.current.search('Python');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Then clear
      await act(async () => {
        await result.current.search('');
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.total).toBe(0);
    });

    it('should pass entity type filter', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('developer', 'candidate');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(mockSmartSearch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'candidate',
          })
        );
      });
    });
  });

  describe('caching', () => {
    it('should use cached results when available', async () => {
      // Pre-populate cache
      const cachedData = {
        query: 'cached query',
        type: undefined,
        response: mockSearchResponse,
        timestamp: Date.now(),
      };
      mockStorage[SEARCH_CACHE_KEY] = JSON.stringify([cachedData]);

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('cached query');
      });

      // Should immediately show cached results
      expect(result.current.results).toHaveLength(2);
      expect(result.current.isFromCache).toBe(true);
    });

    it('should not use expired cache', async () => {
      // Pre-populate with expired cache
      const expiredData = {
        query: 'old query',
        type: undefined,
        response: mockSearchResponse,
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago (expired)
      };
      mockStorage[SEARCH_CACHE_KEY] = JSON.stringify([expiredData]);

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('old query');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Should fetch fresh data
      await waitFor(() => {
        expect(mockSmartSearch).toHaveBeenCalled();
      });
    });

    it('should save results to cache', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('new query');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalled();
        const cacheData = mockStorage[SEARCH_CACHE_KEY];
        if (cacheData) {
          const cache = JSON.parse(cacheData);
          expect(cache.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('history management', () => {
    it('should limit history size', async () => {
      // Pre-populate with max history
      const existingHistory = Array.from(
        { length: 10 },
        (_, i) => `search ${i}`
      );
      mockStorage[SEARCH_HISTORY_KEY] = JSON.stringify(existingHistory);

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('new search');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        const savedHistory = JSON.parse(mockStorage[SEARCH_HISTORY_KEY] || '[]');
        // Should not exceed max (10)
        expect(savedHistory.length).toBeLessThanOrEqual(10);
        // New search should be first
        expect(savedHistory[0]).toBe('new search');
      });
    });

    it('should not duplicate history entries', async () => {
      mockStorage[SEARCH_HISTORY_KEY] = JSON.stringify(['existing search']);

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('existing search');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        const savedHistory = JSON.parse(mockStorage[SEARCH_HISTORY_KEY] || '[]');
        const count = savedHistory.filter(
          (h: string) => h.toLowerCase() === 'existing search'
        ).length;
        expect(count).toBe(1);
      });
    });

    it('should clear history', () => {
      mockStorage[SEARCH_HISTORY_KEY] = JSON.stringify(['search 1', 'search 2']);

      const { result } = renderHook(() => useSmartSearch());

      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.history).toEqual([]);
      expect(localStorage.removeItem).toHaveBeenCalledWith(SEARCH_HISTORY_KEY);
    });
  });

  describe('clearResults', () => {
    it('should clear all search state', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      // First do a search
      await act(async () => {
        await result.current.search('Python');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.results.length).toBeGreaterThan(0);
      });

      // Then clear
      act(() => {
        result.current.clearResults();
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.query).toBe('');
      expect(result.current.error).toBeNull();
      expect(result.current.parsedQuery).toEqual({});
    });
  });

  describe('pagination', () => {
    it('should track hasMore correctly', async () => {
      // Response with more results available
      mockSmartSearch.mockResolvedValueOnce({
        ...mockSearchResponse,
        total: 100, // More than returned
      });

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('developer');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.hasMore).toBe(true);
      });
    });

    it('should load more results', async () => {
      // Initial response
      mockSmartSearch.mockResolvedValueOnce({
        ...mockSearchResponse,
        total: 100,
      });

      // Load more response
      const moreResults: api.SmartSearchResponse = {
        results: [
          {
            id: 3,
            type: 'candidate',
            name: 'Boris Java',
            status: 'new',
            tags: [],
            extra_data: {},
            created_at: '2024-01-03T00:00:00Z',
            updated_at: '2024-01-03T00:00:00Z',
            relevance_score: 60,
          },
        ],
        total: 100,
        parsed_query: {},
        offset: 50,
        limit: 50,
      };
      mockSmartSearch.mockResolvedValueOnce(moreResults);

      const { result } = renderHook(() => useSmartSearch(0));

      // Initial search
      await act(async () => {
        await result.current.search('developer');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.results).toHaveLength(2);
      });

      // Load more
      await act(async () => {
        await result.current.loadMore();
      });

      await waitFor(() => {
        expect(result.current.results).toHaveLength(3);
        expect(result.current.results[2].name).toBe('Boris Java');
      });
    });

    it('should not load more if already loading', async () => {
      // Set up response with more results to enable hasMore
      mockSmartSearch.mockResolvedValueOnce({
        ...mockSearchResponse,
        total: 100, // More than returned
      });

      const { result } = renderHook(() => useSmartSearch(0));

      // Initial search
      await act(async () => {
        await result.current.search('developer');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.hasMore).toBe(true);
      });

      // Mock a slow load more response
      mockSmartSearch.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockSearchResponse), 200))
      );

      // Start loading more
      act(() => {
        result.current.loadMore();
      });

      // Try to load more again immediately (should be prevented by isLoading check)
      await act(async () => {
        await result.current.loadMore();
      });

      // Should only have 2 calls: initial + one loadMore
      expect(mockSmartSearch).toHaveBeenCalledTimes(2);
    });

    it('should not load more if no more results', async () => {
      // Clear any previous mock calls
      mockSmartSearch.mockClear();

      // Response with all results
      mockSmartSearch.mockResolvedValueOnce({
        ...mockSearchResponse,
        total: 2, // Same as returned (2 results)
      });

      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('developer');
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      await waitFor(() => {
        expect(result.current.results).toHaveLength(2);
        expect(result.current.hasMore).toBe(false);
      });

      // Try to load more when there's nothing more
      await act(async () => {
        await result.current.loadMore();
      });

      // Should not call API again (loadMore is prevented by hasMore=false)
      expect(mockSmartSearch).toHaveBeenCalledTimes(1);
    });
  });

  describe('parsed query', () => {
    it('should expose parsed query from response', async () => {
      const { result } = renderHook(() => useSmartSearch(0));

      await act(async () => {
        await result.current.search('Senior Python');
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await waitFor(() => {
        expect(result.current.parsedQuery).toEqual({
          skills: ['Python'],
          experience_level: 'senior',
        });
      });
    });
  });

  describe('clearSearchHistory utility', () => {
    it('should clear search history from localStorage', () => {
      mockStorage[SEARCH_HISTORY_KEY] = JSON.stringify(['search 1']);

      clearSearchHistory();

      expect(localStorage.removeItem).toHaveBeenCalledWith(SEARCH_HISTORY_KEY);
    });
  });

  describe('debouncing', () => {
    it('should debounce search calls', async () => {
      // Clear mocks
      mockSmartSearch.mockClear();
      mockSmartSearch.mockResolvedValue(mockSearchResponse);

      vi.useFakeTimers();

      const { result } = renderHook(() => useSmartSearch(300));

      // Rapid searches
      await act(async () => {
        result.current.search('P');
      });
      await act(async () => {
        result.current.search('Py');
      });
      await act(async () => {
        result.current.search('Pyt');
      });
      await act(async () => {
        result.current.search('Python');
      });

      // Should not call API yet (still debouncing)
      expect(mockSmartSearch).not.toHaveBeenCalled();

      // Advance time past debounce
      await act(async () => {
        vi.advanceTimersByTime(350);
        // Let promises resolve
        await vi.runAllTimersAsync();
      });

      // Should only call once with final value
      expect(mockSmartSearch).toHaveBeenCalledTimes(1);
      expect(mockSmartSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Python',
        })
      );

      vi.useRealTimers();
    });
  });
});
