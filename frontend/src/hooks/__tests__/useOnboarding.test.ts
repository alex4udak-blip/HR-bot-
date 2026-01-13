import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnboarding, type TooltipId } from '../useOnboarding';

/**
 * Tests for useOnboarding hook
 * Verifies tooltip tracking, localStorage persistence, and reset functionality
 */

// Storage key used by the hook
const STORAGE_KEY = 'hr-bot-onboarding-state';

describe('useOnboarding', () => {
  // Mock localStorage
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Initial state', () => {
    it('should start with empty seen tooltips array', () => {
      const { result } = renderHook(() => useOnboarding());

      expect(result.current.seenTooltips).toEqual([]);
      expect(result.current.isOnboardingComplete).toBe(false);
    });

    it('should load existing state from localStorage', () => {
      mockStorage[STORAGE_KEY] = JSON.stringify({
        seenTooltips: ['vacancies-page', 'kanban-board'],
      });

      const { result } = renderHook(() => useOnboarding());

      // Note: The hook syncs state in useEffect, so we need to wait for it
      expect(result.current.seenTooltips).toContain('vacancies-page');
      expect(result.current.seenTooltips).toContain('kanban-board');
    });

    it('should handle invalid localStorage data gracefully', () => {
      mockStorage[STORAGE_KEY] = 'invalid-json';

      const { result } = renderHook(() => useOnboarding());

      // Should fall back to empty state
      expect(result.current.seenTooltips).toEqual([]);
    });

    it('should handle missing seenTooltips array in stored data', () => {
      mockStorage[STORAGE_KEY] = JSON.stringify({ someOtherKey: true });

      const { result } = renderHook(() => useOnboarding());

      expect(result.current.seenTooltips).toEqual([]);
    });
  });

  describe('hasSeenTooltip', () => {
    it('should return false for unseen tooltip', () => {
      const { result } = renderHook(() => useOnboarding());

      expect(result.current.hasSeenTooltip('vacancies-page')).toBe(false);
    });

    it('should return true for seen tooltip', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
      });

      expect(result.current.hasSeenTooltip('vacancies-page')).toBe(true);
    });

    it('should return correct state for multiple tooltips', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('contacts-page');
      });

      expect(result.current.hasSeenTooltip('vacancies-page')).toBe(true);
      expect(result.current.hasSeenTooltip('contacts-page')).toBe(true);
      expect(result.current.hasSeenTooltip('kanban-board')).toBe(false);
      expect(result.current.hasSeenTooltip('parser-modal')).toBe(false);
    });
  });

  describe('markTooltipSeen', () => {
    it('should add tooltip to seen list', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
      });

      expect(result.current.seenTooltips).toContain('vacancies-page');
    });

    it('should persist to localStorage', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
      });

      expect(localStorage.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(mockStorage[STORAGE_KEY]);
      expect(savedData.seenTooltips).toContain('vacancies-page');
    });

    it('should not duplicate tooltip when marked again', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('vacancies-page');
      });

      const vacanciesCount = result.current.seenTooltips.filter(
        (id) => id === 'vacancies-page'
      ).length;
      expect(vacanciesCount).toBe(1);
    });

    it('should mark multiple different tooltips', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('kanban-board');
        result.current.markTooltipSeen('contacts-page');
      });

      expect(result.current.seenTooltips).toHaveLength(3);
      expect(result.current.seenTooltips).toContain('vacancies-page');
      expect(result.current.seenTooltips).toContain('kanban-board');
      expect(result.current.seenTooltips).toContain('contacts-page');
    });
  });

  describe('resetOnboarding', () => {
    it('should clear all seen tooltips', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('kanban-board');
      });

      expect(result.current.seenTooltips).toHaveLength(2);

      act(() => {
        result.current.resetOnboarding();
      });

      expect(result.current.seenTooltips).toHaveLength(0);
      expect(result.current.seenTooltips).toEqual([]);
    });

    it('should persist reset state to localStorage', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
      });

      act(() => {
        result.current.resetOnboarding();
      });

      const savedData = JSON.parse(mockStorage[STORAGE_KEY]);
      expect(savedData.seenTooltips).toEqual([]);
    });

    it('should reset isOnboardingComplete flag', () => {
      const { result } = renderHook(() => useOnboarding());

      // Mark all tooltips as seen
      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('kanban-board');
        result.current.markTooltipSeen('contacts-page');
        result.current.markTooltipSeen('parser-modal');
      });

      expect(result.current.isOnboardingComplete).toBe(true);

      act(() => {
        result.current.resetOnboarding();
      });

      expect(result.current.isOnboardingComplete).toBe(false);
    });
  });

  describe('isOnboardingComplete', () => {
    it('should be false when no tooltips seen', () => {
      const { result } = renderHook(() => useOnboarding());

      expect(result.current.isOnboardingComplete).toBe(false);
    });

    it('should be false when some tooltips seen', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('kanban-board');
      });

      expect(result.current.isOnboardingComplete).toBe(false);
    });

    it('should be true when all tooltips seen', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('kanban-board');
        result.current.markTooltipSeen('contacts-page');
        result.current.markTooltipSeen('parser-modal');
      });

      expect(result.current.isOnboardingComplete).toBe(true);
    });

    it('should set completedAt when all tooltips are seen', () => {
      const { result } = renderHook(() => useOnboarding());

      act(() => {
        result.current.markTooltipSeen('vacancies-page');
        result.current.markTooltipSeen('kanban-board');
        result.current.markTooltipSeen('contacts-page');
        result.current.markTooltipSeen('parser-modal');
      });

      const savedData = JSON.parse(mockStorage[STORAGE_KEY]);
      expect(savedData.completedAt).toBeDefined();
      // Verify it's a valid ISO date string
      expect(new Date(savedData.completedAt).toISOString()).toBe(
        savedData.completedAt
      );
    });
  });

  describe('Multiple hook instances', () => {
    it('should share state between instances via localStorage', () => {
      const { result: result1 } = renderHook(() => useOnboarding());

      act(() => {
        result1.current.markTooltipSeen('vacancies-page');
      });

      // Create new instance - it should read from localStorage
      const { result: result2 } = renderHook(() => useOnboarding());

      // Both instances should see the tooltip as seen
      expect(result2.current.hasSeenTooltip('vacancies-page')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle localStorage errors gracefully on save', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Make setItem throw
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Storage full');
      });

      const { result } = renderHook(() => useOnboarding());

      // Should not throw
      act(() => {
        result.current.markTooltipSeen('vacancies-page');
      });

      // State should still update in memory
      expect(result.current.hasSeenTooltip('vacancies-page')).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    it('should handle all valid tooltip IDs', () => {
      const { result } = renderHook(() => useOnboarding());

      const tooltipIds: TooltipId[] = [
        'vacancies-page',
        'kanban-board',
        'contacts-page',
        'parser-modal',
      ];

      tooltipIds.forEach((id) => {
        act(() => {
          result.current.markTooltipSeen(id);
        });
        expect(result.current.hasSeenTooltip(id)).toBe(true);
      });

      expect(result.current.seenTooltips).toHaveLength(4);
    });
  });
});
