import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Target,
  Briefcase,
  MapPin,
  DollarSign,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  GitCompare
} from 'lucide-react';
import clsx from 'clsx';
import { getSimilarCandidates, compareCandidates } from '@/services/api';
import { ListSkeleton, EmptyState } from '@/components/ui';

interface SimilarCandidate {
  entity_id: number;
  entity_name: string;
  similarity_score: number;
  common_skills: string[];
  similar_experience: boolean;
  similar_salary: boolean;
  similar_location: boolean;
  match_reasons: string[];
}

interface SimilarCandidatesProps {
  entityId: number;
  entityName: string;
}

export default function SimilarCandidates({ entityId, entityName }: SimilarCandidatesProps) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<SimilarCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparingId, setComparingId] = useState<number | null>(null);
  const [comparisonResult, setComparisonResult] = useState<SimilarCandidate | null>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);

  const loadSimilarCandidates = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSimilarCandidates(entityId, 10);
      setCandidates(data);
    } catch (err) {
      console.error('Failed to load similar candidates:', err);
      setError('Не удалось загрузить похожих кандидатов');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSimilarCandidates();
  }, [entityId]);

  const handleCompare = async (otherEntityId: number, otherEntityName: string) => {
    setComparingId(otherEntityId);
    try {
      const result = await compareCandidates(entityId, otherEntityId);
      setComparisonResult({ ...result, entity_name: otherEntityName });
      setShowCompareModal(true);
    } catch (err) {
      console.error('Failed to compare candidates:', err);
    } finally {
      setComparingId(null);
    }
  };

  const handleNavigateToCandidate = (candidateId: number) => {
    navigate(`/contacts/${candidateId}`);
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return 'bg-green-500/20';
    if (score >= 40) return 'bg-yellow-500/20';
    return 'bg-orange-500/20';
  };

  if (loading) {
    return <ListSkeleton count={3} />;
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Ошибка загрузки"
        description={error}
        size="sm"
        actions={[{
          label: 'Повторить',
          onClick: loadSimilarCandidates,
        }]}
      />
    );
  }

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Похожие кандидаты не найдены"
        description="Заполните навыки, опыт и зарплатные ожидания для поиска похожих кандидатов"
        size="sm"
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
            <Users size={16} />
            Похожие кандидаты ({candidates.length})
          </h3>
          <button
            onClick={loadSimilarCandidates}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title="Обновить"
          >
            <RefreshCw size={14} className="text-white/40" />
          </button>
        </div>

        {candidates.map((candidate, index) => (
          <motion.div
            key={candidate.entity_id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              {/* Candidate Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <button
                    onClick={() => handleNavigateToCandidate(candidate.entity_id)}
                    className="font-medium text-white hover:text-blue-400 transition-colors truncate text-left"
                  >
                    {candidate.entity_name}
                  </button>
                  <ChevronRight
                    size={14}
                    className="text-white/40 flex-shrink-0"
                  />
                </div>

                {/* Match indicators */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {candidate.similar_experience && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">
                      <Briefcase size={10} />
                      Опыт
                    </span>
                  )}
                  {candidate.similar_salary && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full">
                      <DollarSign size={10} />
                      Зарплата
                    </span>
                  )}
                  {candidate.similar_location && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">
                      <MapPin size={10} />
                      Локация
                    </span>
                  )}
                </div>

                {/* Common skills */}
                {candidate.common_skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.common_skills.slice(0, 5).map((skill, i) => (
                      <span
                        key={i}
                        className="text-xs px-2 py-0.5 bg-white/5 text-white/60 rounded"
                      >
                        {skill}
                      </span>
                    ))}
                    {candidate.common_skills.length > 5 && (
                      <span className="text-xs px-2 py-0.5 bg-white/5 text-white/40 rounded">
                        +{candidate.common_skills.length - 5}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Score and actions */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <div className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                  getScoreBgColor(candidate.similarity_score)
                )}>
                  <Target size={14} className={getScoreColor(candidate.similarity_score)} />
                  <span className={clsx('font-bold text-sm', getScoreColor(candidate.similarity_score))}>
                    {candidate.similarity_score}%
                  </span>
                </div>

                <button
                  onClick={() => handleCompare(candidate.entity_id, candidate.entity_name)}
                  disabled={comparingId === candidate.entity_id}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
                    comparingId === candidate.entity_id
                      ? 'bg-white/5 text-white/30 cursor-wait'
                      : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                  )}
                >
                  {comparingId === candidate.entity_id ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <GitCompare size={12} />
                  )}
                  Сравнить
                </button>
              </div>
            </div>

            {/* Match reasons */}
            {candidate.match_reasons.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="text-xs text-white/40">
                  {candidate.match_reasons.map((reason, i) => (
                    <div key={i} className="flex items-center gap-1.5 mb-1">
                      <CheckCircle2 size={10} className="text-green-400" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Comparison Modal */}
      <AnimatePresence>
        {showCompareModal && comparisonResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
            onClick={() => setShowCompareModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-gray-900 rounded-2xl border border-white/10 overflow-hidden"
            >
              <div className="p-6 border-b border-white/10">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <GitCompare size={20} className="text-blue-400" />
                  Сравнение кандидатов
                </h3>
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="text-center flex-1">
                    <p className="text-sm text-white/60 mb-1">Текущий</p>
                    <p className="font-medium text-white truncate">{entityName}</p>
                  </div>
                  <div className={clsx(
                    'px-4 py-2 rounded-full mx-4 flex-shrink-0',
                    getScoreBgColor(comparisonResult.similarity_score)
                  )}>
                    <span className={clsx('font-bold text-lg', getScoreColor(comparisonResult.similarity_score))}>
                      {comparisonResult.similarity_score}%
                    </span>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-sm text-white/60 mb-1">Сравниваемый</p>
                    <p className="font-medium text-white truncate">{comparisonResult.entity_name}</p>
                  </div>
                </div>

                {/* Match indicators - improved layout */}
                <div className="grid grid-cols-3 gap-2 mb-6">
                  <div className={clsx(
                    'p-3 rounded-lg text-center cursor-default',
                    comparisonResult.similar_experience ? 'bg-green-500/20 ring-1 ring-green-500/30' : 'bg-white/5'
                  )}>
                    <Briefcase size={18} className={comparisonResult.similar_experience ? 'text-green-400 mx-auto mb-1' : 'text-white/30 mx-auto mb-1'} />
                    <p className={clsx('text-xs font-medium', comparisonResult.similar_experience ? 'text-green-400' : 'text-white/30')}>
                      Опыт
                    </p>
                    <p className={clsx('text-[10px] mt-0.5', comparisonResult.similar_experience ? 'text-green-400/70' : 'text-white/20')}>
                      {comparisonResult.similar_experience ? 'Совпадает' : 'Не совпадает'}
                    </p>
                  </div>
                  <div className={clsx(
                    'p-3 rounded-lg text-center cursor-default',
                    comparisonResult.similar_salary ? 'bg-green-500/20 ring-1 ring-green-500/30' : 'bg-white/5'
                  )}>
                    <DollarSign size={18} className={comparisonResult.similar_salary ? 'text-green-400 mx-auto mb-1' : 'text-white/30 mx-auto mb-1'} />
                    <p className={clsx('text-xs font-medium', comparisonResult.similar_salary ? 'text-green-400' : 'text-white/30')}>
                      Зарплата
                    </p>
                    <p className={clsx('text-[10px] mt-0.5', comparisonResult.similar_salary ? 'text-green-400/70' : 'text-white/20')}>
                      {comparisonResult.similar_salary ? 'Пересекается' : 'Не пересекается'}
                    </p>
                  </div>
                  <div className={clsx(
                    'p-3 rounded-lg text-center cursor-default',
                    comparisonResult.similar_location ? 'bg-green-500/20 ring-1 ring-green-500/30' : 'bg-white/5'
                  )}>
                    <MapPin size={18} className={comparisonResult.similar_location ? 'text-green-400 mx-auto mb-1' : 'text-white/30 mx-auto mb-1'} />
                    <p className={clsx('text-xs font-medium', comparisonResult.similar_location ? 'text-green-400' : 'text-white/30')}>
                      Локация
                    </p>
                    <p className={clsx('text-[10px] mt-0.5', comparisonResult.similar_location ? 'text-green-400/70' : 'text-white/20')}>
                      {comparisonResult.similar_location ? 'Совпадает' : 'Не совпадает'}
                    </p>
                  </div>
                </div>

                {/* Common skills */}
                {comparisonResult.common_skills.length > 0 && (
                  <div className="mb-6">
                    <p className="text-sm text-white/60 mb-2">Общие навыки ({comparisonResult.common_skills.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {comparisonResult.common_skills.map((skill, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Match reasons */}
                {comparisonResult.match_reasons.length > 0 && (
                  <div>
                    <p className="text-sm text-white/60 mb-2">Причины совпадения</p>
                    <div className="space-y-2">
                      {comparisonResult.match_reasons.map((reason, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-white/80">
                          <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                          {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No matches message */}
                {comparisonResult.match_reasons.length === 0 && comparisonResult.common_skills.length === 0 && (
                  <div className="text-center py-4 text-white/40 text-sm">
                    <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                    <p>Общих характеристик не найдено</p>
                    <p className="text-xs mt-1">Кандидаты имеют разные навыки, опыт или локацию</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-white/10 flex justify-between">
                <button
                  onClick={() => handleNavigateToCandidate(comparisonResult.entity_id)}
                  className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
                >
                  Открыть профиль
                </button>
                <button
                  onClick={() => setShowCompareModal(false)}
                  className="px-4 py-2 bg-white/10 text-white/80 rounded-lg hover:bg-white/20 transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
