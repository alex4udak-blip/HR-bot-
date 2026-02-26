import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lightbulb } from 'lucide-react';
import clsx from 'clsx';
import { useOnboarding, type TooltipId } from '@/hooks/useOnboarding';

/**
 * Position of the tooltip relative to the target element
 */
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

/**
 * Props for the OnboardingTooltip component
 */
export interface OnboardingTooltipProps {
  /** Unique identifier for this tooltip */
  id: TooltipId;
  /** Content to display in the tooltip */
  content: string;
  /** Position relative to the target element */
  position?: TooltipPosition;
  /** Delay before showing the tooltip (ms) */
  delay?: number;
  /** Whether the tooltip is enabled */
  enabled?: boolean;
  /** Custom class name for additional styling */
  className?: string;
  /** Children to wrap (the target element) */
  children: React.ReactNode;
  /** Callback when tooltip is dismissed */
  onDismiss?: () => void;
}

/**
 * Arrow component for the tooltip
 */
const TooltipArrow = ({ position }: { position: TooltipPosition }) => {
  const arrowClasses = clsx(
    'absolute w-3 h-3 bg-gradient-to-br from-blue-600 to-purple-600 rotate-45',
    {
      'left-1/2 -translate-x-1/2 -bottom-1.5': position === 'top',
      'left-1/2 -translate-x-1/2 -top-1.5': position === 'bottom',
      'top-1/2 -translate-y-1/2 -right-1.5': position === 'left',
      'top-1/2 -translate-y-1/2 -left-1.5': position === 'right',
    }
  );

  return <div className={arrowClasses} />;
};

/**
 * Get tooltip container position styles based on position prop
 */
const getPositionStyles = (position: TooltipPosition): string => {
  switch (position) {
    case 'top':
      return 'bottom-full left-1/2 -translate-x-1/2 mb-3';
    case 'bottom':
      return 'top-full left-1/2 -translate-x-1/2 mt-3';
    case 'left':
      return 'right-full top-1/2 -translate-y-1/2 mr-3';
    case 'right':
      return 'left-full top-1/2 -translate-y-1/2 ml-3';
    default:
      return 'bottom-full left-1/2 -translate-x-1/2 mb-3';
  }
};

/**
 * Get animation variants based on position
 */
const getAnimationVariants = (position: TooltipPosition) => {
  const offset = 10;
  const initial: { opacity: number; x?: number; y?: number; scale: number } = {
    opacity: 0,
    scale: 0.95,
  };
  const animate: { opacity: number; x: number; y: number; scale: number } = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
  };

  switch (position) {
    case 'top':
      initial.y = offset;
      break;
    case 'bottom':
      initial.y = -offset;
      break;
    case 'left':
      initial.x = offset;
      break;
    case 'right':
      initial.x = -offset;
      break;
  }

  return { initial, animate };
};

/**
 * OnboardingTooltip Component
 *
 * Displays a helpful tooltip for new users on first visit.
 * The tooltip can be dismissed with a "Got it" button and stores
 * the dismissed state in localStorage.
 *
 * Features:
 * - Pulse animation on first show
 * - Arrow pointing to the target element
 * - Blue/purple gradient highlight
 * - Configurable position (top/bottom/left/right)
 * - Automatic persistence via localStorage
 *
 * @example
 * ```tsx
 * <OnboardingTooltip
 *   id="vacancies-page"
 *   content="Create vacancies and track candidates through the hiring pipeline"
 *   position="bottom"
 * >
 *   <button>New Vacancy</button>
 * </OnboardingTooltip>
 * ```
 */
export function OnboardingTooltip({
  id,
  content,
  position = 'top',
  delay = 500,
  enabled = true,
  className,
  children,
  onDismiss,
}: OnboardingTooltipProps) {
  const { hasSeenTooltip, markTooltipSeen } = useOnboarding();
  const [isVisible, setIsVisible] = useState(false);
  const [showPulse, setShowPulse] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine if tooltip should show
  const shouldShow = enabled && !hasSeenTooltip(id);

  // Show tooltip after delay
  useEffect(() => {
    if (!shouldShow) {
      setIsVisible(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [shouldShow, delay]);

  // Stop pulse animation after a few seconds
  useEffect(() => {
    if (isVisible && showPulse) {
      const timer = setTimeout(() => {
        setShowPulse(false);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isVisible, showPulse]);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    markTooltipSeen(id);
    setIsVisible(false);
    onDismiss?.();
  }, [id, markTooltipSeen, onDismiss]);

  // Handle click outside
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        // Don't auto-dismiss on click outside, only on "Got it" button
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible]);

  // Handle escape key
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, handleDismiss]);

  const positionStyles = getPositionStyles(position);
  const { initial, animate } = getAnimationVariants(position);

  return (
    <div ref={containerRef} className={clsx('relative inline-block', className)}>
      {/* Target element */}
      {children}

      {/* Tooltip */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={initial}
            animate={animate}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={clsx(
              'absolute z-50 w-72',
              positionStyles
            )}
          >
            {/* Pulse animation ring */}
            {showPulse && (
              <motion.div
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500"
                animate={{
                  scale: [1, 1.05, 1],
                  opacity: [0.5, 0.3, 0.5],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            )}

            {/* Main tooltip container */}
            <div className="relative bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl p-0.5 shadow-xl shadow-purple-500/20">
              <div className="glass rounded-[10px] p-4">
                {/* Header */}
                <div className="flex items-start gap-3 mb-2">
                  <div className="p-1.5 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg flex-shrink-0">
                    <Lightbulb className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/90 leading-relaxed">
                      {content}
                    </p>
                  </div>
                  <button
                    onClick={handleDismiss}
                    className="p-1 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0 -mt-1 -mr-1"
                    aria-label="Dismiss tooltip"
                  >
                    <X className="w-4 h-4 text-white/60" />
                  </button>
                </div>

                {/* Action button */}
                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleDismiss}
                    className="px-4 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-lg shadow-purple-500/20"
                  >
                    Got it
                  </button>
                </div>
              </div>

              {/* Arrow */}
              <TooltipArrow position={position} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default OnboardingTooltip;
