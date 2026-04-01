import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Mail,
  Phone,
  MessageCircle,
  Briefcase,
  Tag,
  Clock,
  Sparkles,
  ChevronRight,
  User,
  Search,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { getEntities, getEntity } from '@/services/api/entities';
import type { Entity, EntityWithRelations, EntityStatus } from '@/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import { formatDate } from '@/utils';

// Stage definitions for the pipeline tabs
const STAGES: { key: EntityStatus; label: string; color: string; border: string }[] = [
  { key: 'new', label: 'Новые', color: '#3b82f6', border: 'border-blue-500' },
  { key: 'screening', label: 'Интервью HR', color: '#8b5cf6', border: 'border-violet-500' },
  { key: 'is_interview', label: 'Интервью с заказчиком', color: '#f59e0b', border: 'border-amber-500' },
  { key: 'practice', label: 'Практика', color: '#10b981', border: 'border-emerald-500' },
  { key: 'hired', label: 'Команда', color: '#22c55e', border: 'border-green-500' },
];

export default function AllCandidatesPage() {
  const [candidates, setCandidates] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState<EntityStatus>('new');
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<EntityWithRelations | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load all candidates
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await getEntities({ type: 'candidate', limit: 500 });
        if (!cancelled) setCandidates(data);
      } catch (err) {
        console.error('Failed to load candidates:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Load selected candidate details
  const handleSelectCandidate = useCallback(async (id: number) => {
    if (id === selectedCandidateId) return;
    setSelectedCandidateId(id);
    setDetailLoading(true);
    try {
      const detail = await getEntity(id);
      setSelectedCandidate(detail);
    } catch (err) {
      console.error('Failed to load candidate details:', err);
      setSelectedCandidate(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedCandidateId]);

  // Stage counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stage of STAGES) {
      counts[stage.key] = candidates.filter(c => c.status === stage.key).length;
    }
    return counts;
  }, [candidates]);

  // Filtered candidates for active stage + search
  const filteredCandidates = useMemo(() => {
    let result = candidates.filter(c => c.status === activeStage);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.position?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [candidates, activeStage, searchQuery]);

  // Reset selection when stage changes
  useEffect(() => {
    setSelectedCandidateId(null);
    setSelectedCandidate(null);
  }, [activeStage]);

  // Extract extra_data fields
  const getExtraField = (entity: EntityWithRelations | null, field: string): string | undefined => {
    if (!entity?.extra_data) return undefined;
    const val = entity.extra_data[field];
    return typeof val === 'string' ? val : undefined;
  };

  return (
    <div className="min-h-screen p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Все кандидаты</h1>
        <p className="text-sm text-white/40">
          Пайплайн кандидатов по этапам отбора
        </p>
      </div>

      {/* Stage tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
        {STAGES.map(stage => {
          const isActive = activeStage === stage.key;
          const count = stageCounts[stage.key] || 0;
          return (
            <button
              key={stage.key}
              onClick={() => setActiveStage(stage.key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap border-l-[3px] flex-shrink-0',
                isActive
                  ? 'bg-white/10 text-white shadow-lg'
                  : 'bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70'
              )}
              style={{
                borderLeftColor: isActive ? stage.color : 'transparent',
              }}
            >
              {stage.label}
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-full text-xs font-semibold',
                  isActive ? 'bg-white/15 text-white' : 'bg-white/5 text-white/40'
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Поиск по имени, позиции..."
          className="w-full pl-10 pr-4 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
        />
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
          <span className="ml-3 text-sm text-white/40">Загрузка кандидатов...</span>
        </div>
      )}

      {/* Candidate cards — horizontal scroll */}
      {!loading && (
        <>
          {filteredCandidates.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-white/10 mx-auto mb-3" />
              <p className="text-sm text-white/30">
                {searchQuery ? 'Не найдено кандидатов по запросу' : 'Нет кандидатов на этом этапе'}
              </p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-4 mb-6 scrollbar-thin">
              {filteredCandidates.map(candidate => {
                const isSelected = selectedCandidateId === candidate.id;
                const stageConfig = STAGES.find(s => s.key === activeStage);
                return (
                  <motion.div
                    key={candidate.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => handleSelectCandidate(candidate.id)}
                    className={clsx(
                      'flex-shrink-0 w-40 p-3 rounded-xl cursor-pointer transition-all duration-200 border',
                      isSelected
                        ? `bg-white/10 ${stageConfig?.border || 'border-blue-500'} border-opacity-60 shadow-lg`
                        : 'bg-white/[0.04] border-white/5 hover:bg-white/[0.07] hover:border-white/10'
                    )}
                  >
                    {/* Avatar */}
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold mb-2 mx-auto"
                      style={{
                        backgroundColor: `${stageConfig?.color || '#3b82f6'}20`,
                        color: stageConfig?.color || '#3b82f6',
                      }}
                    >
                      {candidate.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    {/* Name */}
                    <p className="text-sm font-medium text-white text-center truncate" title={candidate.name}>
                      {candidate.name}
                    </p>
                    {/* Position */}
                    <p className="text-xs text-white/40 text-center truncate mt-0.5" title={candidate.position || 'Не указана'}>
                      {candidate.position || 'Не указана'}
                    </p>
                    {/* Vacancy names if any */}
                    {candidate.vacancy_names && candidate.vacancy_names.length > 0 && (
                      <p className="text-[10px] text-white/25 text-center truncate mt-1" title={candidate.vacancy_names.join(', ')}>
                        {candidate.vacancy_names[0]}
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Selected candidate profile panel */}
          <AnimatePresence mode="wait">
            {selectedCandidateId && (
              <motion.div
                key={selectedCandidateId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="bg-white/[0.04] border border-white/10 rounded-2xl p-6"
              >
                {detailLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
                    <span className="ml-3 text-sm text-white/40">Загрузка профиля...</span>
                  </div>
                ) : selectedCandidate ? (
                  <div className="space-y-6">
                    {/* Top: Name + Status */}
                    <div className="flex items-start justify-between flex-wrap gap-4">
                      <div className="flex items-center gap-4">
                        <div
                          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
                          style={{
                            backgroundColor: `${STAGES.find(s => s.key === selectedCandidate.status)?.color || '#3b82f6'}20`,
                            color: STAGES.find(s => s.key === selectedCandidate.status)?.color || '#3b82f6',
                          }}
                        >
                          {selectedCandidate.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-white">{selectedCandidate.name}</h2>
                          {selectedCandidate.position && (
                            <p className="text-sm text-white/50 flex items-center gap-1.5 mt-0.5">
                              <Briefcase className="w-3.5 h-3.5" />
                              {selectedCandidate.position}
                            </p>
                          )}
                          {selectedCandidate.company && (
                            <p className="text-xs text-white/30 mt-0.5">{selectedCandidate.company}</p>
                          )}
                        </div>
                      </div>
                      <span className={clsx(
                        'px-3 py-1 rounded-full text-xs font-medium border',
                        STATUS_COLORS[selectedCandidate.status] || 'bg-gray-500/20 text-gray-300'
                      )}>
                        {STATUS_LABELS[selectedCandidate.status] || selectedCandidate.status}
                      </span>
                    </div>

                    {/* Contact info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {selectedCandidate.email && (
                        <div className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-lg px-3 py-2">
                          <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          <span className="truncate">{selectedCandidate.email}</span>
                        </div>
                      )}
                      {selectedCandidate.emails && selectedCandidate.emails.length > 0 && !selectedCandidate.email && (
                        <div className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-lg px-3 py-2">
                          <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          <span className="truncate">{selectedCandidate.emails[0]}</span>
                        </div>
                      )}
                      {selectedCandidate.phone && (
                        <div className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-lg px-3 py-2">
                          <Phone className="w-4 h-4 text-green-400 flex-shrink-0" />
                          <span>{selectedCandidate.phone}</span>
                        </div>
                      )}
                      {selectedCandidate.phones && selectedCandidate.phones.length > 0 && !selectedCandidate.phone && (
                        <div className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-lg px-3 py-2">
                          <Phone className="w-4 h-4 text-green-400 flex-shrink-0" />
                          <span>{selectedCandidate.phones[0]}</span>
                        </div>
                      )}
                      {selectedCandidate.telegram_usernames && selectedCandidate.telegram_usernames.length > 0 && (
                        <div className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-lg px-3 py-2">
                          <MessageCircle className="w-4 h-4 text-sky-400 flex-shrink-0" />
                          <span>@{selectedCandidate.telegram_usernames[0]}</span>
                        </div>
                      )}
                      {selectedCandidate.department_name && (
                        <div className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-lg px-3 py-2">
                          <User className="w-4 h-4 text-purple-400 flex-shrink-0" />
                          <span className="truncate">{selectedCandidate.department_name}</span>
                        </div>
                      )}
                    </div>

                    {/* Salary */}
                    {(selectedCandidate.expected_salary_min || selectedCandidate.expected_salary_max) && (
                      <div className="bg-white/[0.03] rounded-lg px-4 py-3">
                        <p className="text-xs text-white/30 mb-1">Ожидаемая зарплата</p>
                        <p className="text-sm text-white/70 font-medium">
                          {selectedCandidate.expected_salary_min && selectedCandidate.expected_salary_max
                            ? `${selectedCandidate.expected_salary_min.toLocaleString()} - ${selectedCandidate.expected_salary_max.toLocaleString()} ${selectedCandidate.expected_salary_currency || 'RUB'}`
                            : selectedCandidate.expected_salary_min
                              ? `от ${selectedCandidate.expected_salary_min.toLocaleString()} ${selectedCandidate.expected_salary_currency || 'RUB'}`
                              : `до ${selectedCandidate.expected_salary_max?.toLocaleString()} ${selectedCandidate.expected_salary_currency || 'RUB'}`
                          }
                        </p>
                      </div>
                    )}

                    {/* AI Summary */}
                    {getExtraField(selectedCandidate, 'ai_summary') && (
                      <div className="bg-gradient-to-r from-violet-500/10 to-blue-500/10 border border-violet-500/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-violet-400" />
                          <h3 className="text-sm font-semibold text-violet-300">AI-резюме</h3>
                        </div>
                        <p className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap">
                          {getExtraField(selectedCandidate, 'ai_summary')}
                        </p>
                      </div>
                    )}

                    {/* Vacancy links */}
                    {selectedCandidate.vacancy_names && selectedCandidate.vacancy_names.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-2">
                          <Briefcase className="w-4 h-4" />
                          Вакансии
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {selectedCandidate.vacancy_names.map((vName, i) => (
                            <span
                              key={i}
                              className="px-3 py-1 bg-blue-500/10 text-blue-300 text-xs rounded-full border border-blue-500/20"
                            >
                              {vName}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {selectedCandidate.tags && selectedCandidate.tags.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-2">
                          <Tag className="w-4 h-4" />
                          Теги
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCandidate.tags.map((tag, i) => (
                            <span
                              key={i}
                              className="px-2.5 py-0.5 bg-white/5 text-white/50 text-xs rounded-full border border-white/10"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key events / Analyses */}
                    {selectedCandidate.analyses && selectedCandidate.analyses.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Анализы
                        </h3>
                        <div className="space-y-2">
                          {selectedCandidate.analyses.slice(0, 5).map(analysis => (
                            <div
                              key={analysis.id}
                              className="flex items-start gap-3 bg-white/[0.03] rounded-lg p-3"
                            >
                              <ChevronRight className="w-4 h-4 text-white/20 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                {analysis.report_type && (
                                  <p className="text-xs text-white/40 mb-0.5">{analysis.report_type}</p>
                                )}
                                {analysis.result && (
                                  <p className="text-sm text-white/60 line-clamp-2">{analysis.result}</p>
                                )}
                                <p className="text-[10px] text-white/20 mt-1">{formatDate(analysis.created_at)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Linked chats */}
                    {selectedCandidate.chats && selectedCandidate.chats.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-2">
                          <MessageCircle className="w-4 h-4" />
                          Связанные чаты ({selectedCandidate.chats.length})
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {selectedCandidate.chats.slice(0, 5).map(chat => (
                            <span
                              key={chat.id}
                              className="px-3 py-1 bg-white/5 text-white/40 text-xs rounded-lg border border-white/5"
                            >
                              {chat.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Meta info */}
                    <div className="flex items-center gap-4 pt-2 border-t border-white/5 text-[11px] text-white/20">
                      <span>Создан: {formatDate(selectedCandidate.created_at)}</span>
                      <span>Обновлен: {formatDate(selectedCandidate.updated_at)}</span>
                      {selectedCandidate.owner_name && (
                        <span>Ответственный: {selectedCandidate.owner_name}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-white/30">
                    Не удалось загрузить данные кандидата
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
