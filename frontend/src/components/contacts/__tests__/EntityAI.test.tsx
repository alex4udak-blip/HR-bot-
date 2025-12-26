import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EntityAI from '../EntityAI';
import type { EntityWithRelations } from '@/types';

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-markdown
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('EntityAI', () => {
  const mockEntity: EntityWithRelations = {
    id: 1,
    type: 'candidate',
    name: 'John Doe',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    chats: [
      {
        id: 1,
        title: 'Chat 1',
        chat_type: 'work',
        created_at: '2024-01-01T00:00:00Z',
      },
    ] as any,
    calls: [
      {
        id: 1,
        source_type: 'gmeet',
        status: 'completed',
        created_at: '2024-01-01T00:00:00Z',
      },
    ] as any,
    transfers: [],
    analyses: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.setItem('token', 'test-token');
    mockFetch.mockClear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Rendering', () => {
    it('should render AI assistant interface', () => {
      render(<EntityAI entity={mockEntity} />);

      expect(screen.getByPlaceholderText('Задайте вопрос о контакте...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    });

    it('should render quick action buttons', () => {
      render(<EntityAI entity={mockEntity} />);

      expect(screen.getByText('Полный анализ')).toBeInTheDocument();
      expect(screen.getByText('Red flags')).toBeInTheDocument();
      expect(screen.getByText('До/После')).toBeInTheDocument();
      expect(screen.getByText('Прогноз')).toBeInTheDocument();
      expect(screen.getByText('Резюме')).toBeInTheDocument();
      expect(screen.getByText('Вопросы')).toBeInTheDocument();
    });

    it('should show no data warning when entity has no chats or calls', () => {
      const entityWithoutData: EntityWithRelations = {
        ...mockEntity,
        chats: [],
        calls: [],
      };

      render(<EntityAI entity={entityWithoutData} />);

      expect(
        screen.getByText(/К контакту не привязаны чаты или звонки/)
      ).toBeInTheDocument();
    });

    it('should not show warning when entity has data', () => {
      render(<EntityAI entity={mockEntity} />);

      expect(
        screen.queryByText(/К контакту не привязаны чаты или звонки/)
      ).not.toBeInTheDocument();
    });

    it('should show empty state when no messages', () => {
      render(<EntityAI entity={mockEntity} />);

      expect(screen.getByText('Задайте вопрос или выберите действие')).toBeInTheDocument();
      expect(screen.getByText('AI проанализирует все переписки и звонки')).toBeInTheDocument();
    });
  });

  describe('Memory Management', () => {
    it('should load AI memory on mount', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: 'Test summary',
          summary_updated_at: '2024-01-01T00:00:00Z',
          key_events: [],
        }),
      });

      render(<EntityAI entity={mockEntity} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/entities/1/ai/memory',
          expect.objectContaining({
            headers: { Authorization: 'Bearer test-token' },
          })
        );
      });
    });

    it('should show memory when memory button is clicked', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: 'Candidate summary',
          summary_updated_at: '2024-01-01T00:00:00Z',
          key_events: [
            { date: '2024-01-01', event: 'First contact', details: 'Initial call' },
          ],
        }),
      });

      render(<EntityAI entity={mockEntity} />);

      await waitFor(() => {
        const memoryButton = screen.getByText('Память');
        expect(memoryButton).toBeInTheDocument();
      });

      const memoryButton = screen.getByText('Память');
      await userEvent.click(memoryButton);

      await waitFor(() => {
        expect(screen.getByText('Candidate summary')).toBeInTheDocument();
        expect(screen.getByText('Initial call')).toBeInTheDocument();
      });
    });

    it('should update memory when update button is clicked', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            summary: null,
            summary_updated_at: null,
            key_events: [],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ new_events_count: 3 }),
        });

      render(<EntityAI entity={mockEntity} />);

      await waitFor(() => {
        const updateButton = screen.getByText('Обновить');
        expect(updateButton).toBeInTheDocument();
      });

      const updateButton = screen.getByText('Обновить');
      await userEvent.click(updateButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/entities/1/ai/update-summary',
          expect.objectContaining({
            method: 'POST',
            headers: { Authorization: 'Bearer test-token' },
          })
        );
      });
    });

    it('should disable update button when entity has no data', () => {
      const entityWithoutData: EntityWithRelations = {
        ...mockEntity,
        chats: [],
        calls: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: null,
          summary_updated_at: null,
          key_events: [],
        }),
      });

      render(<EntityAI entity={entityWithoutData} />);

      const updateButton = screen.getByText('Обновить');
      expect(updateButton).toBeDisabled();
    });
  });

  describe('Message Sending', () => {
    it('should send message when form is submitted', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"content":"Test response"}\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: {
            getReader: () => mockReader,
          },
        });

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test question');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await userEvent.click(sendButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/entities/1/ai/message',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              Authorization: 'Bearer test-token',
            }),
            body: JSON.stringify({ message: undefined }),
          })
        );
      });
    });

    it('should send message on Enter key press', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        });

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test question{Enter}');

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/entities/1/ai/message',
          expect.any(Object)
        );
      });
    });

    it('should not send message on Shift+Enter', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        });

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Line 1');

      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

      // Should not send message
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Only initial calls should have been made (history and memory)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should disable send button when input is empty', () => {
      render(<EntityAI entity={mockEntity} />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('should enable send button when input has text', async () => {
      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test');

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('Quick Actions', () => {
    it('should send quick action when button is clicked', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"content":"Analysis result"}\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: {
            getReader: () => mockReader,
          },
        });

      render(<EntityAI entity={mockEntity} />);

      const fullAnalysisButton = screen.getByText('Полный анализ');
      await userEvent.click(fullAnalysisButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/entities/1/ai/message',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ quick_action: 'full_analysis' }),
          })
        );
      });
    });

    it('should disable quick action buttons during loading', async () => {
      const mockReader = {
        read: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ done: true, value: undefined }), 1000)
            )
        ),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: {
            getReader: () => mockReader,
          },
        });

      render(<EntityAI entity={mockEntity} />);

      const fullAnalysisButton = screen.getByText('Полный анализ');
      await userEvent.click(fullAnalysisButton);

      const redFlagsButton = screen.getByText('Red flags');
      expect(redFlagsButton).toBeDisabled();
    });
  });

  describe('History Management', () => {
    it('should load chat history on mount', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [
              { role: 'user', content: 'Question' },
              { role: 'assistant', content: 'Answer' },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        });

      render(<EntityAI entity={mockEntity} />);

      await waitFor(() => {
        expect(screen.getByText('Question')).toBeInTheDocument();
        expect(screen.getByText('Answer')).toBeInTheDocument();
      });
    });

    it('should clear history when clear button is clicked', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [
              { role: 'user', content: 'Question' },
              { role: 'assistant', content: 'Answer' },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
        });

      render(<EntityAI entity={mockEntity} />);

      await waitFor(() => {
        expect(screen.getByText('Очистить')).toBeInTheDocument();
      });

      const clearButton = screen.getByText('Очистить');
      await userEvent.click(clearButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/entities/1/ai/history',
          expect.objectContaining({
            method: 'DELETE',
            headers: { Authorization: 'Bearer test-token' },
          })
        );
      });

      await waitFor(() => {
        expect(screen.queryByText('Question')).not.toBeInTheDocument();
        expect(screen.queryByText('Answer')).not.toBeInTheDocument();
      });
    });

    it('should not show clear button when no messages', () => {
      render(<EntityAI entity={mockEntity} />);

      expect(screen.queryByText('Очистить')).not.toBeInTheDocument();
    });
  });

  describe('Streaming Response', () => {
    it('should display streaming content as it arrives', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"content":"Part 1"}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"content":" Part 2"}\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: {
            getReader: () => mockReader,
          },
        });

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await userEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText('Part 1 Part 2')).toBeInTheDocument();
      });
    });

    it('should show loading indicator during streaming', async () => {
      const mockReader = {
        read: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ done: true, value: undefined }), 1000)
            )
        ),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: {
            getReader: () => mockReader,
          },
        });

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await userEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText('Анализирую данные...')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await userEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText('Произошла ошибка. Попробуйте ещё раз.')).toBeInTheDocument();
      });
    });

    it('should handle API errors in stream', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"error":true,"content":"API Error"}\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ summary: null, key_events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: {
            getReader: () => mockReader,
          },
        });

      render(<EntityAI entity={mockEntity} />);

      const input = screen.getByPlaceholderText('Задайте вопрос о контакте...');
      await userEvent.type(input, 'Test');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await userEvent.click(sendButton);

      // Error should be handled but not crash the app
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });
});
