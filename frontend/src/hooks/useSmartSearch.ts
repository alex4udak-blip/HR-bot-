import { useState, useCallback, useRef, useEffect } from 'react';
import { smartSearch, type SmartSearchResponse, type SmartSearchResult, type SmartSearchParams } from '@/services/api';
import type { EntityType } from '@/types';
import { getLocalStorage, setLocalStorage, removeLocalStorage } from '@/utils/localStorage';

/**
 * Local storage key for search history
 */
const SEARCH_HISTORY_KEY = 'hr_smart_search_history';
const MAX_HISTORY_ITEMS = 10;

/**
 * Local storage key for results cache
 */
const SEARCH_CACHE_KEY = 'hr_smart_search_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedSearch {
  query: string;
  type?: EntityType;
  response: SmartSearchResponse;
  timestamp: number;
}

/**
 * Get search history from localStorage
 */
function getSearchHistory(): string[] {
  return getLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
}

/**
 * Save search query to history
 */
function saveToHistory(query: string): void {
  const history = getSearchHistory();
  // Remove duplicate if exists
  const filtered = history.filter(q => q.toLowerCase() !== query.toLowerCase());
  // Add to beginning
  filtered.unshift(query);
  // Limit size
  const limited = filtered.slice(0, MAX_HISTORY_ITEMS);
  setLocalStorage(SEARCH_HISTORY_KEY, limited);
}

/**
 * Get cached search result
 */
function getCachedResult(query: string, type?: EntityType): SmartSearchResponse | null {
  const cache = getLocalStorage<CachedSearch[]>(SEARCH_CACHE_KEY, []);
  if (cache.length === 0) return null;

  const now = Date.now();

  // Find matching cache entry
  const entry = cache.find(
    c => c.query.toLowerCase() === query.toLowerCase() &&
         c.type === type &&
         (now - c.timestamp) < CACHE_TTL_MS
  );

  return entry?.response || null;
}

/**
 * Save search result to cache
 */
function saveToCache(query: string, type: EntityType | undefined, response: SmartSearchResponse): void {
  let cache = getLocalStorage<CachedSearch[]>(SEARCH_CACHE_KEY, []);
  const now = Date.now();

  // Remove expired entries and duplicate
  cache = cache.filter(
    c => (now - c.timestamp) < CACHE_TTL_MS &&
         !(c.query.toLowerCase() === query.toLowerCase() && c.type === type)
  );

  // Add new entry
  cache.unshift({ query, type, response, timestamp: now });

  // Limit cache size
  cache = cache.slice(0, 20);

  setLocalStorage(SEARCH_CACHE_KEY, cache);
}

/**
 * Clear search history
 */
export function clearSearchHistory(): void {
  removeLocalStorage(SEARCH_HISTORY_KEY);
}

/**
 * Return type for the useSmartSearch hook
 */
export interface UseSmartSearchReturn {
  /** Search results */
  results: SmartSearchResult[];
  /** Total count of matching results */
  total: number;
  /** Parsed query information from AI */
  parsedQuery: Record<string, unknown>;
  /** Current search query */
  query: string;
  /** Whether search is in progress */
  isLoading: boolean;
  /** Error message if search failed */
  error: string | null;
  /** Search history */
  history: string[];
  /** Whether results are from cache */
  isFromCache: boolean;
  /** Execute search */
  search: (query: string, type?: EntityType) => Promise<void>;
  /** Clear current results */
  clearResults: () => void;
  /** Clear search history */
  clearHistory: () => void;
  /** Load more results (pagination) */
  loadMore: () => Promise<void>;
  /** Whether there are more results to load */
  hasMore: boolean;
}

/**
 * Hook for smart search with AI-powered natural language understanding.
 *
 * Features:
 * - Debounced API calls
 * - Local caching (5-minute TTL)
 * - Search history
 * - Pagination support
 * - Error handling
 *
 * @param debounceMs Debounce time in milliseconds (default: 300)
 *
 * @example
 * ```tsx
 * const { results, isLoading, search, history } = useSmartSearch();
 *
 * // Execute search
 * await search("Python developers with 3+ years experience");
 *
 * // Results are ranked by relevance
 * results.forEach(r => console.log(r.name, r.relevance_score));
 * ```
 */
export function useSmartSearch(debounceMs: number = 300): UseSmartSearchReturn {
  const [results, setResults] = useState<SmartSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [parsedQuery, setParsedQuery] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(getSearchHistory);
  const [isFromCache, setIsFromCache] = useState(false);
  const [currentType, setCurrentType] = useState<EntityType | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Refs for debounce and cleanup
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const LIMIT = 50;

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  /**
   * Execute search with debouncing
   */
  const search = useCallback(async (searchQuery: string, type?: EntityType) => {
    // Clear previous debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const trimmedQuery = searchQuery.trim();
    setQuery(trimmedQuery);
    setCurrentType(type);
    setOffset(0);

    if (!trimmedQuery) {
      setResults([]);
      setTotal(0);
      setParsedQuery({});
      setError(null);
      setIsFromCache(false);
      setHasMore(false);
      return;
    }

    // Check cache first
    const cached = getCachedResult(trimmedQuery, type);
    if (cached) {
      if (isMountedRef.current) {
        setResults(cached.results);
        setTotal(cached.total);
        setParsedQuery(cached.parsed_query);
        setIsFromCache(true);
        setError(null);
        setHasMore(cached.results.length < cached.total);
      }
      // Still fetch fresh data in background
    }

    // Debounce the API call
    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);
      if (!cached) {
        setIsFromCache(false);
      }

      try {
        const params: SmartSearchParams = {
          query: trimmedQuery,
          type,
          limit: LIMIT,
          offset: 0,
        };

        const response = await smartSearch(params);

        if (isMountedRef.current && !controller.signal.aborted) {
          setResults(response.results);
          setTotal(response.total);
          setParsedQuery(response.parsed_query);
          setIsFromCache(false);
          setHasMore(response.results.length < response.total);

          // Save to history and cache
          if (response.results.length > 0) {
            saveToHistory(trimmedQuery);
            setHistory(getSearchHistory());
          }
          saveToCache(trimmedQuery, type, response);
        }
      } catch (err) {
        if (isMountedRef.current && !(err instanceof Error && err.name === 'AbortError')) {
          const message = err instanceof Error ? err.message : 'Search failed';
          setError(message);
          // Keep cached results if available
          if (!cached) {
            setResults([]);
            setTotal(0);
          }
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    }, debounceMs);
  }, [debounceMs]);

  /**
   * Load more results (pagination)
   */
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore || !query) return;

    const newOffset = offset + LIMIT;
    setIsLoading(true);

    try {
      const params: SmartSearchParams = {
        query,
        type: currentType,
        limit: LIMIT,
        offset: newOffset,
      };

      const response = await smartSearch(params);

      if (isMountedRef.current) {
        setResults(prev => [...prev, ...response.results]);
        setOffset(newOffset);
        setHasMore(results.length + response.results.length < response.total);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to load more';
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isLoading, hasMore, query, currentType, offset, results.length]);

  /**
   * Clear current results
   */
  const clearResults = useCallback(() => {
    setResults([]);
    setTotal(0);
    setParsedQuery({});
    setQuery('');
    setError(null);
    setIsFromCache(false);
    setOffset(0);
    setHasMore(false);
  }, []);

  /**
   * Clear search history
   */
  const clearHistory = useCallback(() => {
    clearSearchHistory();
    setHistory([]);
  }, []);

  return {
    results,
    total,
    parsedQuery,
    query,
    isLoading,
    error,
    history,
    isFromCache,
    search,
    clearResults,
    clearHistory,
    loadMore,
    hasMore,
  };
}

export default useSmartSearch;
