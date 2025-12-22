import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  CheckSquare,
  Lightbulb,
  Clock,
  User,
  Copy,
  Check,
  RefreshCw,
  Edit3,
  X,
  Save,
  Link,
  Unlink
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useCallStore } from '@/stores/callStore';
import { useEntityStore } from '@/stores/entityStore';
import type { CallRecording } from '@/types';

interface CallDetailProps {
  call: CallRecording;
}

export default function CallDetail({ call }: CallDetailProps) {
  const { reprocessCall, updateCall, loading } = useCallStore();
  const { entities, fetchEntities } = useEntityStore();

  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'actions'>('summary');
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(call.title || '');
  const [editEntityId, setEditEntityId] = useState<number | null>(call.entity_id || null);
  const [saving, setSaving] = useState(false);

  // Fetch entities for dropdown
  useEffect(() => {
    if (isEditing && entities.length === 0) {
      fetchEntities();
    }
  }, [isEditing]);

  // Sync edit state when call changes
  useEffect(() => {
    setEditTitle(call.title || '');
    setEditEntityId(call.entity_id || null);
  }, [call.id, call.title, call.entity_id]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Скопировано');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReprocess = async () => {
    try {
      await reprocessCall(call.id);
      toast.success('Переобработка запущена');
    } catch {
      toast.error('Не удалось запустить переобработку');
    }
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await updateCall(call.id, {
        title: editTitle || undefined,
        entity_id: editEntityId === null ? -1 : editEntityId
      });
      toast.success('Изменения сохранены');
      setIsEditing(false);
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditTitle(call.title || '');
    setEditEntityId(call.entity_id || null);
    setIsEditing(false);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}м ${secs}с`;
  };

  return (
    <div className="p-6">
      {/* Edit Panel */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border border-purple-500/30 rounded-xl p-4 mb-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Edit3 size={20} className="text-purple-400" />
                Редактирование звонка
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-white/60 hover:bg-white/20 transition-colors flex items-center gap-2"
                >
                  <X size={16} />
                  Отмена
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors flex items-center gap-2"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Сохранить
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Title */}
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Название звонка
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Например: Интервью с кандидатом"
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              {/* Entity Link */}
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Связать с контактом
                </label>
                <div className="flex gap-2">
                  <select
                    value={editEntityId || ''}
                    onChange={(e) => setEditEntityId(e.target.value ? parseInt(e.target.value) : null)}
                    className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-gray-900">Не связан</option>
                    {entities.map((entity) => (
                      <option key={entity.id} value={entity.id} className="bg-gray-900">
                        {entity.name} ({entity.type})
                      </option>
                    ))}
                  </select>
                  {editEntityId && (
                    <button
                      onClick={() => setEditEntityId(null)}
                      className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      title="Отвязать"
                    >
                      <Unlink size={20} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Banner */}
      {call.status === 'failed' && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-400 font-medium">Обработка не удалась</p>
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
              Повторить
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
                {call.status === 'pending' && 'Ожидание...'}
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

        <div className="bg-white/5 rounded-xl p-4 relative group">
          <div className="flex items-center gap-2 text-white/40 text-sm mb-2">
            <User size={16} />
            Контакт
          </div>
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold text-white truncate">
              {call.entity_name || 'Не связан'}
            </p>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-all"
                title="Редактировать"
              >
                <Edit3 size={14} className="text-white/60" />
              </button>
            )}
          </div>
          {call.entity_id && (
            <div className="mt-1 flex items-center gap-1 text-xs text-cyan-400/60">
              <Link size={12} />
              Связан
            </div>
          )}
        </div>
      </div>

      {/* Title Display/Edit Button */}
      {(call.title || !isEditing) && (
        <div className="flex items-center gap-3 mb-6">
          {call.title && (
            <div className="flex-1 bg-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 text-white/40 text-sm mb-1">
                <FileText size={14} />
                Название
              </div>
              <p className="text-white font-medium">{call.title}</p>
            </div>
          )}
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors flex items-center gap-2"
            >
              <Edit3 size={16} />
              {call.title || call.entity_name ? 'Редактировать' : 'Добавить название / связать'}
            </button>
          )}
        </div>
      )}

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

                {!call.summary && (!call.key_points || call.key_points.length === 0) && (
                  <p className="text-white/40">Резюме недоступно</p>
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

                {/* Speaker-based transcript (chat style) */}
                {call.speakers && call.speakers.length > 0 ? (
                  <div className="space-y-3">
                    {call.speakers.map((segment, idx) => {
                      // Generate consistent color for each speaker
                      const speakerColors = [
                        { bg: 'bg-cyan-500/20', border: 'border-cyan-500/30', text: 'text-cyan-400' },
                        { bg: 'bg-purple-500/20', border: 'border-purple-500/30', text: 'text-purple-400' },
                        { bg: 'bg-green-500/20', border: 'border-green-500/30', text: 'text-green-400' },
                        { bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', text: 'text-yellow-400' },
                        { bg: 'bg-pink-500/20', border: 'border-pink-500/30', text: 'text-pink-400' },
                        { bg: 'bg-orange-500/20', border: 'border-orange-500/30', text: 'text-orange-400' },
                      ];

                      // Get unique speakers to assign colors
                      const uniqueSpeakers = [...new Set(call.speakers?.map(s => s.speaker) || [])];
                      const speakerIndex = uniqueSpeakers.indexOf(segment.speaker);
                      const colorSet = speakerColors[speakerIndex % speakerColors.length];

                      const formatTime = (seconds: number) => {
                        const mins = Math.floor(seconds / 60);
                        const secs = Math.floor(seconds % 60);
                        return `${mins}:${secs.toString().padStart(2, '0')}`;
                      };

                      return (
                        <div
                          key={idx}
                          className={clsx(
                            'p-4 rounded-xl border',
                            colorSet.bg,
                            colorSet.border
                          )}
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <div className={clsx(
                              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                              colorSet.bg,
                              colorSet.text
                            )}>
                              <User size={16} />
                            </div>
                            <span className={clsx('font-medium', colorSet.text)}>
                              {segment.speaker}
                            </span>
                            <span className="text-white/30 text-xs ml-auto">
                              {formatTime(segment.start)} — {formatTime(segment.end)}
                            </span>
                          </div>
                          <p className="text-white/80 leading-relaxed pl-11">
                            {segment.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : call.transcript ? (
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
