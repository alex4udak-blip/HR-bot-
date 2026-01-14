import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SimilarCandidates from '../SimilarCandidates';
import * as api from '@/services/api';

/**
 * Tests for SimilarCandidates component
 * Verifies similar candidate display, navigation, and state handling
 */

// Mock API
vi.mock('@/services/api', () => ({
  getSimilarCandidates: vi.fn(),
  compareCandidates: vi.fn(),
}));

const mockSimilarCandidates = [
  {
    entity_id: 101,
    entity_name: 'Ivan Python',
    similarity_score: 92,
    common_skills: ['Python', 'Django', 'PostgreSQL'],
    similar_experience: true,
    similar_salary: true,
    similar_location: false,
    match_reasons: ['Strong Python skills', 'Similar experience level'],
  },
  {
    entity_id: 102,
    entity_name: 'Anna Django',
    similarity_score: 78,
    common_skills: ['Python', 'Django'],
    similar_experience: true,
    similar_salary: false,
    similar_location: true,
    match_reasons: ['Python experience'],
  },
  {
    entity_id: 103,
    entity_name: 'Boris Flask',
    similarity_score: 45,
    common_skills: ['Python'],
    similar_experience: false,
    similar_salary: true,
    similar_location: false,
    match_reasons: ['Same city'],
  },
];

describe('SimilarCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getSimilarCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(mockSimilarCandidates);
  });

  const renderWithRouter = (props = {}) => {
    return render(
      <MemoryRouter>
        <SimilarCandidates entityId={1} entityName="Current Candidate" {...props} />
      </MemoryRouter>
    );
  };

  describe('Loading State', () => {
    it('should show loading skeleton initially', () => {
      (api.getSimilarCandidates as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolve
      );

      renderWithRouter();

      // ListSkeleton should be shown - check for skeleton elements
      const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no similar candidates found', async () => {
      (api.getSimilarCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Похожие кандидаты не найдены/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      (api.getSimilarCandidates as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Ошибка загрузки/i)).toBeInTheDocument();
      });
    });

    it('should show retry button on error', async () => {
      (api.getSimilarCandidates as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Повторить/i)).toBeInTheDocument();
      });
    });

    it('should retry fetch when retry button is clicked', async () => {
      (api.getSimilarCandidates as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(mockSimilarCandidates);

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Повторить/i)).toBeInTheDocument();
      });

      const retryButton = screen.getByText(/Повторить/i);
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('Ivan Python')).toBeInTheDocument();
      });
    });
  });

  describe('Similar Candidates Display', () => {
    it('should display similar candidates', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Ivan Python')).toBeInTheDocument();
        expect(screen.getByText('Anna Django')).toBeInTheDocument();
        expect(screen.getByText('Boris Flask')).toBeInTheDocument();
      });
    });

    it('should display similarity scores', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('92%')).toBeInTheDocument();
        expect(screen.getByText('78%')).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();
      });
    });

    it('should display common skills', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Python should appear multiple times (once per candidate with it)
        const pythonSkills = screen.getAllByText('Python');
        expect(pythonSkills.length).toBeGreaterThan(0);
      });
    });

    it('should show count of similar candidates', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Похожие кандидаты \(3\)/i)).toBeInTheDocument();
      });
    });

    it('should display match indicators', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Should show experience, salary, location indicators
        expect(screen.getAllByText('Опыт').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Зарплата').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Navigation', () => {
    it('should have clickable candidate names', async () => {
      renderWithRouter();

      await waitFor(() => {
        const candidate = screen.getByText('Ivan Python');
        expect(candidate).toBeInTheDocument();
        // The name should be a button
        expect(candidate.tagName.toLowerCase()).toBe('button');
      });
    });
  });

  describe('Score Colors', () => {
    it('should show green color for high scores (>=70)', async () => {
      renderWithRouter();

      await waitFor(() => {
        const scoreElement = screen.getByText('92%');
        expect(scoreElement.className).toContain('green');
      });
    });

    it('should show yellow color for medium scores (40-69)', async () => {
      renderWithRouter();

      await waitFor(() => {
        const scoreElement = screen.getByText('45%');
        expect(scoreElement.className).toContain('yellow');
      });
    });
  });

  describe('Props', () => {
    it('should call API with correct entityId', async () => {
      renderWithRouter({ entityId: 42 });

      await waitFor(() => {
        expect(api.getSimilarCandidates).toHaveBeenCalledWith(42, 10);
      });
    });
  });

  describe('Compare Functionality', () => {
    it('should show compare button for each candidate', async () => {
      renderWithRouter();

      await waitFor(() => {
        const compareButtons = screen.getAllByText('Сравнить');
        expect(compareButtons.length).toBe(3);
      });
    });

    it('should call compareCandidates when compare is clicked', async () => {
      (api.compareCandidates as ReturnType<typeof vi.fn>).mockResolvedValue({
        entity_id: 101,
        entity_name: 'Ivan Python',
        similarity_score: 92,
        common_skills: ['Python'],
        similar_experience: true,
        similar_salary: true,
        similar_location: false,
        match_reasons: ['Strong Python skills'],
      });

      renderWithRouter();

      await waitFor(() => {
        const compareButton = screen.getAllByText('Сравнить')[0];
        fireEvent.click(compareButton);
      });

      await waitFor(() => {
        expect(api.compareCandidates).toHaveBeenCalledWith(1, 101);
      });
    });
  });
});
