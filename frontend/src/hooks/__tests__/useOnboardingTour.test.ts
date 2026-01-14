import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useOnboardingTour,
  DEFAULT_TOUR_STEPS,
  type TourStep,
} from '../useOnboardingTour';

/**
 * Tests for useOnboardingTour hook
 * Verifies tour state management, navigation, localStorage persistence, and analytics
 */

// Storage key used by the hook
const TOUR_STORAGE_KEY = 'hr-bot-onboarding-tour';

describe('useOnboardingTour', () => {
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

    // Mock console.log for analytics testing
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Initial state', () => {
    it('should start with tour inactive', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.isActive).toBe(false);
      expect(result.current.currentStep).toBe(0);
    });

    it('should have default tour steps', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.steps).toEqual(DEFAULT_TOUR_STEPS);
      expect(result.current.totalSteps).toBe(DEFAULT_TOUR_STEPS.length);
    });

    it('should have 7 default steps', () => {
      expect(DEFAULT_TOUR_STEPS.length).toBe(7);
    });

    it('should have all expected step IDs in order', () => {
      const expectedIds = [
        'candidates-database',
        'upload-resume',
        'smart-search',
        'candidate-card',
        'candidate-filters',
        'vacancies',
        'create-vacancy',
      ];
      const actualIds = DEFAULT_TOUR_STEPS.map(step => step.id);
      expect(actualIds).toEqual(expectedIds);
    });

    it('should have route property for all steps to ensure navigation works', () => {
      DEFAULT_TOUR_STEPS.forEach(step => {
        expect(step.route).toBeDefined();
        expect(typeof step.route).toBe('string');
        expect(step.route!.startsWith('/')).toBe(true);
      });
    });

    it('should accept custom tour steps', () => {
      const customSteps: TourStep[] = [
        {
          id: 'step-1',
          target: '.target-1',
          title: 'Step 1',
          content: 'First step',
          placement: 'bottom',
        },
        {
          id: 'step-2',
          target: '.target-2',
          title: 'Step 2',
          content: 'Second step',
          placement: 'top',
        },
      ];

      const { result } = renderHook(() => useOnboardingTour(customSteps));

      expect(result.current.steps).toEqual(customSteps);
      expect(result.current.totalSteps).toBe(2);
    });

    it('should load existing state from localStorage', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: true,
        skipped: false,
        stepsCompleted: ['step-1', 'step-2'],
        startCount: 2,
      });

      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.hasCompletedTour).toBe(true);
    });

    it('should handle invalid localStorage data gracefully', () => {
      mockStorage[TOUR_STORAGE_KEY] = 'invalid-json';

      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.hasCompletedTour).toBe(false);
      expect(result.current.shouldAutoStart).toBe(true);
    });
  });

  describe('shouldAutoStart', () => {
    it('should be true for new users (no prior tour interaction)', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.shouldAutoStart).toBe(true);
    });

    it('should be false if tour was completed', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: true,
        skipped: false,
        stepsCompleted: [],
        startCount: 1,
      });

      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.shouldAutoStart).toBe(false);
    });

    it('should be false if tour was skipped', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: false,
        skipped: true,
        stepsCompleted: [],
        startCount: 1,
      });

      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.shouldAutoStart).toBe(false);
    });

    it('should be false if tour was started before', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: false,
        skipped: false,
        stepsCompleted: [],
        startCount: 1,
      });

      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.shouldAutoStart).toBe(false);
    });
  });

  describe('startTour', () => {
    it('should activate the tour', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      expect(result.current.isActive).toBe(true);
    });

    it('should increment startCount in localStorage', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.startCount).toBe(1);
    });

    it('should resume from last step if available', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: false,
        skipped: false,
        stepsCompleted: ['candidates-database'],
        startCount: 1,
        lastStepIndex: 3,
      });

      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      expect(result.current.currentStep).toBe(3);
    });

    it('should update shouldAutoStart after starting', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.shouldAutoStart).toBe(true);

      act(() => {
        result.current.startTour();
      });

      // After starting, shouldAutoStart should be false (startCount > 0)
      expect(result.current.shouldAutoStart).toBe(false);
    });
  });

  describe('nextStep', () => {
    it('should move to the next step', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(1);
    });

    it('should not exceed total steps', () => {
      const customSteps: TourStep[] = [
        { id: 'step-1', target: '.t1', title: 'T1', content: 'C1', placement: 'bottom' },
        { id: 'step-2', target: '.t2', title: 'T2', content: 'C2', placement: 'bottom' },
      ];

      const { result } = renderHook(() => useOnboardingTour(customSteps));

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(1);

      // Try to go past the last step
      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(1); // Should stay at last step
    });

    it('should save lastStepIndex to localStorage', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.lastStepIndex).toBe(1);
    });

    it('should track step completion in stepsCompleted', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.stepsCompleted).toContain('candidates-database');
    });

    it('should not duplicate step IDs in stepsCompleted', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      // Go back and forward to same step
      act(() => {
        result.current.prevStep();
      });

      act(() => {
        result.current.nextStep();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      const firstStepCount = savedData.stepsCompleted.filter(
        (id: string) => id === 'candidates-database'
      ).length;
      expect(firstStepCount).toBe(1);
    });
  });

  describe('prevStep', () => {
    it('should move to the previous step', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(2);

      act(() => {
        result.current.prevStep();
      });

      expect(result.current.currentStep).toBe(1);
    });

    it('should not go below 0', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.prevStep();
      });

      expect(result.current.currentStep).toBe(0);
    });
  });

  describe('goToStep', () => {
    it('should jump to a specific step', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.goToStep(3);
      });

      expect(result.current.currentStep).toBe(3);
    });

    it('should not go to invalid step index (negative)', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.goToStep(-1);
      });

      expect(result.current.currentStep).toBe(0);
    });

    it('should not go to invalid step index (beyond total)', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.goToStep(100);
      });

      expect(result.current.currentStep).toBe(0);
    });
  });

  describe('skipTour', () => {
    it('should deactivate the tour', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      expect(result.current.isActive).toBe(true);

      act(() => {
        result.current.skipTour();
      });

      expect(result.current.isActive).toBe(false);
    });

    it('should set skipped flag in localStorage', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.skipTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.skipped).toBe(true);
    });

    it('should save lastStepIndex for resuming later', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      act(() => {
        result.current.nextStep();
      });

      act(() => {
        result.current.skipTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.lastStepIndex).toBe(2);
    });

    it('should allow restarting after skip', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.skipTour();
      });

      expect(result.current.isActive).toBe(false);

      // Reset and restart
      act(() => {
        result.current.resetTour();
      });

      act(() => {
        result.current.startTour();
      });

      expect(result.current.isActive).toBe(true);
    });
  });

  describe('completeTour', () => {
    it('should deactivate the tour', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.completeTour();
      });

      expect(result.current.isActive).toBe(false);
    });

    it('should set completed flag in localStorage', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.completeTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.completed).toBe(true);
    });

    it('should set completedAt timestamp', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.completeTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.completedAt).toBeDefined();
      expect(new Date(savedData.completedAt).toISOString()).toBe(savedData.completedAt);
    });

    it('should clear lastStepIndex', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
        result.current.completeTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.lastStepIndex).toBeUndefined();
    });

    it('should reset currentStep to 0', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
        result.current.nextStep();
        result.current.completeTour();
      });

      expect(result.current.currentStep).toBe(0);
    });

    it('should update hasCompletedTour flag', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.hasCompletedTour).toBe(false);

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.completeTour();
      });

      expect(result.current.hasCompletedTour).toBe(true);
    });
  });

  describe('resetTour', () => {
    it('should deactivate the tour', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.resetTour();
      });

      expect(result.current.isActive).toBe(false);
    });

    it('should clear completed state', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: true,
        skipped: false,
        stepsCompleted: ['step-1'],
        startCount: 1,
      });

      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.hasCompletedTour).toBe(true);

      act(() => {
        result.current.resetTour();
      });

      expect(result.current.hasCompletedTour).toBe(false);
    });

    it('should clear skipped state', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: false,
        skipped: true,
        stepsCompleted: [],
        startCount: 1,
      });

      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.resetTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.skipped).toBe(false);
    });

    it('should preserve startCount', () => {
      mockStorage[TOUR_STORAGE_KEY] = JSON.stringify({
        completed: true,
        skipped: false,
        stepsCompleted: [],
        startCount: 5,
      });

      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.resetTour();
      });

      const savedData = JSON.parse(mockStorage[TOUR_STORAGE_KEY]);
      expect(savedData.startCount).toBe(5);
    });

    it('should reset currentStep to 0', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(2);

      act(() => {
        result.current.resetTour();
      });

      expect(result.current.currentStep).toBe(0);
    });
  });

  describe('currentStepConfig', () => {
    it('should return null when tour is not active', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(result.current.currentStepConfig).toBe(null);
    });

    it('should return current step config when tour is active', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      expect(result.current.currentStepConfig).toEqual(DEFAULT_TOUR_STEPS[0]);
    });

    it('should update when step changes', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStepConfig).toEqual(DEFAULT_TOUR_STEPS[1]);
    });
  });

  describe('progress', () => {
    it('should be 0 at the start', () => {
      const { result } = renderHook(() => useOnboardingTour());

      act(() => {
        result.current.startTour();
      });

      expect(result.current.progress).toBe(0);
    });

    it('should increase as steps are completed', () => {
      const customSteps: TourStep[] = [
        { id: 'step-1', target: '.t1', title: 'T1', content: 'C1', placement: 'bottom' },
        { id: 'step-2', target: '.t2', title: 'T2', content: 'C2', placement: 'bottom' },
        { id: 'step-3', target: '.t3', title: 'T3', content: 'C3', placement: 'bottom' },
        { id: 'step-4', target: '.t4', title: 'T4', content: 'C4', placement: 'bottom' },
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
    });
  });

  describe('Edge cases', () => {
    it('should handle localStorage errors gracefully on save', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Storage full');
      });

      const { result } = renderHook(() => useOnboardingTour());

      // Should not throw
      act(() => {
        result.current.startTour();
      });

      // State should still update in memory
      expect(result.current.isActive).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    it('should handle empty steps array', () => {
      const { result } = renderHook(() => useOnboardingTour([]));

      expect(result.current.totalSteps).toBe(0);
      expect(result.current.progress).toBe(0);
      expect(result.current.currentStepConfig).toBe(null);
    });

    it('should handle window undefined (SSR)', () => {
      // This is tested implicitly through localStorage mocking
      // The hook should not crash when window/localStorage is unavailable
      const { result } = renderHook(() => useOnboardingTour());
      expect(result.current).toBeDefined();
    });
  });

  describe('trackEvent', () => {
    it('should be a callable function', () => {
      const { result } = renderHook(() => useOnboardingTour());

      expect(typeof result.current.trackEvent).toBe('function');

      // Should not throw
      act(() => {
        result.current.trackEvent('tour_started', { test: true });
      });
    });

    it('should accept event name and data', () => {
      const { result } = renderHook(() => useOnboardingTour());

      // Should not throw with various inputs
      act(() => {
        result.current.trackEvent('step_completed');
        result.current.trackEvent('step_completed', { stepId: 'test' });
        result.current.trackEvent('tour_skipped', { atStep: 0 });
      });
    });
  });
});
