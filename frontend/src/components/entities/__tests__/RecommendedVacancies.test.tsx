import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecommendedVacancies from '../RecommendedVacancies';
import * as api from '@/services/api';

/**
 * Tests for RecommendedVacancies component
 * Verifies AI-recommended vacancies display and apply functionality
 */

// Mock API
vi.mock('@/services/api', () => ({
  getRecommendedVacancies: vi.fn(),
  autoApplyToVacancy: vi.fn(),
}));

// Mock react-router-dom navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockRecommendations = [
  {
    vacancy_id: 1,
    vacancy_title: 'Senior Python Developer',
    match_score: 92,
    match_reasons: ['Strong Python skills', '5+ years experience', 'Django expertise'],
    missing_requirements: ['AWS certification'],
    salary_compatible: true,
    salary_min: 200000,
    salary_max: 300000,
    salary_currency: 'RUB',
    location: 'Moscow',
    applications_count: 15,
    employment_type: 'Full-time',
    experience_level: 'Senior',
    department_name: 'Backend Team',
  },
  {
    vacancy_id: 2,
    vacancy_title: 'Backend Developer',
    match_score: 78,
    match_reasons: ['Python experience', 'Database knowledge'],
    missing_requirements: ['Leadership experience', 'System design'],
    salary_compatible: false,
    salary_min: 150000,
    salary_max: 200000,
    salary_currency: 'RUB',
    location: 'Remote',
    applications_count: 8,
    employment_type: 'Remote',
    experience_level: 'Middle',
  },
  {
    vacancy_id: 3,
    vacancy_title: 'Python Developer',
    match_score: 65,
    match_reasons: ['Python skills'],
    missing_requirements: ['Django', 'PostgreSQL', 'REST API design'],
    salary_compatible: true,
    salary_min: 100000,
    salary_max: 150000,
    salary_currency: 'RUB',
    location: 'Saint Petersburg',
    applications_count: 25,
  },
];

describe('RecommendedVacancies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getRecommendedVacancies as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecommendations);
    (api.autoApplyToVacancy as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  });

  const renderWithRouter = (props = {}) => {
    return render(
      <MemoryRouter>
        <RecommendedVacancies entityId={1} {...props} />
      </MemoryRouter>
    );
  };

  describe('Loading State', () => {
    it('should show loading state initially', () => {
      (api.getRecommendedVacancies as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolve
      );

      renderWithRouter();

      expect(screen.getByText(/Подбираем подходящие вакансии/i)).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no recommendations', async () => {
      (api.getRecommendedVacancies as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Подходящих вакансий не найдено/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      (api.getRecommendedVacancies as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error')
      );

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Не удалось загрузить рекомендации/i)).toBeInTheDocument();
      });
    });

    it('should show retry button on error', async () => {
      (api.getRecommendedVacancies as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error')
      );

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Повторить/i)).toBeInTheDocument();
      });
    });

    it('should retry fetch when retry button is clicked', async () => {
      (api.getRecommendedVacancies as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(mockRecommendations);

      renderWithRouter();

      await waitFor(() => {
        const retryButton = screen.getByText(/Повторить/i);
        fireEvent.click(retryButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });
    });
  });

  describe('Recommendations Display', () => {
    it('should display all recommendations', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
        expect(screen.getByText('Backend Developer')).toBeInTheDocument();
        expect(screen.getByText('Python Developer')).toBeInTheDocument();
      });
    });

    it('should display match scores', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('92')).toBeInTheDocument();
        expect(screen.getByText('78')).toBeInTheDocument();
        expect(screen.getByText('65')).toBeInTheDocument();
      });
    });

    it('should display count of recommendations', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Найдено 3 подходящих вакансий/i)).toBeInTheDocument();
      });
    });

    it('should display score label based on score value', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Отличное совпадение')).toBeInTheDocument();
        expect(screen.getByText('Хорошее совпадение')).toBeInTheDocument();
      });
    });
  });

  describe('Score Colors', () => {
    it('should show green for high scores (>=80)', async () => {
      renderWithRouter();

      await waitFor(() => {
        const scoreElement = screen.getByText('92').closest('div');
        expect(scoreElement?.className).toContain('green');
      });
    });

    it('should show yellow for medium scores (60-79)', async () => {
      renderWithRouter();

      await waitFor(() => {
        const scoreElement = screen.getByText('78').closest('div');
        expect(scoreElement?.className).toContain('yellow');
      });
    });

    it('should show orange for lower scores (40-59)', async () => {
      renderWithRouter();

      await waitFor(() => {
        const scoreElement = screen.getByText('65').closest('div');
        expect(scoreElement?.className).toContain('orange');
      });
    });
  });

  describe('Vacancy Details', () => {
    it('should display salary information', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Click to expand first card
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      // Salary info should be visible
      await waitFor(() => {
        expect(screen.getByText(/200.*300/)).toBeInTheDocument();
      });
    });

    it('should display location', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Moscow')).toBeInTheDocument();
      });
    });

    it('should display applications count', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/15 откликов/)).toBeInTheDocument();
      });
    });

    it('should show salary compatibility badge', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Compatible salary should show green check
        const compatibleBadge = screen.getAllByText('Зарплата')[0];
        expect(compatibleBadge.className).toContain('green');
      });
    });
  });

  describe('Expand/Collapse', () => {
    it('should expand card details when clicked', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        expect(screen.getByText(/Почему подходит/i)).toBeInTheDocument();
        expect(screen.getByText('Strong Python skills')).toBeInTheDocument();
      });
    });

    it('should show match reasons when expanded', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        expect(screen.getByText('Strong Python skills')).toBeInTheDocument();
        expect(screen.getByText('5+ years experience')).toBeInTheDocument();
      });
    });

    it('should show missing requirements when expanded', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        expect(screen.getByText(/Чего не хватает/i)).toBeInTheDocument();
        expect(screen.getByText('AWS certification')).toBeInTheDocument();
      });
    });

    it('should collapse when clicked again', async () => {
      renderWithRouter();

      // Open
      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      // Close
      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        expect(screen.queryByText(/Почему подходит/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Apply Functionality', () => {
    it('should show apply button when expanded', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        expect(screen.getByText(/Предложить вакансию/i)).toBeInTheDocument();
      });
    });

    it('should call autoApplyToVacancy when apply is clicked', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        const applyButton = screen.getByText(/Предложить вакансию/i);
        fireEvent.click(applyButton);
      });

      await waitFor(() => {
        expect(api.autoApplyToVacancy).toHaveBeenCalledWith(1, 1);
      });
    });

    it('should show loading state while applying', async () => {
      (api.autoApplyToVacancy as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        const applyButton = screen.getByText(/Предложить вакансию/i);
        fireEvent.click(applyButton);
      });

      expect(screen.getByText(/Отправляем/i)).toBeInTheDocument();
    });

    it('should show success state after applying', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        const applyButton = screen.getByText(/Предложить вакансию/i);
        fireEvent.click(applyButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Заявка отправлена/i)).toBeInTheDocument();
      });
    });

    it('should call onApply callback after successful application', async () => {
      const onApply = vi.fn();
      renderWithRouter({ onApply });

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        const applyButton = screen.getByText(/Предложить вакансию/i);
        fireEvent.click(applyButton);
      });

      await waitFor(() => {
        expect(onApply).toHaveBeenCalledWith(1);
      });
    });
  });

  describe('Navigation', () => {
    it('should show open vacancy button when expanded', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        expect(screen.getByText('Открыть')).toBeInTheDocument();
      });
    });

    it('should navigate to vacancy page when open button is clicked', async () => {
      renderWithRouter();

      await waitFor(() => {
        const card = screen.getByText('Senior Python Developer').closest('[class*="cursor-pointer"]');
        if (card) {
          fireEvent.click(card);
        }
      });

      await waitFor(() => {
        const openButton = screen.getByText('Открыть');
        fireEvent.click(openButton);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/vacancies/1');
    });
  });

  describe('Props', () => {
    it('should fetch recommendations with correct entityId', async () => {
      renderWithRouter({ entityId: 42 });

      await waitFor(() => {
        expect(api.getRecommendedVacancies).toHaveBeenCalledWith(42, 10);
      });
    });

    it('should refetch when entityId changes', async () => {
      const { rerender } = renderWithRouter({ entityId: 1 });

      await waitFor(() => {
        expect(api.getRecommendedVacancies).toHaveBeenCalledWith(1, 10);
      });

      rerender(
        <MemoryRouter>
          <RecommendedVacancies entityId={2} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(api.getRecommendedVacancies).toHaveBeenCalledWith(2, 10);
      });
    });
  });
});
