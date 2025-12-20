import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Trash2,
  Sparkles,
  AlertTriangle,
  ThumbsUp,
  FileText,
  Loader2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getAIHistory, clearAIHistory, streamAIMessage, streamQuickAction } from '@/services/api';
import type { AIMessage } from '@/types';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface AIPanelProps {
  chatId: number;
  chatTitle: string;
}

const quickActions = [
  { id: 'full_analysis', label: 'Full Analysis', icon: FileText },
  { id: 'red_flags', label: 'Red Flags', icon: AlertTriangle },
  { id: 'strengths', label: 'Strengths', icon: ThumbsUp },
  { id: 'recommendation', label: 'Recommendation', icon: Sparkles },
];

export default function AIPanel({ chatId, chatTitle }: AIPanelProps) {
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [localMessages, setLocalMessages] = useState<AIMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: conversation } = useQuery({
    queryKey: ['ai-history', chatId],
    queryFn: () => getAIHistory(chatId),
  });

  useEffect(() => {
    if (conversation?.messages) {
      setLocalMessages(conversation.messages);
    }
  }, [conversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages, streamingContent]);

  const clearMutation = useMutation({
    mutationFn: () => clearAIHistory(chatId),
    onSuccess: () => {
      setLocalMessages([]);
      queryClient.invalidateQueries({ queryKey: ['ai-history', chatId] });
      toast.success('Chat history cleared');
    },
  });

  const handleSend = async () => {
    if (!message.trim() || isStreaming) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    setLocalMessages((prev) => [...prev, userMessage]);
    setMessage('');
    setIsStreaming(true);
    setStreamingContent('');

    try {
      await streamAIMessage(
        chatId,
        message,
        (chunk) => setStreamingContent((prev) => prev + chunk),
        () => {
          setLocalMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: streamingContent,
              timestamp: new Date().toISOString(),
            },
          ]);
          setStreamingContent('');
          setIsStreaming(false);
          queryClient.invalidateQueries({ queryKey: ['ai-history', chatId] });
        }
      );
    } catch (error) {
      toast.error('Failed to send message');
      setIsStreaming(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    if (isStreaming) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: `[Quick Action: ${action}]`,
      timestamp: new Date().toISOString(),
    };

    setLocalMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');

    try {
      await streamQuickAction(
        chatId,
        action,
        (chunk) => setStreamingContent((prev) => prev + chunk),
        () => {
          setLocalMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: streamingContent,
              timestamp: new Date().toISOString(),
            },
          ]);
          setStreamingContent('');
          setIsStreaming(false);
          queryClient.invalidateQueries({ queryKey: ['ai-history', chatId] });
        }
      );
    } catch (error) {
      toast.error('Failed to execute action');
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-400" />
            AI Assistant
          </h3>
          <p className="text-xs text-dark-500 truncate">{chatTitle}</p>
        </div>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={localMessages.length === 0 || clearMutation.isPending}
          className="p-2 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-b border-white/5">
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleQuickAction(action.id)}
              disabled={isStreaming}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium glass-light hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              <action.icon className="w-3.5 h-3.5 text-accent-400" />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {localMessages.length === 0 && !isStreaming && (
          <div className="text-center py-8">
            <Sparkles className="w-12 h-12 mx-auto text-dark-600 mb-3" />
            <p className="text-dark-400 mb-1">Start a conversation</p>
            <p className="text-dark-500 text-sm">
              Ask questions about the candidates
            </p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {localMessages.map((msg, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={clsx(
                'rounded-xl p-3',
                msg.role === 'user'
                  ? 'bg-accent-500/20 ml-8'
                  : 'glass-light mr-8'
              )}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-light rounded-xl p-3 mr-8"
          >
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
            </div>
          </motion.div>
        )}

        {/* Loading indicator */}
        {isStreaming && !streamingContent && (
          <div className="flex items-center gap-2 text-dark-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/5">
        <div className="flex gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about candidates..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 glass-light rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-500/50 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || isStreaming}
            className="p-3 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
