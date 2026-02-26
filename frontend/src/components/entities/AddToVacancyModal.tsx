import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Briefcase, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { getVacancies, applyEntityToVacancy } from '@/services/api';
import type { Vacancy } from '@/types';
import { VACANCY_STATUS_LABELS, VACANCY_STATUS_COLORS } from '@/types';
import { formatSalary } from '@/utils';

interface AddToVacancyModalProps {
  entityId: number;
  entityName: string;
  onClose: () => void;
  onSuccess: () => void;
}

// Source options for candidates
const SOURCE_OPTIONS = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'hh', label: 'HeadHunter' },
  { value: 'referral', label: 'Реферал' },
  { value: 'direct', label: 'Прямой отклик' },
  { value: 'agency', label: 'Агентство' },
  { value: 'other', label: 'Другое' },
];

export default function AddToVacancyModal({
  entityId,
  entityName,
  onClose,
  onSuccess
}: AddToVacancyModalProps) {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null);
  const [source, setSource] = useState('');
  const [loadingVacancies, setLoadingVacancies] = useState(false);

  // Load open vacancies
  useEffect(() => {
    const loadVacancies = async () => {
      setLoadingVacancies(true);
      try {
        const data = await getVacancies({
          status: 'open',
          search: searchQuery || undefined
        });
        setVacancies(data);
      } catch (error) {
        console.error('Failed to load vacancies:', error);
        toast.error('Не удалось загрузить вакансии');
      } finally {
        setLoadingVacancies(false);
      }
    };

    const debounce = setTimeout(loadVacancies, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleSubmit = async () => {
    if (!selectedVacancy) {
      toast.error('Выберите вакансию');
      return;
    }

    setLoading(true);
    try {
      await applyEntityToVacancy(entityId, selectedVacancy.id, source || undefined);
      toast.success('Кандидат добавлен в вакансию');
      onSuccess();
    } catch (error: any) {
      const message = error?.response?.data?.detail || 'Ошибка при добавлении';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Format salary for display using utility function
  const getSalaryDisplay = (vacancy: Vacancy) => {
    if (!vacancy.salary_min && !vacancy.salary_max) return null;
    return formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Briefcase className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Добавить в вакансию</h2>
              <p className="text-sm text-white/60">{entityName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-dark-800/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col p-4">
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Поиск вакансии..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Source */}
          <div className="mb-4">
            <label className="block text-sm text-white/60 mb-1">Источник</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500"
            >
              <option value="">Не указан</option>
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Vacancies List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {loadingVacancies ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : vacancies.length === 0 ? (
              <div className="text-center py-8 text-white/40">
                <Briefcase className="w-12 h-12 mx-auto mb-2" />
                <p>Вакансии не найдены</p>
                <p className="text-sm mt-1">Нет открытых вакансий</p>
              </div>
            ) : (
              vacancies.map((vacancy) => {
                const salary = getSalaryDisplay(vacancy);
                return (
                  <button
                    key={vacancy.id}
                    onClick={() => setSelectedVacancy(vacancy)}
                    className={clsx(
                      'w-full p-3 rounded-lg border text-left transition-colors',
                      selectedVacancy?.id === vacancy.id
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-white/10 glass-light hover:bg-white/10'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{vacancy.title}</p>
                      </div>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full ml-2', VACANCY_STATUS_COLORS[vacancy.status])}>
                        {VACANCY_STATUS_LABELS[vacancy.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/60">
                      {vacancy.location && <span>{vacancy.location}</span>}
                      {vacancy.location && salary && <span>•</span>}
                      {salary && <span>{salary}</span>}
                    </div>
                    {vacancy.department_name && (
                      <p className="text-xs text-white/40 mt-1">{vacancy.department_name}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-white/40">
                      <span>{vacancy.applications_count} кандидатов</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/60 hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !selectedVacancy}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {loading ? 'Добавление...' : 'Добавить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
