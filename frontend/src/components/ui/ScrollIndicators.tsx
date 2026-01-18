import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface ScrollIndicatorsProps {
  /** Whether to show indicators (typically when dragging) */
  isActive: boolean;
  /** Current scroll direction */
  direction: 'left' | 'right' | null;
  /** Scroll intensity 0-1 for animation effects */
  intensity: number;
  /** Whether there's content to scroll to on the left */
  canScrollLeft: boolean;
  /** Whether there's content to scroll to on the right */
  canScrollRight: boolean;
  /** Children to wrap */
  children: React.ReactNode;
  /** Additional class for the container */
  className?: string;
}

/**
 * Scroll indicators component that wraps a horizontally scrollable container.
 *
 * Shows gradient overlays with chevron icons on the edges when:
 * 1. isActive is true (user is dragging)
 * 2. There's content to scroll in that direction
 *
 * The active direction gets highlighted with increased opacity and pulsing animation.
 *
 * @example
 * ```tsx
 * <ScrollIndicators
 *   isActive={isDragging}
 *   direction={scrollDirection}
 *   intensity={scrollIntensity}
 *   canScrollLeft={canScrollLeft}
 *   canScrollRight={canScrollRight}
 * >
 *   <div className="overflow-x-auto">
 *     ...content...
 *   </div>
 * </ScrollIndicators>
 * ```
 */
export function ScrollIndicators({
  isActive,
  direction,
  intensity,
  canScrollLeft,
  canScrollRight,
  children,
  className,
}: ScrollIndicatorsProps) {
  const showLeft = isActive && canScrollLeft;
  const showRight = isActive && canScrollRight;
  const isScrollingLeft = direction === 'left';
  const isScrollingRight = direction === 'right';

  return (
    <div className={clsx('relative', className)}>
      {/* Left indicator */}
      <AnimatePresence>
        {showLeft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute left-0 top-0 bottom-0 w-20 pointer-events-none z-20 flex items-center justify-start pl-2"
            style={{
              background: `linear-gradient(to right, rgba(59, 130, 246, ${
                isScrollingLeft ? 0.25 + intensity * 0.25 : 0.15
              }), transparent)`,
            }}
          >
            <motion.div
              animate={
                isScrollingLeft
                  ? {
                      x: [-4, 0, -4],
                      opacity: [0.7, 1, 0.7],
                    }
                  : { x: 0, opacity: 0.5 }
              }
              transition={
                isScrollingLeft
                  ? {
                      duration: 0.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }
                  : { duration: 0.2 }
              }
              className={clsx(
                'flex items-center justify-center w-10 h-10 rounded-full',
                isScrollingLeft
                  ? 'bg-blue-500/30 text-blue-300'
                  : 'bg-white/10 text-white/40'
              )}
            >
              <ChevronLeft className="w-6 h-6" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      {children}

      {/* Right indicator */}
      <AnimatePresence>
        {showRight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 top-0 bottom-0 w-20 pointer-events-none z-20 flex items-center justify-end pr-2"
            style={{
              background: `linear-gradient(to left, rgba(59, 130, 246, ${
                isScrollingRight ? 0.25 + intensity * 0.25 : 0.15
              }), transparent)`,
            }}
          >
            <motion.div
              animate={
                isScrollingRight
                  ? {
                      x: [4, 0, 4],
                      opacity: [0.7, 1, 0.7],
                    }
                  : { x: 0, opacity: 0.5 }
              }
              transition={
                isScrollingRight
                  ? {
                      duration: 0.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }
                  : { duration: 0.2 }
              }
              className={clsx(
                'flex items-center justify-center w-10 h-10 rounded-full',
                isScrollingRight
                  ? 'bg-blue-500/30 text-blue-300'
                  : 'bg-white/10 text-white/40'
              )}
            >
              <ChevronRight className="w-6 h-6" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ScrollIndicators;
