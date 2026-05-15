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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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

    // Filter by date range
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(c => new Date(c.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59');
      result = result.filter(c => new Date(c.created_at) <= to);
    }

    return result;
  }, [entities, searchQuery, selectedStage, selectedSource, dateFrom, dateTo]);

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
    navigate(`/all-candidates?entity=${candidate.id}`);
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
      <div className="p-4 border-b border-[color:var(--hf-white-alpha-10)] space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--hf-status-purple)]" />
            База кандидатов
            <span className="text-sm font-medium text-[color:var(--hf-white-alpha-40)] bg-[var(--hf-white-alpha-04)] px-2 py-0.5 rounded-full">
              {isLoading ? '...' : (typeCounts?.candidate || entities.length)}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowParserModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white-alpha-02)] hover:bg-[var(--hf-white-alpha-06)] rounded-lg text-sm transition-colors"
            >
              <Upload className="w-4 h-4 text-[var(--hf-status-purple)]" />
              <span className="hidden sm:inline">Резюме</span>
            </button>
            <button
              onClick={() => { setPrefillData(null); setShowCreateModal(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-[var(--hf-status-purple)] hover:bg-[var(--hf-status-purple)] rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Добавить</span>
            </button>
          </div>
        </div>

        {/* Search + Filter toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--hf-white-alpha-40)]" />
            <input
              type="text"
              placeholder="Поиск по имени, email, телефону, Telegram..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[var(--hf-white-alpha-04)] border border-[color:var(--hf-white-alpha-06)] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[var(--hf-status-purple-badge)]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-[color:var(--hf-white-alpha-40)] hover:text-[var(--hf-white)]" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors',
              showFilters
                ? 'border-[color:var(--hf-status-purple-badge)] bg-[var(--hf-status-purple-bg)] text-[var(--hf-status-purple)]'
                : 'border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white-alpha-02)] hover:bg-[var(--hf-white-alpha-06)]'
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
              className="px-3 py-1.5 bg-[var(--hf-white-alpha-04)] border border-[color:var(--hf-white-alpha-06)] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[var(--hf-status-purple-badge)]"
            >
              {sources.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[color:var(--hf-white-alpha-40)]">Дата от</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-[var(--hf-white-alpha-05)] border border-[color:var(--hf-white-alpha-10)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--hf-white-alpha-80)] focus:border-[color:var(--hf-status-purple-badge)] focus:outline-none"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[color:var(--hf-white-alpha-40)]">Дата до</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-[var(--hf-white-alpha-05)] border border-[color:var(--hf-white-alpha-10)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--hf-white-alpha-80)] focus:border-[color:var(--hf-status-purple-badge)] focus:outline-none"
              />
            </div>

            {(selectedSource !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => { setSelectedSource('all'); setDateFrom(''); setDateTo(''); }}
                className="text-xs text-[color:var(--hf-white-alpha-40)] hover:text-[var(--hf-white)]"
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
                ? 'bg-[var(--hf-status-purple-badge)] text-[var(--hf-status-purple)] border border-[color:var(--hf-status-purple-badge)]'
                : 'text-[color:var(--hf-white-alpha-50)] hover:text-[color:var(--hf-white-alpha-70)] hover:bg-[var(--hf-white-alpha-04)]'
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
                  ? 'bg-[var(--hf-status-purple-badge)] text-[var(--hf-status-purple)] border border-[color:var(--hf-status-purple-badge)]'
                  : 'text-[color:var(--hf-white-alpha-50)] hover:text-[color:var(--hf-white-alpha-70)] hover:bg-[var(--hf-white-alpha-04)]'
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
          <div className="flex flex-col items-center justify-center h-64 text-[color:var(--hf-white-alpha-40)]">
            <Users className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">
              {searchQuery ? 'Ничего не найдено' : 'Нет кандидатов'}
            </p>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="mt-2 text-xs text-[var(--hf-status-purple)] hover:text-[var(--hf-status-purple)]">
                Сбросить поиск
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--hf-white-alpha-04)]">
            {filteredCandidates.map(candidate => (
              <div
                key={candidate.id}
                onClick={() => handleCandidateClick(candidate)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--hf-white-alpha-02)] cursor-pointer group transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-[var(--hf-status-purple-badge)] flex items-center justify-center text-[var(--hf-status-purple)] font-medium text-xs flex-shrink-0">
                  {getAvatarInitials(candidate.name || '??')}
                </div>

                {/* Name + position */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
                  {candidate.position && (
                    <p className="text-xs text-[color:var(--hf-white-alpha-40)] truncate">{candidate.position}</p>
                  )}
                </div>

                {/* Status */}
                <span className={clsx(
                  'px-2 py-0.5 text-xs rounded-full whitespace-nowrap flex-shrink-0',
                  STATUS_COLORS[candidate.status as EntityStatus] || 'bg-[var(--hf-white-alpha-04)] text-[color:var(--hf-white-alpha-50)]'
                )}>
                  {STATUS_LABELS[candidate.status as EntityStatus] || 'Новый'}
                </span>

                {/* Source */}
                <span className="text-xs text-[color:var(--hf-white-alpha-40)] w-16 text-center flex-shrink-0 hidden sm:block">
                  {getSourceLabel(candidate)}
                </span>

                {/* Date added */}
                <div className="flex items-center gap-1 text-xs text-[color:var(--hf-white-alpha-30)] flex-shrink-0 w-20 hidden sm:flex">
                  <Clock className="w-3 h-3" />
                  {formatDate(candidate.created_at, 'short')}
                </div>

                {/* Owner */}
                {candidate.owner_name && (
                  <div className="flex items-center gap-1 text-xs text-[color:var(--hf-white-alpha-30)] flex-shrink-0 w-24 truncate hidden md:flex">
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{candidate.owner_name}</span>
                  </div>
                )}

                {/* Arrow */}
                <ExternalLink className="w-3.5 h-3.5 text-[color:var(--hf-white-alpha-20)] group-hover:text-[color:var(--hf-white-alpha-50)] transition-colors flex-shrink-0" />
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
