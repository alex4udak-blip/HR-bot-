import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Clock, Sparkles, ChevronDown, Loader2, Trash2, UserCheck } from 'lucide-react';
import clsx from 'clsx';
import { useSmartSearch } from '@/hooks/useSmartSearch';
import type { SmartSearchResult } from '@/services/api';
import type { EntityType } from '@/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';

/**
 * Example search queries shown when input is empty
 */
const EXAMPLE_QUERIES = [
  'Python разработчики с опытом от 3 лет',
  'Frontend React зарплата до 200000',
  'Москва Java senior',
  'DevOps инженер с AWS',
  'Middle Backend Node.js',
  'Аналитик данных SQL',
];

interface SmartSearchBarProps {
  /** Called when a result is selected */
  onResultSelect?: (result: SmartSearchResult) => void;
  /** Called when search results change */
  onResultsChange?: (results: SmartSearchResult[], total: number) => void;
  /** Filter by entity type */
  entityType?: EntityType;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Show inline results dropdown */
  showInlineResults?: boolean;
  /** Maximum inline results to show */
  maxInlineResults?: number;
}

/**
 * Smart Search Bar with AI-powered natural language understanding.
 *
 * Features:
 * - Natural language search queries
 * - Search history with quick access
 * - Example queries for inspiration
 * - Inline results dropdown
 * - Debounced API calls
 * - Loading states and error handling
 *
 * @example
 * ```tsx
 * <SmartSearchBar
 *   onResultSelect={(result) => navigate(`/contacts/${result.id}`)}
 *   onResultsChange={(results) => setSearchResults(results)}
 *   placeholder="Search candidates..."
 * />
 * ```
 */
export default function SmartSearchBar({
  onResultSelect,
  onResultsChange,
  entityType,
  placeholder = 'Search with AI...',
  className,
  autoFocus = false,
  showInlineResults = true,
  maxInlineResults = 5,
}: SmartSearchBarProps) {
  const {
    results,
    total,
    parsedQuery,
    isLoading,
    error,
    history,
    isFromCache,
    search,
    clearResults,
    clearHistory,
  } = useSmartSearch();

  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Notify parent of results changes
  useEffect(() => {
    onResultsChange?.(results, total);
  }, [results, total, onResultsChange]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [results]);

  /**
   * Handle input change with search
   */
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setShowDropdown(true);
    search(value, entityType);
  }, [search, entityType]);

  /**
   * Handle keyboard navigation
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setShowDropdown(true);
      }
      return;
    }

    const itemsToShow = inputValue ? results.slice(0, maxInlineResults) : history;
    const maxIndex = itemsToShow.length - 1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : maxIndex));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          if (inputValue && results[selectedIndex]) {
            onResultSelect?.(results[selectedIndex]);
            setShowDropdown(false);
          } else if (!inputValue && history[selectedIndex]) {
            handleInputChange(history[selectedIndex]);
          }
        } else if (inputValue) {
          // Submit search on Enter
          search(inputValue, entityType);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  }, [showDropdown, inputValue, results, history, selectedIndex, maxInlineResults, onResultSelect, search, entityType, handleInputChange]);

  /**
   * Handle example query click
   */
  const handleExampleClick = useCallback((example: string) => {
    setInputValue(example);
    search(example, entityType);
    inputRef.current?.focus();
  }, [search, entityType]);

  /**
   * Handle history item click
   */
  const handleHistoryClick = useCallback((historyItem: string) => {
    setInputValue(historyItem);
    search(historyItem, entityType);
  }, [search, entityType]);

  /**
   * Handle result click
   */
  const handleResultClick = useCallback((result: SmartSearchResult) => {
    onResultSelect?.(result);
    setShowDropdown(false);
  }, [onResultSelect]);

  /**
   * Clear input and results
   */
  const handleClear = useCallback(() => {
    setInputValue('');
    clearResults();
    setShowDropdown(false);
    inputRef.current?.focus();
  }, [clearResults]);

  // Show dropdown when focused and has content to show
  const shouldShowDropdown = showDropdown && isFocused && (
    (inputValue && showInlineResults && results.length > 0) ||
    (!inputValue && (history.length > 0 || EXAMPLE_QUERIES.length > 0))
  );

  // Parsed query display
  const parsedFilters = Object.entries(parsedQuery).filter(
    ([key, value]) => key !== 'original_query' && key !== 'text_query' && value
  );

  return (
    <div className={clsx('relative', className)}>
      {/* Search Input */}
      <div
        className={clsx(
          'relative flex items-center gap-2',
          'glass-light rounded-xl',
          'transition-all duration-200',
          isFocused && 'ring-2 ring-blue-500/50 border-blue-500/50',
          error && 'border-red-500/50'
        )}
      >
        {/* Search Icon / Loading */}
        <div className="pl-4">
          {isLoading ? (
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="w-5 h-5 text-white/40" aria-hidden="true" />
          )}
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            setShowDropdown(true);
          }}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={clsx(
            'flex-1 bg-transparent py-3 pr-2',
            'text-white placeholder:text-white/40',
            'focus:outline-none'
          )}
          role="combobox"
          aria-expanded={shouldShowDropdown}
          aria-controls="smart-search-dropdown"
          aria-autocomplete="list"
          aria-label={placeholder}
        />

        {/* AI Badge */}
        {inputValue && (
          <div className="flex items-center gap-1 px-2 py-1 bg-purple-500/20 rounded-lg mr-1" aria-label="AI-powered search">
            <Sparkles className="w-3 h-3 text-purple-400" aria-hidden="true" />
            <span className="text-xs text-purple-300">AI</span>
          </div>
        )}

        {/* Clear Button */}
        {inputValue && (
          <button
            onClick={handleClear}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors mr-1"
            aria-label="Очистить поиск"
          >
            <X className="w-4 h-4 text-white/60" aria-hidden="true" />
          </button>
        )}

        {/* Dropdown Toggle */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={clsx(
            'p-2 hover:bg-white/10 rounded-lg transition-colors mr-2',
            showDropdown && 'glass-light'
          )}
          aria-expanded={showDropdown}
          aria-label={showDropdown ? 'Скрыть список' : 'Показать список'}
        >
          <ChevronDown
            className={clsx(
              'w-4 h-4 text-white/60 transition-transform',
              showDropdown && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Parsed Filters Display */}
      {inputValue && parsedFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {parsedFilters.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 rounded-lg text-xs"
            >
              <span className="text-blue-300">{formatFilterKey(key)}:</span>
              <span className="text-white/80">{formatFilterValue(value)}</span>
            </div>
          ))}
          {isFromCache && (
            <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 rounded-lg text-xs">
              <span className="text-yellow-300">cached</span>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mt-2 text-sm text-red-400" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      {/* Dropdown */}
      {shouldShowDropdown && (
        <div
          ref={dropdownRef}
          id="smart-search-dropdown"
          className={clsx(
            'absolute z-50 w-full mt-2',
            'bg-[#1a1a2e] border border-white/10 rounded-xl',
            'shadow-xl shadow-black/20',
            'max-h-[400px] overflow-y-auto'
          )}
          role="listbox"
          aria-label="Результаты поиска"
        >
          {/* Results */}
          {inputValue && results.length > 0 && (
            <div className="p-2">
              <div className="px-3 py-2 text-xs text-white/40 uppercase tracking-wide">
                Results ({total})
              </div>
              {results.slice(0, maxInlineResults).map((result, index) => (
                <button
                  key={result.id}
                  onClick={() => handleResultClick(result)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg',
                    'text-left transition-colors',
                    selectedIndex === index
                      ? 'bg-blue-500/20 text-white'
                      : 'hover:bg-dark-800/50 text-white/80'
                  )}
                  role="option"
                  aria-selected={selectedIndex === index}
                >
                  <UserCheck className="w-5 h-5 text-blue-400 flex-shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{result.name}</span>
                      {result.relevance_score > 0 && (
                        <span className="text-xs text-white/40">
                          {Math.round(result.relevance_score)}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/50">
                      {result.position && <span>{result.position}</span>}
                      {result.company && <span>at {result.company}</span>}
                    </div>
                  </div>
                  <span className={clsx('text-xs px-2 py-0.5 rounded', STATUS_COLORS[result.status])}>
                    {STATUS_LABELS[result.status]}
                  </span>
                </button>
              ))}
              {results.length > maxInlineResults && (
                <div className="px-3 py-2 text-sm text-white/40 text-center">
                  +{results.length - maxInlineResults} more results
                </div>
              )}
            </div>
          )}

          {/* History */}
          {!inputValue && history.length > 0 && (
            <div className="p-2">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-white/40 uppercase tracking-wide" id="search-history-label">
                  Recent searches
                </span>
                <button
                  onClick={clearHistory}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                  aria-label="Clear search history"
                >
                  <Trash2 className="w-3 h-3 text-white/40" aria-hidden="true" />
                </button>
              </div>
              <div role="group" aria-labelledby="search-history-label">
                {history.map((item, index) => (
                  <button
                    key={item}
                    onClick={() => handleHistoryClick(item)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg',
                      'text-left transition-colors',
                      selectedIndex === index
                        ? 'bg-blue-500/20 text-white'
                        : 'hover:bg-dark-800/50 text-white/80'
                    )}
                    role="option"
                    aria-selected={selectedIndex === index}
                  >
                    <Clock className="w-4 h-4 text-white/40 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{item}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Examples */}
          {!inputValue && (
            <div className="p-2 border-t border-white/5">
              <div className="px-3 py-2 text-xs text-white/40 uppercase tracking-wide">
                Try searching for
              </div>
              <div className="flex flex-wrap gap-2 px-3 pb-2">
                {EXAMPLE_QUERIES.slice(0, 4).map((example) => (
                  <button
                    key={example}
                    onClick={() => handleExampleClick(example)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm',
                      'glass-light hover:bg-white/10 text-white/70',
                      'transition-colors'
                    )}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Format filter key for display
 */
function formatFilterKey(key: string): string {
  const labels: Record<string, string> = {
    skills: 'Skills',
    experience_min_years: 'Experience',
    experience_max_years: 'Max experience',
    experience_level: 'Level',
    salary_min: 'Min salary',
    salary_max: 'Max salary',
    salary_currency: 'Currency',
    location: 'Location',
    remote_ok: 'Remote',
    position: 'Position',
    entity_type: 'Type',
    status: 'Status',
    tags: 'Tags',
  };
  return labels[key] || key;
}

/**
 * Format filter value for display
 */
function formatFilterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return new Intl.NumberFormat('ru-RU').format(value);
  }
  return String(value);
}
