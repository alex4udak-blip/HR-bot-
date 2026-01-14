import { useState, useCallback, useEffect } from 'react';

/**
 * Storage key for onboarding state in localStorage
 */
const ONBOARDING_STORAGE_KEY = 'hr-bot-onboarding-state';

/**
 * Tooltip IDs used throughout the application
 */
export type TooltipId =
  | 'vacancies-page'
  | 'kanban-board'
  | 'contacts-page'
  | 'candidates-page'
  | 'parser-modal';

/**
 * Interface for the onboarding state stored in localStorage
 */
interface OnboardingState {
  seenTooltips: TooltipId[];
  completedAt?: string;
}

/**
 * Return type for the useOnboarding hook
 */
export interface UseOnboardingReturn {
  /** Check if a specific tooltip has been seen by the user */
  hasSeenTooltip: (id: TooltipId) => boolean;
  /** Mark a tooltip as seen */
  markTooltipSeen: (id: TooltipId) => void;
  /** Reset all onboarding state (for testing purposes) */
  resetOnboarding: () => void;
  /** Check if onboarding is complete (all tooltips seen) */
  isOnboardingComplete: boolean;
  /** List of tooltips that have been seen */
  seenTooltips: TooltipId[];
}

/**
 * Get the current onboarding state from localStorage
 */
const getStoredState = (): OnboardingState => {
  if (typeof window === 'undefined') {
    return { seenTooltips: [] };
  }

  try {
    const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate the stored data structure
      if (parsed && Array.isArray(parsed.seenTooltips)) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Failed to parse onboarding state from localStorage:', error);
  }

  return { seenTooltips: [] };
};

/**
 * Save onboarding state to localStorage
 */
const saveState = (state: OnboardingState): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save onboarding state to localStorage:', error);
  }
};

/**
 * All tooltip IDs for checking completion
 */
const ALL_TOOLTIP_IDS: TooltipId[] = [
  'vacancies-page',
  'kanban-board',
  'contacts-page',
  'parser-modal',
];

/**
 * Hook for managing onboarding tooltip state
 *
 * Tracks which tooltips users have seen and stores the state in localStorage.
 * Provides functions to check, mark, and reset tooltip visibility.
 *
 * @example
 * ```tsx
 * const { hasSeenTooltip, markTooltipSeen, resetOnboarding } = useOnboarding();
 *
 * // Check if user has seen a tooltip
 * if (!hasSeenTooltip('vacancies-page')) {
 *   // Show the tooltip
 * }
 *
 * // Mark tooltip as seen
 * markTooltipSeen('vacancies-page');
 *
 * // Reset for testing
 * resetOnboarding();
 * ```
 */
export function useOnboarding(): UseOnboardingReturn {
  const [state, setState] = useState<OnboardingState>(() => getStoredState());

  // Sync state with localStorage on mount (handles SSR hydration)
  useEffect(() => {
    const storedState = getStoredState();
    setState(storedState);
  }, []);

  /**
   * Check if a specific tooltip has been seen
   */
  const hasSeenTooltip = useCallback(
    (id: TooltipId): boolean => {
      return state.seenTooltips.includes(id);
    },
    [state.seenTooltips]
  );

  /**
   * Mark a tooltip as seen
   */
  const markTooltipSeen = useCallback((id: TooltipId): void => {
    setState((prevState) => {
      if (prevState.seenTooltips.includes(id)) {
        return prevState;
      }

      const newSeenTooltips = [...prevState.seenTooltips, id];
      const isComplete = ALL_TOOLTIP_IDS.every((tooltipId) =>
        newSeenTooltips.includes(tooltipId)
      );

      const newState: OnboardingState = {
        seenTooltips: newSeenTooltips,
        ...(isComplete && { completedAt: new Date().toISOString() }),
      };

      saveState(newState);
      return newState;
    });
  }, []);

  /**
   * Reset all onboarding state (useful for testing)
   */
  const resetOnboarding = useCallback((): void => {
    const newState: OnboardingState = { seenTooltips: [] };
    setState(newState);
    saveState(newState);
  }, []);

  /**
   * Check if all tooltips have been seen
   */
  const isOnboardingComplete = ALL_TOOLTIP_IDS.every((id) =>
    state.seenTooltips.includes(id)
  );

  return {
    hasSeenTooltip,
    markTooltipSeen,
    resetOnboarding,
    isOnboardingComplete,
    seenTooltips: state.seenTooltips,
  };
}

export default useOnboarding;
