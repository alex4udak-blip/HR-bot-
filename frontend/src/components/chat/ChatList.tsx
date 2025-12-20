import { motion } from 'framer-motion';
import { MessageSquare, Users } from 'lucide-react';
import type { Chat } from '@/types';
import clsx from 'clsx';

interface ChatListProps {
  chats: Chat[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function ChatList({ chats, selectedId, onSelect }: ChatListProps) {
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    }
  };

  return (
    <div className="divide-y divide-white/5">
      {chats.map((chat, index) => (
        <motion.button
          key={chat.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          onClick={() => onSelect(chat.id)}
          className={clsx(
            'w-full p-4 text-left transition-all duration-200 hover:bg-white/5',
            selectedId === chat.id && 'bg-accent-500/10 border-l-2 border-accent-500'
          )}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500/20 to-accent-600/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-5 h-5 text-accent-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="font-medium truncate">
                  {chat.custom_name || chat.title}
                </h3>
                <span className="text-xs text-dark-500 flex-shrink-0">
                  {formatDate(chat.last_activity)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm text-dark-400">
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {chat.messages_count}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {chat.participants_count}
                </span>
              </div>
            </div>
          </div>
        </motion.button>
      ))}
    </div>
  );
}
