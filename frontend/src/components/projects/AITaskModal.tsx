import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  Plus,
  RefreshCw,
  SkipForward,
  Check,
  AlertCircle,
  Clock,
  User,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { aiParsePlan, aiCreateTasks } from '@/services/api/projects';
import type { ParsedTaskItem } from '@/services/api/projects';

interface AITaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  onTasksCreated?: () => void;
}

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Низкий', color: 'bg-gray-500/20 text-gray-400' },
  1: { label: 'Обычный', color: 'bg-blue-500/20 text-blue-400' },
  2: { label: 'Высокий', color: 'bg-amber-500/20 text-amber-400' },
  3: { label: 'Критический', color: 'bg-red-500/20 text-red-400' },
};

const ACTION_CONFIG = {
  create: { icon: Plus, label: 'Создать', color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/30' },
  update: { icon: RefreshCw, label: 'Обновить', color: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/30' },
  skip: { icon: SkipForward, label: 'Пропустить', color: 'text-gray-400', bg: 'bg-gray-500/20 border-gray-500/30' },
} as const;

export default function AITaskModal({ isOpen, onClose, projectId, onTasksCreated }: AITaskModalProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<ParsedTaskItem[]>([]);
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [step, setStep] = useState<'input' | 'preview'>('input');

  const handleParse = useCallback(async () => {
    if (!text.trim()) {
      toast.error('Введите текст плана');
      return;
    }
    setIsParsing(true);
    try {
      const response = await aiParsePlan(projectId, text.trim());
      setItems(response.items);
      // Check all non-skip items by default
      const checked = new Set<number>();
      response.items.forEach((item, idx) => {
        if (item.action !== 'skip') checked.add(idx);
      });
      setCheckedItems(checked);
      setStep('preview');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка разбора плана';
      toast.error(message);
    } finally {
      setIsParsing(false);
    }
  }, [text, projectId]);

  const handleCreate = useCallback(async () => {
    const selectedItems = items.filter((_, idx) => checkedItems.has(idx));
    if (selectedItems.length === 0) {
      toast.error('Выберите хотя бы одну задачу');
      return;
    }
    setIsCreating(true);
    try {
      const result = await aiCreateTasks(projectId, selectedItems);
      const parts: string[] = [];
      if (result.created > 0) parts.push(`создано: ${result.created}`);
      if (result.updated > 0) parts.push(`обновлено: ${result.updated}`);
      if (result.skipped > 0) parts.push(`пропущено: ${result.skipped}`);
      toast.success(`Готово! ${parts.join(', ')}`);
      onTasksCreated?.();
      handleClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка создания задач';
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }, [items, checkedItems, projectId, onTasksCreated]);

  const handleClose = useCallback(() => {
    setText('');
    setItems([]);
    setCheckedItems(new Set());
    setStep('input');
    setIsParsing(false);
    setIsCreating(false);
    onClose();
  }, [onClose]);

  const toggleCheck = (idx: number) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const cycleAction = (idx: number) => {
    const actions: Array<'create' | 'update' | 'skip'> = ['create', 'update', 'skip'];
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const currentIdx = actions.indexOf(item.action as 'create' | 'update' | 'skip');
        const nextAction = actions[(currentIdx + 1) % actions.length];
        return { ...item, action: nextAction };
      })
    );
  };

  const checkedCount = items.filter((_, idx) => checkedItems.has(idx)).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-[#1a1a2e]/95 border border-white/10 shadow-2xl backdrop-blur-xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">AI-создание задач</h2>
                  <p className="text-xs text-white/40">
                    {step === 'input'
                      ? 'Вставьте текст плана — AI разберёт на задачи'
                      : `Найдено ${items.length} задач — проверьте и подтвердите`}
                  </p>
                </div>
              </div>
              <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              <AnimatePresence mode="wait">
                {step === 'input' ? (
                  <motion.div
                    key="input"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                  >
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={`Вставьте ваш план на день, например:\n\n1. Провести код-ревью PR #42 (Иван, 2ч)\n2. Доделать фичу авторизации — критично!\n3. Созвон с дизайнерами по новому UI\n4. Написать тесты для API эндпоинтов`}
                      className="w-full h-64 p-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 resize-none focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                      autoFocus
                    />
                    <p className="mt-2 text-xs text-white/30">
                      AI определит приоритеты, исполнителей и найдёт дубликаты среди существующих задач.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-2"
                  >
                    {items.map((item, idx) => {
                      const actionCfg = ACTION_CONFIG[item.action as keyof typeof ACTION_CONFIG] || ACTION_CONFIG.create;
                      const ActionIcon = actionCfg.icon;
                      const priorityCfg = PRIORITY_LABELS[item.priority] || PRIORITY_LABELS[1];
                      const isChecked = checkedItems.has(idx);

                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className={clsx(
                            'rounded-xl border p-3 transition-all',
                            isChecked
                              ? 'bg-white/5 border-white/15'
                              : 'bg-white/[0.02] border-white/5 opacity-50'
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Checkbox */}
                            <button
                              onClick={() => toggleCheck(idx)}
                              className={clsx(
                                'mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                                isChecked
                                  ? 'bg-purple-500 border-purple-500'
                                  : 'border-white/20 hover:border-white/40'
                              )}
                            >
                              {isChecked && <Check className="w-3 h-3 text-white" />}
                            </button>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Action badge */}
                                <button
                                  onClick={() => cycleAction(idx)}
                                  className={clsx(
                                    'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border cursor-pointer hover:opacity-80 transition-opacity',
                                    actionCfg.bg
                                  )}
                                  title="Нажмите для смены действия"
                                >
                                  <ActionIcon className={clsx('w-3 h-3', actionCfg.color)} />
                                  {actionCfg.label}
                                </button>

                                {/* Priority */}
                                <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', priorityCfg.color)}>
                                  {priorityCfg.label}
                                </span>

                                {/* Hours */}
                                {item.estimated_hours && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-white/40">
                                    <Clock className="w-3 h-3" />
                                    {item.estimated_hours}ч
                                  </span>
                                )}

                                {/* Assignee */}
                                {item.assignee_hint && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-white/40">
                                    <User className="w-3 h-3" />
                                    {item.assignee_hint}
                                  </span>
                                )}
                              </div>

                              {/* Title */}
                              <p className="mt-1 text-sm text-white font-medium">{item.title}</p>

                              {/* Description */}
                              {item.description && (
                                <p className="mt-0.5 text-xs text-white/40 line-clamp-2">{item.description}</p>
                              )}

                              {/* Existing task reference */}
                              {item.existing_task_title && (
                                <p className="mt-1 text-[10px] text-white/30 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  Связана с: &quot;{item.existing_task_title}&quot;
                                </p>
                              )}

                              {/* Reason */}
                              {item.reason && (
                                <p className="mt-0.5 text-[10px] text-white/25 italic">{item.reason}</p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-white/10 flex items-center justify-between">
              {step === 'preview' && (
                <button
                  onClick={() => setStep('input')}
                  className="px-4 py-2 text-xs font-medium text-white/60 hover:text-white transition-colors"
                >
                  Назад к тексту
                </button>
              )}
              {step === 'input' && <div />}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-xs font-medium text-white/40 hover:text-white/60 transition-colors"
                >
                  Отмена
                </button>

                {step === 'input' ? (
                  <button
                    onClick={handleParse}
                    disabled={isParsing || !text.trim()}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isParsing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        AI разбирает...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Разобрать
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleCreate}
                    disabled={isCreating || checkedCount === 0}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Создаю...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Создать ({checkedCount})
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
