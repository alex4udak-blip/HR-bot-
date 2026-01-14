import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Copy,
  GitMerge,
  ChevronRight,
  X,
  Mail,
  Phone,
  User,
  Building2,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Trash2
} from 'lucide-react';
import clsx from 'clsx';
import { getDuplicateCandidates, mergeEntities } from '@/services/api';

interface DuplicateCandidate {
  entity_id: number;
  entity_name: string;
  confidence: number;
  match_reasons: string[];
  matched_fields: Record<string, string[]>;
}

interface DuplicateWarningProps {
  entityId: number;
  entityName: string;
  isAdmin?: boolean;
  isTransferred?: boolean;
  onMergeComplete?: () => void;
}

export default function DuplicateWarning({
  entityId,
  entityName,
  isAdmin = false,
  isTransferred = false,
  onMergeComplete
}: DuplicateWarningProps) {
  const navigate = useNavigate();
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedDuplicate, setSelectedDuplicate] = useState<DuplicateCandidate | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [keepSourceData, setKeepSourceData] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const data = await getDuplicateCandidates(entityId);
      // Only show high-confidence duplicates (>= 50%)
      setDuplicates(data.filter((d: DuplicateCandidate) => d.confidence >= 50));
    } catch (err) {
      console.error('Failed to load duplicates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDuplicates();
  }, [entityId]);

  const handleOpenMergeModal = (duplicate: DuplicateCandidate) => {
    setSelectedDuplicate(duplicate);
    setMergeError(null);
    setShowMergeModal(true);
  };

  const handleMerge = async () => {
    if (!selectedDuplicate) return;

    setMerging(true);
    setMergeError(null);

    try {
      await mergeEntities(entityId, selectedDuplicate.entity_id, keepSourceData);
      setShowMergeModal(false);
      setDuplicates((prev) => prev.filter((d) => d.entity_id !== selectedDuplicate.entity_id));
      onMergeComplete?.();
    } catch (err: unknown) {
      console.error('Failed to merge entities:', err);
      const errorMessage = err instanceof Error ? err.message : 'Не удалось объединить контакты';
      setMergeError(errorMessage);
    } finally {
      setMerging(false);
    }
  };

  const handleNavigateToEntity = (id: number) => {
    navigate(`/entities/${id}`);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-red-400';
    if (confidence >= 60) return 'text-orange-400';
    return 'text-yellow-400';
  };

  const getConfidenceBgColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-red-500/20';
    if (confidence >= 60) return 'bg-orange-500/20';
    return 'bg-yellow-500/20';
  };

  const getFieldIcon = (field: string) => {
    switch (field) {
      case 'email': return Mail;
      case 'phone': return Phone;
      case 'name': return User;
      case 'company': return Building2;
      default: return CheckCircle2;
    }
  };

  const getFieldLabel = (field: string) => {
    switch (field) {
      case 'email': return 'Email';
      case 'phone': return 'Телефон';
      case 'name': return 'Имя';
      case 'company': return 'Компания';
      default: return field;
    }
  };

  // Don't render if loading, dismissed, or no duplicates
  if (loading || dismissed || duplicates.length === 0) {
    return null;
  }

  return (
    <>
      {/* Warning Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-yellow-500/20 rounded-lg flex-shrink-0">
            <AlertTriangle size={20} className="text-yellow-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-yellow-400 mb-1">
              Обнаружены возможные дубликаты
            </h4>
            <p className="text-sm text-yellow-200/70">
              Найдено {duplicates.length} контакт{duplicates.length > 1 ? 'а' : ''},
              похожих на "{entityName}". Проверьте, не являются ли они одним человеком.
            </p>

            {/* Duplicates list */}
            <div className="mt-3 space-y-2">
              {duplicates.map((duplicate) => (
                <div
                  key={duplicate.entity_id}
                  className="flex items-center justify-between p-3 bg-black/20 rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={clsx(
                      'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
                      getConfidenceBgColor(duplicate.confidence),
                      getConfidenceColor(duplicate.confidence)
                    )}>
                      <Copy size={12} />
                      {duplicate.confidence}%
                    </div>
                    <button
                      onClick={() => handleNavigateToEntity(duplicate.entity_id)}
                      className="text-white hover:text-blue-400 transition-colors truncate flex items-center gap-1"
                    >
                      {duplicate.entity_name}
                      <ExternalLink size={12} className="flex-shrink-0" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Match reasons badges */}
                    <div className="hidden sm:flex items-center gap-1">
                      {Object.keys(duplicate.matched_fields).slice(0, 2).map((field) => {
                        const Icon = getFieldIcon(field);
                        return (
                          <span
                            key={field}
                            className="p-1 bg-white/10 rounded text-white/60"
                            title={`Совпадение: ${getFieldLabel(field)}`}
                          >
                            <Icon size={12} />
                          </span>
                        );
                      })}
                    </div>

                    {isAdmin && !isTransferred && (
                      <button
                        onClick={() => handleOpenMergeModal(duplicate)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 text-blue-400 text-xs rounded-lg hover:bg-blue-500/30 transition-colors"
                      >
                        <GitMerge size={12} />
                        Объединить
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setDismissed(true)}
            className="p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
            title="Скрыть"
          >
            <X size={16} className="text-white/40" />
          </button>
        </div>
      </motion.div>

      {/* Merge Modal */}
      <AnimatePresence>
        {showMergeModal && selectedDuplicate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
            onClick={() => setShowMergeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-gray-900 rounded-2xl border border-white/10 overflow-hidden"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/10">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <GitMerge size={20} className="text-blue-400" />
                  Объединение контактов
                </h3>
                <p className="text-sm text-white/60 mt-1">
                  Все данные будут объединены, один из контактов будет удален.
                </p>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Visual merge representation */}
                <div className="flex items-center justify-center gap-4 mb-6">
                  <div className="flex-1 p-4 bg-white/5 rounded-xl text-center">
                    <p className="text-xs text-white/40 mb-1">Останется</p>
                    <p className="font-medium text-white">{entityName}</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <ChevronRight size={20} className="text-white/40" />
                    <GitMerge size={16} className="text-blue-400 my-1" />
                    <ChevronRight size={20} className="text-white/40" />
                  </div>
                  <div className="flex-1 p-4 bg-red-500/10 rounded-xl text-center border border-red-500/30">
                    <p className="text-xs text-red-400 mb-1 flex items-center justify-center gap-1">
                      <Trash2 size={10} />
                      Будет удален
                    </p>
                    <p className="font-medium text-white">{selectedDuplicate.entity_name}</p>
                  </div>
                </div>

                {/* Matched fields */}
                <div className="mb-6">
                  <p className="text-sm text-white/60 mb-3">Совпадающие данные:</p>
                  <div className="space-y-2">
                    {Object.entries(selectedDuplicate.matched_fields).map(([field, values]) => {
                      const Icon = getFieldIcon(field);
                      return (
                        <div
                          key={field}
                          className="flex items-center gap-3 p-3 bg-white/5 rounded-lg"
                        >
                          <Icon size={16} className="text-white/40 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white/40">{getFieldLabel(field)}</p>
                            <p className="text-sm text-white truncate">
                              {values.join(' / ')}
                            </p>
                          </div>
                          <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Options */}
                <div className="p-4 bg-white/5 rounded-xl mb-6">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={keepSourceData}
                      onChange={(e) => setKeepSourceData(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-white/30 bg-white/10 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <div>
                      <p className="text-sm text-white">
                        Приоритет данных удаляемого контакта
                      </p>
                      <p className="text-xs text-white/40 mt-0.5">
                        При конфликте данных использовать значения из "{selectedDuplicate.entity_name}"
                      </p>
                    </div>
                  </label>
                </div>

                {/* Error message */}
                {mergeError && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg mb-4">
                    <p className="text-sm text-red-400">{mergeError}</p>
                  </div>
                )}

                {/* Warning */}
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-xs text-yellow-200/70">
                    <span className="font-medium text-yellow-400">Внимание:</span> Это действие
                    необратимо. Все чаты, звонки и история будут перенесены на основной контакт.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/10 flex justify-between">
                <button
                  onClick={() => setShowMergeModal(false)}
                  className="px-4 py-2 bg-white/10 text-white/80 rounded-lg hover:bg-white/20 transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={handleMerge}
                  disabled={merging}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                    merging
                      ? 'bg-blue-500/30 text-blue-300 cursor-wait'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  )}
                >
                  {merging ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Объединение...
                    </>
                  ) : (
                    <>
                      <GitMerge size={16} />
                      Объединить
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
