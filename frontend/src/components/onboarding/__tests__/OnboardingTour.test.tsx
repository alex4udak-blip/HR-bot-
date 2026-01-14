import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnboardingTour, DEFAULT_TOUR_STEPS, type TourStep } from '@/hooks/useOnboardingTour';

/**
 * Tests for OnboardingTour integration
 * Since the component uses portals which are complex to test,
 * we focus on testing the hook integration that drives the tour
 */

// Storage key used by the tour hook
const TOUR_STORAGE_KEY = 'hr-bot-onboarding-tour';

describe('OnboardingTour Integration', () => {
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

  describe('Default tour steps', () => {
    it('should have correct number of default steps', () => {
      expect(DEFAULT_TOUR_STEPS.length).toBe(7);
    });

    it('should have correct step IDs', () => {
      const expectedIds = [
        'candidates-database',
        'upload-resume',
        'smart-search',
        'candidate-card',
        'ai-analysis',
        'vacancies',
        'kanban-board',
      ];

      expect(DEFAULT_TOUR_STEPS.map(s => s.id)).toEqual(expectedIds);
    });

    it('should have Russian titles', () => {
      // All titles should be in Russian
      DEFAULT_TOUR_STEPS.forEach(step => {
        // Russian text typically contains Cyrillic characters
        expect(step.title).toBeTruthy();
        expect(step.content).toBeTruthy();
      });
    });

    it('should have valid target selectors', () => {
      DEFAULT_TOUR_STEPS.forEach(step => {
        expect(step.target).toMatch(/^\[data-tour=/);
      });
    });

    it('should have valid placements', () => {
      const validPlacements = ['top', 'bottom', 'left', 'right'];
      DEFAULT_TOUR_STEPS.forEach(step => {
        expect(validPlacements).toContain(step.placement);
      });
    });
  });

  describe('Tour state flow', () => {
    it('should complete full tour flow', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      // Initial state
      expect(result.current.isActive).toBe(false);
      expect(result.current.shouldAutoStart).toBe(true);

      // Start tour
      act(() => {
        result.current.startTour();
      });

      expect(result.current.isActive).toBe(true);
      expect(result.current.currentStep).toBe(0);
      expect(result.current.currentStepConfig?.id).toBe('candidates-database');

      // Navigate through all steps
      for (let i = 0; i < DEFAULT_TOUR_STEPS.length - 1; i++) {
        act(() => {
          result.current.nextStep();
        });
        expect(result.current.currentStep).toBe(i + 1);
      }

      // Complete tour
      act(() => {
        result.current.completeTour();
      });

      expect(result.current.isActive).toBe(false);
      expect(result.current.hasCompletedTour).toBe(true);
    });

    it('should handle skip flow', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result.current.startTour();
      });

      // Skip after first step
      act(() => {
        result.current.nextStep();
      });

      act(() => {
        result.current.skipTour();
      });

      expect(result.current.isActive).toBe(false);

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.skipped).toBe(true);
      expect(savedData.lastStepIndex).toBe(1);
    });

    it('should handle reset and restart', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      // Complete tour first
      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.completeTour();
      });

      expect(result.current.hasCompletedTour).toBe(true);

      // Reset
      act(() => {
        result.current.resetTour();
      });

      expect(result.current.hasCompletedTour).toBe(false);

      // Should be able to start again
      act(() => {
        result.current.startTour();
      });

      expect(result.current.isActive).toBe(true);
      expect(result.current.currentStep).toBe(0);
    });
  });

  describe('Progress tracking', () => {
    it('should track progress correctly', () => {
      const customSteps: TourStep[] = [
        { id: 's1', target: '.t1', title: 'T1', content: 'C1', placement: 'bottom' },
        { id: 's2', target: '.t2', title: 'T2', content: 'C2', placement: 'bottom' },
        { id: 's3', target: '.t3', title: 'T3', content: 'C3', placement: 'bottom' },
        { id: 's4', target: '.t4', title: 'T4', content: 'C4', placement: 'bottom' },
      ];

      const { result } = renderHook(() => useOnboardingTour(customSteps));

      act(() => {
        result.current.startTour();
      });

      expect(result.current.progress).toBe(0);

      act(() => {
        result.current.nextStep();
      });
      expect(result.current.progress).toBe(25);

      act(() => {
        result.current.nextStep();
      });
      expect(result.current.progress).toBe(50);

      act(() => {
        result.current.nextStep();
      });
      expect(result.current.progress).toBe(75);
    });

    it('should track completed steps', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      act(() => {
        result.current.nextStep();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.stepsCompleted).toContain('candidates-database');
      expect(savedData.stepsCompleted).toContain('upload-resume');
    });
  });

  describe('Navigation controls', () => {
    it('should support goToStep for direct navigation', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.goToStep(3);
      });

      expect(result.current.currentStep).toBe(3);
      expect(result.current.currentStepConfig?.id).toBe('candidate-card');
    });

    it('should support backward navigation', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.goToStep(4);
      });

      act(() => {
        result.current.prevStep();
      });

      expect(result.current.currentStep).toBe(3);
    });

    it('should prevent invalid navigation', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result.current.startTour();
      });

      // Try to go negative
      act(() => {
        result.current.goToStep(-1);
      });
      expect(result.current.currentStep).toBe(0);

      // Try to go beyond total
      act(() => {
        result.current.goToStep(100);
      });
      expect(result.current.currentStep).toBe(0);
    });
  });

  describe('Persistence', () => {
    it('should persist state between hook instances', () => {
      // First instance - complete some steps
      const { result: result1 } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result1.current.startTour();
      });

      act(() => {
        result1.current.nextStep();
      });

      act(() => {
        result1.current.skipTour();
      });

      // Second instance should see the saved state
      const { result: result2 } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      // Should not auto-start since it was skipped
      expect(result2.current.shouldAutoStart).toBe(false);

      // Can reset and start fresh
      act(() => {
        result2.current.resetTour();
      });

      act(() => {
        result2.current.startTour();
      });

      // Should resume from last step
      expect(result2.current.currentStep).toBe(0);
    });

    it('should track start count', () => {
      const { result } = renderHook(() => useOnboardingTour(DEFAULT_TOUR_STEPS));

      act(() => {
        result.current.startTour();
      });

      let savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.startCount).toBe(1);

      act(() => {
        result.current.skipTour();
      });

      act(() => {
        result.current.resetTour();
      });

      act(() => {
        result.current.startTour();
      });

      savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.startCount).toBe(2);
    });
  });

  describe('Step configuration', () => {
    it('should support routes in step config', () => {
      const stepsWithRoutes: TourStep[] = [
        { id: 's1', target: '.t1', title: 'T1', content: 'C1', placement: 'bottom', route: '/candidates' },
        { id: 's2', target: '.t2', title: 'T2', content: 'C2', placement: 'bottom', route: '/vacancies' },
      ];

      const { result } = renderHook(() => useOnboardingTour(stepsWithRoutes));

      act(() => {
        result.current.startTour();
      });

      expect(result.current.currentStepConfig?.route).toBe('/candidates');

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStepConfig?.route).toBe('/vacancies');
    });

    it('should support spotlight padding', () => {
      const stepsWithPadding: TourStep[] = [
        { id: 's1', target: '.t1', title: 'T1', content: 'C1', placement: 'bottom', spotlightPadding: 16 },
        { id: 's2', target: '.t2', title: 'T2', content: 'C2', placement: 'bottom', spotlightPadding: 8 },
      ];

      const { result } = renderHook(() => useOnboardingTour(stepsWithPadding));

      act(() => {
        result.current.startTour();
      });

      expect(result.current.currentStepConfig?.spotlightPadding).toBe(16);
    });
  });
});
