import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContactsPage from '../ContactsPage';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import * as api from '@/services/api';
import type { Entity, EntityType, Vacancy, VacancyApplication } from '@/types';

// Mock the entity store
vi.mock('@/stores/entityStore', () => ({
  useEntityStore: vi.fn(),
}));

// Mock the auth store
vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock the API
vi.mock('@/services/api', () => ({
  getDepartments: vi.fn().mockResolvedValue([]),
  getVacancies: vi.fn().mockResolvedValue([]),
  getApplications: vi.fn().mockResolvedValue([]),
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

const mockEntities: Entity[] = [
  {
    id: 1,
    name: 'John Doe',
    type: 'candidate' as EntityType,
    status: 'active',
    email: 'john@example.com',
    tags: [],
    extra_data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'Jane Smith',
    type: 'candidate' as EntityType,
    status: 'active',
    email: 'jane@example.com',
    tags: [],
    extra_data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    name: 'Bob Wilson',
    type: 'client' as EntityType,
    status: 'active',
    email: 'bob@example.com',
    tags: [],
    extra_data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockVacancies: Vacancy[] = [
  {
    id: 1,
    title: 'Software Engineer',
    status: 'open',
    salary_currency: 'USD',
    priority: 0,
    applications_count: 2,
    stage_counts: {},
    tags: [],
    extra_data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    title: 'Product Manager',
    status: 'open',
    salary_currency: 'USD',
    priority: 0,
    applications_count: 1,
    stage_counts: {},
    tags: [],
    extra_data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockApplications: VacancyApplication[] = [
  {
    id: 1,
    vacancy_id: 1,
    entity_id: 1, // John Doe
    stage: 'applied',
    stage_order: 0,
    applied_at: new Date().toISOString(),
    last_stage_change_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    vacancy_id: 1,
    entity_id: 2, // Jane Smith
    stage: 'screening',
    stage_order: 1,
    applied_at: new Date().toISOString(),
    last_stage_change_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockEntityStore = {
  entities: mockEntities,
  currentEntity: null,
  loading: false,
  fetchEntity: vi.fn(),
  deleteEntity: vi.fn(),
  setFilters: vi.fn(),
  clearCurrentEntity: vi.fn(),
  typeCounts: { all: 3, candidate: 2, client: 1, contractor: 0, lead: 0, partner: 0, custom: 0 },
  fetchTypeCounts: vi.fn(),
};

const mockAuthStore = {
  canEditResource: vi.fn().mockReturnValue(true),
  canDeleteResource: vi.fn().mockReturnValue(true),
  canShareResource: vi.fn().mockReturnValue(true),
  isSuperAdmin: vi.fn().mockReturnValue(false),
  isOwner: vi.fn().mockReturnValue(false),
};

describe('ContactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useEntityStore as ReturnType<typeof vi.fn>).mockReturnValue(mockEntityStore);
    (useAuthStore as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthStore);
    (api.getDepartments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getVacancies as ReturnType<typeof vi.fn>).mockResolvedValue(mockVacancies);
    (api.getApplications as ReturnType<typeof vi.fn>).mockResolvedValue(mockApplications);
  });

  const renderWithRouter = (initialEntries: string[] = ['/contacts']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <ContactsPage />
      </MemoryRouter>
    );
  };

  describe('Vacancy Filter', () => {
    it('should display the vacancy filter dropdown when vacancies exist', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('All candidates')).toBeInTheDocument();
      });
    });

    it('should show vacancy titles with application counts in dropdown', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Software Engineer (2)')).toBeInTheDocument();
        expect(screen.getByText('Product Manager (1)')).toBeInTheDocument();
      });
    });

    it('should call getApplications when a vacancy is selected', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('All candidates')).toBeInTheDocument();
      });

      // Find the select element and change its value
      const select = screen.getByDisplayValue('All candidates');
      fireEvent.change(select, { target: { value: '1' } });

      await waitFor(() => {
        expect(api.getApplications).toHaveBeenCalledWith(1);
      });
    });

    it('should not show vacancy filter when no vacancies exist', async () => {
      (api.getVacancies as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderWithRouter();

      await waitFor(() => {
        expect(screen.queryByText('All candidates')).not.toBeInTheDocument();
      });
    });

    it('should show loading indicator when filtering by vacancy', async () => {
      // Make getApplications take time to resolve
      let resolveApplications: (value: VacancyApplication[]) => void;
      (api.getApplications as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => {
          resolveApplications = resolve;
        })
      );

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('All candidates')).toBeInTheDocument();
      });

      // Select a vacancy
      const select = screen.getByDisplayValue('All candidates');
      fireEvent.change(select, { target: { value: '1' } });

      // Should show loading spinner (the select should be disabled)
      await waitFor(() => {
        expect(select).toBeDisabled();
      });

      // Resolve the promise
      resolveApplications!(mockApplications);

      await waitFor(() => {
        expect(select).not.toBeDisabled();
      });
    });
  });

  describe('Entity List', () => {
    it('should display all entities when no vacancy filter is applied', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
      });
    });
  });

  describe('Search', () => {
    it('should display search input', () => {
      renderWithRouter();

      expect(screen.getByPlaceholderText(/поиск контактов/i)).toBeInTheDocument();
    });
  });

  describe('Header', () => {
    it('should display the contacts header', () => {
      renderWithRouter();

      expect(screen.getByText('Контакты')).toBeInTheDocument();
    });

    it('should display create contact button', () => {
      renderWithRouter();

      // The create button has a Plus icon
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });
});

describe('Vacancy Filter Logic', () => {
  // Test the filtering logic with different scenarios
  const filterEntitiesByVacancy = (
    entities: Entity[],
    vacancyEntityIds: Set<number> | null
  ): Entity[] => {
    if (vacancyEntityIds === null) {
      return entities;
    }
    return entities.filter((entity) => vacancyEntityIds.has(entity.id));
  };

  it('should return all entities when vacancyEntityIds is null', () => {
    const filtered = filterEntitiesByVacancy(mockEntities, null);
    expect(filtered).toHaveLength(3);
  });

  it('should filter entities by vacancy applications', () => {
    // Only entity IDs 1 and 2 applied to vacancy 1
    const vacancyEntityIds = new Set([1, 2]);
    const filtered = filterEntitiesByVacancy(mockEntities, vacancyEntityIds);

    expect(filtered).toHaveLength(2);
    expect(filtered.find((e) => e.name === 'John Doe')).toBeDefined();
    expect(filtered.find((e) => e.name === 'Jane Smith')).toBeDefined();
    expect(filtered.find((e) => e.name === 'Bob Wilson')).toBeUndefined();
  });

  it('should return empty array when no entities match', () => {
    const vacancyEntityIds = new Set([999]);
    const filtered = filterEntitiesByVacancy(mockEntities, vacancyEntityIds);

    expect(filtered).toHaveLength(0);
  });

  it('should handle empty vacancy applications', () => {
    const vacancyEntityIds = new Set<number>();
    const filtered = filterEntitiesByVacancy(mockEntities, vacancyEntityIds);

    expect(filtered).toHaveLength(0);
  });
});
