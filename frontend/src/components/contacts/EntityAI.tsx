import { useState, useEffect, useRef } from 'react';
import {
  Bot,
  SendHorizontal,
  FileSearch,
  AlertTriangle,
  GitCompare,
  TrendingUp,
  FileText,
  HelpCircle,
  Trash2,
  Loader2,
  Brain,
  RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import toast from 'react-hot-toast';
import type { EntityWithRelations } from '@/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

const QUICK_ACTIONS = [
  { id: 'full_analysis', label: 'Полный анализ', icon: FileSearch },
  { id: 'red_flags', label: 'Red flags', icon: AlertTriangle },
  { id: 'comparison', label: 'До/После', icon: GitCompare },
  { id: 'prediction', label: 'Прогноз', icon: TrendingUp },
  { id: 'summary', label: 'Резюме', icon: FileText },
  { id: 'questions', label: 'Вопросы', icon: HelpCircle },
];

interface EntityAIProps {
  entity: EntityWithRelations;
}

interface AIMemory {
  summary: string | null;
  summary_updated_at: string | null;
  key_events: Array<{date: string; event: string; details: string}>;
}

export default function EntityAI({ entity }: EntityAIProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [memory, setMemory] = useState<AIMemory | null>(null);
  const [updatingMemory, setUpdatingMemory] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load history and memory on mount
  useEffect(() => {
    loadHistory();
    loadMemory();
    return () => {
      // Cleanup on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [entity.id]);

  const loadMemory = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/entities/${entity.id}/ai/memory`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setMemory(data);
      }
    } catch (e) {
      console.error('Failed to load AI memory:', e);
    }
  };

  const updateMemory = async () => {
    setUpdatingMemory(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/entities/${entity.id}/ai/update-summary`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        toast.success(`Память обновлена! Новых событий: ${data.new_events_count}`);
        loadMemory();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Не удалось обновить память');
      }
    } catch (e) {
      toast.error('Ошибка при обновлении памяти');
    } finally {
      setUpdatingMemory(false);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const loadHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/entities/${entity.id}/ai/history`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch (e) {
      console.error('Failed to load AI history:', e);
    }
  };

  const clearHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/entities/${entity.id}/ai/history`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        setMessages([]);
        toast.success('История очищена');
      }
    } catch (e) {
      console.error('Failed to clear history:', e);
      toast.error('Не удалось очистить историю');
    }
  };

  const sendMessage = async (message?: string, quickAction?: string) => {
    if (loading) return;

    const userMessage = quickAction
      ? `[${QUICK_ACTIONS.find(a => a.id === quickAction)?.label}]`
      : message || input.trim();

    if (!userMessage && !quickAction) return;

    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setInput('');
    setStreamingContent('');

    // Add user message optimistically
    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/entities/${entity.id}/ai/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(
          quickAction ? { quick_action: quickAction } : { message }
        ),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                toast.error(parsed.content || 'Ошибка AI');
                continue;
              }
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
            } catch {
              // Ignore JSON parse errors for incomplete chunks
            }
          }
        }
      }

      // Add assistant message
      setMessages([...newMessages, { role: 'assistant', content: fullContent }]);
      setStreamingContent('');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // Request was aborted, ignore
        return;
      }
      console.error('AI error:', e);
      toast.error('Ошибка при обращении к AI');
      setMessages([...newMessages, {
        role: 'assistant',
        content: 'Произошла ошибка. Попробуйте ещё раз.'
      }]);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Check if entity has any data (use actual arrays for EntityWithRelations)
  const hasData = (entity.chats && entity.chats.length > 0) || (entity.calls && entity.calls.length > 0);

  return (
    <div className="h-full flex flex-col p-4">
      {/* No data warning */}
      {!hasData && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4 flex-shrink-0">
          <p className="text-sm text-yellow-400/80">
            К контакту не привязаны чаты или звонки. Привяжите данные для полноценного анализа.
          </p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="pb-3 border-b border-white/5 flex-shrink-0 overflow-x-auto">
        <div className="flex gap-1.5 min-w-max pb-1">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => sendMessage(undefined, action.id)}
                disabled={loading}
                title={action.label}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium glass-light hover:bg-white/10 transition-colors',
                  loading && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Icon size={14} className="flex-shrink-0 text-accent-400" />
                <span className="hidden sm:inline">{action.label}</span>
              </button>
            );
          })}
          {/* Memory buttons */}
          <button
            onClick={() => setShowMemory(!showMemory)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
              memory?.summary
                ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400'
                : 'glass-light hover:bg-white/10 text-white/60'
            )}
            title={memory?.summary ? 'Показать память AI' : 'Память AI пуста'}
          >
            <Brain size={14} className="flex-shrink-0" />
            <span className="hidden sm:inline">Память</span>
            {memory?.key_events && memory.key_events.length > 0 && (
              <span className="bg-purple-500/30 text-purple-300 text-[10px] px-1.5 rounded-full">
                {memory.key_events.length}
              </span>
            )}
          </button>
          <button
            onClick={updateMemory}
            disabled={updatingMemory || !hasData}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
              updatingMemory || !hasData
                ? 'opacity-50 cursor-not-allowed glass-light'
                : 'bg-accent-500/20 hover:bg-accent-500/30 text-accent-400'
            )}
            title="Обновить память AI (резюме + события)"
          >
            {updatingMemory ? (
              <Loader2 size={14} className="flex-shrink-0 animate-spin" />
            ) : (
              <RefreshCw size={14} className="flex-shrink-0" />
            )}
            <span className="hidden sm:inline">{updatingMemory ? 'Обновление...' : 'Обновить'}</span>
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
              title="Очистить историю"
            >
              <Trash2 size={14} className="flex-shrink-0" />
              <span className="hidden sm:inline">Очистить</span>
            </button>
          )}
        </div>
      </div>

      {/* Memory Panel */}
      {showMemory && memory && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 mb-4 flex-shrink-0">
          {memory.summary ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Brain size={14} className="text-purple-400" />
                <span className="text-sm font-medium text-purple-300">Память AI</span>
                {memory.summary_updated_at && (
                  <span className="text-xs text-white/40">
                    обновлено {new Date(memory.summary_updated_at).toLocaleDateString('ru')}
                  </span>
                )}
              </div>
              <p className="text-sm text-white/70 mb-2">{memory.summary}</p>
              {memory.key_events && memory.key_events.length > 0 && (
                <div className="border-t border-purple-500/20 pt-2 mt-2">
                  <div className="text-xs text-purple-300 mb-1">Ключевые события:</div>
                  <div className="space-y-1">
                    {memory.key_events.slice(-5).map((event, i) => (
                      <div key={i} className="text-xs text-white/60 flex gap-2">
                        <span className="text-white/40">{event.date}</span>
                        <span>{event.details || event.event}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-white/50">
              Память пуста. Нажмите "Обновить" для создания резюме на основе чатов и звонков.
            </p>
          )}
        </div>
      )}

      {/* Messages - flexible height */}
      <div className="flex-1 min-h-0 overflow-y-auto mb-4 pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        <div className="space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-center py-8 text-white/40">
            <Bot size={40} className="mx-auto mb-2 opacity-50" />
            <p>Задайте вопрос или выберите действие</p>
            <p className="text-sm mt-1">AI проанализирует все переписки и звонки</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={clsx(
              'p-3 rounded-lg overflow-hidden',
              msg.role === 'user'
                ? 'bg-cyan-500/20 ml-4 sm:ml-8'
                : 'bg-white/5 mr-2 sm:mr-4'
            )}
          >
            <div className="prose prose-invert prose-sm max-w-none break-words overflow-wrap-anywhere">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="p-3 rounded-lg bg-white/5 mr-2 sm:mr-4 overflow-hidden">
            <div className="prose prose-invert prose-sm max-w-none break-words overflow-wrap-anywhere">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {loading && !streamingContent && (
          <div className="p-3 rounded-lg bg-white/5 mr-2 sm:mr-4">
            <div className="flex items-center gap-2 text-white/60">
              <Loader2 size={16} className="animate-spin flex-shrink-0" />
              <span className="truncate">Анализирую данные...</span>
            </div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="pt-4 border-t border-white/5 flex-shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задайте вопрос о контакте..."
            rows={1}
            disabled={loading}
            className="flex-1 glass-light rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-500/50 disabled:opacity-50 min-w-0"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            aria-label="Send"
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <SendHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
