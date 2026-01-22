import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Search, UserPlus, User } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useVacancyStore } from '@/stores/vacancyStore';
import { getEntities } from '@/services/api';
import type { Entity } from '@/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';

interface AddCandidateModalProps {
  vacancyId: number;
  onClose: () => void;
}

const SOURCE_OPTIONS = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'hh', label: 'HeadHunter' },
  { value: 'referral', label: 'Реферал' },
  { value: 'direct', label: 'Прямой отклик' },
  { value: 'agency', label: 'Агентство' },
  { value: 'other', label: 'Другое' },
];

export default function AddCandidateModal({ vacancyId, onClose }: AddCandidateModalProps) {
  const { addCandidateToVacancy } = useVacancyStore();
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [candidates, setCandidates] = useState<Entity[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Entity | null>(null);
  const [source, setSource] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  useEffect(() => {
    const loadCandidates = async () => {
      setLoadingCandidates(true);
      try {
        const data = await getEntities({
          type: 'candidate',
          search: searchQuery || undefined
        });
        setCandidates(data);
      } catch (error) {
        console.error('Failed to load candidates:', error);
      } finally {
        setLoadingCandidates(false);
      }
    };

    const debounce = setTimeout(loadCandidates, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleSubmit = async () => {
    if (!selectedCandidate) {
      toast.error('Выберите кандидата');
      return;
    }

    setLoading(true);
    try {
      await addCandidateToVacancy(vacancyId, selectedCandidate.id, source || undefined);
      toast.success('Кандидат добавлен в вакансию');
      onClose();
    } catch (error: any) {
      const message = error?.response?.data?.detail || 'Ошибка при добавлении';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-candidate-modal-title"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <UserPlus className="w-5 h-5 text-blue-400" aria-hidden="true" />
            </div>
            <h2 id="add-candidate-modal-title" className="text-lg font-semibold">Добавить кандидата</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            aria-label="Закрыть окно"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col p-4">
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" aria-hidden="true" />
            <input
              type="text"
              placeholder="Поиск кандидата..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
              aria-label="Поиск кандидата по имени"
            />
          </div>

          {/* Source */}
          <div className="mb-4">
            <label htmlFor="candidate-source" className="block text-sm text-white/60 mb-1">Источник</label>
            <select
              id="candidate-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
            >
              <option value="">Не указан</option>
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Candidates List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0" role="listbox" aria-label="Список кандидатов">
            {loadingCandidates ? (
              <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" aria-hidden="true" />
                <span className="sr-only">Загрузка кандидатов...</span>
              </div>
            ) : candidates.length === 0 ? (
              <div className="text-center py-8 text-white/40">
                <User className="w-12 h-12 mx-auto mb-2" aria-hidden="true" />
                <p>Кандидаты не найдены</p>
              </div>
            ) : (
              candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => setSelectedCandidate(candidate)}
                  className={clsx(
                    'w-full p-3 rounded-lg border text-left transition-colors',
                    selectedCandidate?.id === candidate.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  )}
                  role="option"
                  aria-selected={selectedCandidate?.id === candidate.id}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{candidate.name}</p>
                      <p className="text-sm text-white/60 truncate">
                        {candidate.email || candidate.phone || 'Нет контактов'}
                      </p>
                    </div>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full ml-2', STATUS_COLORS[candidate.status])}>
                      {STATUS_LABELS[candidate.status]}
                    </span>
                  </div>
                  {candidate.position && (
                    <p className="text-xs text-white/40 mt-1 truncate">{candidate.position}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/60 hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !selectedCandidate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            aria-busy={loading}
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            {loading ? 'Добавление...' : 'Добавить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
