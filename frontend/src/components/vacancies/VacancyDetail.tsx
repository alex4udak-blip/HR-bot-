import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useKeyboardShortcuts } from '@/hooks';
import {
  MapPin,
  DollarSign,
  Clock,
  Building2,
  User,
  Calendar,
  Users,
  Plus,
  Star,
  Tag,
  FileText,
  CheckCircle,
  XCircle,
  TrendingUp
} from 'lucide-react';
import type { Vacancy } from '@/types';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  APPLICATION_STAGE_LABELS,
} from '@/types';
import { formatSalary } from '@/utils';
import { useVacancyStore } from '@/stores/vacancyStore';
import AddCandidateModal from './AddCandidateModal';
import { NoCandidatesEmpty } from '@/components/ui';

interface VacancyDetailProps {
  vacancy: Vacancy;
}

export default function VacancyDetail({ vacancy }: VacancyDetailProps) {
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const { fetchKanbanBoard } = useVacancyStore();

  // Keyboard shortcut: Escape closes add candidate modal
  const handleCloseModal = useCallback(() => {
    if (showAddCandidate) {
      setShowAddCandidate(false);
    }
  }, [showAddCandidate]);

  useKeyboardShortcuts([
    {
      key: 'Escape',
      handler: handleCloseModal,
      description: 'Close add candidate modal',
    },
  ], { enabled: showAddCandidate });

  useEffect(() => {
    fetchKanbanBoard(vacancy.id);
  }, [vacancy.id, fetchKanbanBoard]);

  const formatDate = (date?: string) => {
    if (!date) return 'Не указана';
    return new Date(date).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  // Calculate stats
  const totalCandidates = vacancy.applications_count;
  const hiredCount = vacancy.stage_counts?.hired || 0;
  const rejectedCount = vacancy.stage_counts?.rejected || 0;
  const inProgressCount = totalCandidates - hiredCount - rejectedCount - (vacancy.stage_counts?.withdrawn || 0);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 text-white/60 mb-2">
              <Users className="w-4 h-4" />
              <span className="text-sm">Всего кандидатов</span>
            </div>
            <p className="text-2xl font-bold">{totalCandidates}</p>
          </div>
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 text-blue-400 mb-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">В процессе</span>
            </div>
            <p className="text-2xl font-bold">{inProgressCount}</p>
          </div>
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 text-green-400 mb-2">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm">Наняты</span>
            </div>
            <p className="text-2xl font-bold">{hiredCount}</p>
          </div>
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 text-red-400 mb-2">
              <XCircle className="w-4 h-4" />
              <span className="text-sm">Отклонены</span>
            </div>
            <p className="text-2xl font-bold">{rejectedCount}</p>
          </div>
        </div>

        {/* Main Info */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Details Card */}
          <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" />
              Детали вакансии
            </h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Локация</p>
                  <p>{vacancy.location || 'Не указана'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Зарплата</p>
                  <p>{formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Тип занятости</p>
                  <p>{EMPLOYMENT_TYPES.find(t => t.value === vacancy.employment_type)?.label || 'Не указан'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Star className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Уровень</p>
                  <p>{EXPERIENCE_LEVELS.find(l => l.value === vacancy.experience_level)?.label || 'Не указан'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Отдел</p>
                  <p>{vacancy.department_name || 'Не указан'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Ответственный</p>
                  <p>{vacancy.hiring_manager_name || 'Не назначен'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-white/40" />
                <div>
                  <p className="text-sm text-white/60">Опубликована</p>
                  <p>{formatDate(vacancy.published_at)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline Overview */}
          <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-400" />
                Воронка найма
              </h3>
              <button
                onClick={() => setShowAddCandidate(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </button>
            </div>

            <div className="space-y-3">
              {Object.entries(vacancy.stage_counts || {}).length > 0 ? (
                Object.entries(vacancy.stage_counts).map(([stage, count]) => {
                  const percentage = totalCandidates > 0 ? Math.round((count / totalCandidates) * 100) : 0;
                  return (
                    <div key={stage} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{APPLICATION_STAGE_LABELS[stage as keyof typeof APPLICATION_STAGE_LABELS] || stage}</span>
                        <span className="text-white/60">{count} ({percentage}%)</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          className="h-full bg-blue-500 rounded-full"
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <NoCandidatesEmpty onAdd={() => setShowAddCandidate(true)} />
              )}
            </div>
          </div>
        </div>

        {/* Description sections */}
        {vacancy.description && (
          <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-3">Описание</h3>
            <p className="text-white/80 whitespace-pre-wrap">{vacancy.description}</p>
          </div>
        )}

        {vacancy.requirements && (
          <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-3">Требования</h3>
            <p className="text-white/80 whitespace-pre-wrap">{vacancy.requirements}</p>
          </div>
        )}

        {vacancy.responsibilities && (
          <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-3">Обязанности</h3>
            <p className="text-white/80 whitespace-pre-wrap">{vacancy.responsibilities}</p>
          </div>
        )}

        {/* Tags */}
        {vacancy.tags.length > 0 && (
          <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Tag className="w-5 h-5 text-blue-400" />
              Теги
            </h3>
            <div className="flex flex-wrap gap-2">
              {vacancy.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 bg-white/10 rounded-full text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Candidate Modal */}
      {showAddCandidate && (
        <AddCandidateModal
          vacancyId={vacancy.id}
          onClose={() => setShowAddCandidate(false)}
        />
      )}
    </div>
  );
}
