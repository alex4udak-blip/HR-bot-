import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  CheckSquare,
  Lightbulb,
  Clock,
  User,
  Copy,
  Check,
  RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useCallStore } from '@/stores/callStore';
import type { CallRecording } from '@/types';

interface CallDetailProps {
  call: CallRecording;
}

export default function CallDetail({ call }: CallDetailProps) {
  const { reprocessCall, loading } = useCallStore();
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'actions'>('summary');
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReprocess = async () => {
    try {
      await reprocessCall(call.id);
      toast.success('Reprocessing started');
    } catch {
      toast.error('Failed to start reprocessing');
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="p-6">
      {/* Status Banner */}
      {call.status === 'failed' && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-400 font-medium">Processing Failed</p>
              {call.error_message && (
                <p className="text-sm text-red-300/60 mt-1">{call.error_message}</p>
              )}
            </div>
            <button
              onClick={handleReprocess}
              disabled={loading}
              className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors flex items-center gap-2"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Retry
            </button>
          </div>
        </div>
      )}

      {call.status !== 'done' && call.status !== 'failed' && (
        <div className="bg-cyan-500/20 border border-cyan-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <div>
              <p className="text-cyan-400 font-medium">Обработка</p>
              <p className="text-sm text-cyan-300/60">
                {call.status === 'transcribing' && 'Транскрибируем аудио...'}
                {call.status === 'analyzing' && 'Анализируем содержимое...'}
                {call.status === 'processing' && 'Обрабатываем аудио файл...'}
                {call.status === 'recording' && 'Идёт запись...'}
                {call.status === 'connecting' && 'Подключаемся к встрече...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-white/40 text-sm mb-2">
            <Clock size={16} />
            Длительность
          </div>
          <p className="text-2xl font-semibold text-white">
            {formatDuration(call.duration_seconds)}
          </p>
        </div>

        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-white/40 text-sm mb-2">
            <FileText size={16} />
            Источник
          </div>
          <p className="text-2xl font-semibold text-white capitalize">
            {call.source_type}
          </p>
        </div>

        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-white/40 text-sm mb-2">
            <User size={16} />
            Контакт
          </div>
          <p className="text-lg font-semibold text-white truncate">
            {call.entity_name || 'Не связан'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      {call.status === 'done' && (
        <>
          <div className="flex gap-2 mb-6">
            {[
              { id: 'summary', label: 'Резюме', icon: FileText },
              { id: 'transcript', label: 'Транскрипт', icon: FileText },
              { id: 'actions', label: 'Задачи', icon: CheckSquare }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors',
                    activeTab === tab.id
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  )}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 rounded-xl p-6"
          >
            {activeTab === 'summary' && (
              <div className="space-y-6">
                {call.summary && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <FileText size={20} className="text-cyan-400" />
                        Резюме
                      </h3>
                      <button
                        onClick={() => handleCopy(call.summary || '')}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-white/40" />}
                      </button>
                    </div>
                    <p className="text-white/80 whitespace-pre-wrap leading-relaxed">{call.summary}</p>
                  </div>
                )}

                {call.key_points && call.key_points.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
                      <Lightbulb size={20} className="text-yellow-400" />
                      Ключевые моменты
                    </h3>
                    <ul className="space-y-2">
                      {call.key_points.map((point, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-white/80">
                          <span className="w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'transcript' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Транскрипт</h3>
                  {call.transcript && (
                    <button
                      onClick={() => handleCopy(call.transcript || '')}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-white/40" />}
                    </button>
                  )}
                </div>

                {call.transcript ? (
                  <div className="prose prose-invert max-w-none">
                    <p className="text-white/80 whitespace-pre-wrap leading-relaxed">{call.transcript}</p>
                  </div>
                ) : (
                  <p className="text-white/40">Транскрипт недоступен</p>
                )}
              </div>
            )}

            {activeTab === 'actions' && (
              <div>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                  <CheckSquare size={20} className="text-green-400" />
                  Задачи
                </h3>

                {call.action_items && call.action_items.length > 0 ? (
                  <ul className="space-y-3">
                    {call.action_items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-3 p-3 bg-white/5 rounded-lg">
                        <div className="w-5 h-5 rounded border border-green-500/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <CheckSquare size={12} className="text-green-400 opacity-0" />
                        </div>
                        <span className="text-white/80">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-white/40">Задачи не обнаружены</p>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
