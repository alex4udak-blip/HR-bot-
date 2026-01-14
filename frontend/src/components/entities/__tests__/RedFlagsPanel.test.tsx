import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RedFlagsPanel from '../RedFlagsPanel';
import * as api from '@/services/api';

/**
 * Tests for RedFlagsPanel component
 * Verifies AI-detected red flags display and dismissal
 */

// Mock API
vi.mock('@/services/api', () => ({
  getEntityRedFlags: vi.fn(),
}));

const mockRedFlags = [
  {
    id: 1,
    type: 'employment_gap',
    severity: 'high',
    title: 'Длительный перерыв в работе',
    description: 'Найден перерыв в работе более 1 года между 2021-2022',
    details: {
      gap_start: '2021-03-01',
      gap_end: '2022-06-01',
      duration_months: 15,
    },
    dismissible: true,
  },
  {
    id: 2,
    type: 'job_hopping',
    severity: 'medium',
    title: 'Частая смена работы',
    description: 'Средний срок работы менее 1 года за последние 5 лет',
    details: {
      average_tenure_months: 9,
      jobs_count: 6,
    },
    dismissible: true,
  },
  {
    id: 3,
    type: 'salary_mismatch',
    severity: 'low',
    title: 'Ожидания по зарплате',
    description: 'Ожидаемая зарплата выше среднерыночной на 20%',
    details: {
      expected_salary: 300000,
      market_average: 250000,
    },
    dismissible: false,
  },
];

describe('RedFlagsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getEntityRedFlags as ReturnType<typeof vi.fn>).mockResolvedValue(mockRedFlags);
    (api.dismissRedFlag as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  });

  describe('Loading State', () => {
    it('should show loading state initially', () => {
      (api.getEntityRedFlags as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolve
      );

      render(<RedFlagsPanel entityId={1} />);

      expect(screen.getByText(/Анализируем/i)).toBeInTheDocument();
    });
  });

  describe('No Red Flags', () => {
    it('should show positive message when no red flags found', async () => {
      (api.getEntityRedFlags as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText(/красных флагов не обнаружено/i)).toBeInTheDocument();
      });
    });
  });

  describe('Red Flags Display', () => {
    it('should display all red flags', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText('Длительный перерыв в работе')).toBeInTheDocument();
        expect(screen.getByText('Частая смена работы')).toBeInTheDocument();
        expect(screen.getByText('Ожидания по зарплате')).toBeInTheDocument();
      });
    });

    it('should display red flag descriptions', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText(/перерыв в работе более 1 года/i)).toBeInTheDocument();
        expect(screen.getByText(/Средний срок работы менее 1 года/i)).toBeInTheDocument();
      });
    });

    it('should display count of red flags', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText(/3/)).toBeInTheDocument();
      });
    });
  });

  describe('Severity Indicators', () => {
    it('should show red color for high severity', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        const highSeverityFlag = screen.getByText('Длительный перерыв в работе')
          .closest('[data-severity]');
        expect(highSeverityFlag?.getAttribute('data-severity')).toBe('high');
      });
    });

    it('should show orange/yellow color for medium severity', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        const mediumSeverityFlag = screen.getByText('Частая смена работы')
          .closest('[data-severity]');
        expect(mediumSeverityFlag?.getAttribute('data-severity')).toBe('medium');
      });
    });

    it('should show appropriate icon for each severity', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        // Icons should be present (AlertTriangle, AlertCircle, etc.)
        const icons = screen.getAllByRole('img', { hidden: true });
        expect(icons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Dismiss Functionality', () => {
    it('should show dismiss button for dismissible flags', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        const dismissButtons = screen.getAllByTitle(/Скрыть/i);
        expect(dismissButtons.length).toBe(2); // Only 2 dismissible flags
      });
    });

    it('should not show dismiss button for non-dismissible flags', async () => {
      (api.getEntityRedFlags as ReturnType<typeof vi.fn>).mockResolvedValue([
        { ...mockRedFlags[2], dismissible: false },
      ]);

      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.queryByTitle(/Скрыть/i)).not.toBeInTheDocument();
      });
    });

    it('should call dismissRedFlag API when dismiss is clicked', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        const dismissButton = screen.getAllByTitle(/Скрыть/i)[0];
        fireEvent.click(dismissButton);
      });

      await waitFor(() => {
        expect(api.dismissRedFlag).toHaveBeenCalledWith(1, 1);
      });
    });

    it('should remove flag from list after dismissal', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText('Длительный перерыв в работе')).toBeInTheDocument();
      });

      const dismissButton = screen.getAllByTitle(/Скрыть/i)[0];
      fireEvent.click(dismissButton);

      await waitFor(() => {
        expect(screen.queryByText('Длительный перерыв в работе')).not.toBeInTheDocument();
      });
    });

    it('should call onDismiss callback after dismissal', async () => {
      const onDismiss = vi.fn();
      render(<RedFlagsPanel entityId={1} onDismiss={onDismiss} />);

      await waitFor(() => {
        const dismissButton = screen.getAllByTitle(/Скрыть/i)[0];
        fireEvent.click(dismissButton);
      });

      await waitFor(() => {
        expect(onDismiss).toHaveBeenCalledWith(1);
      });
    });
  });

  describe('Expand/Collapse Details', () => {
    it('should expand details when flag is clicked', async () => {
      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        const flag = screen.getByText('Длительный перерыв в работе').closest('button');
        if (flag) {
          fireEvent.click(flag);
        }
      });

      await waitFor(() => {
        // Details should be visible (like gap duration)
        expect(screen.getByText(/15 месяцев/i)).toBeInTheDocument();
      });
    });

    it('should collapse details when clicked again', async () => {
      render(<RedFlagsPanel entityId={1} />);

      // Open
      await waitFor(() => {
        const flag = screen.getByText('Длительный перерыв в работе').closest('button');
        if (flag) {
          fireEvent.click(flag);
        }
      });

      // Close
      await waitFor(() => {
        const flag = screen.getByText('Длительный перерыв в работе').closest('button');
        if (flag) {
          fireEvent.click(flag);
        }
      });

      await waitFor(() => {
        expect(screen.queryByText(/15 месяцев/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should show error message when API fails', async () => {
      (api.getEntityRedFlags as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText(/Ошибка загрузки/i)).toBeInTheDocument();
      });
    });

    it('should show retry button on error', async () => {
      (api.getEntityRedFlags as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(screen.getByText(/Повторить/i)).toBeInTheDocument();
      });
    });

    it('should retry fetch on retry button click', async () => {
      (api.getEntityRedFlags as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(mockRedFlags);

      render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        const retryButton = screen.getByText(/Повторить/i);
        fireEvent.click(retryButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Длительный перерыв в работе')).toBeInTheDocument();
      });
    });
  });

  describe('Props', () => {
    it('should fetch red flags for correct entityId', async () => {
      render(<RedFlagsPanel entityId={42} />);

      await waitFor(() => {
        expect(api.getEntityRedFlags).toHaveBeenCalledWith(42);
      });
    });

    it('should refetch when entityId changes', async () => {
      const { rerender } = render(<RedFlagsPanel entityId={1} />);

      await waitFor(() => {
        expect(api.getEntityRedFlags).toHaveBeenCalledWith(1);
      });

      rerender(<RedFlagsPanel entityId={2} />);

      await waitFor(() => {
        expect(api.getEntityRedFlags).toHaveBeenCalledWith(2);
      });
    });

    it('should collapse panel by default when collapsed prop is true', () => {
      render(<RedFlagsPanel entityId={1} collapsed />);

      // Panel header should be visible but content collapsed
      expect(screen.getByText(/Красные флаги/i)).toBeInTheDocument();
    });
  });
});
