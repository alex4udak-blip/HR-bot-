import { create } from 'zustand';
import type { Chat } from '@/types';

interface ChatState {
  selectedChatId: number | null;
  chats: Chat[];
  setSelectedChatId: (id: number | null) => void;
  setChats: (chats: Chat[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedChatId: null,
  chats: [],
  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),
  setChats: (chats) => set({ chats }),
}));
