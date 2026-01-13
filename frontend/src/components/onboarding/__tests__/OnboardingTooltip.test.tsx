import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OnboardingTooltip from '../OnboardingTooltip';
import type { TooltipId } from '@/hooks/useOnboarding';

/**
 * Tests for OnboardingTooltip component
 * Verifies tooltip display, dismissal, positioning, and localStorage integration
 */

// Storage key used by the onboarding hook
const STORAGE_KEY = 'hr-bot-onboarding-state';

describe('OnboardingTooltip', () => {
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

  const defaultProps = {
    id: 'vacancies-page' as TooltipId,
    content: 'Test tooltip content',
    children: <button>Target Button</button>,
  };

  describe('Initial rendering', () => {
    it('should render children', () => {
      render(<OnboardingTooltip {...defaultProps} />);

      expect(screen.getByText('Target Button')).toBeInTheDocument();
    });

    it('should not show tooltip immediately with default delay', () => {
      render(<OnboardingTooltip {...defaultProps} />);

      expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
    });

    it('should show tooltip after delay', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should show "Got it" button', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByText('Got it')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });

  describe('Dismissal behavior', () => {
    it('should dismiss tooltip when "Got it" is clicked', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByText('Got it')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      fireEvent.click(screen.getByText('Got it'));

      await waitFor(() => {
        expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
      });
    });

    it('should dismiss tooltip when close button is clicked', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByLabelText('Dismiss tooltip')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      fireEvent.click(screen.getByLabelText('Dismiss tooltip'));

      await waitFor(() => {
        expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
      });
    });

    it('should dismiss tooltip when Escape key is pressed', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByText('Got it')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
      });
    });

    it('should call onDismiss callback when dismissed', async () => {
      const onDismiss = vi.fn();
      render(<OnboardingTooltip {...defaultProps} delay={10} onDismiss={onDismiss} />);

      await waitFor(
        () => {
          expect(screen.getByText('Got it')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      fireEvent.click(screen.getByText('Got it'));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('should persist dismissal to localStorage', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByText('Got it')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      fireEvent.click(screen.getByText('Got it'));

      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalled();
      });

      const savedData = JSON.parse(mockStorage[STORAGE_KEY]);
      expect(savedData.seenTooltips).toContain('vacancies-page');
    });
  });

  describe('Previously seen tooltips', () => {
    it('should not show tooltip if already seen', async () => {
      // Simulate tooltip already seen
      mockStorage[STORAGE_KEY] = JSON.stringify({
        seenTooltips: ['vacancies-page'],
      });

      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      // Wait a bit to make sure tooltip doesn't appear
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
    });

    it('should show tooltip for different ID', async () => {
      // Mark a different tooltip as seen
      mockStorage[STORAGE_KEY] = JSON.stringify({
        seenTooltips: ['contacts-page'],
      });

      render(<OnboardingTooltip {...defaultProps} delay={10} />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });

  describe('Enabled prop', () => {
    it('should not show tooltip when enabled is false', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} enabled={false} />);

      // Wait a bit to make sure tooltip doesn't appear
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
    });

    it('should show tooltip when enabled is true', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} enabled={true} />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });

  describe('Position variants', () => {
    it('should render with top position', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} position="top" />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should render with bottom position', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} position="bottom" />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should render with left position', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} position="left" />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should render with right position', async () => {
      render(<OnboardingTooltip {...defaultProps} delay={10} position="right" />);

      await waitFor(
        () => {
          expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });

  describe('Custom styling', () => {
    it('should accept custom className', async () => {
      const { container } = render(
        <OnboardingTooltip {...defaultProps} delay={10} className="custom-class" />
      );

      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  describe('Different tooltip IDs', () => {
    it('should work with kanban-board ID', async () => {
      render(
        <OnboardingTooltip
          id="kanban-board"
          content="Kanban board tooltip"
          delay={10}
        >
          <button>Kanban</button>
        </OnboardingTooltip>
      );

      await waitFor(
        () => {
          expect(screen.getByText('Kanban board tooltip')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should work with contacts-page ID', async () => {
      render(
        <OnboardingTooltip
          id="contacts-page"
          content="Contacts page tooltip"
          delay={10}
        >
          <button>Contacts</button>
        </OnboardingTooltip>
      );

      await waitFor(
        () => {
          expect(screen.getByText('Contacts page tooltip')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should work with parser-modal ID', async () => {
      render(
        <OnboardingTooltip
          id="parser-modal"
          content="Parser modal tooltip"
          delay={10}
        >
          <button>Parser</button>
        </OnboardingTooltip>
      );

      await waitFor(
        () => {
          expect(screen.getByText('Parser modal tooltip')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });
});
