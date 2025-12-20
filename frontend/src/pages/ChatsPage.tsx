import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  MessageSquare,
  ChevronLeft,
  X,
  UserCheck,
  FolderKanban,
  Building2,
  Briefcase,
  DollarSign,
  Headphones,
  Settings,
  LayoutGrid
} from 'lucide-react';
import { getChats } from '@/services/api';
import { useChatStore } from '@/stores/chatStore';
import ChatList from '@/components/chat/ChatList';
import ChatDetail from '@/components/chat/ChatDetail';
import AIPanel from '@/components/chat/AIPanel';
import type { ChatTypeId } from '@/types';
import clsx from 'clsx';

// Chat type filter options
const CHAT_TYPE_FILTERS: { id: ChatTypeId | 'all'; name: string; icon: typeof MessageSquare }[] = [
  { id: 'all', name: 'Все', icon: LayoutGrid },
  { id: 'hr', name: 'HR', icon: UserCheck },
  { id: 'project', name: 'Проект', icon: FolderKanban },
  { id: 'client', name: 'Клиент', icon: Building2 },
  { id: 'contractor', name: 'Подрядчик', icon: Briefcase },
  { id: 'sales', name: 'Продажи', icon: DollarSign },
  { id: 'support', name: 'Поддержка', icon: Headphones },
  { id: 'custom', name: 'Другое', icon: Settings },
];

export default function ChatsPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ChatTypeId | 'all'>('all');
  const [showAIPanel, setShowAIPanel] = useState(true);
  const { selectedChatId, setSelectedChatId, setChats } = useChatStore();

  const { data: chats = [], isLoading } = useQuery({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  // Sync chats to store only when data changes (compare by length to avoid infinite loop)
  useEffect(() => {
    if (chats.length > 0) {
      setChats(chats);
    }
  }, [chats.length, setChats]);

  useEffect(() => {
    if (chatId) {
      setSelectedChatId(parseInt(chatId));
    }
  }, [chatId]);

  const filteredChats = chats.filter((chat) => {
    const matchesSearch = (chat.custom_name || chat.title).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || chat.chat_type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Count chats per type
  const typeCounts = chats.reduce((acc, chat) => {
    acc[chat.chat_type] = (acc[chat.chat_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  const handleSelectChat = (id: number) => {
    setSelectedChatId(id);
    navigate(`/chats/${id}`);
  };

  const handleCloseChat = () => {
    setSelectedChatId(null);
    navigate('/chats');
  };

  return (
    <div className="h-full flex">
      {/* Chat List - Left Column */}
      <div
        className={clsx(
          'w-full lg:w-80 flex-shrink-0 border-r border-white/5 flex flex-col glass',
          selectedChatId && 'hidden lg:flex'
        )}
      >
        {/* Type Filter Tabs */}
        <div className="p-2 border-b border-white/5">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {CHAT_TYPE_FILTERS.map((filter) => {
              const Icon = filter.icon;
              const count = filter.id === 'all' ? chats.length : (typeCounts[filter.id] || 0);
              const isActive = typeFilter === filter.id;

              return (
                <button
                  key={filter.id}
                  onClick={() => setTypeFilter(filter.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all',
                    isActive
                      ? 'bg-accent-500/20 text-accent-400'
                      : 'text-dark-400 hover:text-dark-200 hover:bg-white/5'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{filter.name}</span>
                  {count > 0 && (
                    <span className={clsx(
                      'px-1.5 py-0.5 rounded-full text-[10px]',
                      isActive ? 'bg-accent-500/30' : 'bg-white/10'
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              placeholder="Поиск чатов..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full glass-light rounded-xl py-2.5 pl-10 pr-4 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="text-center py-8 px-4">
              <MessageSquare className="w-12 h-12 mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400">Чаты не найдены</p>
              <p className="text-dark-500 text-sm mt-1">
                Добавьте бота в Telegram группу
              </p>
            </div>
          ) : (
            <ChatList
              chats={filteredChats}
              selectedId={selectedChatId}
              onSelect={handleSelectChat}
            />
          )}
        </div>
      </div>

      {/* Chat Detail - Middle Column */}
      <div
        className={clsx(
          'flex-1 flex flex-col min-w-0',
          !selectedChatId && 'hidden lg:flex'
        )}
      >
        {selectedChat ? (
          <>
            {/* Mobile Header */}
            <div className="lg:hidden flex items-center gap-3 p-4 border-b border-white/5 glass">
              <button
                onClick={handleCloseChat}
                className="p-2 rounded-lg hover:bg-white/5"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold truncate">
                  {selectedChat.custom_name || selectedChat.title}
                </h2>
                <p className="text-sm text-dark-400">
                  {selectedChat.messages_count} сообщ.
                </p>
              </div>
              <button
                onClick={() => setShowAIPanel(!showAIPanel)}
                className={clsx(
                  'p-2 rounded-lg transition-colors',
                  showAIPanel ? 'bg-accent-500/20 text-accent-400' : 'hover:bg-white/5'
                )}
              >
                <MessageSquare className="w-5 h-5" />
              </button>
            </div>

            <ChatDetail chat={selectedChat} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto text-dark-600 mb-4" />
              <h2 className="text-xl font-semibold mb-2">Выберите чат</h2>
              <p className="text-dark-400">
                Выберите чат из списка для просмотра
              </p>
            </div>
          </div>
        )}
      </div>

      {/* AI Panel - Right Column */}
      <AnimatePresence>
        {selectedChat && showAIPanel && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden xl:flex flex-col border-l border-white/5 glass overflow-hidden"
          >
            <AIPanel chatId={selectedChat.id} chatTitle={selectedChat.custom_name || selectedChat.title} chatType={selectedChat.chat_type} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile AI Panel */}
      <AnimatePresence>
        {selectedChat && showAIPanel && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="xl:hidden fixed inset-0 z-50 glass flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-semibold">AI Ассистент</h3>
              <button
                onClick={() => setShowAIPanel(false)}
                className="p-2 rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <AIPanel chatId={selectedChat.id} chatTitle={selectedChat.custom_name || selectedChat.title} chatType={selectedChat.chat_type} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Toggle Button */}
      {selectedChat && (
        <button
          onClick={() => setShowAIPanel(!showAIPanel)}
          className={clsx(
            'hidden xl:flex fixed right-4 bottom-4 p-3 rounded-xl shadow-lg transition-all duration-200',
            showAIPanel
              ? 'bg-accent-500 text-white'
              : 'glass hover:bg-white/10'
          )}
        >
          <MessageSquare className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
