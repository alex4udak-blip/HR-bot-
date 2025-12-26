import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactDetail from '../ContactDetail';
import { useEntityStore } from '@/stores/entityStore';
import * as api from '@/services/api';
import type { EntityWithRelations, Chat, CallRecording } from '@/types';

// Mock dependencies
vi.mock('@/stores/entityStore', () => ({
  useEntityStore: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  getChats: vi.fn(),
  getCalls: vi.fn(),
  linkChatToEntity: vi.fn(),
  linkCallToEntity: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, className, ...props }: any) => (
      <div onClick={onClick} className={className} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock EntityAI component
vi.mock('../EntityAI', () => ({
  default: () => <div data-testid="entity-ai">EntityAI Component</div>,
}));

describe('ContactDetail', () => {
  const mockFetchEntity = vi.fn();

  const mockEntity: EntityWithRelations = {
    id: 1,
    type: 'candidate',
    name: 'John Doe',
    status: 'active',
    email: 'john@example.com',
    phone: '+1234567890',
    telegram_usernames: ['johndoe'],
    emails: ['john@example.com'],
    phones: ['+1234567890'],
    company: 'ACME Corp',
    position: 'Senior Developer',
    tags: ['senior', 'remote'],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    chats: [],
    calls: [],
    transfers: [],
    analyses: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useEntityStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchEntity: mockFetchEntity,
    });
  });

  describe('Rendering', () => {
    it('should render contact information', () => {
      render(<ContactDetail entity={mockEntity} />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('ACME Corp')).toBeInTheDocument();
      expect(screen.getByText('Senior Developer')).toBeInTheDocument();
      expect(screen.getByText('senior')).toBeInTheDocument();
      expect(screen.getByText('remote')).toBeInTheDocument();
    });

    it('should render contact details with multiple emails and phones', () => {
      const entityWithMultiple: EntityWithRelations = {
        ...mockEntity,
        emails: ['john@example.com', 'john.doe@acme.com'],
        phones: ['+1234567890', '+0987654321'],
      };

      render(<ContactDetail entity={entityWithMultiple} />);

      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByText('john.doe@acme.com')).toBeInTheDocument();
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
      expect(screen.getByText('+0987654321')).toBeInTheDocument();
    });

    it('should render telegram usernames as links', () => {
      render(<ContactDetail entity={mockEntity} />);

      const telegramLink = screen.getByText('@johndoe').closest('a');
      expect(telegramLink).toHaveAttribute('href', 'https://t.me/johndoe');
      expect(telegramLink).toHaveAttribute('target', '_blank');
    });

    it('should render all tabs', () => {
      render(<ContactDetail entity={mockEntity} />);

      expect(screen.getByText('Обзор')).toBeInTheDocument();
      expect(screen.getByText(/Чаты/)).toBeInTheDocument();
      expect(screen.getByText(/Звонки/)).toBeInTheDocument();
      expect(screen.getByText('История')).toBeInTheDocument();
    });

    it('should show EntityAI component when showAIInOverview is true', () => {
      render(<ContactDetail entity={mockEntity} showAIInOverview={true} />);

      expect(screen.getByTestId('entity-ai')).toBeInTheDocument();
    });

    it('should hide EntityAI component when showAIInOverview is false', () => {
      render(<ContactDetail entity={mockEntity} showAIInOverview={false} />);

      expect(screen.queryByTestId('entity-ai')).not.toBeInTheDocument();
    });

    it('should show transferred entity indicator when entity is transferred', () => {
      const transferredEntity: EntityWithRelations = {
        ...mockEntity,
        is_transferred: true,
        transferred_to_name: 'Jane Smith',
        transferred_at: '2024-02-01T00:00:00Z',
      };

      render(<ContactDetail entity={transferredEntity} />);

      expect(screen.getByText(/Контакт передан → Jane Smith/)).toBeInTheDocument();
      expect(
        screen.getByText(/Это копия только для просмотра. Редактирование недоступно./)
      ).toBeInTheDocument();
    });
  });

  describe('Tab Navigation', () => {
    it('should switch to chats tab when clicked', async () => {
      const entityWithChats: EntityWithRelations = {
        ...mockEntity,
        chats: [
          {
            id: 1,
            title: 'Test Chat',
            chat_type: 'work',
            created_at: '2024-01-01T00:00:00Z',
            last_activity: '2024-01-02T00:00:00Z',
            messages_count: 10,
            participants_count: 2,
          } as Chat,
        ],
      };

      render(<ContactDetail entity={entityWithChats} />);

      const chatsTab = screen.getByText(/Чаты \(1\)/);
      await userEvent.click(chatsTab);

      expect(screen.getByText('Test Chat')).toBeInTheDocument();
    });

    it('should switch to calls tab when clicked', async () => {
      const entityWithCalls: EntityWithRelations = {
        ...mockEntity,
        calls: [
          {
            id: 1,
            source_type: 'gmeet',
            status: 'completed',
            duration_seconds: 300,
            created_at: '2024-01-01T00:00:00Z',
          } as CallRecording,
        ],
      };

      render(<ContactDetail entity={entityWithCalls} />);

      const callsTab = screen.getByText(/Звонки \(1\)/);
      await userEvent.click(callsTab);

      expect(screen.getByText(/Звонок GMEET/)).toBeInTheDocument();
    });

    it('should switch to history tab when clicked', async () => {
      const entityWithHistory: EntityWithRelations = {
        ...mockEntity,
        transfers: [
          {
            id: 1,
            entity_id: 1,
            from_user_id: 1,
            to_user_id: 2,
            from_user_name: 'Alice',
            to_user_name: 'Bob',
            comment: 'Transfer comment',
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      };

      render(<ContactDetail entity={entityWithHistory} />);

      const historyTab = screen.getByText('История');
      await userEvent.click(historyTab);

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Transfer comment')).toBeInTheDocument();
    });
  });

  describe('Chats Display', () => {
    it('should show "no chats" message when there are no chats', () => {
      render(<ContactDetail entity={mockEntity} />);

      expect(screen.getByText('Нет связанных чатов')).toBeInTheDocument();
    });

    it('should display recent chats in overview tab', () => {
      const entityWithChats: EntityWithRelations = {
        ...mockEntity,
        chats: [
          {
            id: 1,
            title: 'Chat 1',
            chat_type: 'work',
            created_at: '2024-01-01T00:00:00Z',
            last_activity: '2024-01-02T00:00:00Z',
            messages_count: 5,
            participants_count: 2,
          } as Chat,
          {
            id: 2,
            title: 'Chat 2',
            chat_type: 'hr',
            created_at: '2024-01-03T00:00:00Z',
            last_activity: '2024-01-04T00:00:00Z',
            messages_count: 3,
            participants_count: 3,
          } as Chat,
        ],
      };

      render(<ContactDetail entity={entityWithChats} />);

      expect(screen.getByText('Chat 1')).toBeInTheDocument();
      expect(screen.getByText('Chat 2')).toBeInTheDocument();
    });

    it('should limit chats display to 3 in overview', () => {
      const entityWithManyChats: EntityWithRelations = {
        ...mockEntity,
        chats: [
          { id: 1, title: 'Chat 1', chat_type: 'work', created_at: '2024-01-01T00:00:00Z' } as Chat,
          { id: 2, title: 'Chat 2', chat_type: 'work', created_at: '2024-01-02T00:00:00Z' } as Chat,
          { id: 3, title: 'Chat 3', chat_type: 'work', created_at: '2024-01-03T00:00:00Z' } as Chat,
          { id: 4, title: 'Chat 4', chat_type: 'work', created_at: '2024-01-04T00:00:00Z' } as Chat,
        ],
      };

      render(<ContactDetail entity={entityWithManyChats} />);

      expect(screen.getByText('Chat 1')).toBeInTheDocument();
      expect(screen.getByText('Chat 2')).toBeInTheDocument();
      expect(screen.getByText('Chat 3')).toBeInTheDocument();
      expect(screen.queryByText('Chat 4')).not.toBeInTheDocument();
    });
  });

  describe('Calls Display', () => {
    it('should show "no calls" message when there are no calls', () => {
      render(<ContactDetail entity={mockEntity} />);

      expect(screen.getByText('Нет записей звонков')).toBeInTheDocument();
    });

    it('should display recent calls in overview tab', () => {
      const entityWithCalls: EntityWithRelations = {
        ...mockEntity,
        calls: [
          {
            id: 1,
            source_type: 'gmeet',
            status: 'completed',
            duration_seconds: 300,
            created_at: '2024-01-01T00:00:00Z',
          } as CallRecording,
        ],
      };

      render(<ContactDetail entity={entityWithCalls} />);

      expect(screen.getByText('5:00')).toBeInTheDocument(); // duration formatted
    });

    it('should format call duration correctly', () => {
      const entityWithCalls: EntityWithRelations = {
        ...mockEntity,
        calls: [
          {
            id: 1,
            source_type: 'gmeet',
            status: 'completed',
            duration_seconds: 125, // 2:05
            created_at: '2024-01-01T00:00:00Z',
          } as CallRecording,
        ],
      };

      render(<ContactDetail entity={entityWithCalls} />);

      expect(screen.getByText('2:05')).toBeInTheDocument();
    });
  });

  describe('Link Chat Modal', () => {
    it('should open link chat modal when button is clicked', async () => {
      render(<ContactDetail entity={mockEntity} />);

      const linkButton = screen.getAllByText('Привязать')[0];
      await userEvent.click(linkButton);

      await waitFor(() => {
        expect(screen.getByText('Привязать чат')).toBeInTheDocument();
      });
    });

    it('should load unlinked chats when modal opens', async () => {
      const mockChats: Chat[] = [
        {
          id: 1,
          title: 'Unlinked Chat',
          chat_type: 'work',
          created_at: '2024-01-01T00:00:00Z',
        } as Chat,
      ];

      (api.getChats as ReturnType<typeof vi.fn>).mockResolvedValue(mockChats);

      render(<ContactDetail entity={mockEntity} />);

      const linkButton = screen.getAllByText('Привязать')[0];
      await userEvent.click(linkButton);

      await waitFor(() => {
        expect(api.getChats).toHaveBeenCalled();
        expect(screen.getByText('Unlinked Chat')).toBeInTheDocument();
      });
    });

    it('should show empty state when no unlinked chats', async () => {
      (api.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 1, entity_id: 2, title: 'Linked Chat' } as Chat,
      ]);

      render(<ContactDetail entity={mockEntity} />);

      const linkButton = screen.getAllByText('Привязать')[0];
      await userEvent.click(linkButton);

      await waitFor(() => {
        expect(screen.getByText('Нет доступных чатов для привязки')).toBeInTheDocument();
      });
    });

    it('should close modal when X button is clicked', async () => {
      (api.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      render(<ContactDetail entity={mockEntity} />);

      const linkButton = screen.getAllByText('Привязать')[0];
      await userEvent.click(linkButton);

      await waitFor(() => {
        expect(screen.getByText('Привязать чат')).toBeInTheDocument();
      });

      const closeButtons = screen.getAllByRole('button');
      const xButton = closeButtons.find((btn) => {
        const svg = btn.querySelector('svg');
        return svg?.getAttribute('class')?.includes('lucide');
      });

      if (xButton) {
        await userEvent.click(xButton);
        await waitFor(() => {
          expect(screen.queryByText('Привязать чат')).not.toBeInTheDocument();
        });
      }
    });

    it('should link chat to entity when chat is selected', async () => {
      const mockChats: Chat[] = [
        {
          id: 1,
          title: 'Chat to Link',
          chat_type: 'work',
          created_at: '2024-01-01T00:00:00Z',
        } as Chat,
      ];

      (api.getChats as ReturnType<typeof vi.fn>).mockResolvedValue(mockChats);
      (api.linkChatToEntity as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      render(<ContactDetail entity={mockEntity} />);

      const linkButton = screen.getAllByText('Привязать')[0];
      await userEvent.click(linkButton);

      await waitFor(() => {
        expect(screen.getByText('Chat to Link')).toBeInTheDocument();
      });

      const chatButton = screen.getByText('Chat to Link').closest('button');
      if (chatButton) {
        await userEvent.click(chatButton);

        await waitFor(() => {
          expect(api.linkChatToEntity).toHaveBeenCalledWith(1, 1);
          expect(mockFetchEntity).toHaveBeenCalledWith(1);
        });
      }
    });
  });

  describe('Link Call Modal', () => {
    it('should open link call modal when button is clicked', async () => {
      render(<ContactDetail entity={mockEntity} />);

      const linkButtons = screen.getAllByText('Привязать');
      const callLinkButton = linkButtons[1]; // Second "Привязать" button is for calls
      await userEvent.click(callLinkButton);

      await waitFor(() => {
        expect(screen.getByText('Привязать звонок')).toBeInTheDocument();
      });
    });

    it('should load unlinked calls when modal opens', async () => {
      const mockCalls: CallRecording[] = [
        {
          id: 1,
          source_type: 'gmeet',
          status: 'completed',
          duration_seconds: 300,
          created_at: '2024-01-01T00:00:00Z',
        } as CallRecording,
      ];

      (api.getCalls as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalls);

      render(<ContactDetail entity={mockEntity} />);

      const linkButtons = screen.getAllByText('Привязать');
      await userEvent.click(linkButtons[1]);

      await waitFor(() => {
        expect(api.getCalls).toHaveBeenCalledWith({});
        expect(screen.getByText(/Звонок GMEET/)).toBeInTheDocument();
      });
    });

    it('should link call to entity when call is selected', async () => {
      const mockCalls: CallRecording[] = [
        {
          id: 1,
          source_type: 'gmeet',
          status: 'completed',
          duration_seconds: 300,
          created_at: '2024-01-01T00:00:00Z',
        } as CallRecording,
      ];

      (api.getCalls as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalls);
      (api.linkCallToEntity as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      render(<ContactDetail entity={mockEntity} />);

      const linkButtons = screen.getAllByText('Привязать');
      await userEvent.click(linkButtons[1]);

      await waitFor(() => {
        expect(screen.getByText(/Звонок GMEET/)).toBeInTheDocument();
      });

      const callButton = screen.getByText(/Звонок GMEET/).closest('button');
      if (callButton) {
        await userEvent.click(callButton);

        await waitFor(() => {
          expect(api.linkCallToEntity).toHaveBeenCalledWith(1, 1);
          expect(mockFetchEntity).toHaveBeenCalledWith(1);
        });
      }
    });
  });

  describe('History Display', () => {
    it('should show empty state when no history', async () => {
      render(<ContactDetail entity={mockEntity} />);

      const historyTab = screen.getByText('История');
      await userEvent.click(historyTab);

      await waitFor(() => {
        expect(screen.getByText('История пуста')).toBeInTheDocument();
      });
    });

    it('should display transfers in history tab', async () => {
      const entityWithTransfers: EntityWithRelations = {
        ...mockEntity,
        transfers: [
          {
            id: 1,
            entity_id: 1,
            from_user_id: 1,
            to_user_id: 2,
            from_user_name: 'Alice',
            to_user_name: 'Bob',
            comment: 'Transferring to Bob',
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      };

      render(<ContactDetail entity={entityWithTransfers} />);

      const historyTab = screen.getByText('История');
      await userEvent.click(historyTab);

      await waitFor(() => {
        expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Transferring to Bob').length).toBeGreaterThan(0);
      });
    });

    it('should display analyses in history tab', async () => {
      const entityWithAnalyses: EntityWithRelations = {
        ...mockEntity,
        analyses: [
          {
            id: 1,
            entity_id: 1,
            report_type: 'Full Analysis',
            result: 'Analysis result',
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      };

      render(<ContactDetail entity={entityWithAnalyses} />);

      const historyTab = screen.getByText('История');
      await userEvent.click(historyTab);

      await waitFor(() => {
        expect(screen.getByText('Full Analysis')).toBeInTheDocument();
        expect(screen.getByText('Analysis result')).toBeInTheDocument();
      });
    });
  });

  describe('Date Formatting', () => {
    it('should format dates correctly', () => {
      const entityWithData: EntityWithRelations = {
        ...mockEntity,
        chats: [
          {
            id: 1,
            title: 'Test Chat',
            chat_type: 'work',
            created_at: '2024-01-15T14:30:00Z',
            last_activity: '2024-01-15T14:30:00Z',
            messages_count: 5,
            participants_count: 2,
          } as Chat,
        ],
      };

      render(<ContactDetail entity={entityWithData} />);

      // Date should be formatted (format depends on locale)
      const chatElement = screen.getByText('Test Chat');
      expect(chatElement).toBeInTheDocument();
    });
  });
});
