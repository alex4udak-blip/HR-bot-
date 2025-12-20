import { motion } from 'framer-motion';
import {
  MessageSquare, Users, UserCheck, FolderKanban, Building2,
  Briefcase, DollarSign, Headphones, Settings
} from 'lucide-react';
import type { Chat, ChatTypeId } from '@/types';
import clsx from 'clsx';

interface ChatListProps {
  chats: Chat[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

// Chat type configurations for UI
const CHAT_TYPE_CONFIG: Record<ChatTypeId, { name: string; icon: typeof MessageSquare; color: string; bgColor: string }> = {
  work: { name: 'Рабочий', icon: MessageSquare, color: 'text-indigo-400', bgColor: 'from-indigo-500/20 to-indigo-600/20' },
  hr: { name: 'HR', icon: UserCheck, color: 'text-blue-400', bgColor: 'from-blue-500/20 to-blue-600/20' },
  project: { name: 'Проект', icon: FolderKanban, color: 'text-purple-400', bgColor: 'from-purple-500/20 to-purple-600/20' },
  client: { name: 'Клиент', icon: Building2, color: 'text-green-400', bgColor: 'from-green-500/20 to-green-600/20' },
  contractor: { name: 'Подрядчик', icon: Briefcase, color: 'text-orange-400', bgColor: 'from-orange-500/20 to-orange-600/20' },
  sales: { name: 'Продажи', icon: DollarSign, color: 'text-yellow-400', bgColor: 'from-yellow-500/20 to-yellow-600/20' },
  support: { name: 'Поддержка', icon: Headphones, color: 'text-cyan-400', bgColor: 'from-cyan-500/20 to-cyan-600/20' },
  custom: { name: 'Другое', icon: Settings, color: 'text-gray-400', bgColor: 'from-gray-500/20 to-gray-600/20' },
};

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
      return 'Вчера';
    } else if (days < 7) {
      return date.toLocaleDateString('ru-RU', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    }
  };

  const getChatTypeConfig = (type: ChatTypeId) => {
    return CHAT_TYPE_CONFIG[type] || CHAT_TYPE_CONFIG.custom;
  };

  return (
    <div className="divide-y divide-white/5">
      {chats.map((chat, index) => {
        const typeConfig = getChatTypeConfig(chat.chat_type);
        const TypeIcon = typeConfig.icon;

        return (
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
              <div className={clsx(
                'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0',
                typeConfig.bgColor
              )}>
                <TypeIcon className={clsx('w-5 h-5', typeConfig.color)} />
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
                  <span className={clsx('text-xs px-1.5 py-0.5 rounded', typeConfig.color, 'bg-white/5')}>
                    {chat.custom_type_name || typeConfig.name}
                  </span>
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
        );
      })}
    </div>
  );
}
