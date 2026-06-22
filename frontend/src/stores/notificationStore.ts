import { create } from 'zustand';

interface NotificationState {
  unreadCount: number;
  setUnreadCount: (n: number | ((prev: number) => number)) => void;
  bumpUnread: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n) => set((s) => ({ unreadCount: Math.max(0, typeof n === 'function' ? n(s.unreadCount) : n) })),
  bumpUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
}));
