import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Check, Mail, Phone,
  ChevronRight, Loader2, AlertCircle,
  UserPlus, Send, Filter, RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import { getMatchingCandidates, inviteCandidateToVacancy, notifyMatchingCandidates } from '@/services/api';
import type { CandidateMatch, ApplicationStage } from '@/types';
import { formatSalary as formatSalaryUtil } from '@/utils';
import { STATUS_LABELS, STATUS_COLORS, APPLICATION_STAGE_LABELS } from '@/types';
import { ListSkeleton, EmptyState } from '@/components/ui';

interface NewVacancyMatcherProps {
  vacancyId: number;
  vacancyTitle?: string;
  onInvite?: (entityId: number, stage: ApplicationStage) => void;
}

// Match score colors based on percentage
const getScoreColor = (score: number): string => {
  if (score >= 80) return 'text-green-400 bg-green-500/20 border-green-500/30';
  if (score >= 60) return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
  if (score >= 40) return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
  return 'text-red-400 bg-red-500/20 border-red-500/30';
};

// Available stages to invite to
const INVITE_STAGES: { value: ApplicationStage; label: string }[] = [
  { value: 'screening', label: 'Скрининг' },
  { value: 'phone_screen', label: 'Телефонное интервью' },
  { value: 'interview', label: 'Собеседование' },
];

export default function NewVacancyMatcher({ vacancyId, onInvite }: NewVacancyMatcherProps) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<CandidateMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedStage, setSelectedStage] = useState<ApplicationStage>('screening');
  const [minScore, setMinScore] = useState<number>(30);
  const [showFilters, setShowFilters] = useState(false);
  const [notifying, setNotifying] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMatchingCandidates(vacancyId, {
        limit: 20,
        minScore: minScore,
        excludeApplied: true
      });
      setCandidates(data);
    } catch (err) {
      console.error('Failed to load matching candidates:', err);
      setError('Не удалось загрузить подходящих кандидатов');
    } finally {
      setLoading(false);
    }
  }, [vacancyId, minScore]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const handleInvite = async (entityId: number) => {
    if (invitingId || invitedIds.has(entityId)) return;

    setInvitingId(entityId);
    try {
      await inviteCandidateToVacancy(vacancyId, entityId, selectedStage);
      setInvitedIds(prev => new Set([...prev, entityId]));
      onInvite?.(entityId, selectedStage);
    } catch (err) {
      console.error('Failed to invite candidate:', err);
    } finally {
      setInvitingId(null);
    }
  };

  const handleNotifyAll = async () => {
    if (notifying) return;

    setNotifying(true);
    try {
      await notifyMatchingCandidates(vacancyId, { minScore: minScore, limit: 50 });
      // Success - notification sent
    } catch {
      // Error handled silently - could add toast notification here
    } finally {
      setNotifying(false);
    }
  };

  const handleNavigateToEntity = (entityId: number) => {
    navigate(`/contacts/${entityId}`);
  };

  const toggleExpanded = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-white/60 mb-4">
          <Users size={18} className="text-blue-400" />
          <span className="text-sm font-medium">Ищем подходящих кандидатов...</span>
        </div>
        <ListSkeleton count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Ошибка загрузки"
        description={error}
        size="sm"
        actions={[{
          label: "Попробовать снова",
          onClick: loadCandidates
        }]}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-white/60">
          <Users size={16} className="text-blue-400" />
          <span className="text-sm">
            {candidates.length > 0
              ? `Найдено ${candidates.length} подходящих кандидатов`
              : 'Кандидаты не найдены'
            }
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors',
              showFilters
                ? 'bg-purple-500/20 text-purple-300'
                : 'bg-white/5 hover:bg-white/10 text-white/60'
            )}
          >
            <Filter size={14} />
            Фильтры
          </button>

          <button
            onClick={loadCandidates}
            disabled={loading}
            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 transition-colors"
            title="Обновить список"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-4">
              {/* Min score slider */}
              <div>
                <label className="text-xs text-white/60 block mb-2">
                  Минимальный балл совпадения: {minScore}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              {/* Default stage selector */}
              <div>
                <label className="text-xs text-white/60 block mb-2">
                  Этап приглашения по умолчанию:
                </label>
                <div className="flex flex-wrap gap-2">
                  {INVITE_STAGES.map((stage) => (
                    <button
                      key={stage.value}
                      onClick={() => setSelectedStage(stage.value)}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-xs transition-colors',
                        selectedStage === stage.value
                          ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                          : 'bg-white/5 text-white/60 hover:bg-white/10'
                      )}
                    >
                      {stage.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notify all button */}
              {candidates.length > 0 && (
                <button
                  onClick={handleNotifyAll}
                  disabled={notifying}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-sm transition-colors"
                >
                  {notifying ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Отправляем уведомления...</span>
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      <span>Уведомить всех подходящих кандидатов</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {candidates.length === 0 && (
        <EmptyState
          icon={Users}
          title="Кандидаты не найдены"
          description="Попробуйте снизить минимальный балл совпадения в фильтрах"
          size="sm"
        />
      )}

      {/* Candidates list */}
      <AnimatePresence>
        {candidates.map((candidate, index) => (
          <motion.div
            key={candidate.entity_id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: index * 0.03 }}
            className={clsx(
              'bg-white/5 rounded-xl border transition-all duration-200',
              expandedId === candidate.entity_id
                ? 'border-blue-500/50 bg-white/8'
                : 'border-white/10 hover:border-white/20'
            )}
          >
            {/* Main card content */}
            <div
              onClick={() => toggleExpanded(candidate.entity_id)}
              className="p-4 cursor-pointer"
            >
              <div className="flex items-start gap-3">
                {/* Score indicator */}
                <div
                  className={clsx(
                    'flex-shrink-0 w-12 h-12 rounded-lg border flex flex-col items-center justify-center',
                    getScoreColor(candidate.match_score)
                  )}
                >
                  <span className="text-lg font-bold">{candidate.match_score}</span>
                  <span className="text-[9px] opacity-70">%</span>
                </div>

                {/* Candidate info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-medium text-white truncate">
                        {candidate.entity_name}
                      </h4>
                      {candidate.position && (
                        <p className="text-xs text-white/60 truncate">
                          {candidate.position}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {candidate.status && (
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full',
                          STATUS_COLORS[candidate.status as keyof typeof STATUS_COLORS] || 'bg-gray-500/20 text-gray-300'
                        )}>
                          {STATUS_LABELS[candidate.status as keyof typeof STATUS_LABELS] || candidate.status}
                        </span>
                      )}
                      <ChevronRight
                        size={18}
                        className={clsx(
                          'flex-shrink-0 text-white/40 transition-transform duration-200',
                          expandedId === candidate.entity_id && 'rotate-90'
                        )}
                      />
                    </div>
                  </div>

                  {/* Quick info */}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {candidate.email && (
                      <span className="flex items-center gap-1 text-xs text-white/50">
                        <Mail size={12} />
                        {candidate.email}
                      </span>
                    )}
                    {candidate.phone && (
                      <span className="flex items-center gap-1 text-xs text-white/50">
                        <Phone size={12} />
                        {candidate.phone}
                      </span>
                    )}
                  </div>

                  {/* Salary info */}
                  {(candidate.expected_salary_min || candidate.expected_salary_max) && (
                    <div className="mt-2 text-xs text-white/40">
                      Ожидаемая зарплата: {formatSalaryUtil(
                        candidate.expected_salary_min,
                        candidate.expected_salary_max,
                        candidate.expected_salary_currency
                      )}
                    </div>
                  )}

                  {/* Compatibility indicator */}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {candidate.salary_compatible ? (
                      <span className="flex items-center gap-1 text-xs text-green-400/80 bg-green-500/10 px-2 py-0.5 rounded-full">
                        <Check size={12} />
                        Зарплата подходит
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-400/80 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                        <AlertCircle size={12} />
                        Зарплата не совпадает
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Expanded details */}
            <AnimatePresence>
              {expandedId === candidate.entity_id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-2 border-t border-white/10 space-y-3">
                    {/* Match reasons */}
                    {candidate.match_reasons.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-green-400 mb-1 flex items-center gap-1">
                          <Check size={12} />
                          Почему подходит:
                        </p>
                        <ul className="space-y-1">
                          {candidate.match_reasons.map((reason, i) => (
                            <li key={i} className="text-xs text-white/70 pl-4">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Missing skills */}
                    {candidate.missing_skills.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-yellow-400 mb-1 flex items-center gap-1">
                          <AlertCircle size={12} />
                          Недостающие навыки:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {candidate.missing_skills.map((skill, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 bg-yellow-500/10 text-yellow-300/80 rounded"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInvite(candidate.entity_id);
                        }}
                        disabled={invitingId === candidate.entity_id || invitedIds.has(candidate.entity_id)}
                        className={clsx(
                          'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          invitedIds.has(candidate.entity_id)
                            ? 'bg-green-500/20 text-green-400 cursor-default'
                            : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'
                        )}
                      >
                        {invitingId === candidate.entity_id ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Приглашаем...</span>
                          </>
                        ) : invitedIds.has(candidate.entity_id) ? (
                          <>
                            <Check size={16} />
                            <span>Приглашён</span>
                          </>
                        ) : (
                          <>
                            <UserPlus size={16} />
                            <span>Пригласить на {APPLICATION_STAGE_LABELS[selectedStage] || selectedStage}</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigateToEntity(candidate.entity_id);
                        }}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 hover:text-white transition-colors"
                      >
                        Профиль
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
