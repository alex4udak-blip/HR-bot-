import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Upload,
  Clock,
  Users,
  User,
  Filter,
  X,
  ExternalLink
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import type { Entity, EntityStatus } from '@/types';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  ENTITY_PIPELINE_STAGES
} from '@/types';
import type { ParsedResume } from '@/services/api';
import { formatDate } from '@/utils';
import ContactForm from '@/components/contacts/ContactForm';
import ParserModal from '@/components/parser/ParserModal';
import { Skeleton } from '@/components/ui';

interface CandidatesDatabaseProps {
  vacancies: any[];
  onRefreshVacancies: () => void;
}

// Helper to safely access extra_data string fields
const getExtraDataString = (entity: Entity, key: string): string => {
  const val = entity.extra_data?.[key];
  return typeof val === 'string' ? val : '';
};

type StageFilter = 'all' | EntityStatus;

/**
 * F-05: Глобальная база кандидатов
 * Все кандидаты компании в одном месте.
 * Поиск, фильтры, защита от дублей.
 */
export default function CandidatesDatabase({ vacancies: _vacancies, onRefreshVacancies: _onRefreshVacancies }: CandidatesDatabaseProps) {
  const navigate = useNavigate();

  // State
  const [selectedStage, setSelectedStage] = useState<StageFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showParserModal, setShowParserModal] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<Entity> | null>(null);

  // Store
  const {
    entities,
    isLoading,
    setFilters,
    fetchEntities,
    typeCounts
  } = useEntityStore();

  // Fetch candidates on mount
  useEffect(() => {
    setFilters({ type: 'candidate' });
  }, [setFilters]);

  // Search and filter
  const filteredCandidates = useMemo(() => {
    let result = entities;

    // Search: name, email, phone, telegram
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.telegram_usernames?.some(t => t.toLowerCase().includes(q))
      );
    }

    // Filter by status
    if (selectedStage !== 'all') {
      result = result.filter(c => {
        if (c.status === selectedStage) return true;
        if (selectedStage === 'new' && !(ENTITY_PIPELINE_STAGES as readonly string[]).includes(c.status)) return true;
        return false;
      });
    }

    // Filter by source
    if (selectedSource !== 'all') {
      result = result.filter(c => {
        const source = getExtraDataString(c, 'source_url');
        if (selectedSource === 'hh' && source.includes('hh.ru')) return true;
        if (selectedSource === 'habr' && source.includes('habr')) return true;
        if (selectedSource === 'linkedin' && source.includes('linkedin')) return true;
        if (selectedSource === 'manual' && !source) return true;
        return false;
      });
    }

    return result;
  }, [entities, searchQuery, selectedStage, selectedSource]);

  // Stage counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entities.length };
    ENTITY_PIPELINE_STAGES.forEach(stage => {
      counts[stage] = entities.filter(c => c.status === stage).length;
    });
    const knownStatuses = new Set<string>(ENTITY_PIPELINE_STAGES);
    const unknownCount = entities.filter(c => !knownStatuses.has(c.status)).length;
    counts['new'] = (counts['new'] || 0) + unknownCount;
    return counts;
  }, [entities]);

  // Unique sources for filter
  const sources = [
    { value: 'all', label: 'Все источники' },
    { value: 'hh', label: 'HeadHunter' },
    { value: 'habr', label: 'Habr' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'manual', label: 'Вручную' },
  ];

  // Handlers
  const handleCandidateClick = (candidate: Entity) => {
    navigate(`/contacts/${candidate.id}`);
  };

  const handleParsedResume = (data: ParsedResume) => {
    const prefill: Partial<Entity> = {
      type: 'candidate',
      name: data.name || '',
      email: data.email,
      phone: data.phone,
      telegram_usernames: data.telegram ? [data.telegram] : [],
      company: data.company,
      position: data.position,
      tags: data.skills || [],
      expected_salary_min: data.salary_min,
      expected_salary_max: data.salary_max,
      expected_salary_currency: data.salary_currency || 'RUB',
      extra_data: {
        experience_years: data.experience_years,
        location: data.location,
        summary: data.summary,
        source_url: data.source_url,
      },
    };
    setPrefillData(prefill);
    setShowParserModal(false);
    setShowCreateModal(true);
    toast.success('Данные распознаны');
  };

  const getAvatarInitials = (name: string) => {
    return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  };

  const getSourceLabel = (candidate: Entity): string => {
    const url = getExtraDataString(candidate, 'source_url');
    if (url.includes('hh.ru')) return 'HH';
    if (url.includes('habr')) return 'Habr';
    if (url.includes('linkedin')) return 'LinkedIn';
    if (url) return 'Ссылка';
    return 'Вручную';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            База кандидатов
            <span className="text-sm font-medium text-white/40 bg-white/[0.04] px-2 py-0.5 rounded-full">
              {isLoading ? '...' : (typeCounts?.candidate || entities.length)}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowParserModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] rounded-lg text-sm transition-colors"
            >
              <Upload className="w-4 h-4 text-purple-400" />
              <span className="hidden sm:inline">Резюме</span>
            </button>
            <button
              onClick={() => { setPrefillData(null); setShowCreateModal(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Добавить</span>
            </button>
          </div>
        </div>

        {/* Search + Filter toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Поиск по имени, email, телефону, Telegram..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-white/40 hover:text-white" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors',
              showFilters
                ? 'border-purple-500/50 bg-purple-500/10 text-purple-300'
                : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06]'
            )}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Фильтры</span>
          </button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="px-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            >
              {sources.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {(selectedSource !== 'all') && (
              <button
                onClick={() => { setSelectedSource('all'); }}
                className="text-xs text-white/40 hover:text-white"
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        )}

        {/* Status tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setSelectedStage('all')}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              selectedStage === 'all'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-white/50 hover:text-white/70 hover:bg-white/[0.04]'
            )}
          >
            Все ({stageCounts.all || 0})
          </button>
          {ENTITY_PIPELINE_STAGES.map(stage => (
            <button
              key={stage}
              onClick={() => setSelectedStage(stage)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                selectedStage === stage
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/[0.04]'
              )}
            >
              {STATUS_LABELS[stage]} ({stageCounts[stage] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* Candidate list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-white/40">
            <Users className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">
              {searchQuery ? 'Ничего не найдено' : 'Нет кандидатов'}
            </p>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="mt-2 text-xs text-purple-400 hover:text-purple-300">
                Сбросить поиск
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filteredCandidates.map(candidate => (
              <div
                key={candidate.id}
                onClick={() => handleCandidateClick(candidate)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] cursor-pointer group transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-xs flex-shrink-0">
                  {getAvatarInitials(candidate.name || '??')}
                </div>

                {/* Name + position */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
                  {candidate.position && (
                    <p className="text-xs text-white/40 truncate">{candidate.position}</p>
                  )}
                </div>

                {/* Status */}
                <span className={clsx(
                  'px-2 py-0.5 text-xs rounded-full whitespace-nowrap flex-shrink-0',
                  STATUS_COLORS[candidate.status as EntityStatus] || 'bg-white/[0.04] text-white/50'
                )}>
                  {STATUS_LABELS[candidate.status as EntityStatus] || 'Новый'}
                </span>

                {/* Source */}
                <span className="text-xs text-white/40 w-16 text-center flex-shrink-0 hidden sm:block">
                  {getSourceLabel(candidate)}
                </span>

                {/* Date added */}
                <div className="flex items-center gap-1 text-xs text-white/30 flex-shrink-0 w-20 hidden sm:flex">
                  <Clock className="w-3 h-3" />
                  {formatDate(candidate.created_at, 'short')}
                </div>

                {/* Owner */}
                {candidate.owner_name && (
                  <div className="flex items-center gap-1 text-xs text-white/30 flex-shrink-0 w-24 truncate hidden md:flex">
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{candidate.owner_name}</span>
                  </div>
                )}

                {/* Arrow */}
                <ExternalLink className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 transition-colors flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create candidate modal */}
      {showCreateModal && (
        <ContactForm
          defaultType="candidate"
          prefillData={prefillData || undefined}
          onClose={() => {
            setShowCreateModal(false);
            setPrefillData(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setPrefillData(null);
            fetchEntities();
            toast.success('Кандидат добавлен');
          }}
        />
      )}

      {/* Parser modal */}
      {showParserModal && (
        <ParserModal
          type="resume"
          onClose={() => setShowParserModal(false)}
          onParsed={(data) => handleParsedResume(data as ParsedResume)}
        />
      )}
    </div>
  );
}
