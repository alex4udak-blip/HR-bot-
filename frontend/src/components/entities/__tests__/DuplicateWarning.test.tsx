import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DuplicateWarning from '../DuplicateWarning';
import * as api from '@/services/api';

/**
 * Tests for DuplicateWarning component
 * Verifies duplicate detection display and merge functionality
 */

// Mock API
vi.mock('@/services/api', () => ({
  getDuplicateCandidates: vi.fn(),
  mergeEntities: vi.fn(),
}));

const mockDuplicates = [
  {
    entity_id: 101,
    name: 'Ivan Petrov',
    email: 'ivan@test.com',
    phone: '+1234567890',
    similarity: 95,
    matching_fields: ['email', 'phone'],
    entity_type: 'candidate',
    position: 'Python Developer',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    entity_id: 102,
    name: 'Ivan P.',
    email: 'ivan@test.com',
    similarity: 82,
    matching_fields: ['email'],
    entity_type: 'candidate',
    position: 'Backend Developer',
    created_at: '2024-01-02T00:00:00Z',
  },
];

describe('DuplicateWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getDuplicateCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(mockDuplicates);
    (api.mergeEntities as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  });

  const renderWithRouter = (props = {}) => {
    return render(
      <MemoryRouter>
        <DuplicateWarning entityId={1} {...props} />
      </MemoryRouter>
    );
  };

  describe('Loading State', () => {
    it('should show loading state initially', () => {
      (api.getDuplicateCandidates as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolve
      );

      renderWithRouter();

      expect(screen.getByText(/Проверяем на дубликаты/i)).toBeInTheDocument();
    });
  });

  describe('No Duplicates', () => {
    it('should not render when no duplicates found', async () => {
      (api.getDuplicateCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { container } = renderWithRouter();

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });
  });

  describe('Duplicate Warning Display', () => {
    it('should show warning when duplicates are found', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Возможные дубликаты/i)).toBeInTheDocument();
      });
    });

    it('should display number of duplicates', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/2/)).toBeInTheDocument();
      });
    });

    it('should display duplicate names', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Ivan Petrov')).toBeInTheDocument();
        expect(screen.getByText('Ivan P.')).toBeInTheDocument();
      });
    });

    it('should display similarity percentages', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/95%/)).toBeInTheDocument();
        expect(screen.getByText(/82%/)).toBeInTheDocument();
      });
    });

    it('should display matching fields', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/email/i)).toBeInTheDocument();
      });
    });

    it('should show high similarity badge for high scores', async () => {
      renderWithRouter();

      await waitFor(() => {
        const highSimilarity = screen.getByText('95%');
        expect(highSimilarity.className).toContain('red');
      });
    });
  });

  describe('Duplicate Navigation', () => {
    it('should link to duplicate entity profile', async () => {
      renderWithRouter();

      await waitFor(() => {
        const link = screen.getByText('Ivan Petrov').closest('a');
        expect(link).toHaveAttribute('href', '/entities/101');
      });
    });
  });

  describe('Merge Functionality', () => {
    it('should show merge button for each duplicate', async () => {
      renderWithRouter();

      await waitFor(() => {
        const mergeButtons = screen.getAllByText(/Объединить/i);
        expect(mergeButtons.length).toBe(2);
      });
    });

    it('should call mergeEntities when merge button is clicked', async () => {
      const onMerge = vi.fn();
      renderWithRouter({ onMerge });

      await waitFor(() => {
        const mergeButton = screen.getAllByText(/Объединить/i)[0];
        fireEvent.click(mergeButton);
      });

      await waitFor(() => {
        expect(api.mergeEntities).toHaveBeenCalledWith(1, 101);
      });
    });

    it('should call onMerge callback after successful merge', async () => {
      const onMerge = vi.fn();
      renderWithRouter({ onMerge });

      await waitFor(() => {
        const mergeButton = screen.getAllByText(/Объединить/i)[0];
        fireEvent.click(mergeButton);
      });

      await waitFor(() => {
        expect(onMerge).toHaveBeenCalledWith(101);
      });
    });

    it('should show loading state while merging', async () => {
      (api.mergeEntities as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      renderWithRouter();

      await waitFor(() => {
        const mergeButton = screen.getAllByText(/Объединить/i)[0];
        fireEvent.click(mergeButton);
      });

      // Should show loading indicator
      expect(screen.getByText(/Объединяем/i)).toBeInTheDocument();
    });
  });

  describe('Dismiss Functionality', () => {
    it('should show dismiss button', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByTitle(/Скрыть/i)).toBeInTheDocument();
      });
    });

    it('should hide warning when dismiss button is clicked', async () => {
      renderWithRouter();

      await waitFor(() => {
        const dismissButton = screen.getByTitle(/Скрыть/i);
        fireEvent.click(dismissButton);
      });

      await waitFor(() => {
        expect(screen.queryByText(/Возможные дубликаты/i)).not.toBeInTheDocument();
      });
    });

    it('should call onDismiss callback when dismissed', async () => {
      const onDismiss = vi.fn();
      renderWithRouter({ onDismiss });

      await waitFor(() => {
        const dismissButton = screen.getByTitle(/Скрыть/i);
        fireEvent.click(dismissButton);
      });

      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('Error State', () => {
    it('should handle API errors gracefully', async () => {
      (api.getDuplicateCandidates as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      const { container } = renderWithRouter();

      await waitFor(() => {
        // Should not crash, just not render anything
        expect(container.querySelector('.duplicate-warning')).toBeNull();
      });
    });

    it('should show error when merge fails', async () => {
      (api.mergeEntities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Merge failed'));

      renderWithRouter();

      await waitFor(() => {
        const mergeButton = screen.getAllByText(/Объединить/i)[0];
        fireEvent.click(mergeButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Ошибка/i)).toBeInTheDocument();
      });
    });
  });

  describe('Props', () => {
    it('should pass correct entityId to API', async () => {
      renderWithRouter({ entityId: 42 });

      await waitFor(() => {
        expect(api.getDuplicateCandidates).toHaveBeenCalledWith(42);
      });
    });

    it('should re-check when entityId changes', async () => {
      const { rerender } = renderWithRouter({ entityId: 1 });

      await waitFor(() => {
        expect(api.getDuplicateCandidates).toHaveBeenCalledWith(1);
      });

      rerender(
        <MemoryRouter>
          <DuplicateWarning entityId={2} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(api.getDuplicateCandidates).toHaveBeenCalledWith(2);
      });
    });
  });
});
