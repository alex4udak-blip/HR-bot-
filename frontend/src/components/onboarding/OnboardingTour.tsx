import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  SkipForward,
  Check,
} from 'lucide-react';
import clsx from 'clsx';
import { useOnboardingTour, type TourStep } from '@/hooks/useOnboardingTour';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Position of the tooltip relative to spotlight
 */
interface TooltipPosition {
  top: number;
  left: number;
  transformOrigin: string;
}

/**
 * Props for OnboardingTour component
 */
export interface OnboardingTourProps {
  /** Custom tour steps (optional, uses defaults if not provided) */
  steps?: TourStep[];
  /** Whether to auto-start for new users */
  autoStart?: boolean;
  /** Callback when tour completes */
  onComplete?: () => void;
  /** Callback when tour is skipped */
  onSkip?: () => void;
}

/**
 * Calculate spotlight dimensions for target element
 */
const getSpotlightRect = (
  target: string,
  padding: number = 8
): DOMRect | null => {
  const element = document.querySelector(target);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return new DOMRect(
    rect.left - padding,
    rect.top - padding,
    rect.width + padding * 2,
    rect.height + padding * 2
  );
};

/**
 * Calculate tooltip position based on target and placement
 */
const calculateTooltipPosition = (
  targetRect: DOMRect,
  placement: TourStep['placement'],
  tooltipWidth: number = 320,
  tooltipHeight: number = 200
): TooltipPosition => {
  const gap = 16; // Gap between spotlight and tooltip
  const viewportPadding = 16;

  let top = 0;
  let left = 0;
  let transformOrigin = 'center center';

  switch (placement) {
    case 'top':
      top = targetRect.top - tooltipHeight - gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      transformOrigin = 'bottom center';
      break;
    case 'bottom':
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      transformOrigin = 'top center';
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      left = targetRect.left - tooltipWidth - gap;
      transformOrigin = 'center right';
      break;
    case 'right':
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      left = targetRect.right + gap;
      transformOrigin = 'center left';
      break;
  }

  // Ensure tooltip stays within viewport
  const maxLeft = window.innerWidth - tooltipWidth - viewportPadding;
  const maxTop = window.innerHeight - tooltipHeight - viewportPadding;

  left = Math.max(viewportPadding, Math.min(left, maxLeft));
  top = Math.max(viewportPadding, Math.min(top, maxTop));

  return { top, left, transformOrigin };
};

/**
 * Arrow component pointing to target
 */
const TooltipArrow = ({
  placement,
  spotlightRect,
  tooltipPosition,
}: {
  placement: TourStep['placement'];
  spotlightRect: DOMRect;
  tooltipPosition: TooltipPosition;
}) => {
  const arrowSize = 12;

  // Calculate arrow position based on placement
  let arrowStyle: React.CSSProperties = {};
  let rotation = 0;

  switch (placement) {
    case 'top':
      rotation = 180;
      arrowStyle = {
        bottom: -arrowSize / 2,
        left: Math.min(
          Math.max(spotlightRect.left + spotlightRect.width / 2 - tooltipPosition.left - arrowSize / 2, 16),
          320 - 32
        ),
      };
      break;
    case 'bottom':
      rotation = 0;
      arrowStyle = {
        top: -arrowSize / 2,
        left: Math.min(
          Math.max(spotlightRect.left + spotlightRect.width / 2 - tooltipPosition.left - arrowSize / 2, 16),
          320 - 32
        ),
      };
      break;
    case 'left':
      rotation = 90;
      arrowStyle = {
        right: -arrowSize / 2,
        top: Math.min(
          Math.max(spotlightRect.top + spotlightRect.height / 2 - tooltipPosition.top - arrowSize / 2, 16),
          200 - 32
        ),
      };
      break;
    case 'right':
      rotation = -90;
      arrowStyle = {
        left: -arrowSize / 2,
        top: Math.min(
          Math.max(spotlightRect.top + spotlightRect.height / 2 - tooltipPosition.top - arrowSize / 2, 16),
          200 - 32
        ),
      };
      break;
  }

  return (
    <div
      className="absolute w-3 h-3"
      style={{
        ...arrowStyle,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-600 rotate-45" />
    </div>
  );
};

/**
 * OnboardingTour Component
 *
 * Provides a step-by-step interactive tour of the HR-bot interface.
 *
 * Features:
 * - Spotlight overlay highlighting target elements
 * - Animated tooltips with navigation
 * - Progress indicator
 * - Auto-start for new users
 * - Route navigation between steps
 * - Keyboard navigation (Escape to close)
 *
 * @example
 * ```tsx
 * // In App.tsx or Layout.tsx
 * <OnboardingTour autoStart onComplete={() => console.log('Tour completed!')} />
 * ```
 */
export function OnboardingTour({
  steps,
  autoStart = true,
  onComplete,
  onSkip,
}: OnboardingTourProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const tooltipRef = useRef<HTMLDivElement>(null);

  const {
    isActive,
    currentStep,
    totalSteps,
    currentStepConfig,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
    shouldAutoStart,
    progress,
  } = useOnboardingTour(steps);

  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({
    top: 0,
    left: 0,
    transformOrigin: 'center center',
  });
  const [isNavigating, setIsNavigating] = useState(false);

  // Auto-start tour for new users
  useEffect(() => {
    if (autoStart && shouldAutoStart) {
      // Small delay to let the app render first
      const timer = setTimeout(() => {
        startTour();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoStart, shouldAutoStart, startTour]);

  // Navigate to step route if needed
  useEffect(() => {
    if (!isActive || !currentStepConfig?.route) return;

    const targetRoute = currentStepConfig.route;
    if (location.pathname !== targetRoute) {
      setIsNavigating(true);
      navigate(targetRoute);
    }
  }, [isActive, currentStepConfig, location.pathname, navigate]);

  // Update spotlight position when step changes or after navigation
  useEffect(() => {
    if (!isActive || !currentStepConfig) {
      setSpotlightRect(null);
      return;
    }

    const updatePosition = () => {
      const rect = getSpotlightRect(
        currentStepConfig.target,
        currentStepConfig.spotlightPadding
      );

      if (rect) {
        setSpotlightRect(rect);
        setIsNavigating(false);

        // Calculate tooltip position
        const pos = calculateTooltipPosition(rect, currentStepConfig.placement);
        setTooltipPosition(pos);
      }
    };

    // Initial update with delay for navigation
    const timer = setTimeout(updatePosition, isNavigating ? 500 : 100);

    // Update on scroll/resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isActive, currentStepConfig, isNavigating]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          handleSkip();
          break;
        case 'ArrowRight':
        case 'Enter':
          if (currentStep < totalSteps - 1) {
            handleNext();
          } else {
            handleComplete();
          }
          break;
        case 'ArrowLeft':
          if (currentStep > 0) {
            prevStep();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, currentStep, totalSteps, prevStep]);

  // Handlers
  const handleNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      nextStep();
    }
  }, [currentStep, totalSteps, nextStep]);

  const handleComplete = useCallback(() => {
    completeTour();
    onComplete?.();
  }, [completeTour, onComplete]);

  const handleSkip = useCallback(() => {
    skipTour();
    onSkip?.();
  }, [skipTour, onSkip]);

  // Don't render if tour is not active
  if (!isActive || !currentStepConfig) {
    return null;
  }

  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  return createPortal(
    <AnimatePresence>
      {isActive && (
        <>
          {/* Overlay with spotlight cutout */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[9998] pointer-events-auto"
            onClick={handleSkip}
          >
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/70" />

            {/* Spotlight cutout (if target found) */}
            {spotlightRect && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="absolute rounded-lg ring-4 ring-cyan-400/50"
                style={{
                  left: spotlightRect.left,
                  top: spotlightRect.top,
                  width: spotlightRect.width,
                  height: spotlightRect.height,
                  boxShadow: `
                    0 0 0 9999px rgba(0, 0, 0, 0.7),
                    0 0 30px 10px rgba(34, 211, 238, 0.3)
                  `,
                }}
              />
            )}
          </motion.div>

          {/* Tooltip */}
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="fixed z-[9999] w-80 pointer-events-auto"
            style={{
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              transformOrigin: tooltipPosition.transformOrigin,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Main tooltip container */}
            <div className="relative bg-gradient-to-br from-cyan-600 to-blue-600 rounded-2xl p-0.5 shadow-2xl shadow-cyan-500/20">
              <div className="glass rounded-[14px] overflow-hidden">
                {/* Header with icon and close button */}
                <div className="flex items-center justify-between p-4 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-lg">
                      <Lightbulb className="w-5 h-5 text-yellow-400" />
                    </div>
                    <span className="text-xs text-cyan-400 font-medium">
                      Шаг {currentStep + 1} из {totalSteps}
                    </span>
                  </div>
                  <button
                    onClick={handleSkip}
                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Закрыть тур"
                  >
                    <X className="w-4 h-4 text-white/60" />
                  </button>
                </div>

                {/* Content */}
                <div className="px-4 pb-3">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {currentStepConfig.title}
                  </h3>
                  <p className="text-sm text-white/80 leading-relaxed">
                    {currentStepConfig.content}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="px-4 pb-3">
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan-400 to-blue-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between p-4 pt-2 border-t border-white/10">
                  <button
                    onClick={handleSkip}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:bg-dark-800/50 rounded-lg transition-colors"
                  >
                    <SkipForward className="w-4 h-4" />
                    Пропустить
                  </button>

                  <div className="flex items-center gap-2">
                    {!isFirstStep && (
                      <button
                        onClick={prevStep}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-white/80 hover:text-white glass-light hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Назад
                      </button>
                    )}

                    {isLastStep ? (
                      <button
                        onClick={handleComplete}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 rounded-lg transition-all shadow-lg shadow-cyan-500/20"
                      >
                        <Check className="w-4 h-4" />
                        Завершить
                      </button>
                    ) : (
                      <button
                        onClick={handleNext}
                        className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 rounded-lg transition-all shadow-lg shadow-cyan-500/20"
                      >
                        Далее
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Arrow pointing to target */}
              {spotlightRect && (
                <TooltipArrow
                  placement={currentStepConfig.placement}
                  spotlightRect={spotlightRect}
                  tooltipPosition={tooltipPosition}
                />
              )}
            </div>
          </motion.div>

          {/* Step dots indicator */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 p-2 glass backdrop-blur-sm rounded-full"
          >
            {Array.from({ length: totalSteps }).map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  if (index < currentStep) {
                    // Can go back to previous steps
                    for (let i = 0; i < currentStep - index; i++) {
                      setTimeout(() => prevStep(), i * 100);
                    }
                  } else if (index > currentStep) {
                    // Can go forward
                    for (let i = 0; i < index - currentStep; i++) {
                      setTimeout(() => nextStep(), i * 100);
                    }
                  }
                }}
                className={clsx(
                  'w-2.5 h-2.5 rounded-full transition-all duration-300',
                  index === currentStep
                    ? 'w-6 bg-gradient-to-r from-cyan-400 to-blue-400'
                    : index < currentStep
                    ? 'bg-cyan-400/50 hover:bg-cyan-400/70'
                    : 'bg-white/20 hover:bg-white/30'
                )}
                aria-label={`Перейти к шагу ${index + 1}`}
              />
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default OnboardingTour;
