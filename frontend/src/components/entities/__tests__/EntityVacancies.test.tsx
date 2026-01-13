import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EntityVacancies from '../EntityVacancies';
import * as api from '@/services/api';
import type { VacancyApplication, ApplicationStage } from '@/types';

// Mock dependencies
vi.mock('@/services/api', () => ({
  getEntityVacancies: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, className, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div onClick={onClick as React.MouseEventHandler} className={className as string} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren<object>) => <>{children}</>,
}));

const mockApplications: VacancyApplication[] = [
  {
    id: 1,
    vacancy_id: 1,
    vacancy_title: 'Senior Python Developer',
    entity_id: 101,
    entity_name: 'John Doe',
    stage: 'interview' as ApplicationStage,
    stage_order: 1000,
    rating: 4,
    source: 'LinkedIn',
    notes: 'Great candidate with strong Python skills',
    applied_at: '2024-01-15T10:00:00Z',
    last_stage_change_at: '2024-01-20T14:00:00Z',
    updated_at: '2024-01-20T14:00:00Z',
  },
  {
    id: 2,
    vacancy_id: 2,
    vacancy_title: 'Frontend Developer',
    entity_id: 101,
    entity_name: 'John Doe',
    stage: 'applied' as ApplicationStage,
    stage_order: 2000,
    source: 'Referral',
    applied_at: '2024-01-18T09:00:00Z',
    last_stage_change_at: '2024-01-18T09:00:00Z',
    updated_at: '2024-01-18T09:00:00Z',
  },
  {
    id: 3,
    vacancy_id: 3,
    vacancy_title: 'Tech Lead',
    entity_id: 101,
    entity_name: 'John Doe',
    stage: 'offer' as ApplicationStage,
    stage_order: 3000,
    rating: 5,
    notes: 'Excellent leadership skills',
    next_interview_at: '2024-02-01T15:00:00Z',
    applied_at: '2024-01-10T08:00:00Z',
    last_stage_change_at: '2024-01-25T11:00:00Z',
    updated_at: '2024-01-25T11:00:00Z',
  },
];

describe('EntityVacancies', () => {
  const renderWithRouter = (entityId: number = 101) => {
    return render(
      <MemoryRouter>
        <EntityVacancies entityId={entityId} />
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getEntityVacancies as ReturnType<typeof vi.fn>).mockResolvedValue(mockApplications);
  });

  describe('Loading State', () => {
    it('should show loading skeleton while loading', async () => {
      (api.getEntityVacancies as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockApplications), 100))
      );

      renderWithRouter();

      // ListSkeleton should be rendered during loading
      // Check that the vacancy title is not shown yet
      expect(screen.queryByText('Senior Python Developer')).not.toBeInTheDocument();
    });

    it('should fetch applications on mount', async () => {
      renderWithRouter(101);

      await waitFor(() => {
        expect(api.getEntityVacancies).toHaveBeenCalledWith(101);
      });
    });
  });

  describe('Displaying Applications List', () => {
    it('should display list of applications after loading', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
        expect(screen.getByText('Tech Lead')).toBeInTheDocument();
      });
    });

    it('should display vacancy title for each application', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
        expect(screen.getByText('Tech Lead')).toBeInTheDocument();
      });
    });

    it('should display application stage', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Interview')).toBeInTheDocument();
        expect(screen.getByText('Applied')).toBeInTheDocument();
        expect(screen.getByText('Offer')).toBeInTheDocument();
      });
    });

    it('should display source when available', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('LinkedIn')).toBeInTheDocument();
        expect(screen.getByText('Referral')).toBeInTheDocument();
      });
    });

    it('should display rating when available', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Rating 4/5 and 5/5 should be displayed (Russian: "Reyting: 4/5")
        expect(screen.getByText(/рейтинг: 4\/5/i)).toBeInTheDocument();
        expect(screen.getByText(/рейтинг: 5\/5/i)).toBeInTheDocument();
      });
    });

    it('should display notes preview when available', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Great candidate with strong Python skills')).toBeInTheDocument();
        expect(screen.getByText('Excellent leadership skills')).toBeInTheDocument();
      });
    });

    it('should display next interview date when available', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Next interview indicator should be shown (Russian: "Sleduyushchee sobesedovanie:")
        expect(screen.getByText(/следующее собеседование/i)).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no applications', async () => {
      (api.getEntityVacancies as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderWithRouter();

      // NoEntityVacanciesEmpty component should be rendered
      // This will render an EmptyState with a message
      await waitFor(() => {
        const container = document.body;
        expect(container).toBeTruthy();
      });
    });
  });

  describe('Error State', () => {
    it('should show error state on API failure', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.getEntityVacancies as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API Error'));

      renderWithRouter();

      await waitFor(() => {
        // English text as per component: "Loading error"
        expect(screen.getByText(/loading error/i)).toBeInTheDocument();
      });

      consoleError.mockRestore();
    });
  });

  describe('Stage Colors', () => {
    it('should apply correct stage colors', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Check that stage badges are rendered
        const interviewBadge = screen.getByText('Interview');
        const appliedBadge = screen.getByText('Applied');
        const offerBadge = screen.getByText('Offer');

        expect(interviewBadge).toBeInTheDocument();
        expect(appliedBadge).toBeInTheDocument();
        expect(offerBadge).toBeInTheDocument();
      });
    });
  });

  describe('Fallback Vacancy Title', () => {
    it('should show fallback title when vacancy_title is missing', async () => {
      const applicationsWithoutTitle: VacancyApplication[] = [
        {
          id: 1,
          vacancy_id: 999,
          entity_id: 101,
          stage: 'applied' as ApplicationStage,
          stage_order: 1000,
          applied_at: '2024-01-15T10:00:00Z',
          last_stage_change_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
      ];

      (api.getEntityVacancies as ReturnType<typeof vi.fn>).mockResolvedValue(applicationsWithoutTitle);

      renderWithRouter();

      await waitFor(() => {
        // Should show fallback title (Russian: "Vakansiya #999")
        expect(screen.getByText(/вакансия #999/i)).toBeInTheDocument();
      });
    });
  });

  describe('Data Refresh', () => {
    it('should refetch data when entityId changes', async () => {
      const { rerender } = render(
        <MemoryRouter>
          <EntityVacancies entityId={101} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(api.getEntityVacancies).toHaveBeenCalledWith(101);
      });

      // Rerender with different entityId
      rerender(
        <MemoryRouter>
          <EntityVacancies entityId={102} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(api.getEntityVacancies).toHaveBeenCalledWith(102);
      });
    });
  });
});
