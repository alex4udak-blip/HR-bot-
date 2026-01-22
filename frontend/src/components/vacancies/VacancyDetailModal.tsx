import { motion } from 'framer-motion';
import {
  X,
  MapPin,
  DollarSign,
  Clock,
  Building2,
  User,
  Calendar,
  Users,
  Edit,
  Tag,
  FileText,
  CheckCircle,
  XCircle,
  TrendingUp,
  ExternalLink
} from 'lucide-react';
import type { Vacancy } from '@/types';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  APPLICATION_STAGE_LABELS,
  VACANCY_STATUS_LABELS,
  VACANCY_STATUS_COLORS
} from '@/types';
import { formatSalary, formatDate } from '@/utils';

interface VacancyDetailModalProps {
  vacancy: Vacancy;
  onClose: () => void;
  onEdit: () => void;
}

export default function VacancyDetailModal({ vacancy, onClose, onEdit }: VacancyDetailModalProps) {

  // Calculate stats
  const totalCandidates = vacancy.applications_count || 0;
  const hiredCount = vacancy.stage_counts?.hired || 0;
  const rejectedCount = vacancy.stage_counts?.rejected || 0;
  const inProgressCount = totalCandidates - hiredCount - rejectedCount - (vacancy.stage_counts?.withdrawn || 0);

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
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-white/10">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-1 rounded ${VACANCY_STATUS_COLORS[vacancy.status]}`}>
                {VACANCY_STATUS_LABELS[vacancy.status]}
              </span>
              {vacancy.priority && vacancy.priority > 1 && (
                <span className="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                  Приоритет: {vacancy.priority}
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold">{vacancy.title}</h2>
            {vacancy.department_name && (
              <p className="text-sm text-white/50 mt-1 flex items-center gap-1.5">
                <Building2 className="w-4 h-4" />
                {vacancy.department_name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onEdit}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              title="Редактировать"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-1.5 text-white/60 mb-1">
                <Users className="w-4 h-4" />
                <span className="text-xs">Всего</span>
              </div>
              <p className="text-xl font-bold">{totalCandidates}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-1.5 text-blue-400 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs">В процессе</span>
              </div>
              <p className="text-xl font-bold">{inProgressCount}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-1.5 text-green-400 mb-1">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs">Наняты</span>
              </div>
              <p className="text-xl font-bold">{hiredCount}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-1.5 text-red-400 mb-1">
                <XCircle className="w-4 h-4" />
                <span className="text-xs">Отклонены</span>
              </div>
              <p className="text-xl font-bold">{rejectedCount}</p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(vacancy.salary_min || vacancy.salary_max) && (
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-1.5 text-green-400 mb-1">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-xs">Зарплата</span>
                </div>
                <p className="font-medium text-sm">
                  {formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency)}
                </p>
              </div>
            )}
            {vacancy.location && (
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-1.5 text-white/60 mb-1">
                  <MapPin className="w-4 h-4" />
                  <span className="text-xs">Локация</span>
                </div>
                <p className="font-medium text-sm">{vacancy.location}</p>
              </div>
            )}
            {vacancy.employment_type && (
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-1.5 text-white/60 mb-1">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs">Занятость</span>
                </div>
                <p className="font-medium text-sm">
                  {EMPLOYMENT_TYPES.find(t => t.value === vacancy.employment_type)?.label || vacancy.employment_type}
                </p>
              </div>
            )}
            {vacancy.experience_level && (
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-1.5 text-white/60 mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs">Уровень</span>
                </div>
                <p className="font-medium text-sm">
                  {EXPERIENCE_LEVELS.find(l => l.value === vacancy.experience_level)?.label || vacancy.experience_level}
                </p>
              </div>
            )}
            {vacancy.hiring_manager_name && (
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-1.5 text-white/60 mb-1">
                  <User className="w-4 h-4" />
                  <span className="text-xs">Ответственный</span>
                </div>
                <p className="font-medium text-sm">{vacancy.hiring_manager_name}</p>
              </div>
            )}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-1.5 text-white/60 mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-xs">Создана</span>
              </div>
              <p className="font-medium text-sm">{formatDate(vacancy.created_at, 'medium') || 'Не указана'}</p>
            </div>
          </div>

          {/* Pipeline progress */}
          {Object.entries(vacancy.stage_counts || {}).length > 0 && (
            <div className="p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" />
                Воронка найма
              </h3>
              <div className="space-y-2">
                {Object.entries(vacancy.stage_counts).map(([stage, count]) => {
                  const percentage = totalCandidates > 0 ? Math.round((count / totalCandidates) * 100) : 0;
                  return (
                    <div key={stage} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>{APPLICATION_STAGE_LABELS[stage as keyof typeof APPLICATION_STAGE_LABELS] || stage}</span>
                        <span className="text-white/60">{count} ({percentage}%)</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          className="h-full bg-cyan-500 rounded-full"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Description */}
          {vacancy.description && (
            <div className="p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                Описание
              </h3>
              <p className="text-sm text-white/80 whitespace-pre-wrap">{vacancy.description}</p>
            </div>
          )}

          {/* Requirements */}
          {vacancy.requirements && (
            <div className="p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-2">Требования</h3>
              <p className="text-sm text-white/80 whitespace-pre-wrap">{vacancy.requirements}</p>
            </div>
          )}

          {/* Responsibilities */}
          {vacancy.responsibilities && (
            <div className="p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-2">Обязанности</h3>
              <p className="text-sm text-white/80 whitespace-pre-wrap">{vacancy.responsibilities}</p>
            </div>
          )}

          {/* Tags */}
          {vacancy.tags && vacancy.tags.length > 0 && (
            <div className="p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-2 flex items-center gap-1.5">
                <Tag className="w-4 h-4" />
                Навыки и технологии
              </h3>
              <div className="flex flex-wrap gap-2">
                {vacancy.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source URL */}
          {vacancy.source_url && (
            <div className="p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-2">Источник</h3>
              <a
                href={vacancy.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm truncate"
              >
                <ExternalLink className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{vacancy.source_url}</span>
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
          >
            Закрыть
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            <Edit className="w-4 h-4" />
            Редактировать
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
