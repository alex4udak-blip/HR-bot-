import { useState, useCallback, useEffect, useMemo } from 'react';

/**
 * Storage key for onboarding tour state in localStorage
 */
const TOUR_STORAGE_KEY = 'hr-bot-onboarding-tour';

/**
 * Analytics event types for tour tracking
 */
export type TourAnalyticsEvent =
  | 'tour_started'
  | 'tour_completed'
  | 'tour_skipped'
  | 'step_completed'
  | 'step_skipped';

/**
 * Tour step configuration
 */
export interface TourStep {
  /** Unique identifier for the step */
  id: string;
  /** Target element selector (CSS selector) */
  target: string;
  /** Title of the step (Russian) */
  title: string;
  /** Description/content of the step (Russian) */
  content: string;
  /** Position of the tooltip relative to target */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Route to navigate to before showing this step (optional) */
  route?: string;
  /** Whether to highlight the target element */
  spotlightPadding?: number;
  /** Callback before step is shown */
  onBeforeShow?: () => void | Promise<void>;
  /** Callback after step is shown */
  onAfterShow?: () => void;
}

/**
 * Tour state stored in localStorage
 */
interface TourState {
  /** Whether the tour has been completed */
  completed: boolean;
  /** Timestamp when tour was completed */
  completedAt?: string;
  /** Current step index (for resuming) */
  lastStepIndex?: number;
  /** Whether user explicitly skipped the tour */
  skipped: boolean;
  /** Analytics data for completed steps */
  stepsCompleted: string[];
  /** Number of times tour was started */
  startCount: number;
}

/**
 * Return type for useOnboardingTour hook
 */
export interface UseOnboardingTourReturn {
  /** Whether the tour is currently active */
  isActive: boolean;
  /** Current step index (0-based) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Current step configuration */
  currentStepConfig: TourStep | null;
  /** All tour steps */
  steps: TourStep[];
  /** Start the tour */
  startTour: () => void;
  /** Go to next step */
  nextStep: () => void;
  /** Go to previous step */
  prevStep: () => void;
  /** Skip to a specific step */
  goToStep: (index: number) => void;
  /** Skip/close the tour */
  skipTour: () => void;
  /** Complete the tour */
  completeTour: () => void;
  /** Reset tour state (allows restart) */
  resetTour: () => void;
  /** Whether tour should auto-start for new users */
  shouldAutoStart: boolean;
  /** Whether tour has been completed before */
  hasCompletedTour: boolean;
  /** Progress percentage (0-100) */
  progress: number;
  /** Analytics tracking function */
  trackEvent: (event: TourAnalyticsEvent, data?: Record<string, unknown>) => void;
}

/**
 * Default tour steps for HR-bot onboarding
 */
export const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    id: 'candidates-database',
    target: '[data-tour="candidates-link"]',
    title: 'База кандидатов',
    content: 'Здесь хранятся все ваши кандидаты. Вы можете фильтровать, искать и управлять статусами кандидатов.',
    placement: 'right',
    route: '/candidates',
    spotlightPadding: 8,
  },
  {
    id: 'upload-resume',
    target: '[data-tour="upload-resume"]',
    title: 'Загрузить резюме',
    content: 'Нажмите сюда, чтобы загрузить резюме кандидата. Система автоматически распознает данные из PDF, DOC или текста.',
    placement: 'bottom',
    route: '/candidates',
    spotlightPadding: 8,
  },
  {
    id: 'smart-search',
    target: '[data-tour="search-input"]',
    title: 'Умный поиск',
    content: 'Используйте поиск для быстрого нахождения кандидатов по имени, навыкам, email или телефону.',
    placement: 'bottom',
    route: '/candidates',
    spotlightPadding: 8,
  },
  {
    id: 'candidate-card',
    target: '[data-tour="candidate-row"]',
    title: 'Карточка кандидата',
    content: 'Кликните на кандидата, чтобы открыть его подробную карточку с контактами, историей и AI-анализом.',
    placement: 'right',
    route: '/candidates',
    spotlightPadding: 4,
  },
  {
    id: 'candidate-filters',
    target: '[data-tour="filters-button"]',
    title: 'Фильтры кандидатов',
    content: 'Используйте фильтры для быстрого поиска по статусу, зарплате, дате добавления и навыкам кандидатов.',
    placement: 'bottom',
    route: '/candidates',
    spotlightPadding: 8,
  },
  {
    id: 'vacancies',
    target: '[data-tour="vacancies-link"]',
    title: 'Вакансии',
    content: 'Создавайте вакансии и добавляйте к ним кандидатов. Система поможет отслеживать статус каждого отклика.',
    placement: 'right',
    route: '/vacancies',
    spotlightPadding: 8,
  },
  {
    id: 'create-vacancy',
    target: '[data-tour="create-vacancy"]',
    title: 'Создание вакансии',
    content: 'Создайте новую вакансию и добавляйте кандидатов. После открытия вакансии вы сможете использовать Kanban-доску для управления воронкой найма.',
    placement: 'bottom',
    route: '/vacancies',
    spotlightPadding: 8,
  },
];

/**
 * Get initial tour state from localStorage
 */
const getStoredState = (): TourState => {
  if (typeof window === 'undefined') {
    return {
      completed: false,
      skipped: false,
      stepsCompleted: [],
      startCount: 0,
    };
  }

  try {
    const stored = localStorage.getItem(TOUR_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.completed === 'boolean') {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Failed to parse tour state from localStorage:', error);
  }

  return {
    completed: false,
    skipped: false,
    stepsCompleted: [],
    startCount: 0,
  };
};

/**
 * Save tour state to localStorage
 */
const saveState = (state: TourState): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save tour state to localStorage:', error);
  }
};

/**
 * Hook for managing onboarding tour state
 *
 * Provides step-by-step tour functionality with:
 * - Progress persistence in localStorage
 * - Analytics tracking
 * - Navigation between steps
 * - Auto-start for new users
 *
 * @param steps - Array of tour step configurations (defaults to DEFAULT_TOUR_STEPS)
 * @returns Tour state and control functions
 *
 * @example
 * ```tsx
 * const { isActive, currentStepConfig, nextStep, skipTour } = useOnboardingTour();
 *
 * if (isActive && currentStepConfig) {
 *   return <TourTooltip step={currentStepConfig} onNext={nextStep} onSkip={skipTour} />;
 * }
 * ```
 */
export function useOnboardingTour(
  steps: TourStep[] = DEFAULT_TOUR_STEPS
): UseOnboardingTourReturn {
  const [state, setState] = useState<TourState>(() => getStoredState());
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Sync with localStorage on mount
  useEffect(() => {
    const storedState = getStoredState();
    setState(storedState);
  }, []);

  // Computed values
  const totalSteps = steps.length;
  const currentStepConfig = isActive && currentStep < steps.length ? steps[currentStep] : null;
  const progress = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  const shouldAutoStart = !state.completed && !state.skipped && state.startCount === 0;
  const hasCompletedTour = state.completed;

  /**
   * Track analytics event
   */
  const trackEvent = useCallback((_event: TourAnalyticsEvent, _data?: Record<string, unknown>) => {
    // Analytics events can be logged or sent to analytics service here
    // Example: analytics.track(event, { ...data, tourVersion: '1.0' });
  }, []);

  /**
   * Start the tour
   */
  const startTour = useCallback(() => {
    setIsActive(true);
    setCurrentStep(state.lastStepIndex || 0);

    const newState: TourState = {
      ...state,
      startCount: state.startCount + 1,
    };
    setState(newState);
    saveState(newState);

    trackEvent('tour_started', { startCount: newState.startCount });
  }, [state, trackEvent]);

  /**
   * Go to next step
   */
  const nextStep = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      const stepId = steps[currentStep].id;
      const newStep = currentStep + 1;
      setCurrentStep(newStep);

      const newState: TourState = {
        ...state,
        lastStepIndex: newStep,
        stepsCompleted: state.stepsCompleted.includes(stepId)
          ? state.stepsCompleted
          : [...state.stepsCompleted, stepId],
      };
      setState(newState);
      saveState(newState);

      trackEvent('step_completed', { stepId, stepIndex: currentStep });
    }
  }, [currentStep, totalSteps, state, steps, trackEvent]);

  /**
   * Go to previous step
   */
  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);

      const newState: TourState = {
        ...state,
        lastStepIndex: newStep,
      };
      setState(newState);
      saveState(newState);
    }
  }, [currentStep, state]);

  /**
   * Go to a specific step
   */
  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < totalSteps) {
      setCurrentStep(index);

      const newState: TourState = {
        ...state,
        lastStepIndex: index,
      };
      setState(newState);
      saveState(newState);
    }
  }, [totalSteps, state]);

  /**
   * Skip/close the tour
   */
  const skipTour = useCallback(() => {
    setIsActive(false);

    const newState: TourState = {
      ...state,
      skipped: true,
      lastStepIndex: currentStep,
    };
    setState(newState);
    saveState(newState);

    trackEvent('tour_skipped', { atStep: currentStep, stepId: steps[currentStep]?.id });
  }, [state, currentStep, steps, trackEvent]);

  /**
   * Complete the tour
   */
  const completeTour = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);

    const lastStepId = steps[steps.length - 1]?.id;
    const newState: TourState = {
      ...state,
      completed: true,
      completedAt: new Date().toISOString(),
      lastStepIndex: undefined,
      stepsCompleted: state.stepsCompleted.includes(lastStepId!)
        ? state.stepsCompleted
        : [...state.stepsCompleted, lastStepId!],
    };
    setState(newState);
    saveState(newState);

    trackEvent('tour_completed', {
      totalSteps,
      stepsCompleted: newState.stepsCompleted.length,
    });
  }, [state, steps, totalSteps, trackEvent]);

  /**
   * Reset tour state (allows restarting)
   */
  const resetTour = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);

    const newState: TourState = {
      completed: false,
      skipped: false,
      stepsCompleted: [],
      startCount: state.startCount,
    };
    setState(newState);
    saveState(newState);
  }, [state.startCount]);

  // Memoize return value
  return useMemo(() => ({
    isActive,
    currentStep,
    totalSteps,
    currentStepConfig,
    steps,
    startTour,
    nextStep,
    prevStep,
    goToStep,
    skipTour,
    completeTour,
    resetTour,
    shouldAutoStart,
    hasCompletedTour,
    progress,
    trackEvent,
  }), [
    isActive,
    currentStep,
    totalSteps,
    currentStepConfig,
    steps,
    startTour,
    nextStep,
    prevStep,
    goToStep,
    skipTour,
    completeTour,
    resetTour,
    shouldAutoStart,
    hasCompletedTour,
    progress,
    trackEvent,
  ]);
}

export default useOnboardingTour;
