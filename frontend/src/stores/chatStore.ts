import { create } from 'zustand';
import type { Chat } from '@/types';

interface ChatState {
  selectedChatId: number | null;
  chats: Chat[];
  setSelectedChatId: (id: number | null) => void;
  setChats: (chats: Chat[]) => void;

  // WebSocket handlers
  handleChatCreated: (data: Record<string, unknown>) => void;
  handleChatUpdated: (data: Record<string, unknown>) => void;
  handleChatDeleted: (data: { id: number }) => void;
  handleChatMessage: (data: Record<string, unknown>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedChatId: null,
  chats: [],
  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),
  setChats: (chats) => set({ chats }),

  // WebSocket handlers for real-time updates
  handleChatCreated: (data: Record<string, unknown>) => {
    const chat = data as unknown as Chat;
    console.log('[ChatStore] Chat created via WebSocket:', chat.id, chat.title);

    set((state) => {
      // Check if chat already exists (avoid duplicates)
      if (state.chats.some((c) => c.id === chat.id)) {
        return state;
      }
      return {
        chats: [chat, ...state.chats],
      };
    });
  },

  handleChatUpdated: (data: Record<string, unknown>) => {
    const chat = data as unknown as Chat;
    console.log('[ChatStore] Chat updated via WebSocket:', chat.id, chat.title);

    set((state) => ({
      chats: state.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)),
    }));
  },

  handleChatDeleted: (data: { id: number }) => {
    console.log('[ChatStore] Chat deleted via WebSocket:', data.id);

    set((state) => ({
      chats: state.chats.filter((c) => c.id !== data.id),
      selectedChatId: state.selectedChatId === data.id ? null : state.selectedChatId,
    }));
  },

  handleChatMessage: (data: Record<string, unknown>) => {
    const { chat_id, message_count } = data as { chat_id: number; message_count?: number };
    console.log('[ChatStore] New message in chat via WebSocket:', chat_id);

    // Update chat's message count and move it to top of list
    set((state) => {
      const chatIndex = state.chats.findIndex((c) => c.id === chat_id);
      if (chatIndex === -1) return state;

      const updatedChats = [...state.chats];
      const chat = { ...updatedChats[chatIndex] };
      chat.messages_count = message_count ?? (chat.messages_count || 0) + 1;
      chat.last_activity = new Date().toISOString();

      // Move chat to top
      updatedChats.splice(chatIndex, 1);
      updatedChats.unshift(chat);

      return { chats: updatedChats };
    });
  },
}));
