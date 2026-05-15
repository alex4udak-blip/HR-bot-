import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, X, MapPin,
  DollarSign, Users, ChevronRight, Loader2,
  AlertCircle, Sparkles, Send
} from 'lucide-react';
import clsx from 'clsx';
import { getRecommendedVacancies, autoApplyToVacancy } from '@/services/api';
import type { VacancyRecommendation } from '@/types';
import { formatSalary as formatSalaryUtil } from '@/utils';
import { ListSkeleton, EmptyRecommendations, EmptyError } from '@/components/ui';

interface RecommendedVacanciesProps {
  entityId: number;
  entityName?: string;
  onApply?: (vacancyId: number) => void;
}

// Match score colors based on percentage
const getScoreColor = (score: number): string => {
  if (score >= 80) return 'text-[var(--hf-status-green)] bg-[var(--hf-status-green-badge)] border-[color:var(--hf-status-green-badge)]';
  if (score >= 60) return 'text-[var(--hf-status-yellow)] bg-[var(--hf-status-yellow-badge)] border-[color:var(--hf-status-yellow-badge)]';
  if (score >= 40) return 'text-[var(--hf-status-orange)] bg-[var(--hf-status-orange-badge)] border-[color:var(--hf-status-orange-badge)]';
  return 'text-[var(--hf-status-red)] bg-[var(--hf-status-red-badge)] border-[color:var(--hf-status-red-badge)]';
};

// Match score label
const getScoreLabel = (score: number): string => {
  if (score >= 80) return 'Отличное совпадение';
  if (score >= 60) return 'Хорошее совпадение';
  if (score >= 40) return 'Среднее совпадение';
  return 'Низкое совпадение';
};

export default function RecommendedVacancies({ entityId, onApply }: RecommendedVacanciesProps) {
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState<VacancyRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyingTo, setApplyingTo] = useState<number | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRecommendedVacancies(entityId, 10);
      setRecommendations(data);
    } catch (err) {
      console.error('Failed to load recommendations:', err);
      setError('Не удалось загрузить рекомендации');
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  const handleApply = async (vacancyId: number) => {
    if (applyingTo || appliedIds.has(vacancyId)) return;

    setApplyingTo(vacancyId);
    try {
      await autoApplyToVacancy(entityId, vacancyId);
      setAppliedIds(prev => new Set([...prev, vacancyId]));
      onApply?.(vacancyId);
    } catch (err) {
      console.error('Failed to apply:', err);
    } finally {
      setApplyingTo(null);
    }
  };

  const handleNavigateToVacancy = (vacancyId: number) => {
    navigate(`/vacancies/${vacancyId}`);
  };

  const toggleExpanded = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[color:var(--hf-white-alpha-60)] mb-4">
          <Sparkles size={18} className="text-[var(--hf-status-purple)]" />
          <span className="text-sm font-medium">Подбираем подходящие вакансии...</span>
        </div>
        <ListSkeleton count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyError
        message={error}
        onRetry={loadRecommendations}
      />
    );
  }

  if (recommendations.length === 0) {
    return <EmptyRecommendations entityType="candidate" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[color:var(--hf-white-alpha-60)] mb-2">
        <Sparkles size={16} className="text-[var(--hf-status-purple)]" />
        <span className="text-sm">
          Найдено {recommendations.length} подходящих вакансий
        </span>
      </div>

      <AnimatePresence>
        {recommendations.map((rec, index) => (
          <motion.div
            key={rec.vacancy_id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: index * 0.05 }}
            className={clsx(
              'glass-light rounded-xl border transition-all duration-200',
              expandedId === rec.vacancy_id
                ? 'border-[color:var(--hf-status-purple-badge)] bg-[var(--hf-white-alpha-08)]'
                : 'border-[color:var(--hf-white-alpha-10)] hover:border-[color:var(--hf-white-alpha-20)]'
            )}
          >
            {/* Main card content */}
            <div
              onClick={() => toggleExpanded(rec.vacancy_id)}
              className="p-4 cursor-pointer"
            >
              <div className="flex items-start gap-3">
                {/* Score indicator */}
                <div
                  className={clsx(
                    'flex-shrink-0 w-14 h-14 rounded-lg border flex flex-col items-center justify-center',
                    getScoreColor(rec.match_score)
                  )}
                >
                  <span className="text-lg font-bold">{rec.match_score}</span>
                  <span className="text-[10px] opacity-70">%</span>
                </div>

                {/* Vacancy info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-medium text-[var(--hf-white)] truncate">
                        {rec.vacancy_title}
                      </h4>
                      <p className="text-xs text-[color:var(--hf-white-alpha-40)] mt-0.5">
                        {getScoreLabel(rec.match_score)}
                      </p>
                    </div>

                    <ChevronRight
                      size={18}
                      className={clsx(
                        'flex-shrink-0 text-[color:var(--hf-white-alpha-40)] transition-transform duration-200',
                        expandedId === rec.vacancy_id && 'rotate-90'
                      )}
                    />
                  </div>

                  {/* Quick info */}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {rec.salary_min || rec.salary_max ? (
                      <span className="flex items-center gap-1 text-xs text-[color:var(--hf-white-alpha-60)]">
                        <DollarSign size={12} />
                        {formatSalaryUtil(rec.salary_min, rec.salary_max, rec.salary_currency)}
                      </span>
                    ) : null}

                    {rec.location && (
                      <span className="flex items-center gap-1 text-xs text-[color:var(--hf-white-alpha-60)]">
                        <MapPin size={12} />
                        {rec.location}
                      </span>
                    )}

                    <span className="flex items-center gap-1 text-xs text-[color:var(--hf-white-alpha-40)]">
                      <Users size={12} />
                      {rec.applications_count} откликов
                    </span>
                  </div>

                  {/* Compatibility indicators */}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {rec.salary_compatible ? (
                      <span className="flex items-center gap-1 text-xs text-[color:var(--hf-status-green)] bg-[var(--hf-status-green-bg)] px-2 py-0.5 rounded-full">
                        <Check size={12} />
                        Зарплата
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-[color:var(--hf-status-red)] bg-[var(--hf-status-red-bg)] px-2 py-0.5 rounded-full">
                        <X size={12} />
                        Зарплата
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Expanded details */}
            <AnimatePresence>
              {expandedId === rec.vacancy_id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-2 border-t border-[color:var(--hf-white-alpha-10)] space-y-3">
                    {/* Match reasons */}
                    {rec.match_reasons.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-[var(--hf-status-green)] mb-1 flex items-center gap-1">
                          <Check size={12} />
                          Почему подходит:
                        </p>
                        <ul className="space-y-1">
                          {rec.match_reasons.map((reason, i) => (
                            <li key={i} className="text-xs text-[color:var(--hf-white-alpha-70)] pl-4">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Missing requirements */}
                    {rec.missing_requirements.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-[var(--hf-status-yellow)] mb-1 flex items-center gap-1">
                          <AlertCircle size={12} />
                          Чего не хватает:
                        </p>
                        <ul className="space-y-1">
                          {rec.missing_requirements.map((req, i) => (
                            <li key={i} className="text-xs text-[color:var(--hf-white-alpha-70)] pl-4">
                              {req}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Additional info */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {rec.employment_type && (
                        <span className="px-2 py-1 glass-light rounded text-[color:var(--hf-white-alpha-60)]">
                          {rec.employment_type}
                        </span>
                      )}
                      {rec.experience_level && (
                        <span className="px-2 py-1 glass-light rounded text-[color:var(--hf-white-alpha-60)]">
                          {rec.experience_level}
                        </span>
                      )}
                      {rec.department_name && (
                        <span className="px-2 py-1 glass-light rounded text-[color:var(--hf-white-alpha-60)]">
                          {rec.department_name}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApply(rec.vacancy_id);
                        }}
                        disabled={applyingTo === rec.vacancy_id || appliedIds.has(rec.vacancy_id)}
                        className={clsx(
                          'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          appliedIds.has(rec.vacancy_id)
                            ? 'bg-[var(--hf-status-green-badge)] text-[var(--hf-status-green)] cursor-default'
                            : 'bg-[var(--hf-status-purple-badge)] hover:bg-[var(--hf-status-purple-bg)] text-[var(--hf-status-purple)]'
                        )}
                      >
                        {applyingTo === rec.vacancy_id ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Отправляем...</span>
                          </>
                        ) : appliedIds.has(rec.vacancy_id) ? (
                          <>
                            <Check size={16} />
                            <span>Заявка отправлена</span>
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            <span>Предложить вакансию</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigateToVacancy(rec.vacancy_id);
                        }}
                        className="px-4 py-2 glass-light hover:bg-[var(--hf-white-alpha-10)] rounded-lg text-sm text-[color:var(--hf-white-alpha-70)] hover:text-[var(--hf-white)] transition-colors"
                      >
                        Открыть
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
