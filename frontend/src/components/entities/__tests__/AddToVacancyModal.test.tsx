import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddToVacancyModal from '../AddToVacancyModal';
import * as api from '@/services/api';
import type { Vacancy } from '@/types';

// Mock dependencies
vi.mock('@/services/api', () => ({
  getVacancies: vi.fn(),
  applyEntityToVacancy: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

const mockVacancies: Vacancy[] = [
  {
    id: 1,
    title: 'Senior Python Developer',
    description: 'Backend development',
    status: 'open',
    salary_min: 150000,
    salary_max: 250000,
    salary_currency: 'RUB',
    location: 'Moscow',
    employment_type: 'full-time',
    experience_level: 'senior',
    priority: 1,
    tags: ['python', 'fastapi'],
    extra_data: {},
    applications_count: 5,
    stage_counts: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    department_name: 'Engineering',
  },
  {
    id: 2,
    title: 'Frontend Developer',
    description: 'React development',
    status: 'open',
    salary_min: 100000,
    salary_max: 180000,
    salary_currency: 'RUB',
    location: 'Remote',
    employment_type: 'full-time',
    experience_level: 'middle',
    priority: 2,
    tags: ['react', 'typescript'],
    extra_data: {},
    applications_count: 3,
    stage_counts: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe('AddToVacancyModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const defaultProps = {
    entityId: 1,
    entityName: 'John Doe',
    onClose: mockOnClose,
    onSuccess: mockOnSuccess,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getVacancies as ReturnType<typeof vi.fn>).mockResolvedValue(mockVacancies);
  });

  describe('Modal Open/Close', () => {
    it('should render modal with header', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      // Russian text: "Dobavit' v vakansiyu" (Add to vacancy)
      expect(screen.getByText(/добавить в вакансию/i)).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('should close modal when Cancel button is clicked', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      // Russian text: "Otmena" (Cancel)
      const cancelButton = screen.getByText(/отмена/i);
      await userEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Vacancy Loading', () => {
    it('should load vacancies on mount', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(api.getVacancies).toHaveBeenCalledWith({
          status: 'open',
          search: undefined,
        });
      });
    });

    it('should display loading spinner while loading', async () => {
      // Delay the response to show loading state
      let resolvePromise: (value: Vacancy[]) => void;
      (api.getVacancies as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => { resolvePromise = resolve; })
      );

      const { container } = render(<AddToVacancyModal {...defaultProps} />);

      // Check for spinner (animate-spin class)
      await waitFor(() => {
        const spinner = container.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });

      // Cleanup: resolve the promise to prevent test leakage
      resolvePromise!(mockVacancies);
    });

    it('should display vacancies after loading', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
      });
    });

    it('should display vacancy location', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Moscow')).toBeInTheDocument();
      });
    });

    it('should display department name when available', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Engineering')).toBeInTheDocument();
      });
    });

    it('should display applications count', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        // Russian text: "5 kandidatov" (5 candidates)
        expect(screen.getByText(/5 кандидатов/i)).toBeInTheDocument();
      });
    });
  });

  describe('Vacancy Selection', () => {
    it('should allow selecting a vacancy', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      const vacancyButton = screen.getByText('Senior Python Developer').closest('button');
      if (vacancyButton) {
        await userEvent.click(vacancyButton);

        // Check that vacancy is selected (has border-blue-500 class)
        expect(vacancyButton.className).toContain('border-blue-500');
      }
    });

    it('should allow changing selected vacancy', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      // Select first vacancy
      const firstVacancy = screen.getByText('Senior Python Developer').closest('button');
      if (firstVacancy) {
        await userEvent.click(firstVacancy);
        expect(firstVacancy.className).toContain('border-blue-500');
      }

      // Select second vacancy
      const secondVacancy = screen.getByText('Frontend Developer').closest('button');
      if (secondVacancy) {
        await userEvent.click(secondVacancy);
        expect(secondVacancy.className).toContain('border-blue-500');
        // First vacancy should no longer be selected
        if (firstVacancy) {
          expect(firstVacancy.className).not.toContain('border-blue-500');
        }
      }
    });
  });

  describe('Search Functionality', () => {
    it('should have search input', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      // Russian text: "Poisk vakansii..." (Search vacancy...)
      const searchInput = screen.getByPlaceholderText(/поиск вакансии/i);
      expect(searchInput).toBeInTheDocument();
    });

    it('should filter vacancies when searching (debounced)', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText(/поиск вакансии/i);
      await userEvent.type(searchInput, 'Python');

      // Wait for debounce
      await waitFor(() => {
        expect(api.getVacancies).toHaveBeenCalledWith({
          status: 'open',
          search: 'Python',
        });
      }, { timeout: 500 });
    });
  });

  describe('Source Selection', () => {
    it('should have source dropdown', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      const sourceSelect = screen.getByRole('combobox');
      expect(sourceSelect).toBeInTheDocument();
    });

    it('should allow selecting a source', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      const sourceSelect = screen.getByRole('combobox');
      await userEvent.selectOptions(sourceSelect, 'linkedin');

      expect((sourceSelect as HTMLSelectElement).value).toBe('linkedin');
    });
  });

  describe('Submit Application', () => {
    it('should disable submit button when no vacancy selected', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      // Russian text: "Dobavit'" (Add)
      const submitButton = screen.getByRole('button', { name: /добавить$/i });
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when vacancy is selected', async () => {
      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      const vacancyButton = screen.getByText('Senior Python Developer').closest('button');
      if (vacancyButton) {
        await userEvent.click(vacancyButton);
      }

      const submitButton = screen.getByRole('button', { name: /добавить$/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('should submit application and call onSuccess', async () => {
      (api.applyEntityToVacancy as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1,
        entity_id: 1,
        vacancy_id: 1,
        stage: 'applied',
      });

      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      // Select vacancy
      const vacancyButton = screen.getByText('Senior Python Developer').closest('button');
      if (vacancyButton) {
        await userEvent.click(vacancyButton);
      }

      // Submit
      const submitButton = screen.getByRole('button', { name: /добавить$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(api.applyEntityToVacancy).toHaveBeenCalledWith(1, 1, undefined);
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });

    it('should submit application with source', async () => {
      (api.applyEntityToVacancy as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1,
        entity_id: 1,
        vacancy_id: 1,
        stage: 'applied',
      });

      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      // Select source
      const sourceSelect = screen.getByRole('combobox');
      await userEvent.selectOptions(sourceSelect, 'linkedin');

      // Select vacancy
      const vacancyButton = screen.getByText('Senior Python Developer').closest('button');
      if (vacancyButton) {
        await userEvent.click(vacancyButton);
      }

      // Submit
      const submitButton = screen.getByRole('button', { name: /добавить$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(api.applyEntityToVacancy).toHaveBeenCalledWith(1, 1, 'linkedin');
      });
    });

    it('should show loading state during submission', async () => {
      (api.applyEntityToVacancy as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({}), 100))
      );

      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      const vacancyButton = screen.getByText('Senior Python Developer').closest('button');
      if (vacancyButton) {
        await userEvent.click(vacancyButton);
      }

      const submitButton = screen.getByRole('button', { name: /добавить$/i });
      await userEvent.click(submitButton);

      // Button should show "Dobavlenie..." (Adding...) while loading
      expect(screen.getByText(/добавление/i)).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle API error when loading vacancies', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.getVacancies as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API Error'));

      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalled();
      });

      consoleError.mockRestore();
    });

    it('should handle API error when submitting', async () => {
      const toast = await import('react-hot-toast');
      (api.applyEntityToVacancy as ReturnType<typeof vi.fn>).mockRejectedValue({
        response: { data: { detail: 'Entity already applied to this vacancy' } },
      });

      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Senior Python Developer')).toBeInTheDocument();
      });

      const vacancyButton = screen.getByText('Senior Python Developer').closest('button');
      if (vacancyButton) {
        await userEvent.click(vacancyButton);
      }

      const submitButton = screen.getByRole('button', { name: /добавить$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(toast.default.error).toHaveBeenCalledWith('Entity already applied to this vacancy');
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no vacancies available', async () => {
      (api.getVacancies as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      render(<AddToVacancyModal {...defaultProps} />);

      await waitFor(() => {
        // Russian text: "Vakansii ne naydeny" (Vacancies not found)
        expect(screen.getByText(/вакансии не найдены/i)).toBeInTheDocument();
        // Russian text: "Net otkrytykh vakansiy" (No open vacancies)
        expect(screen.getByText(/нет открытых вакансий/i)).toBeInTheDocument();
      });
    });
  });
});
