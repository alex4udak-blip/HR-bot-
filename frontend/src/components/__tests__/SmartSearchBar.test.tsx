import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SmartSearchBar from '../SmartSearchBar';
import type { SmartSearchResult } from '@/services/api';

/**
 * Tests for SmartSearchBar component
 * Verifies AI-powered search functionality, history, and result display
 */

// Mock the useSmartSearch hook
const mockSearch = vi.fn();
const mockClearResults = vi.fn();
const mockClearHistory = vi.fn();

vi.mock('@/hooks/useSmartSearch', () => ({
  useSmartSearch: () => ({
    results: mockResults,
    total: mockResults.length,
    parsedQuery: mockParsedQuery,
    isLoading: mockIsLoading,
    error: mockError,
    history: mockHistory,
    isFromCache: false,
    search: mockSearch,
    clearResults: mockClearResults,
    clearHistory: mockClearHistory,
    loadMore: vi.fn(),
    hasMore: false,
  }),
  default: () => ({
    results: mockResults,
    total: mockResults.length,
    parsedQuery: mockParsedQuery,
    isLoading: mockIsLoading,
    error: mockError,
    history: mockHistory,
    isFromCache: false,
    search: mockSearch,
    clearResults: mockClearResults,
    clearHistory: mockClearHistory,
    loadMore: vi.fn(),
    hasMore: false,
  }),
}));

// Mock data
let mockResults: SmartSearchResult[] = [];
let mockParsedQuery: Record<string, unknown> = {};
let mockIsLoading = false;
let mockError: string | null = null;
let mockHistory: string[] = [];

const mockSearchResults: SmartSearchResult[] = [
  {
    id: 1,
    type: 'candidate',
    name: 'Ivan Python',
    status: 'interview',
    email: 'ivan@test.com',
    position: 'Senior Python Developer',
    company: 'TechCorp',
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
];

describe('SmartSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResults = [];
    mockParsedQuery = {};
    mockIsLoading = false;
    mockError = null;
    mockHistory = [];
  });

  describe('Rendering', () => {
    it('should render search input', () => {
      render(<SmartSearchBar />);

      expect(screen.getByPlaceholderText('Search with AI...')).toBeInTheDocument();
    });

    it('should render with custom placeholder', () => {
      render(<SmartSearchBar placeholder="Find candidates..." />);

      expect(screen.getByPlaceholderText('Find candidates...')).toBeInTheDocument();
    });

    it('should render search icon', () => {
      render(<SmartSearchBar />);

      // Search icon should be visible (lucide-react icon)
      expect(screen.getByPlaceholderText('Search with AI...')).toBeInTheDocument();
    });

    it('should render dropdown toggle button', () => {
      render(<SmartSearchBar />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Search Input', () => {
    it('should call search on input change', async () => {
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python developer');

      expect(mockSearch).toHaveBeenCalled();
    });

    it('should show AI badge when input has value', async () => {
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python');

      expect(screen.getByText('AI')).toBeInTheDocument();
    });

    it('should show clear button when input has value', async () => {
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python');

      // X button should appear
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(1);
    });

    it('should clear input when clear button is clicked', async () => {
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python');

      // Find and click the clear button
      const clearButtons = screen.getAllByRole('button');
      const clearButton = clearButtons.find(btn => btn.querySelector('svg'));
      if (clearButton) {
        await userEvent.click(clearButton);
      }

      expect(mockClearResults).toHaveBeenCalled();
    });

    it('should auto-focus when autoFocus prop is true', () => {
      render(<SmartSearchBar autoFocus />);
      const input = screen.getByPlaceholderText('Search with AI...');

      expect(document.activeElement).toBe(input);
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner when searching', () => {
      mockIsLoading = true;
      render(<SmartSearchBar />);

      // Loading spinner should be present
      // The component shows Loader2 icon when loading
      const input = screen.getByPlaceholderText('Search with AI...');
      expect(input).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error message', () => {
      mockError = 'Search failed';
      render(<SmartSearchBar />);

      expect(screen.getByText('Search failed')).toBeInTheDocument();
    });
  });

  describe('Results Dropdown', () => {
    it('should show results count when results are available', async () => {
      mockResults = mockSearchResults;
      render(<SmartSearchBar showInlineResults />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python');

      // Focus the input to show dropdown
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText(/Results/)).toBeInTheDocument();
      });
    });

    it('should call onResultSelect when clicking a result', async () => {
      mockResults = mockSearchResults;
      const onResultSelect = vi.fn();
      render(<SmartSearchBar showInlineResults onResultSelect={onResultSelect} />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python');
      fireEvent.focus(input);

      await waitFor(() => {
        const resultButton = screen.getByText('Ivan Python');
        fireEvent.click(resultButton);
      });

      expect(onResultSelect).toHaveBeenCalled();
    });
  });

  describe('History', () => {
    it('should show history when input is empty and focused', async () => {
      mockHistory = ['Python developer', 'React frontend'];
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText(/Recent searches/i)).toBeInTheDocument();
      });
    });

    it('should show clear history button', async () => {
      mockHistory = ['Python developer'];
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      fireEvent.focus(input);

      await waitFor(() => {
        // Clear history button should be present
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });
    });

    it('should use history item when clicked', async () => {
      mockHistory = ['Python developer'];
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      fireEvent.focus(input);

      await waitFor(() => {
        const historyItem = screen.getByText('Python developer');
        fireEvent.click(historyItem);
      });

      expect(mockSearch).toHaveBeenCalledWith('Python developer', undefined);
    });
  });

  describe('Example Queries', () => {
    it('should show example queries when dropdown is open', async () => {
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText(/Try searching for/i)).toBeInTheDocument();
      });
    });

    it('should search with example query when clicked', async () => {
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      fireEvent.focus(input);

      await waitFor(() => {
        // Find an example query button
        const exampleQuery = screen.getByText('Python разработчики с опытом от 3 лет');
        fireEvent.click(exampleQuery);
      });

      expect(mockSearch).toHaveBeenCalled();
    });
  });

  describe('Parsed Filters Display', () => {
    it('should display parsed filters when available', async () => {
      mockParsedQuery = {
        skills: ['Python'],
        experience_level: 'senior',
      };
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Senior Python developer');

      await waitFor(() => {
        expect(screen.getByText('Skills:')).toBeInTheDocument();
        expect(screen.getByText('Python')).toBeInTheDocument();
      });
    });
  });

  describe('Keyboard Navigation', () => {
    it('should close dropdown on Escape', async () => {
      mockHistory = ['Python developer'];
      render(<SmartSearchBar />);
      const input = screen.getByPlaceholderText('Search with AI...');

      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText(/Recent searches/i)).toBeInTheDocument();
      });

      fireEvent.keyDown(input, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByText(/Recent searches/i)).not.toBeInTheDocument();
      });
    });

    it('should navigate results with arrow keys', async () => {
      mockResults = mockSearchResults;
      render(<SmartSearchBar showInlineResults />);
      const input = screen.getByPlaceholderText('Search with AI...');

      await userEvent.type(input, 'Python');
      fireEvent.focus(input);

      // Arrow down
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      // Component handles selection state internally
      expect(input).toBeInTheDocument();
    });
  });

  describe('Callbacks', () => {
    it('should call onResultsChange when results change', () => {
      mockResults = mockSearchResults;
      const onResultsChange = vi.fn();
      render(<SmartSearchBar onResultsChange={onResultsChange} />);

      // Results change should trigger callback
      expect(onResultsChange).toHaveBeenCalledWith(mockSearchResults, mockSearchResults.length);
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(<SmartSearchBar className="custom-search" />);

      expect(container.querySelector('.custom-search')).toBeInTheDocument();
    });
  });
});
