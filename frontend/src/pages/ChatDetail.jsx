import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  MessageSquare,
  Users,
  Settings,
  History,
  Send,
  Sparkles,
  Copy,
  Check,
  Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout, PageHeader } from '../components/layout'
import {
  Card,
  Button,
  Tabs,
  Avatar,
  Badge,
  Textarea,
  EmptyState,
  Skeleton,
} from '../components/ui'
import {
  getChat,
  getChatMessages,
  getChatParticipants,
  getChatHistory,
  analyzeChat,
  updateChat,
} from '../lib/api'
import { formatDateTime, getMessageTypeColor, getMessageTypeLabel } from '../lib/utils'

const tabs = [
  { id: 'messages', label: 'Сообщения', icon: MessageSquare },
  { id: 'participants', label: 'Участники', icon: Users },
  { id: 'criteria', label: 'Критерии', icon: Settings },
  { id: 'history', label: 'История', icon: History },
]

function MessagesTab({ chatId }) {
  const { data: messages, isLoading } = useQuery({
    queryKey: ['chat-messages', chatId],
    queryFn: () => getChatMessages(chatId),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!messages?.length) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Нет сообщений"
        description="Сообщения появятся здесь после начала общения в группе"
      />
    )
  }

  return (
    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
      {messages.map((msg, index) => (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.02 }}
          className="flex gap-3"
        >
          <Avatar
            name={msg.first_name || msg.username}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-dark-100">
                {msg.first_name} {msg.last_name}
              </span>
              {msg.username && (
                <span className="text-dark-500 text-sm">
                  @{msg.username}
                </span>
              )}
              <span className="text-dark-600 text-xs">
                {formatDateTime(msg.created_at)}
              </span>
            </div>
            <div className="flex items-start gap-2">
              {msg.message_type !== 'text' && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${getMessageTypeColor(
                    msg.message_type
                  )}`}
                >
                  {getMessageTypeLabel(msg.message_type)}
                </span>
              )}
              <p className="text-dark-200 whitespace-pre-wrap break-words">
                {msg.content}
              </p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function ParticipantsTab({ chatId }) {
  const { data: participants, isLoading } = useQuery({
    queryKey: ['chat-participants', chatId],
    queryFn: () => getChatParticipants(chatId),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {participants?.map((p, index) => (
        <motion.div
          key={p.user_id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          className="flex items-center gap-4 p-4 rounded-xl bg-dark-800/50"
        >
          <Avatar name={p.first_name || p.username} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-dark-100">
              {p.first_name} {p.last_name}
            </p>
            {p.username && (
              <p className="text-dark-400 text-sm">@{p.username}</p>
            )}
          </div>
          <Badge variant="info">{p.messages_count} сообщений</Badge>
        </motion.div>
      ))}
    </div>
  )
}

function CriteriaTab({ chat, onUpdate }) {
  const [criteria, setCriteria] = useState(chat?.criteria || '')
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    await onUpdate({ criteria })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    toast.success('Критерии сохранены')
  }

  return (
    <div className="space-y-4">
      <p className="text-dark-400">
        Укажите критерии оценки кандидатов через запятую. Они будут учтены при анализе.
      </p>
      <Textarea
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        placeholder="Python, командная работа, системное мышление, инициативность..."
        rows={4}
      />
      <Button onClick={handleSave}>
        {saved ? <Check className="w-4 h-4" /> : null}
        {saved ? 'Сохранено' : 'Сохранить критерии'}
      </Button>
    </div>
  )
}

function HistoryTab({ chatId }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['chat-history', chatId],
    queryFn: () => getChatHistory(chatId),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  if (!history?.length) {
    return (
      <EmptyState
        icon={History}
        title="Нет истории"
        description="Здесь будут сохранены результаты анализов"
      />
    )
  }

  return (
    <div className="space-y-4">
      {history.map((item) => (
        <Card key={item.id} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <Badge variant={item.analysis_type === 'full' ? 'info' : 'default'}>
              {item.analysis_type === 'full' ? 'Полный анализ' : 'Вопрос'}
            </Badge>
            <span className="text-dark-500 text-sm">
              {formatDateTime(item.created_at)}
            </span>
          </div>
          {item.question && (
            <p className="text-dark-400 italic mb-2">"{item.question}"</p>
          )}
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{item.result.slice(0, 500)}...</ReactMarkdown>
          </div>
        </Card>
      ))}
    </div>
  )
}

function AnalyzePanel({ chatId }) {
  const [mode, setMode] = useState('full')
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const queryClient = useQueryClient()

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeChat(chatId, mode, mode === 'question' ? question : null),
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries(['chat-history', chatId])
      toast.success('Анализ завершён')
    },
    onError: () => {
      toast.error('Ошибка при анализе')
    },
  })

  const handleCopy = () => {
    navigator.clipboard.writeText(result?.result || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <h3 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-accent-400" />
        AI Анализ
      </h3>

      <div className="flex gap-2 mb-4">
        <Button
          variant={mode === 'full' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode('full')}
        >
          Полный анализ
        </Button>
        <Button
          variant={mode === 'question' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode('question')}
        >
          Задать вопрос
        </Button>
      </div>

      {mode === 'question' && (
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Введите ваш вопрос о чате..."
          className="mb-4"
        />
      )}

      <Button
        onClick={() => analyzeMutation.mutate()}
        loading={analyzeMutation.isPending}
        className="w-full mb-4"
      >
        <Sparkles className="w-4 h-4" />
        {mode === 'full' ? 'Запустить анализ' : 'Получить ответ'}
      </Button>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-dark-700 pt-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-dark-400 text-sm">Результат</span>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? 'Скопировано' : 'Копировать'}
              </Button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none max-h-[400px] overflow-y-auto">
              <ReactMarkdown>{result.result}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

export function ChatDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('messages')
  const queryClient = useQueryClient()

  const { data: chat, isLoading } = useQuery({
    queryKey: ['chat', id],
    queryFn: () => getChat(id),
  })

  const updateMutation = useMutation({
    mutationFn: (data) => updateChat(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['chat', id])
    },
  })

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/chats')}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад к чатам
        </Button>
        <PageHeader
          title={chat?.title}
          description={`${chat?.messages_count} сообщений • ${chat?.users_count} участников`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <Tabs tabs={tabs} defaultTab="messages" onChange={setActiveTab} />
            <div className="mt-6">
              {activeTab === 'messages' && <MessagesTab chatId={id} />}
              {activeTab === 'participants' && <ParticipantsTab chatId={id} />}
              {activeTab === 'criteria' && (
                <CriteriaTab
                  chat={chat}
                  onUpdate={(data) => updateMutation.mutate(data)}
                />
              )}
              {activeTab === 'history' && <HistoryTab chatId={id} />}
            </div>
          </Card>
        </div>

        <div>
          <AnalyzePanel chatId={id} />
        </div>
      </div>
    </Layout>
  )
}
