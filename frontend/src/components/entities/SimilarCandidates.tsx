import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Target,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  GitCompare,
  Sparkles,
  X,
  Zap,
  Brain
} from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import {
  getSimilarByProfile,
  generateEntityProfile,
  compareCandidatesAI,
  type SimilarByProfileResponse,
  type AIProfile
} from '@/services/api';
import { ListSkeleton, EmptyState } from '@/components/ui';

interface SimilarCandidatesProps {
  entityId: number;
  entityName: string;
}

export default function SimilarCandidates({ entityId, entityName }: SimilarCandidatesProps) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<SimilarByProfileResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI comparison modal state
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [comparingId, setComparingId] = useState<number | null>(null);
  const [comparingName, setComparingName] = useState<string>('');
  const [aiComparison, setAiComparison] = useState<string>('');
  const [aiComparing, setAiComparing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadSimilarCandidates = async (forceGenerate = false) => {
    setLoading(true);
    setError(null);

    try {
      // If force generate, first generate profile then search
      if (forceGenerate) {
        setGenerating(true);
        await generateEntityProfile(entityId);
        setGenerating(false);
      }

      const data = await getSimilarByProfile(entityId, 30, 10);
      setCandidates(data);
    } catch (err: unknown) {
      console.error('Failed to load similar candidates:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // If profile not found, show generate option
      if (errorMessage.includes('404') || errorMessage.includes('not generated')) {
        setError('profile_not_found');
      } else {
        setError('Не удалось загрузить похожих кандидатов');
      }
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  };

  useEffect(() => {
    loadSimilarCandidates();
  }, [entityId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerateProfile = async () => {
    setGenerating(true);
    setError(null);
    try {
      await generateEntityProfile(entityId);
      await loadSimilarCandidates();
    } catch (err) {
      console.error('Failed to generate profile:', err);
      setError('Не удалось сгенерировать профиль');
    } finally {
      setGenerating(false);
    }
  };

  const handleCompare = async (otherEntityId: number, otherEntityName: string) => {
    setComparingId(otherEntityId);
    setComparingName(otherEntityName);
    setAiComparison('');
    setAiComparing(true);
    setShowCompareModal(true);

    // Cancel any previous request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    try {
      // Start AI comparison streaming
      await compareCandidatesAI(entityId, otherEntityId, (chunk) => {
        setAiComparison(prev => prev + chunk);
      });
    } catch (err) {
      console.error('Failed to compare candidates:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        setAiComparison(prev => prev + '\n\n❌ Ошибка при сравнении');
      }
    } finally {
      setComparingId(null);
      setAiComparing(false);
    }
  };

  const handleCloseModal = useCallback(() => {
    abortControllerRef.current?.abort();
    setShowCompareModal(false);
    setAiComparison('');
    setAiComparing(false);
  }, []);

  const handleNavigateToCandidate = (candidateId: number) => {
    navigate(`/contacts/${candidateId}`);
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return 'bg-green-500/20';
    if (score >= 50) return 'bg-yellow-500/20';
    return 'bg-orange-500/20';
  };

  const getLevelLabel = (level: string | null) => {
    const labels: Record<string, string> = {
      junior: 'Junior',
      middle: 'Middle',
      senior: 'Senior',
      lead: 'Lead',
      unknown: ''
    };
    return labels[level || 'unknown'] || '';
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-white/40" />
          <span className="text-sm text-white/60">Поиск похожих...</span>
          {generating && (
            <span className="flex items-center gap-1 text-xs text-purple-400">
              <Brain size={12} className="animate-pulse" />
              Генерация профиля...
            </span>
          )}
        </div>
        <ListSkeleton count={3} />
      </div>
    );
  }

  // Special case: profile not generated yet
  if (error === 'profile_not_found') {
    return (
      <div className="p-6 bg-purple-500/10 rounded-xl border border-purple-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Brain size={20} className="text-purple-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">AI-профиль не создан</h3>
            <p className="text-sm text-white/60">Создайте профиль для поиска похожих кандидатов</p>
          </div>
        </div>
        <p className="text-sm text-white/50 mb-4">
          AI проанализирует резюме, переписки и звонки, чтобы найти кандидатов с похожими навыками, опытом и ожиданиями.
        </p>
        <button
          onClick={handleGenerateProfile}
          disabled={generating}
          className={clsx(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors',
            generating
              ? 'bg-purple-500/20 text-purple-300 cursor-wait'
              : 'bg-purple-500 hover:bg-purple-600 text-white'
          )}
        >
          {generating ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              Анализ данных...
            </>
          ) : (
            <>
              <Zap size={16} />
              Создать AI-профиль
            </>
          )}
        </button>
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
          label: 'Повторить',
          onClick: () => loadSimilarCandidates(true),
        }]}
      />
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="text-center py-6">
        <Users size={32} className="mx-auto text-white/20 mb-3" />
        <p className="text-white/60 mb-2">Похожие кандидаты не найдены</p>
        <p className="text-xs text-white/40 mb-4">
          Возможно, профили других кандидатов ещё не созданы
        </p>
        <button
          onClick={() => loadSimilarCandidates(true)}
          className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1 mx-auto"
        >
          <RefreshCw size={14} />
          Обновить профиль и поиск
        </button>
      </div>
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
            onClick={() => loadSimilarCandidates(true)}
            disabled={generating}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title="Обновить профиль и поиск"
          >
            <RefreshCw size={14} className={clsx('text-white/40', generating && 'animate-spin')} />
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
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={() => handleNavigateToCandidate(candidate.entity_id)}
                    className="font-medium text-white hover:text-blue-400 transition-colors truncate text-left"
                  >
                    {candidate.entity_name}
                  </button>
                  <ChevronRight size={14} className="text-white/40 flex-shrink-0" />
                </div>

                {/* Position and level */}
                <div className="flex items-center gap-2 mb-2">
                  {candidate.profile_specialization && (
                    <span className="text-xs text-white/50">
                      {candidate.profile_specialization}
                    </span>
                  )}
                  {candidate.profile_level && candidate.profile_level !== 'unknown' && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                      {getLevelLabel(candidate.profile_level)}
                    </span>
                  )}
                </div>

                {/* Summary */}
                {candidate.profile_summary && (
                  <p className="text-xs text-white/40 line-clamp-2 mb-2">
                    {candidate.profile_summary}
                  </p>
                )}

                {/* Match reasons */}
                {candidate.matches.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {candidate.matches.slice(0, 3).map((match, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded"
                      >
                        <CheckCircle2 size={10} />
                        {match}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Score and actions */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <div className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                  getScoreBgColor(candidate.score)
                )}>
                  <Target size={14} className={getScoreColor(candidate.score)} />
                  <span className={clsx('font-bold text-sm', getScoreColor(candidate.score))}>
                    {candidate.score}%
                  </span>
                </div>

                <button
                  onClick={() => handleCompare(candidate.entity_id, candidate.entity_name)}
                  disabled={comparingId === candidate.entity_id}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
                    comparingId === candidate.entity_id
                      ? 'bg-white/5 text-white/30 cursor-wait'
                      : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                  )}
                >
                  {comparingId === candidate.entity_id ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  AI-анализ
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* AI Comparison Modal */}
      <AnimatePresence>
        {showCompareModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
            onClick={handleCloseModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-gray-900 rounded-2xl border border-white/10 overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="p-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Sparkles size={20} className="text-purple-400" />
                  AI-сравнение кандидатов
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X size={20} className="text-white/60" />
                </button>
              </div>

              {/* Names header */}
              <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0 bg-white/5">
                <div className="text-center flex-1 min-w-0">
                  <p className="text-xs text-white/60 mb-0.5">Текущий</p>
                  <p className="font-medium text-white truncate">{entityName}</p>
                </div>
                <div className="px-3 py-1.5 rounded-full mx-3 flex-shrink-0 bg-purple-500/20">
                  <GitCompare size={16} className="text-purple-400" />
                </div>
                <div className="text-center flex-1 min-w-0">
                  <p className="text-xs text-white/60 mb-0.5">Сравниваемый</p>
                  <p className="font-medium text-white truncate">{comparingName}</p>
                </div>
              </div>

              {/* AI Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {aiComparing && !aiComparison && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <Brain size={32} className="text-purple-400 animate-pulse mx-auto mb-3" />
                      <p className="text-white/60">Анализирую профили, чаты и звонки...</p>
                      <p className="text-xs text-white/40 mt-1">Это может занять несколько секунд</p>
                    </div>
                  </div>
                )}

                {aiComparison && (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      components={{
                        h2: ({ children }) => (
                          <h2 className="text-base font-semibold text-white mt-4 mb-2 flex items-center gap-2">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-sm font-medium text-white/80 mt-3 mb-1">{children}</h3>
                        ),
                        p: ({ children }) => (
                          <p className="text-sm text-white/70 mb-2 leading-relaxed">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="text-sm text-white/70 space-y-1 mb-2 ml-4">{children}</ul>
                        ),
                        li: ({ children }) => (
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400 mt-1">•</span>
                            <span>{children}</span>
                          </li>
                        ),
                        strong: ({ children }) => (
                          <strong className="text-white font-medium">{children}</strong>
                        ),
                      }}
                    >
                      {aiComparison}
                    </ReactMarkdown>
                    {aiComparing && (
                      <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1" />
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/10 flex justify-between flex-shrink-0">
                <button
                  onClick={() => comparingName && handleNavigateToCandidate(
                    candidates.find(c => c.entity_name === comparingName)?.entity_id || 0
                  )}
                  className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
                >
                  Открыть профиль
                </button>
                <button
                  onClick={handleCloseModal}
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
