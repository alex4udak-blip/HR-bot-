import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Search,
  Users,
  Clock,
  ChevronRight,
  Inbox,
} from 'lucide-react'
import { Layout, PageHeader } from '../components/layout'
import {
  Card,
  Input,
  Badge,
  Avatar,
  EmptyState,
  SkeletonCard,
} from '../components/ui'
import { getChats } from '../lib/api'
import { formatDateTime, formatNumber } from '../lib/utils'

function ChatCard({ chat, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link to={`/chats/${chat.id}`}>
        <Card hover className="group cursor-pointer">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-6 h-6 text-accent-400" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-semibold text-dark-100 truncate group-hover:text-accent-400 transition-colors">
                  {chat.title}
                </h3>
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    chat.is_active ? 'bg-emerald-400' : 'bg-dark-600'
                  }`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-dark-400">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4" />
                  {formatNumber(chat.messages_count)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {chat.users_count}
                </span>
                {chat.last_message_at && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    {formatDateTime(chat.last_message_at)}
                  </span>
                )}
              </div>

              {chat.criteria && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {chat.criteria.split(',').slice(0, 3).map((c) => (
                    <Badge key={c} variant="info">
                      {c.trim()}
                    </Badge>
                  ))}
                </div>
              )}

              {chat.owner_name && (
                <div className="flex items-center gap-2 mt-3">
                  <Avatar name={chat.owner_name} size="sm" />
                  <span className="text-sm text-dark-500">
                    {chat.owner_name}
                  </span>
                </div>
              )}
            </div>

            <ChevronRight className="w-5 h-5 text-dark-600 group-hover:text-accent-400 transition-colors flex-shrink-0" />
          </div>
        </Card>
      </Link>
    </motion.div>
  )
}

export function ChatsPage() {
  const [search, setSearch] = useState('')

  const { data: chats, isLoading } = useQuery({
    queryKey: ['chats', search],
    queryFn: () => getChats(search),
  })

  return (
    <Layout>
      <PageHeader
        title="Чаты"
        description="Управляйте отслеживаемыми групповыми чатами"
      />

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
        <input
          type="text"
          placeholder="Поиск чатов..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-12"
        />
      </div>

      {/* Chats List */}
      <AnimatePresence mode="wait">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : chats?.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Нет чатов"
            description="Добавьте бота в групповой чат, чтобы начать сбор данных"
          />
        ) : (
          <div className="space-y-4">
            {chats?.map((chat, index) => (
              <ChatCard key={chat.id} chat={chat} index={index} />
            ))}
          </div>
        )}
      </AnimatePresence>
    </Layout>
  )
}
