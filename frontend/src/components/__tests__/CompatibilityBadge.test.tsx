import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompatibilityBadge, { getScoreColor, getScoreBgColor, getRecommendationLabel } from '../CompatibilityBadge';
import type { CompatibilityScore } from '@/types';

/**
 * Tests for CompatibilityBadge component
 * Verifies AI compatibility score display, dropdown, and state handling
 */

const mockScore: CompatibilityScore = {
  overall_score: 85,
  skills_match: 90,
  experience_match: 80,
  salary_match: 75,
  culture_fit: 95,
  recommendation: 'hire',
  summary: 'Excellent candidate with strong technical skills',
  strengths: ['Strong Python skills', 'Leadership experience', 'Good communication'],
  weaknesses: ['Limited cloud experience'],
};

const mockLowScore: CompatibilityScore = {
  overall_score: 35,
  skills_match: 30,
  experience_match: 40,
  salary_match: 50,
  culture_fit: 20,
  recommendation: 'reject',
  summary: 'Skills do not match requirements',
  strengths: ['Motivated'],
  weaknesses: ['Lacks required experience', 'Salary expectations too high'],
};

const mockMediumScore: CompatibilityScore = {
  overall_score: 55,
  skills_match: 60,
  experience_match: 50,
  salary_match: 55,
  culture_fit: 55,
  recommendation: 'maybe',
  summary: 'Potential candidate but some concerns',
  strengths: ['Relevant background'],
  weaknesses: ['Junior level'],
};

describe('CompatibilityBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Score Color Utilities', () => {
    it('should return green for high scores (>=70)', () => {
      expect(getScoreColor(85)).toContain('green');
      expect(getScoreColor(70)).toContain('green');
      expect(getScoreColor(100)).toContain('green');
    });

    it('should return yellow for medium scores (40-69)', () => {
      expect(getScoreColor(55)).toContain('yellow');
      expect(getScoreColor(40)).toContain('yellow');
      expect(getScoreColor(69)).toContain('yellow');
    });

    it('should return red for low scores (<40)', () => {
      expect(getScoreColor(35)).toContain('red');
      expect(getScoreColor(0)).toContain('red');
      expect(getScoreColor(39)).toContain('red');
    });
  });

  describe('Score Background Color Utilities', () => {
    it('should return green background for high scores', () => {
      expect(getScoreBgColor(85)).toContain('green');
    });

    it('should return yellow background for medium scores', () => {
      expect(getScoreBgColor(55)).toContain('yellow');
    });

    it('should return red background for low scores', () => {
      expect(getScoreBgColor(35)).toContain('red');
    });
  });

  describe('Recommendation Label Utilities', () => {
    it('should return correct label for hire recommendation', () => {
      const result = getRecommendationLabel('hire');
      expect(result.label).toBe('Рекомендуем');
      expect(result.color).toContain('green');
    });

    it('should return correct label for maybe recommendation', () => {
      const result = getRecommendationLabel('maybe');
      expect(result.label).toBe('На рассмотрение');
      expect(result.color).toContain('yellow');
    });

    it('should return correct label for reject recommendation', () => {
      const result = getRecommendationLabel('reject');
      expect(result.label).toBe('Не рекомендуем');
      expect(result.color).toContain('red');
    });

    it('should return default label for unknown recommendation', () => {
      const result = getRecommendationLabel('unknown');
      expect(result.label).toBe('Не определено');
    });
  });

  describe('Loading State', () => {
    it('should show loading indicator', () => {
      render(<CompatibilityBadge isLoading />);

      expect(screen.getByText('AI...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error state with retry button', () => {
      const onCalculate = vi.fn();
      render(<CompatibilityBadge error="Failed to calculate" onCalculate={onCalculate} />);

      expect(screen.getByText('Ошибка')).toBeInTheDocument();
    });

    it('should call onCalculate when error button is clicked', () => {
      const onCalculate = vi.fn();
      render(<CompatibilityBadge error="Failed to calculate" onCalculate={onCalculate} />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onCalculate).toHaveBeenCalled();
    });
  });

  describe('No Score State', () => {
    it('should show calculate button when no score', () => {
      render(<CompatibilityBadge />);

      expect(screen.getByText('AI скор')).toBeInTheDocument();
    });

    it('should call onCalculate when calculate button is clicked', () => {
      const onCalculate = vi.fn();
      render(<CompatibilityBadge onCalculate={onCalculate} />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onCalculate).toHaveBeenCalled();
    });

    it('should disable button when no onCalculate provided', () => {
      render(<CompatibilityBadge />);

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });
  });

  describe('Score Display', () => {
    it('should display score percentage', () => {
      render(<CompatibilityBadge score={mockScore} />);

      expect(screen.getByText('85%')).toBeInTheDocument();
    });

    it('should display high score with green color', () => {
      render(<CompatibilityBadge score={mockScore} />);

      const scoreElement = screen.getByText('85%');
      expect(scoreElement.className).toContain('green');
    });

    it('should display low score with red color', () => {
      render(<CompatibilityBadge score={mockLowScore} />);

      const scoreElement = screen.getByText('35%');
      expect(scoreElement.className).toContain('red');
    });

    it('should display medium score with yellow color', () => {
      render(<CompatibilityBadge score={mockMediumScore} />);

      const scoreElement = screen.getByText('55%');
      expect(scoreElement.className).toContain('yellow');
    });
  });

  describe('Compact Mode', () => {
    it('should show compact badge without dropdown', () => {
      render(<CompatibilityBadge score={mockScore} compact />);

      expect(screen.getByText('85')).toBeInTheDocument();
      // Should not have dropdown arrow
      expect(screen.queryByText('AI Совместимость')).not.toBeInTheDocument();
    });

    it('should show title attribute in compact mode', () => {
      render(<CompatibilityBadge score={mockScore} compact />);

      const badge = screen.getByTitle('85% совместимость');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Dropdown', () => {
    it('should open dropdown when badge is clicked', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('AI Совместимость')).toBeInTheDocument();
      });
    });

    it('should show recommendation label in dropdown', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Рекомендуем')).toBeInTheDocument();
      });
    });

    it('should show skills match score', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Навыки')).toBeInTheDocument();
      });
    });

    it('should show experience match score', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Опыт')).toBeInTheDocument();
      });
    });

    it('should show salary match score', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Зарплата')).toBeInTheDocument();
      });
    });

    it('should show culture fit score', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Культура')).toBeInTheDocument();
      });
    });

    it('should show summary', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText(mockScore.summary!)).toBeInTheDocument();
      });
    });

    it('should show strengths', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Сильные стороны')).toBeInTheDocument();
        expect(screen.getByText('Strong Python skills')).toBeInTheDocument();
      });
    });

    it('should show weaknesses', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Риски')).toBeInTheDocument();
        expect(screen.getByText('Limited cloud experience')).toBeInTheDocument();
      });
    });

    it('should show recalculate button when onCalculate provided', async () => {
      const onCalculate = vi.fn();
      render(<CompatibilityBadge score={mockScore} showDetails onCalculate={onCalculate} />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(screen.getByText('Пересчитать')).toBeInTheDocument();
      });
    });

    it('should call onCalculate when recalculate is clicked', async () => {
      const onCalculate = vi.fn();
      render(<CompatibilityBadge score={mockScore} showDetails onCalculate={onCalculate} />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        const recalcButton = screen.getByText('Пересчитать');
        fireEvent.click(recalcButton);
      });

      expect(onCalculate).toHaveBeenCalled();
    });

    it('should close dropdown when clicking recalculate', async () => {
      const onCalculate = vi.fn();
      render(<CompatibilityBadge score={mockScore} showDetails onCalculate={onCalculate} />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      await waitFor(() => {
        const recalcButton = screen.getByText('Пересчитать');
        fireEvent.click(recalcButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('AI Совместимость')).not.toBeInTheDocument();
      });
    });
  });

  describe('Size Variants', () => {
    it('should apply small size class', () => {
      render(<CompatibilityBadge score={mockScore} size="sm" />);

      const badge = screen.getByRole('button');
      expect(badge.className).toContain('text-xs');
    });

    it('should apply medium size class (default)', () => {
      render(<CompatibilityBadge score={mockScore} size="md" />);

      const badge = screen.getByRole('button');
      expect(badge.className).toContain('text-sm');
    });

    it('should apply large size class', () => {
      render(<CompatibilityBadge score={mockScore} size="lg" />);

      const badge = screen.getByRole('button');
      expect(badge.className).toContain('text-base');
    });
  });

  describe('showDetails prop', () => {
    it('should not show dropdown arrow when showDetails is false', () => {
      render(<CompatibilityBadge score={mockScore} showDetails={false} />);

      // Badge should not be clickable to open dropdown
      const badge = screen.getByRole('button');
      expect(badge.className).toContain('cursor-default');
    });

    it('should not open dropdown when showDetails is false', async () => {
      render(<CompatibilityBadge score={mockScore} showDetails={false} />);

      const badge = screen.getByRole('button');
      fireEvent.click(badge);

      // Dropdown should not appear
      expect(screen.queryByText('AI Совместимость')).not.toBeInTheDocument();
    });
  });
});
