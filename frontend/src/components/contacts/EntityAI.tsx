import { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Send,
  FileSearch,
  AlertTriangle,
  GitCompare,
  TrendingUp,
  FileText,
  HelpCircle,
  Trash2,
  Loader2
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

export default function EntityAI({ entity }: EntityAIProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load history on mount
  useEffect(() => {
    loadHistory();
    return () => {
      // Cleanup on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [entity.id]);

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
    <div className="bg-white/5 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Bot size={20} className="text-cyan-400" />
          AI Ассистент
        </h3>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 transition-colors"
            title="Очистить историю"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* No data warning */}
      {!hasData && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-400/80">
            К контакту не привязаны чаты или звонки. Привяжите данные для полноценного анализа.
          </p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        {QUICK_ACTIONS.map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={() => sendMessage(undefined, action.id)}
              disabled={loading}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                loading
                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-white/5 hover:bg-white/10 text-white/80 hover:text-white'
              )}
            >
              <Icon size={14} />
              {action.label}
            </button>
          );
        })}
      </div>

      {/* Messages */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4 pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
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
              'p-3 rounded-lg',
              msg.role === 'user'
                ? 'bg-cyan-500/20 ml-8'
                : 'bg-white/5 mr-4'
            )}
          >
            <div className="prose prose-invert prose-sm max-w-none break-words">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="p-3 rounded-lg bg-white/5 mr-4">
            <div className="prose prose-invert prose-sm max-w-none break-words">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {loading && !streamingContent && (
          <div className="p-3 rounded-lg bg-white/5 mr-4">
            <div className="flex items-center gap-2 text-white/60">
              <Loader2 size={16} className="animate-spin" />
              Анализирую данные...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Задайте вопрос о контакте..."
          disabled={loading}
          className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 transition-colors"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          className={clsx(
            'px-4 py-2 rounded-lg transition-colors flex items-center gap-2',
            loading || !input.trim()
              ? 'bg-white/5 text-white/30 cursor-not-allowed'
              : 'bg-cyan-500 hover:bg-cyan-600 text-white'
          )}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
