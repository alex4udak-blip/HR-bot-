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
  Loader2,
  BarChart,
  AlertCircle,
  Users,
  Clock,
  CheckSquare,
  Smile,
  MessageSquare,
  Handshake,
  Heart,
  TrendingUp,
  Shield,
  MessageCircle,
  HelpCircle,
  Target,
  XCircle,
  Wallet,
  Crown,
  ArrowRight,
  List,
  CheckCircle,
  ArrowUp,
  AlignLeft
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getAIHistory, clearAIHistory, streamAIMessage, streamQuickAction } from '@/services/api';
import type { AIMessage, ChatTypeId } from '@/types';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface AIPanelProps {
  chatId: number;
  chatTitle: string;
  chatType?: ChatTypeId;
}

// Icon mapping
const iconMap: Record<string, typeof FileText> = {
  FileText, AlertTriangle, ThumbsUp, Sparkles, BarChart, AlertCircle, Users, Clock,
  CheckSquare, Smile, MessageSquare, Handshake, Heart, TrendingUp, Shield, MessageCircle,
  HelpCircle, Target, XCircle, Wallet, Crown, ArrowRight, List, CheckCircle, ArrowUp, AlignLeft
};

// Quick actions per chat type
const QUICK_ACTIONS_BY_TYPE: Record<ChatTypeId, { id: string; label: string; icon: string }[]> = {
  hr: [
    { id: 'full_analysis', label: 'Full Analysis', icon: 'FileText' },
    { id: 'red_flags', label: 'Red Flags', icon: 'AlertTriangle' },
    { id: 'strengths', label: 'Strengths', icon: 'ThumbsUp' },
    { id: 'recommendation', label: 'Recommendation', icon: 'Sparkles' },
    { id: 'culture_fit', label: 'Culture Fit', icon: 'Users' },
  ],
  project: [
    { id: 'project_status', label: 'Project Status', icon: 'BarChart' },
    { id: 'blockers', label: 'Blockers', icon: 'AlertCircle' },
    { id: 'responsibilities', label: 'Who Does What', icon: 'Users' },
    { id: 'deadlines', label: 'Deadline Risks', icon: 'Clock' },
    { id: 'action_items', label: 'Action Items', icon: 'CheckSquare' },
  ],
  client: [
    { id: 'satisfaction', label: 'Satisfaction', icon: 'Smile' },
    { id: 'churn_risk', label: 'Churn Risk', icon: 'AlertTriangle' },
    { id: 'requests', label: 'Requests', icon: 'MessageSquare' },
    { id: 'promises', label: 'Our Promises', icon: 'Handshake' },
    { id: 'sentiment', label: 'Sentiment', icon: 'Heart' },
  ],
  contractor: [
    { id: 'performance', label: 'Performance', icon: 'TrendingUp' },
    { id: 'reliability', label: 'Reliability', icon: 'Shield' },
    { id: 'communication', label: 'Communication', icon: 'MessageCircle' },
    { id: 'issues', label: 'Issues', icon: 'AlertCircle' },
    { id: 'recommendation', label: 'Continue?', icon: 'HelpCircle' },
  ],
  sales: [
    { id: 'deal_stage', label: 'Deal Stage', icon: 'Target' },
    { id: 'objections', label: 'Objections', icon: 'XCircle' },
    { id: 'budget', label: 'Budget Info', icon: 'Wallet' },
    { id: 'decision_maker', label: 'Decision Maker', icon: 'Crown' },
    { id: 'next_steps', label: 'Next Steps', icon: 'ArrowRight' },
  ],
  support: [
    { id: 'issues_summary', label: 'Issues Summary', icon: 'List' },
    { id: 'resolution_rate', label: 'Resolution Rate', icon: 'CheckCircle' },
    { id: 'response_time', label: 'Response Time', icon: 'Clock' },
    { id: 'sentiment', label: 'Customer Mood', icon: 'Smile' },
    { id: 'escalations', label: 'Escalations', icon: 'ArrowUp' },
  ],
  custom: [
    { id: 'full_analysis', label: 'Full Analysis', icon: 'FileText' },
    { id: 'summary', label: 'Summary', icon: 'AlignLeft' },
    { id: 'key_points', label: 'Key Points', icon: 'List' },
    { id: 'action_items', label: 'Action Items', icon: 'CheckSquare' },
  ],
};

export default function AIPanel({ chatId, chatTitle, chatType = 'hr' }: AIPanelProps) {
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Get quick actions for current chat type
  const quickActions = QUICK_ACTIONS_BY_TYPE[chatType] || QUICK_ACTIONS_BY_TYPE.custom;
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
          {quickActions.map((action) => {
            const Icon = iconMap[action.icon] || FileText;
            return (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action.id)}
                disabled={isStreaming}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium glass-light hover:bg-white/10 disabled:opacity-50 transition-colors"
              >
                <Icon className="w-3.5 h-3.5 text-accent-400" />
                {action.label}
              </button>
            );
          })}
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
