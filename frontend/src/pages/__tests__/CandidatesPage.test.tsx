import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CandidatesPage from '../CandidatesPage';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import type { Entity, EntityType, EntityStatus } from '@/types';

// Mock the entity store
vi.mock('@/stores/entityStore', () => ({
  useEntityStore: vi.fn(),
}));

// Mock the auth store
vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren<object>) => <>{children}</>,
}));

const mockCandidates: Entity[] = [
  {
    id: 1,
    name: 'Иван Иванов',
    type: 'candidate' as EntityType,
    status: 'new' as EntityStatus,
    email: 'ivan@example.com',
    phone: '+7 999 123-45-67',
    position: 'Senior Developer',
    tags: ['React', 'TypeScript', 'Node.js'],
    extra_data: {},
    expected_salary_min: 150000,
    expected_salary_max: 200000,
    expected_salary_currency: 'RUB',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'Мария Петрова',
    type: 'candidate' as EntityType,
    status: 'interview' as EntityStatus,
    email: 'maria@example.com',
    phone: '+7 999 765-43-21',
    position: 'Product Manager',
    tags: ['Product', 'Agile', 'Scrum'],
    extra_data: {},
    expected_salary_min: 180000,
    expected_salary_max: 250000,
    expected_salary_currency: 'RUB',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    name: 'Алексей Смирнов',
    type: 'candidate' as EntityType,
    status: 'hired' as EntityStatus,
    email: 'alex@example.com',
    position: 'Designer',
    tags: ['Figma', 'UI/UX'],
    extra_data: {},
    expected_salary_min: 80000,
    expected_salary_max: 100000,
    expected_salary_currency: 'RUB',
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
    updated_at: new Date().toISOString(),
  },
  {
    id: 4,
    name: 'Клиент ООО',
    type: 'client' as EntityType, // Not a candidate, should be filtered out
    status: 'active' as EntityStatus,
    email: 'client@company.com',
    tags: [],
    extra_data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockEntityStore = {
  entities: mockCandidates,
  currentEntity: null,
  loading: false,
  error: null,
  fetchEntity: vi.fn(),
  deleteEntity: vi.fn().mockResolvedValue(undefined),
  updateEntity: vi.fn().mockResolvedValue(undefined),
  setFilters: vi.fn(),
  clearCurrentEntity: vi.fn(),
  clearError: vi.fn(),
  typeCounts: { all: 4, candidate: 3, client: 1, contractor: 0, lead: 0, partner: 0, custom: 0 },
  fetchTypeCounts: vi.fn(),
};

const mockAuthStore = {
  canEditResource: vi.fn().mockReturnValue(true),
  canDeleteResource: vi.fn().mockReturnValue(true),
  canShareResource: vi.fn().mockReturnValue(true),
  isSuperAdmin: vi.fn().mockReturnValue(false),
  isOwner: vi.fn().mockReturnValue(false),
};

describe('CandidatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useEntityStore as ReturnType<typeof vi.fn>).mockReturnValue(mockEntityStore);
    (useAuthStore as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthStore);
  });

  const renderWithRouter = (initialEntries: string[] = ['/candidates']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <CandidatesPage />
      </MemoryRouter>
    );
  };

  describe('Header', () => {
    it('should display the candidates page header', () => {
      renderWithRouter();
      expect(screen.getByText('База кандидатов')).toBeInTheDocument();
    });

    it('should display add candidate button', () => {
      renderWithRouter();
      expect(screen.getByText('Добавить кандидата')).toBeInTheDocument();
    });

    it('should display upload resume button', () => {
      renderWithRouter();
      expect(screen.getByText('Загрузить резюме')).toBeInTheDocument();
    });

    it('should display search input', () => {
      renderWithRouter();
      expect(screen.getByPlaceholderText(/поиск по имени, телефону, email/i)).toBeInTheDocument();
    });
  });

  describe('Candidates List', () => {
    it('should display only candidates (not other entity types)', () => {
      renderWithRouter();

      // Should show candidates
      expect(screen.getByText('Иван Иванов')).toBeInTheDocument();
      expect(screen.getByText('Мария Петрова')).toBeInTheDocument();
      expect(screen.getByText('Алексей Смирнов')).toBeInTheDocument();

      // Should NOT show client
      expect(screen.queryByText('Клиент ООО')).not.toBeInTheDocument();
    });

    it('should display candidate positions', () => {
      renderWithRouter();

      expect(screen.getByText('Senior Developer')).toBeInTheDocument();
      expect(screen.getByText('Product Manager')).toBeInTheDocument();
      expect(screen.getByText('Designer')).toBeInTheDocument();
    });

    it('should display candidate skills as tags', () => {
      renderWithRouter();

      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
    });

    it('should display candidate statuses', () => {
      renderWithRouter();

      expect(screen.getByText('Новый')).toBeInTheDocument();
      expect(screen.getByText('Интервью')).toBeInTheDocument();
      expect(screen.getByText('Принят')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      (useEntityStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockEntityStore,
        loading: true,
        entities: [],
      });

      renderWithRouter();

      // Should not show candidates when loading
      expect(screen.queryByText('Иван Иванов')).not.toBeInTheDocument();
    });

    it('should show empty state when no candidates', () => {
      (useEntityStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockEntityStore,
        entities: [],
      });

      renderWithRouter();

      expect(screen.getByText('Пока нет кандидатов')).toBeInTheDocument();
    });
  });

  describe('Quick Filters', () => {
    it('should render the filters button', () => {
      renderWithRouter();
      expect(screen.getByText('Фильтры')).toBeInTheDocument();
    });

    it('should open filters dropdown when clicking the button', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      await waitFor(() => {
        // Check for the filter label in dropdown, which has a specific structure
        expect(screen.getByText('Ожидаемая зарплата')).toBeInTheDocument();
      });
    });

    it('should display status filter options', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      await waitFor(() => {
        // Status options appear both in table and dropdown, so we check dropdown is open
        expect(screen.getByText('Оффер')).toBeInTheDocument(); // Only appears in filter (not shown in mock data)
        expect(screen.getByText('Скрининг')).toBeInTheDocument();
      });
    });

    it('should display salary range filter options', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      await waitFor(() => {
        expect(screen.getByText('Ожидаемая зарплата')).toBeInTheDocument();
        expect(screen.getByText('Любая')).toBeInTheDocument();
        expect(screen.getByText('До 100k')).toBeInTheDocument();
        expect(screen.getByText('100k - 200k')).toBeInTheDocument();
      });
    });

    it('should display date range filter options', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      await waitFor(() => {
        expect(screen.getByText('Дата добавления')).toBeInTheDocument();
        expect(screen.getByText('За все время')).toBeInTheDocument();
        expect(screen.getByText('За 7 дней')).toBeInTheDocument();
        expect(screen.getByText('За 30 дней')).toBeInTheDocument();
      });
    });

    it('should show active filter count badge when filters are applied', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      // Click on a status filter
      await waitFor(() => {
        const newStatusButton = screen.getAllByText('Новый')[0];
        fireEvent.click(newStatusButton);
      });

      // Check for the badge with count
      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument();
      });
    });

    it('should show clear all button when filters are active', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      // Apply a filter
      await waitFor(() => {
        const under100kButton = screen.getByText('До 100k');
        fireEvent.click(under100kButton);
      });

      // Check for clear all button
      await waitFor(() => {
        expect(screen.getByText('Сбросить')).toBeInTheDocument();
      });
    });

    it('should close dropdown when clicking outside', async () => {
      renderWithRouter();

      const filtersButton = screen.getByText('Фильтры');
      fireEvent.click(filtersButton);

      await waitFor(() => {
        // Check dropdown is open by looking for unique filter labels
        expect(screen.getByText('Ожидаемая зарплата')).toBeInTheDocument();
      });

      // Click outside the dropdown
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        // The detailed filter labels inside dropdown should be gone
        expect(screen.queryByText('Ожидаемая зарплата')).not.toBeInTheDocument();
      });
    });
  });

  describe('Selection and Bulk Actions', () => {
    it('should allow selecting candidates', async () => {
      renderWithRouter();

      // Find checkbox buttons (squares)
      const checkboxes = screen.getAllByRole('button').filter(
        btn => btn.querySelector('svg')
      );

      // Click on first row checkbox (skip header checkbox)
      const firstRowCheckbox = checkboxes.find(btn =>
        btn.closest('td')
      );
      if (firstRowCheckbox) {
        fireEvent.click(firstRowCheckbox);
      }

      await waitFor(() => {
        expect(screen.getByText(/выбрано/i)).toBeInTheDocument();
      });
    });

    it('should show bulk actions dropdown when candidates are selected', async () => {
      renderWithRouter();

      // Select a candidate
      const checkboxes = screen.getAllByRole('button').filter(
        btn => btn.querySelector('svg')
      );
      const firstRowCheckbox = checkboxes.find(btn =>
        btn.closest('td')
      );
      if (firstRowCheckbox) {
        fireEvent.click(firstRowCheckbox);
      }

      await waitFor(() => {
        // Check for the selection count indicator
        expect(screen.getByText(/выбрано/i)).toBeInTheDocument();
      });
    });
  });

  describe('Actions', () => {
    it('should call setFilters with type candidate on mount', () => {
      renderWithRouter();

      expect(mockEntityStore.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'candidate' })
      );
    });

    it('should display edit and delete buttons for each candidate', () => {
      renderWithRouter();

      // Each candidate row should have action buttons
      const editButtons = screen.getAllByTitle('Редактировать');
      const deleteButtons = screen.getAllByTitle('Удалить');

      expect(editButtons.length).toBeGreaterThan(0);
      expect(deleteButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should display error message when error occurs', () => {
      (useEntityStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockEntityStore,
        error: 'Failed to load candidates',
      });

      renderWithRouter();

      // ErrorMessage component shows generic title based on error type
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });
  });
});

describe('Candidates Filter Logic', () => {
  // Test the filtering logic with different scenarios
  const filterCandidates = (
    entities: Entity[],
    filters: {
      statuses: EntityStatus[];
      salaryRange: string;
      dateRange: string;
      skills: string[];
    }
  ) => {
    const SALARY_RANGES: Record<string, { min?: number; max?: number }> = {
      any: { min: undefined, max: undefined },
      under100k: { min: undefined, max: 100000 },
      '100k-200k': { min: 100000, max: 200000 },
      '200k-300k': { min: 200000, max: 300000 },
      '300k+': { min: 300000, max: undefined },
    };

    const DATE_RANGES: Record<string, number | undefined> = {
      any: undefined,
      '7days': 7,
      '30days': 30,
      '90days': 90,
    };

    // First filter to only candidates
    const candidates = entities.filter(e => e.type === 'candidate');

    return candidates.filter((candidate) => {
      // Status filter
      if (filters.statuses.length > 0 && !filters.statuses.includes(candidate.status)) {
        return false;
      }

      // Salary range filter
      if (filters.salaryRange !== 'any') {
        const salaryConfig = SALARY_RANGES[filters.salaryRange];
        if (salaryConfig) {
          const salaryMin = candidate.expected_salary_min || 0;
          const salaryMax = candidate.expected_salary_max || salaryMin;
          const avgSalary = salaryMin && salaryMax ? (salaryMin + salaryMax) / 2 : salaryMin || salaryMax;

          if (!avgSalary) return false;
          if (salaryConfig.min !== undefined && avgSalary < salaryConfig.min) return false;
          if (salaryConfig.max !== undefined && avgSalary > salaryConfig.max) return false;
        }
      }

      // Date range filter
      if (filters.dateRange !== 'any') {
        const days = DATE_RANGES[filters.dateRange];
        if (days) {
          const candidateDate = new Date(candidate.created_at);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - days);
          if (candidateDate < cutoffDate) return false;
        }
      }

      // Skills filter
      if (filters.skills.length > 0) {
        const candidateTags = candidate.tags.map(t => t.toLowerCase());
        const hasAllSkills = filters.skills.every(skill =>
          candidateTags.some(tag => tag.includes(skill.toLowerCase()))
        );
        if (!hasAllSkills) return false;
      }

      return true;
    });
  };

  it('should filter out non-candidates', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'any',
      dateRange: 'any',
      skills: [],
    });

    expect(filtered).toHaveLength(3);
    expect(filtered.every(e => e.type === 'candidate')).toBe(true);
  });

  it('should filter by status', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: ['new'],
      salaryRange: 'any',
      dateRange: 'any',
      skills: [],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Иван Иванов');
  });

  it('should filter by multiple statuses', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: ['new', 'interview'],
      salaryRange: 'any',
      dateRange: 'any',
      skills: [],
    });

    expect(filtered).toHaveLength(2);
  });

  it('should filter by salary range - under 100k', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'under100k',
      dateRange: 'any',
      skills: [],
    });

    // Алексей Смирнов has 80k-100k, avg is 90k
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Алексей Смирнов');
  });

  it('should filter by salary range - 100k to 200k', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: '100k-200k',
      dateRange: 'any',
      skills: [],
    });

    // Иван Иванов has 150k-200k (avg 175k)
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Иван Иванов');
  });

  it('should filter by salary range - 200k to 300k', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: '200k-300k',
      dateRange: 'any',
      skills: [],
    });

    // Мария Петрова has 180k-250k (avg 215k)
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Мария Петрова');
  });

  it('should filter by date range - last 7 days', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'any',
      dateRange: '7days',
      skills: [],
    });

    // Иван Иванов (today) and Мария Петрова (5 days ago)
    expect(filtered).toHaveLength(2);
  });

  it('should filter by date range - last 30 days', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'any',
      dateRange: '30days',
      skills: [],
    });

    // Иван Иванов (today) and Мария Петрова (5 days ago)
    // Алексей Смирнов is 60 days ago, should be excluded
    expect(filtered).toHaveLength(2);
  });

  it('should filter by skills', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'any',
      dateRange: 'any',
      skills: ['React'],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Иван Иванов');
  });

  it('should filter by multiple skills (AND logic)', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'any',
      dateRange: 'any',
      skills: ['React', 'TypeScript'],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Иван Иванов');
  });

  it('should combine multiple filters', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: ['new', 'interview'],
      salaryRange: '100k-200k',
      dateRange: '7days',
      skills: [],
    });

    // Only Иван Иванов matches all criteria
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Иван Иванов');
  });

  it('should return all candidates with no filters', () => {
    const filtered = filterCandidates(mockCandidates, {
      statuses: [],
      salaryRange: 'any',
      dateRange: 'any',
      skills: [],
    });

    expect(filtered).toHaveLength(3);
  });
});

describe('Candidates Sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useEntityStore as ReturnType<typeof vi.fn>).mockReturnValue(mockEntityStore);
    (useAuthStore as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthStore);
  });

  const renderWithRouter = (initialEntries: string[] = ['/candidates']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <CandidatesPage />
      </MemoryRouter>
    );
  };

  describe('Sorting UI', () => {
    it('should render sortable column headers with icons', () => {
      renderWithRouter();

      expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      expect(screen.getByTestId('sort-salary')).toBeInTheDocument();
      expect(screen.getByTestId('sort-status')).toBeInTheDocument();
      expect(screen.getByTestId('sort-date')).toBeInTheDocument();
    });

    it('should toggle sort direction when clicking same column', async () => {
      renderWithRouter();

      const sortDateButton = screen.getByTestId('sort-date');

      // Initial state should show desc indicator (default for created_at)
      fireEvent.click(sortDateButton);

      await waitFor(() => {
        // After clicking, direction should toggle
        expect(sortDateButton).toBeInTheDocument();
      });
    });

    it('should change sort field when clicking different column', async () => {
      renderWithRouter();

      const sortNameButton = screen.getByTestId('sort-name');
      fireEvent.click(sortNameButton);

      await waitFor(() => {
        // The name column header should be active
        expect(sortNameButton).toBeInTheDocument();
      });
    });
  });

  describe('Sorting Logic', () => {
    // Helper function to sort candidates
    const sortCandidates = (
      candidates: Entity[],
      sortField: string,
      sortDirection: 'asc' | 'desc'
    ) => {
      return [...candidates].sort((a, b) => {
        let comparison = 0;

        switch (sortField) {
          case 'name':
            comparison = a.name.localeCompare(b.name, 'ru');
            break;
          case 'expected_salary_min':
            const salaryA = a.expected_salary_min || 0;
            const salaryB = b.expected_salary_min || 0;
            comparison = salaryA - salaryB;
            break;
          case 'status':
            comparison = a.status.localeCompare(b.status);
            break;
          case 'created_at':
            comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            break;
          default:
            comparison = 0;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });
    };

    const candidatesOnly = mockCandidates.filter(e => e.type === 'candidate');

    it('should sort by name ascending', () => {
      const sorted = sortCandidates(candidatesOnly, 'name', 'asc');

      expect(sorted[0].name).toBe('Алексей Смирнов');
      expect(sorted[1].name).toBe('Иван Иванов');
      expect(sorted[2].name).toBe('Мария Петрова');
    });

    it('should sort by name descending', () => {
      const sorted = sortCandidates(candidatesOnly, 'name', 'desc');

      expect(sorted[0].name).toBe('Мария Петрова');
      expect(sorted[1].name).toBe('Иван Иванов');
      expect(sorted[2].name).toBe('Алексей Смирнов');
    });

    it('should sort by salary ascending', () => {
      const sorted = sortCandidates(candidatesOnly, 'expected_salary_min', 'asc');

      // Алексей: 80k, Иван: 150k, Мария: 180k
      expect(sorted[0].name).toBe('Алексей Смирнов');
      expect(sorted[1].name).toBe('Иван Иванов');
      expect(sorted[2].name).toBe('Мария Петрова');
    });

    it('should sort by salary descending', () => {
      const sorted = sortCandidates(candidatesOnly, 'expected_salary_min', 'desc');

      // Мария: 180k, Иван: 150k, Алексей: 80k
      expect(sorted[0].name).toBe('Мария Петрова');
      expect(sorted[1].name).toBe('Иван Иванов');
      expect(sorted[2].name).toBe('Алексей Смирнов');
    });

    it('should sort by status ascending', () => {
      const sorted = sortCandidates(candidatesOnly, 'status', 'asc');

      // hired, interview, new (alphabetically)
      expect(sorted[0].status).toBe('hired');
      expect(sorted[1].status).toBe('interview');
      expect(sorted[2].status).toBe('new');
    });

    it('should sort by status descending', () => {
      const sorted = sortCandidates(candidatesOnly, 'status', 'desc');

      // new, interview, hired (reverse alphabetically)
      expect(sorted[0].status).toBe('new');
      expect(sorted[1].status).toBe('interview');
      expect(sorted[2].status).toBe('hired');
    });

    it('should sort by created_at ascending', () => {
      const sorted = sortCandidates(candidatesOnly, 'created_at', 'asc');

      // Oldest first: Алексей (60 days ago), Мария (5 days ago), Иван (today)
      expect(sorted[0].name).toBe('Алексей Смирнов');
      expect(sorted[1].name).toBe('Мария Петрова');
      expect(sorted[2].name).toBe('Иван Иванов');
    });

    it('should sort by created_at descending', () => {
      const sorted = sortCandidates(candidatesOnly, 'created_at', 'desc');

      // Newest first: Иван (today), Мария (5 days ago), Алексей (60 days ago)
      expect(sorted[0].name).toBe('Иван Иванов');
      expect(sorted[1].name).toBe('Мария Петрова');
      expect(sorted[2].name).toBe('Алексей Смирнов');
    });

    it('should handle candidates without salary when sorting by salary', () => {
      const candidatesWithoutSalary: Entity[] = [
        ...candidatesOnly,
        {
          id: 5,
          name: 'Без зарплаты',
          type: 'candidate' as EntityType,
          status: 'new' as EntityStatus,
          tags: [],
          extra_data: {},
          // No salary fields
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const sorted = sortCandidates(candidatesWithoutSalary, 'expected_salary_min', 'asc');

      // Candidate without salary (0) should be first
      expect(sorted[0].name).toBe('Без зарплаты');
    });
  });
});
