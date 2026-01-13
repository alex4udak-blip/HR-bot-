import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Save,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Target,
  TrendingUp,
  Globe,
  RotateCcw
} from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import {
  getChatCriteria,
  updateChatCriteria,
  getCriteriaPresets,
  getDefaultCriteria,
  setDefaultCriteria
} from '@/services/api';
import type { Criterion, ChatTypeId } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface CriteriaPanelProps {
  chatId: number;
  chatType?: ChatTypeId;
}

const categoryIcons = {
  basic: Target,
  red_flags: AlertCircle,
  green_flags: CheckCircle,
  potential: TrendingUp,
};

const categoryColors = {
  basic: 'text-blue-400 bg-blue-500/20',
  red_flags: 'text-red-400 bg-red-500/20',
  green_flags: 'text-green-400 bg-green-500/20',
  potential: 'text-purple-400 bg-purple-500/20',
};

const categoryLabels = {
  basic: 'Основные',
  red_flags: 'Негативные',
  green_flags: 'Позитивные',
  potential: 'Потенциал',
};

export default function CriteriaPanel({ chatId, chatType }: CriteriaPanelProps) {
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuthStore();

  const { data: chatCriteria, isLoading } = useQuery({
    queryKey: ['chat-criteria', chatId],
    queryFn: () => getChatCriteria(chatId),
  });

  const { data: presets = [] } = useQuery({
    queryKey: ['criteria-presets'],
    queryFn: getCriteriaPresets,
  });

  useEffect(() => {
    if (chatCriteria?.criteria) {
      setCriteria(chatCriteria.criteria);
    }
  }, [chatCriteria]);

  const saveMutation = useMutation({
    mutationFn: () => updateChatCriteria(chatId, criteria),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-criteria', chatId] });
      setHasChanges(false);
      toast.success('Критерии сохранены');
    },
    onError: () => {
      toast.error('Ошибка сохранения');
    },
  });

  const saveAsDefaultMutation = useMutation({
    mutationFn: () => setDefaultCriteria(chatType!, criteria),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['default-criteria', chatType] });
      toast.success('Сохранено как критерии по умолчанию');
    },
    onError: () => {
      toast.error('Ошибка сохранения');
    },
  });

  const handleLoadDefaults = async () => {
    if (!chatType) return;
    try {
      const defaults = await getDefaultCriteria(chatType);
      if (defaults.criteria.length > 0) {
        setCriteria(defaults.criteria as Criterion[]);
        setHasChanges(true);
        toast.success(defaults.is_custom ? 'Загружены пользовательские критерии' : 'Загружены стандартные критерии');
      } else {
        toast.error('Нет критериев по умолчанию для этого типа');
      }
    } catch {
      toast.error('Ошибка загрузки критериев');
    }
  };

  const handleAddCriterion = () => {
    setCriteria([
      ...criteria,
      {
        name: '',
        description: '',
        weight: 5,
        category: 'basic',
      },
    ]);
    setHasChanges(true);
  };

  const handleRemoveCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleUpdateCriterion = (index: number, updates: Partial<Criterion>) => {
    setCriteria(
      criteria.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
    setHasChanges(true);
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === parseInt(presetId));
    if (preset) {
      setCriteria([...criteria, ...preset.criteria]);
      setHasChanges(true);
      toast.success(`Применён шаблон: ${preset.name}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">Критерии оценки</h3>
          <p className="text-sm text-dark-400 truncate">
            {criteria.length} {criteria.length === 1 ? 'критерий' : criteria.length < 5 ? 'критерия' : 'критериев'}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0 flex-wrap">
          {chatType && (
            <button
              onClick={handleLoadDefaults}
              className="flex items-center gap-2 px-3 py-2 rounded-lg glass-light text-sm hover:bg-white/10 transition-colors"
              title="Загрузить критерии по умолчанию"
            >
              <RotateCcw className="w-4 h-4" />
              По умолчанию
            </button>
          )}
          {presets.length > 0 && (
            <Select.Root onValueChange={handleApplyPreset}>
              <Select.Trigger className="flex items-center gap-2 px-3 py-2 rounded-lg glass-light text-sm hover:bg-white/10 transition-colors">
                <Select.Value placeholder="Шаблон" />
                <ChevronDown className="w-4 h-4" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="glass rounded-xl overflow-hidden shadow-xl z-50">
                  <Select.Viewport className="p-1">
                    {presets.map((preset) => (
                      <Select.Item
                        key={preset.id}
                        value={String(preset.id)}
                        className="px-3 py-2 rounded-lg cursor-pointer hover:bg-white/10 text-sm outline-none"
                      >
                        <Select.ItemText>{preset.name}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          )}
          <button
            onClick={handleAddCriterion}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        </div>
      </div>

      {/* Criteria List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {criteria.length === 0 ? (
            <div className="text-center py-8 glass-light rounded-xl">
              <Target className="w-12 h-12 mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400">Критерии не настроены</p>
              <p className="text-dark-500 text-sm mt-1">
                Добавьте критерии или выберите шаблон
              </p>
            </div>
          ) : (
            criteria.map((criterion, index) => {
              const Icon = categoryIcons[criterion.category as keyof typeof categoryIcons] || Target;
              const colorClass = categoryColors[criterion.category as keyof typeof categoryColors] || categoryColors.basic;

              return (
                <motion.div
                  key={index}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="glass-light rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <div className={clsx('p-2 rounded-lg flex-shrink-0', colorClass)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-3">
                      <input
                        type="text"
                        value={criterion.name}
                        onChange={(e) =>
                          handleUpdateCriterion(index, { name: e.target.value })
                        }
                        placeholder="Название критерия"
                        className="w-full bg-transparent border-b border-white/10 pb-1 text-sm font-medium focus:outline-none focus:border-accent-500"
                      />
                      <textarea
                        value={criterion.description}
                        onChange={(e) =>
                          handleUpdateCriterion(index, { description: e.target.value })
                        }
                        placeholder="Описание..."
                        rows={2}
                        className="w-full bg-transparent text-sm text-dark-300 resize-none focus:outline-none"
                      />
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-dark-500">Категория:</span>
                          <select
                            value={criterion.category}
                            onChange={(e) =>
                              handleUpdateCriterion(index, {
                                category: e.target.value as Criterion['category'],
                              })
                            }
                            className="bg-dark-800 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent-500"
                          >
                            {Object.entries(categoryLabels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-dark-500">Вес:</span>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={criterion.weight}
                            onChange={(e) =>
                              handleUpdateCriterion(index, {
                                weight: parseInt(e.target.value),
                              })
                            }
                            className="w-20 accent-accent-500"
                          />
                          <span className="text-xs font-medium w-4">{criterion.weight}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveCriterion(index)}
                      className="p-2 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Save Buttons */}
      {hasChanges && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky bottom-0 pt-4 space-y-2"
        >
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </button>
        </motion.div>
      )}

      {/* Save as Default Button - Superadmin only */}
      {isSuperAdmin() && chatType && criteria.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="pt-2 border-t border-white/10"
        >
          <button
            onClick={() => saveAsDefaultMutation.mutate()}
            disabled={saveAsDefaultMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl glass-light text-sm hover:bg-white/10 disabled:opacity-50 transition-colors"
            title={`Сохранить как критерии по умолчанию для всех чатов типа "${chatType}"`}
          >
            <Globe className="w-4 h-4" />
            {saveAsDefaultMutation.isPending ? 'Сохранение...' : 'Сохранить как глобальные'}
          </button>
          <p className="text-xs text-dark-500 text-center mt-1">
            Эти критерии будут применяться ко всем новым чатам типа «{chatType}»
          </p>
        </motion.div>
      )}
    </div>
  );
}
