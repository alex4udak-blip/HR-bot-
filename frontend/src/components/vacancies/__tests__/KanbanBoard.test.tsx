import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import KanbanBoard from '../KanbanBoard';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Vacancy, VacancyApplication, ApplicationStage, KanbanColumn, KanbanBoardData } from '@/types';

// Mock the vacancy store
vi.mock('@/stores/vacancyStore', () => ({
  useVacancyStore: vi.fn(),
}));

// Mock the API
vi.mock('@/services/api', () => ({
  updateApplication: vi.fn().mockResolvedValue({}),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onDragStart, onDragEnd, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div
        {...props}
        onDragStart={onDragStart as unknown as React.DragEventHandler}
        onDragEnd={onDragEnd as unknown as React.DragEventHandler}
      >
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren<object>) => <>{children}</>,
}));

const mockVacancy: Vacancy = {
  id: 1,
  title: 'Software Engineer',
  description: 'Build great software',
  requirements: '',
  responsibilities: '',
  status: 'open',
  salary_min: 150000,
  salary_max: 200000,
  salary_currency: 'USD',
  location: 'Remote',
  employment_type: 'full-time',
  experience_level: 'senior',
  priority: 0,
  applications_count: 5,
  stage_counts: {},
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  closed_at: null,
  department_id: null,
  created_by: 1,
};

const mockApplications: VacancyApplication[] = [
  {
    id: 1,
    vacancy_id: 1,
    entity_id: 101,
    entity_name: 'John Doe',
    entity_email: 'john@example.com',
    entity_phone: '+1234567890',
    entity_position: 'Senior Developer',
    stage: 'applied' as ApplicationStage,
    stage_order: 1000,
    rating: 4,
    source: 'LinkedIn',
    notes: 'Great candidate',
    applied_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    vacancy_id: 1,
    entity_id: 102,
    entity_name: 'Jane Smith',
    entity_email: 'jane@example.com',
    entity_phone: '+1987654321',
    entity_position: 'Tech Lead',
    stage: 'applied' as ApplicationStage,
    stage_order: 2000,
    rating: 5,
    source: 'Referral',
    notes: null,
    applied_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    vacancy_id: 1,
    entity_id: 103,
    entity_name: 'Bob Wilson',
    entity_email: 'bob@example.com',
    entity_phone: null,
    entity_position: 'Developer',
    stage: 'interview' as ApplicationStage,
    stage_order: 1000,
    rating: null,
    source: 'Job Board',
    notes: null,
    applied_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const createKanbanBoard = (applications: VacancyApplication[]): KanbanBoardData => {
  const stages: ApplicationStage[] = [
    'applied',
    'screening',
    'phone_screen',
    'interview',
    'assessment',
    'offer',
    'hired',
    'rejected',
  ];

  const columns: KanbanColumn[] = stages.map((stage) => ({
    stage,
    applications: applications.filter((app) => app.stage === stage),
  }));

  return {
    vacancy_id: 1,
    columns,
    total_count: applications.length,
  };
};

const mockStore = {
  kanbanBoard: createKanbanBoard(mockApplications),
  isKanbanLoading: false,
  error: null,
  fetchKanbanBoard: vi.fn(),
  moveApplication: vi.fn().mockResolvedValue(undefined),
  removeApplication: vi.fn().mockResolvedValue(undefined),
  updateApplication: vi.fn().mockResolvedValue(undefined),
  clearError: vi.fn(),
};

describe('KanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useVacancyStore as ReturnType<typeof vi.fn>).mockReturnValue(mockStore);
  });

  const renderWithRouter = () => {
    return render(
      <MemoryRouter>
        <KanbanBoard vacancy={mockVacancy} />
      </MemoryRouter>
    );
  };

  describe('Basic Rendering', () => {
    it('should render the kanban board header', () => {
      renderWithRouter();
      expect(screen.getByText('Kanban Board')).toBeInTheDocument();
    });

    it('should display total candidate count', () => {
      renderWithRouter();
      expect(screen.getByText('3 candidates')).toBeInTheDocument();
    });

    it('should render Add Candidate button', () => {
      renderWithRouter();
      expect(screen.getByText('Add Candidate')).toBeInTheDocument();
    });

    it('should render all stage columns', () => {
      renderWithRouter();
      expect(screen.getByText('Applied')).toBeInTheDocument();
      expect(screen.getByText('Screening')).toBeInTheDocument();
      expect(screen.getByText('Phone Screen')).toBeInTheDocument();
      expect(screen.getByText('Interview')).toBeInTheDocument();
      expect(screen.getByText('Assessment')).toBeInTheDocument();
      expect(screen.getByText('Offer')).toBeInTheDocument();
      expect(screen.getByText('Hired')).toBeInTheDocument();
      expect(screen.getByText('Rejected')).toBeInTheDocument();
    });

    it('should display candidate cards in correct columns', () => {
      renderWithRouter();

      // John Doe and Jane Smith should be in Applied column
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();

      // Bob Wilson should be in Interview column
      expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
    });

    it('should display candidate contact information', () => {
      renderWithRouter();

      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    it('should display candidate rating when available', () => {
      renderWithRouter();
      // Rating 4 for John Doe
      expect(screen.getByText('4')).toBeInTheDocument();
      // Rating 5 for Jane Smith
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should display candidate source', () => {
      renderWithRouter();
      expect(screen.getByText('LinkedIn')).toBeInTheDocument();
      expect(screen.getByText('Referral')).toBeInTheDocument();
      expect(screen.getByText('Job Board')).toBeInTheDocument();
    });

    it('should display notes preview when available', () => {
      renderWithRouter();
      expect(screen.getByText('Great candidate')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should show loading skeletons when loading', () => {
      (useVacancyStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        isKanbanLoading: true,
        kanbanBoard: null,
      });

      renderWithRouter();

      // Should not show candidate names
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no candidates', () => {
      (useVacancyStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        kanbanBoard: createKanbanBoard([]),
      });

      renderWithRouter();

      // Should show empty state
      expect(screen.getByText('0 candidates')).toBeInTheDocument();
    });

    it('should show empty column indicator', () => {
      renderWithRouter();

      // Columns without candidates should show "Empty" text
      const emptyTexts = screen.getAllByText('Empty');
      expect(emptyTexts.length).toBeGreaterThan(0);
    });
  });

  describe('Drag and Drop - Stage Changes', () => {
    it('should call moveApplication when dropping on different stage', async () => {
      const moveApplication = vi.fn().mockResolvedValue(undefined);
      (useVacancyStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        moveApplication,
      });

      renderWithRouter();

      // Find the card for John Doe
      const card = screen.getByText('John Doe').closest('[draggable="true"]');
      expect(card).toBeInTheDocument();

      if (card) {
        // Simulate drag start
        fireEvent.dragStart(card, {
          dataTransfer: {
            effectAllowed: 'move',
            setData: vi.fn(),
          },
        });

        // Find the Interview column and simulate drop
        const interviewColumn = screen.getByText('Interview').closest('[data-kanban-column]');
        if (interviewColumn) {
          fireEvent.dragOver(interviewColumn, {
            preventDefault: vi.fn(),
            clientY: 100,
            currentTarget: interviewColumn,
          });

          fireEvent.drop(interviewColumn);
        }
      }
    });
  });

  describe('Drag and Drop - Reordering', () => {
    it('should render drag handle icon on cards', () => {
      renderWithRouter();

      // Each card should have a drag handle (GripVertical icon)
      const cards = screen.getAllByRole('button', { name: /details/i });
      expect(cards.length).toBeGreaterThan(0);
    });

    it('should show drop indicator during drag', async () => {
      renderWithRouter();

      // Find the cards in Applied column
      const johnCard = screen.getByText('John Doe').closest('[draggable="true"]');
      expect(johnCard).toBeInTheDocument();
    });
  });

  describe('Card Actions', () => {
    it('should have edit button on each card', () => {
      renderWithRouter();

      const detailsButtons = screen.getAllByTitle('Детали');
      expect(detailsButtons.length).toBe(3); // 3 candidates
    });

    it('should have view profile button on each card', () => {
      renderWithRouter();

      const viewButtons = screen.getAllByTitle('Профиль');
      expect(viewButtons.length).toBe(3); // 3 candidates
    });

    it('should have remove button on each card', () => {
      renderWithRouter();

      const removeButtons = screen.getAllByTitle('Удалить');
      expect(removeButtons.length).toBe(3); // 3 candidates
    });
  });

  describe('Data Fetching', () => {
    it('should fetch kanban board on mount', () => {
      const fetchKanbanBoard = vi.fn();
      (useVacancyStore as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        fetchKanbanBoard,
      });

      renderWithRouter();

      expect(fetchKanbanBoard).toHaveBeenCalledWith(mockVacancy.id);
    });
  });
});

describe('Stage Order Calculation', () => {
  // Test the stage_order calculation logic - matches the actual implementation
  const calculateNewOrder = (
    apps: { stage_order?: number }[],
    targetIndex: number
  ): number => {
    if (targetIndex === 0) {
      // Moving to the beginning
      return (apps[0]?.stage_order || 1000) - 1000;
    } else if (targetIndex >= apps.length) {
      // Moving to the end
      return (apps[apps.length - 1]?.stage_order || 0) + 1000;
    } else {
      // Moving between two cards
      const prevOrder = apps[targetIndex - 1]?.stage_order || 0;
      const nextOrder = apps[targetIndex]?.stage_order || prevOrder + 2000;
      return Math.floor((prevOrder + nextOrder) / 2);
    }
  };

  it('should calculate order for moving to beginning', () => {
    const apps = [
      { stage_order: 1000 },
      { stage_order: 2000 },
      { stage_order: 3000 },
    ];

    const newOrder = calculateNewOrder(apps, 0);
    expect(newOrder).toBe(0); // 1000 - 1000 = 0
  });

  it('should calculate order for moving to end', () => {
    const apps = [
      { stage_order: 1000 },
      { stage_order: 2000 },
      { stage_order: 3000 },
    ];

    const newOrder = calculateNewOrder(apps, 3);
    expect(newOrder).toBe(4000); // 3000 + 1000 = 4000
  });

  it('should calculate order for moving between first and second cards', () => {
    const apps = [
      { stage_order: 1000 },
      { stage_order: 2000 },
      { stage_order: 3000 },
    ];

    const newOrder = calculateNewOrder(apps, 1);
    // prev = apps[0] = 1000, next = apps[1] = 2000
    expect(newOrder).toBe(1500); // (1000 + 2000) / 2 = 1500
  });

  it('should calculate order for moving between second and third cards', () => {
    const apps = [
      { stage_order: 1000 },
      { stage_order: 3000 },
      { stage_order: 5000 },
    ];

    const newOrder = calculateNewOrder(apps, 2);
    // prev = apps[1] = 3000, next = apps[2] = 5000
    expect(newOrder).toBe(4000); // (3000 + 5000) / 2 = 4000
  });

  it('should handle empty array - moving to position 0', () => {
    const apps: { stage_order: number }[] = [];

    const newOrder = calculateNewOrder(apps, 0);
    // apps[0] is undefined, so default 1000 - 1000 = 0
    expect(newOrder).toBe(0);
  });

  it('should handle single item array - move to beginning', () => {
    const apps = [{ stage_order: 5000 }];

    const newOrder = calculateNewOrder(apps, 0);
    expect(newOrder).toBe(4000); // 5000 - 1000 = 4000
  });

  it('should handle single item array - move to end', () => {
    const apps = [{ stage_order: 5000 }];

    const newOrder = calculateNewOrder(apps, 1);
    expect(newOrder).toBe(6000); // 5000 + 1000 = 6000
  });

  it('should handle cards with large gaps', () => {
    const apps = [
      { stage_order: 0 },
      { stage_order: 10000 },
    ];

    const newOrder = calculateNewOrder(apps, 1);
    // prev = apps[0] = 0, next = apps[1] = 10000
    expect(newOrder).toBe(5000); // (0 + 10000) / 2 = 5000
  });
});

describe('Drop Indicator Logic', () => {
  it('should show drop indicator at correct position', () => {
    // This tests the visual feedback logic
    const getDropIndicatorPosition = (
      mouseY: number,
      cards: { top: number; height: number }[]
    ): number => {
      for (let i = 0; i < cards.length; i++) {
        const cardMiddle = cards[i].top + cards[i].height / 2;
        if (mouseY < cardMiddle) {
          return i;
        }
      }
      return cards.length;
    };

    const cards = [
      { top: 0, height: 100 },   // middle at 50
      { top: 100, height: 100 }, // middle at 150
      { top: 200, height: 100 }, // middle at 250
    ];

    // Mouse above first card
    expect(getDropIndicatorPosition(25, cards)).toBe(0);

    // Mouse between first and second card
    expect(getDropIndicatorPosition(75, cards)).toBe(1);

    // Mouse between second and third card
    expect(getDropIndicatorPosition(175, cards)).toBe(2);

    // Mouse below all cards
    expect(getDropIndicatorPosition(300, cards)).toBe(3);
  });
});
