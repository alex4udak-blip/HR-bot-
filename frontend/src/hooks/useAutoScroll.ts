import { useCallback, useRef, useState, useEffect, RefObject } from 'react';

interface AutoScrollConfig {
  /** Pixels from edge to trigger scroll (default: 150) */
  threshold: number;
  /** Maximum scroll speed in pixels per frame (default: 20) */
  maxSpeed: number;
  /** Easing power - higher = more acceleration near edge (default: 2.5) */
  easingPower: number;
  /** Lerp factor for smooth speed transitions (default: 0.12) */
  lerpFactor: number;
}

interface UseAutoScrollReturn {
  /** Current scroll direction: 'left', 'right', or null when not scrolling */
  direction: 'left' | 'right' | null;
  /** Scroll intensity 0-1, useful for indicator animations */
  intensity: number;
  /** Whether container can scroll left */
  canScrollLeft: boolean;
  /** Whether container can scroll right */
  canScrollRight: boolean;
  /** Whether auto-scroll is currently active */
  isScrolling: boolean;
  /** Call this on drag move events */
  handleDragMove: (e: React.DragEvent | MouseEvent) => void;
  /** Call this to stop auto-scroll (on drag end/leave) */
  stopScroll: () => void;
  /** Update scroll capability state (call when container size changes) */
  updateScrollState: () => void;
}

const DEFAULT_CONFIG: AutoScrollConfig = {
  threshold: 150,
  maxSpeed: 20,
  easingPower: 2.5,
  lerpFactor: 0.12,
};

/**
 * Hook for smooth auto-scrolling during drag operations.
 *
 * Features:
 * - Ease-out acceleration near edges
 * - Smooth lerp interpolation between speed changes
 * - Visual state for scroll indicators
 * - Touch-friendly
 *
 * @example
 * ```tsx
 * const {
 *   direction,
 *   intensity,
 *   canScrollLeft,
 *   canScrollRight,
 *   handleDragMove,
 *   stopScroll
 * } = useAutoScroll(containerRef);
 *
 * <div
 *   ref={containerRef}
 *   onDragOver={handleDragMove}
 *   onDragLeave={stopScroll}
 * >
 *   ...
 * </div>
 * ```
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLDivElement>,
  config?: Partial<AutoScrollConfig>
): UseAutoScrollReturn {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // State for UI indicators
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const [intensity, setIntensity] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);

  // Refs for animation loop
  const animationRef = useRef<number | null>(null);
  const currentSpeedRef = useRef(0);
  const targetSpeedRef = useRef(0);
  const targetDirectionRef = useRef<'left' | 'right' | null>(null);

  // Update scroll capability state
  const updateScrollState = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  }, [containerRef]);

  // Initial scroll state and resize listener
  useEffect(() => {
    updateScrollState();

    const handleResize = () => updateScrollState();
    window.addEventListener('resize', handleResize);

    // Also update on scroll
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', updateScrollState);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('scroll', updateScrollState);
      }
    };
  }, [updateScrollState, containerRef]);

  // Stop auto-scroll
  const stopScroll = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    currentSpeedRef.current = 0;
    targetSpeedRef.current = 0;
    targetDirectionRef.current = null;
    setDirection(null);
    setIntensity(0);
    setIsScrolling(false);
  }, []);

  // Animation loop with lerp interpolation
  const animate = useCallback(() => {
    if (!containerRef.current) {
      stopScroll();
      return;
    }

    const container = containerRef.current;

    // Lerp towards target speed for smooth transitions
    const diff = targetSpeedRef.current - currentSpeedRef.current;
    currentSpeedRef.current += diff * cfg.lerpFactor;

    // Apply scroll
    if (Math.abs(currentSpeedRef.current) > 0.1) {
      container.scrollLeft += currentSpeedRef.current;
      updateScrollState();

      // Check if we've hit the edge
      const { scrollLeft, scrollWidth, clientWidth } = container;
      const atLeftEdge = scrollLeft <= 0;
      const atRightEdge = scrollLeft >= scrollWidth - clientWidth - 1;

      if ((targetDirectionRef.current === 'left' && atLeftEdge) ||
          (targetDirectionRef.current === 'right' && atRightEdge)) {
        // Slow down when hitting edge
        targetSpeedRef.current = 0;
      }

      animationRef.current = requestAnimationFrame(animate);
    } else if (targetSpeedRef.current !== 0) {
      // Continue if we have a target but haven't reached minimum speed
      animationRef.current = requestAnimationFrame(animate);
    } else {
      // Fully stopped
      currentSpeedRef.current = 0;
      setIsScrolling(false);
    }
  }, [containerRef, cfg.lerpFactor, stopScroll, updateScrollState]);

  // Start animation loop if not already running
  const startAnimation = useCallback(() => {
    if (animationRef.current === null) {
      setIsScrolling(true);
      animationRef.current = requestAnimationFrame(animate);
    }
  }, [animate]);

  // Handle drag move - calculate scroll direction and speed
  const handleDragMove = useCallback((e: React.DragEvent | MouseEvent) => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX;

    // Calculate distance from edges
    const distanceFromLeft = mouseX - rect.left;
    const distanceFromRight = rect.right - mouseX;

    // Determine scroll direction and calculate eased speed
    let newDirection: 'left' | 'right' | null = null;
    let newIntensity = 0;
    let newTargetSpeed = 0;

    if (distanceFromLeft < cfg.threshold && canScrollLeft) {
      // Scroll left
      newDirection = 'left';
      // Normalize distance (0 at edge, 1 at threshold)
      const normalizedDistance = Math.max(0, distanceFromLeft) / cfg.threshold;
      // Ease-out: faster near edge (when normalizedDistance is small)
      newIntensity = Math.pow(1 - normalizedDistance, cfg.easingPower);
      newTargetSpeed = -cfg.maxSpeed * newIntensity;
    } else if (distanceFromRight < cfg.threshold && canScrollRight) {
      // Scroll right
      newDirection = 'right';
      const normalizedDistance = Math.max(0, distanceFromRight) / cfg.threshold;
      newIntensity = Math.pow(1 - normalizedDistance, cfg.easingPower);
      newTargetSpeed = cfg.maxSpeed * newIntensity;
    }

    // Update state
    targetSpeedRef.current = newTargetSpeed;
    targetDirectionRef.current = newDirection;
    setDirection(newDirection);
    setIntensity(newIntensity);

    // Start or continue animation
    if (newDirection !== null) {
      startAnimation();
    } else {
      // Smoothly decelerate when leaving scroll zone
      targetSpeedRef.current = 0;
    }
  }, [containerRef, cfg.threshold, cfg.maxSpeed, cfg.easingPower, canScrollLeft, canScrollRight, startAnimation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return {
    direction,
    intensity,
    canScrollLeft,
    canScrollRight,
    isScrolling,
    handleDragMove,
    stopScroll,
    updateScrollState,
  };
}

export default useAutoScroll;
