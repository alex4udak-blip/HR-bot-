import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  UserCheck,
  Phone,
  Mail,
  Upload,
  Filter,
  X,
  Check,
  ChevronDown,
  Edit,
  Trash2,
  MoreVertical,
  DollarSign,
  Calendar,
  Tag,
  CheckSquare,
  Square,
  RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import type { Entity, EntityStatus } from '@/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import { formatSalary } from '@/utils';
import type { ParsedResume } from '@/services/api';
import ContactForm from '@/components/contacts/ContactForm';
import ParserModal from '@/components/parser/ParserModal';
import { ConfirmDialog, ErrorMessage, EmptyCandidates } from '@/components/ui';
import { OnboardingTooltip } from '@/components/onboarding';

// Candidate statuses (subset of EntityStatus)
const CANDIDATE_STATUSES: EntityStatus[] = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'];

// Salary range filters (in RUB)
const SALARY_RANGES = [
  { id: 'any', label: 'Любая', min: undefined, max: undefined },
  { id: 'under100k', label: 'До 100k', min: undefined, max: 100000 },
  { id: '100k-200k', label: '100k - 200k', min: 100000, max: 200000 },
  { id: '200k-300k', label: '200k - 300k', min: 200000, max: 300000 },
  { id: '300k+', label: '300k+', min: 300000, max: undefined },
];

// Date range filters
const DATE_RANGES = [
  { id: 'any', label: 'За все время', days: undefined },
  { id: '7days', label: 'За 7 дней', days: 7 },
  { id: '30days', label: 'За 30 дней', days: 30 },
  { id: '90days', label: 'За 90 дней', days: 90 },
];

interface QuickFilters {
  statuses: EntityStatus[];
  salaryRange: string;
  dateRange: string;
  skills: string[];
}

// Pagination config
const PAGE_SIZE = 20;

export default function CandidatesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // UI State
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<Entity | null>(null);
  const [showParserModal, setShowParserModal] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<Entity> | null>(null);
  const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filtersDropdownRef = useRef<HTMLDivElement>(null);

  // Confirmation dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    candidate: Entity | null;
    type: 'delete' | 'bulk_delete';
  }>({ open: false, candidate: null, type: 'delete' });
  const [bulkStatusDialog, setBulkStatusDialog] = useState<{
    open: boolean;
    status: EntityStatus | null;
  }>({ open: false, status: null });
  const [actionLoading, setActionLoading] = useState(false);

  // Quick filters
  const [quickFilters, setQuickFilters] = useState<QuickFilters>(() => {
    const statusesParam = searchParams.get('statuses');
    const salaryParam = searchParams.get('salary');
    const dateParam = searchParams.get('date');
    const skillsParam = searchParams.get('skills');
    return {
      statuses: statusesParam ? statusesParam.split(',') as EntityStatus[] : [],
      salaryRange: salaryParam || 'any',
      dateRange: dateParam || 'any',
      skills: skillsParam ? skillsParam.split(',') : [],
    };
  });

  // Store
  const {
    entities,
    loading,
    error,
    deleteEntity,
    updateEntity,
    setFilters,
    clearError
  } = useEntityStore();

  const { canEditResource, canDeleteResource } = useAuthStore();

  // Filter entities to only candidates
  const candidates = useMemo(() => {
    return entities.filter(e => e.type === 'candidate');
  }, [entities]);

  // Apply quick filters
  const filteredCandidates = useMemo(() => {
    return candidates.filter((candidate) => {
      // Status filter
      if (quickFilters.statuses.length > 0 && !quickFilters.statuses.includes(candidate.status)) {
        return false;
      }

      // Salary range filter
      if (quickFilters.salaryRange !== 'any') {
        const salaryConfig = SALARY_RANGES.find(s => s.id === quickFilters.salaryRange);
        if (salaryConfig) {
          const salaryMin = candidate.expected_salary_min || 0;
          const salaryMax = candidate.expected_salary_max || salaryMin;
          const avgSalary = salaryMin && salaryMax ? (salaryMin + salaryMax) / 2 : salaryMin || salaryMax;

          if (!avgSalary) return false;
          if (salaryConfig.min !== undefined && avgSalary < salaryConfig.min) return false;
          if (salaryConfig.max !== undefined && avgSalary > salaryConfig.max) return false;
        }
      }

      // Date range filter
      if (quickFilters.dateRange !== 'any') {
        const dateConfig = DATE_RANGES.find(d => d.id === quickFilters.dateRange);
        if (dateConfig?.days) {
          const candidateDate = new Date(candidate.created_at);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - dateConfig.days);
          if (candidateDate < cutoffDate) return false;
        }
      }

      // Skills filter
      if (quickFilters.skills.length > 0) {
        const candidateTags = candidate.tags.map(t => t.toLowerCase());
        const hasAllSkills = quickFilters.skills.every(skill =>
          candidateTags.some(tag => tag.includes(skill.toLowerCase()))
        );
        if (!hasAllSkills) return false;
      }

      return true;
    });
  }, [candidates, quickFilters]);

  // Pagination
  const totalPages = Math.ceil(filteredCandidates.length / PAGE_SIZE);
  const paginatedCandidates = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredCandidates.slice(start, start + PAGE_SIZE);
  }, [filteredCandidates, currentPage]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (quickFilters.statuses.length > 0) count++;
    if (quickFilters.salaryRange !== 'any') count++;
    if (quickFilters.dateRange !== 'any') count++;
    if (quickFilters.skills.length > 0) count++;
    return count;
  }, [quickFilters]);

  // All unique skills from candidates
  const allSkills = useMemo(() => {
    const skillSet = new Set<string>();
    candidates.forEach(c => c.tags.forEach(t => skillSet.add(t)));
    return Array.from(skillSet).sort();
  }, [candidates]);

  // Selection helpers
  const allSelected = paginatedCandidates.length > 0 &&
    paginatedCandidates.every(c => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  // Permission helpers
  const canEdit = useCallback((entity: Entity) => {
    if (entity.is_transferred) return false;
    return canEditResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  }, [canEditResource]);

  const canDelete = useCallback((entity: Entity) => {
    if (entity.is_transferred) return false;
    return canDeleteResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  }, [canDeleteResource]);

  // Load candidates on mount
  useEffect(() => {
    setFilters({
      type: 'candidate',
      search: searchQuery || undefined
    });
  }, [setFilters]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      setFilters({ search: searchQuery || undefined });
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, setFilters]);

  // Sync filters to URL
  useEffect(() => {
    const newParams = new URLSearchParams();

    if (searchQuery) newParams.set('search', searchQuery);
    if (quickFilters.statuses.length > 0) {
      newParams.set('statuses', quickFilters.statuses.join(','));
    }
    if (quickFilters.salaryRange !== 'any') {
      newParams.set('salary', quickFilters.salaryRange);
    }
    if (quickFilters.dateRange !== 'any') {
      newParams.set('date', quickFilters.dateRange);
    }
    if (quickFilters.skills.length > 0) {
      newParams.set('skills', quickFilters.skills.join(','));
    }

    setSearchParams(newParams, { replace: true });
  }, [searchQuery, quickFilters, setSearchParams]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filtersDropdownRef.current && !filtersDropdownRef.current.contains(event.target as Node)) {
        setShowFiltersDropdown(false);
      }
    };

    if (showFiltersDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFiltersDropdown]);

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [quickFilters]);

  // Handlers
  const handleToggleStatusFilter = (status: EntityStatus) => {
    setQuickFilters(prev => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter(s => s !== status)
        : [...prev.statuses, status]
    }));
  };

  const handleSalaryRangeChange = (rangeId: string) => {
    setQuickFilters(prev => ({ ...prev, salaryRange: rangeId }));
  };

  const handleDateRangeChange = (rangeId: string) => {
    setQuickFilters(prev => ({ ...prev, dateRange: rangeId }));
  };

  const handleToggleSkillFilter = (skill: string) => {
    setQuickFilters(prev => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill]
    }));
  };

  const handleClearAllFilters = () => {
    setQuickFilters({
      statuses: [],
      salaryRange: 'any',
      dateRange: 'any',
      skills: [],
    });
    setSearchQuery('');
  };

  const handleCandidateClick = (candidate: Entity) => {
    navigate(`/contacts/${candidate.id}`);
  };

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedCandidates.map(c => c.id)));
    }
  };

  const handleSelectOne = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDeleteClick = (candidate: Entity) => {
    setConfirmDialog({ open: true, candidate, type: 'delete' });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog.candidate) return;
    setActionLoading(true);
    try {
      await deleteEntity(confirmDialog.candidate.id);
      toast.success('Кандидат удален');
      setConfirmDialog({ open: false, candidate: null, type: 'delete' });
    } catch {
      toast.error('Не удалось удалить кандидата');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setConfirmDialog({ open: true, candidate: null, type: 'bulk_delete' });
  };

  const handleConfirmBulkDelete = async () => {
    setActionLoading(true);
    try {
      const deletePromises = Array.from(selectedIds).map(id => deleteEntity(id));
      await Promise.all(deletePromises);
      toast.success(`Удалено кандидатов: ${selectedIds.size}`);
      setSelectedIds(new Set());
      setConfirmDialog({ open: false, candidate: null, type: 'bulk_delete' });
    } catch {
      toast.error('Не удалось удалить некоторых кандидатов');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkStatusChange = (status: EntityStatus) => {
    if (selectedIds.size === 0) return;
    setBulkStatusDialog({ open: true, status });
  };

  const handleConfirmBulkStatus = async () => {
    if (!bulkStatusDialog.status) return;
    setActionLoading(true);
    try {
      const updatePromises = Array.from(selectedIds).map(id =>
        updateEntity(id, { status: bulkStatusDialog.status! })
      );
      await Promise.all(updatePromises);
      toast.success(`Статус изменен для ${selectedIds.size} кандидатов`);
      setSelectedIds(new Set());
      setBulkStatusDialog({ open: false, status: null });
      setShowBulkActions(false);
    } catch {
      toast.error('Не удалось изменить статус');
    } finally {
      setActionLoading(false);
    }
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

  const handleRetryFetch = () => {
    clearError();
    setFilters({ type: 'candidate', search: searchQuery || undefined });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const getAvatarInitials = (name: string) => {
    return name
      .split(' ')
      .slice(0, 2)
      .map(n => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <OnboardingTooltip
            id="candidates-page"
            content="Управляйте базой кандидатов, отслеживайте статусы и добавляйте новых через парсинг резюме"
            position="bottom"
          >
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UserCheck className="w-7 h-7 text-cyan-400" />
              База кандидатов
            </h1>
          </OnboardingTooltip>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowParserModal(true)}
              data-tour="upload-resume"
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              Загрузить резюме
            </button>
            <button
              onClick={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Добавить кандидата
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Поиск по имени, телефону, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-tour="search-input"
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick Filters Dropdown */}
          <div className="relative" ref={filtersDropdownRef}>
            <button
              onClick={() => setShowFiltersDropdown(!showFiltersDropdown)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors',
                activeFilterCount > 0
                  ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              )}
            >
              <Filter className="w-4 h-4" />
              Фильтры
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center w-5 h-5 bg-cyan-600 text-white text-xs rounded-full">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className={clsx('w-4 h-4 transition-transform', showFiltersDropdown && 'rotate-180')} />
            </button>

            {/* Dropdown Panel */}
            <AnimatePresence>
              {showFiltersDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute left-0 top-full mt-2 w-80 bg-gray-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between p-3 border-b border-white/10">
                    <span className="font-medium text-sm">Фильтры</span>
                    {activeFilterCount > 0 && (
                      <button
                        onClick={handleClearAllFilters}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Сбросить
                      </button>
                    )}
                  </div>

                  <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
                    {/* Status Filter */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                        <UserCheck className="w-3.5 h-3.5" />
                        Статус
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {CANDIDATE_STATUSES.map((status) => (
                          <button
                            key={status}
                            onClick={() => handleToggleStatusFilter(status)}
                            className={clsx(
                              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                              quickFilters.statuses.includes(status)
                                ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                                : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                            )}
                          >
                            {quickFilters.statuses.includes(status) && <Check className="w-3 h-3" />}
                            {STATUS_LABELS[status]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Salary Range Filter */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                        <DollarSign className="w-3.5 h-3.5" />
                        Ожидаемая зарплата
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {SALARY_RANGES.map((range) => (
                          <button
                            key={range.id}
                            onClick={() => handleSalaryRangeChange(range.id)}
                            className={clsx(
                              'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                              quickFilters.salaryRange === range.id
                                ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                                : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Date Range Filter */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                        <Calendar className="w-3.5 h-3.5" />
                        Дата добавления
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {DATE_RANGES.map((range) => (
                          <button
                            key={range.id}
                            onClick={() => handleDateRangeChange(range.id)}
                            className={clsx(
                              'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                              quickFilters.dateRange === range.id
                                ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                                : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Skills Filter */}
                    {allSkills.length > 0 && (
                      <div>
                        <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                          <Tag className="w-3.5 h-3.5" />
                          Навыки
                        </label>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                          {allSkills.slice(0, 15).map((skill) => (
                            <button
                              key={skill}
                              onClick={() => handleToggleSkillFilter(skill)}
                              className={clsx(
                                'px-2.5 py-1 text-xs rounded-full border transition-colors',
                                quickFilters.skills.includes(skill)
                                  ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                              )}
                            >
                              {skill}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Results count */}
                  <div className="p-3 border-t border-white/10 bg-white/5">
                    <span className="text-xs text-white/50">
                      Найдено {filteredCandidates.length} из {candidates.length} кандидатов
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Selected count & bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-white/60">
                Выбрано: {selectedIds.size}
              </span>
              <div className="relative">
                <button
                  onClick={() => setShowBulkActions(!showBulkActions)}
                  className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm hover:bg-white/10 transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                  Действия
                  <ChevronDown className={clsx('w-4 h-4 transition-transform', showBulkActions && 'rotate-180')} />
                </button>

                {showBulkActions && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-gray-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2">
                      <p className="text-xs text-white/40 px-2 py-1 mb-1">Изменить статус</p>
                      {CANDIDATE_STATUSES.map(status => (
                        <button
                          key={status}
                          onClick={() => handleBulkStatusChange(status)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-white/5 rounded-lg transition-colors"
                        >
                          <span className={clsx('w-2 h-2 rounded-full', STATUS_COLORS[status].replace('text-', 'bg-').split(' ')[0])} />
                          {STATUS_LABELS[status]}
                        </button>
                      ))}
                      <div className="border-t border-white/10 my-2" />
                      <button
                        onClick={handleBulkDelete}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Удалить выбранных
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="p-4">
            <ErrorMessage error={error} onRetry={handleRetryFetch} />
          </div>
        ) : loading && candidates.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <EmptyCandidates
              variant={searchQuery ? 'search' : activeFilterCount > 0 ? 'filter' : 'primary'}
              query={searchQuery}
              onUploadResume={() => setShowParserModal(true)}
              onCreateCandidate={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
            />
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-sm border-b border-white/10">
              <tr>
                <th className="w-12 px-4 py-3 text-left">
                  <button
                    onClick={handleSelectAll}
                    className="p-1 hover:bg-white/5 rounded transition-colors"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-5 h-5 text-cyan-400" />
                    ) : someSelected ? (
                      <div className="w-5 h-5 border-2 border-cyan-400 rounded flex items-center justify-center">
                        <div className="w-2 h-2 bg-cyan-400 rounded-sm" />
                      </div>
                    ) : (
                      <Square className="w-5 h-5 text-white/40" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-white/60">Имя</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-white/60">Контакты</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-white/60">Навыки</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-white/60">Зарплата</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-white/60">Статус</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-white/60">Добавлен</th>
                <th className="w-24 px-4 py-3 text-right text-sm font-medium text-white/60">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {paginatedCandidates.map((candidate, index) => (
                <tr
                  key={candidate.id}
                  onClick={() => handleCandidateClick(candidate)}
                  data-tour={index === 0 ? 'candidate-row' : undefined}
                  className={clsx(
                    'hover:bg-white/5 cursor-pointer transition-colors',
                    selectedIds.has(candidate.id) && 'bg-cyan-500/10'
                  )}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleSelectOne(candidate.id)}
                      className="p-1 hover:bg-white/5 rounded transition-colors"
                    >
                      {selectedIds.has(candidate.id) ? (
                        <CheckSquare className="w-5 h-5 text-cyan-400" />
                      ) : (
                        <Square className="w-5 h-5 text-white/40" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 font-medium text-sm">
                        {getAvatarInitials(candidate.name)}
                      </div>
                      <div>
                        <p className="font-medium text-white">{candidate.name}</p>
                        {candidate.position && (
                          <p className="text-sm text-white/50">{candidate.position}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {candidate.phone && (
                        <div className="flex items-center gap-1.5 text-sm text-white/60">
                          <Phone className="w-3.5 h-3.5" />
                          {candidate.phone}
                        </div>
                      )}
                      {candidate.email && (
                        <div className="flex items-center gap-1.5 text-sm text-white/60">
                          <Mail className="w-3.5 h-3.5" />
                          {candidate.email}
                        </div>
                      )}
                      {candidate.telegram_usernames && candidate.telegram_usernames.length > 0 && (
                        <div className="flex items-center gap-1.5 text-sm text-white/60">
                          <span className="text-cyan-400">@</span>
                          {candidate.telegram_usernames[0]}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {candidate.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs bg-white/5 rounded-full text-white/70"
                        >
                          {tag}
                        </span>
                      ))}
                      {candidate.tags.length > 3 && (
                        <span className="px-2 py-0.5 text-xs text-white/40">
                          +{candidate.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {candidate.expected_salary_min || candidate.expected_salary_max ? (
                      <span className="text-sm text-white/70">
                        {formatSalary(
                          candidate.expected_salary_min,
                          candidate.expected_salary_max,
                          candidate.expected_salary_currency
                        )}
                      </span>
                    ) : (
                      <span className="text-sm text-white/30">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2.5 py-1 text-xs rounded-full', STATUS_COLORS[candidate.status])}>
                      {STATUS_LABELS[candidate.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-white/50">
                      {formatDate(candidate.created_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {canEdit(candidate) && (
                        <button
                          onClick={() => setEditingCandidate(candidate)}
                          className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60 hover:text-white"
                          title="Редактировать"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete(candidate) && (
                        <button
                          onClick={() => handleDeleteClick(candidate)}
                          className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-white/60 hover:text-red-400"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
          <span className="text-sm text-white/50">
            Показано {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredCandidates.length)} из {filteredCandidates.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Назад
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={clsx(
                    'w-8 h-8 text-sm rounded-lg transition-colors',
                    currentPage === pageNum
                      ? 'bg-cyan-600 text-white'
                      : 'hover:bg-white/5 text-white/60'
                  )}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Вперед
            </button>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || editingCandidate) && (
          <ContactForm
            entity={editingCandidate}
            prefillData={prefillData || undefined}
            defaultType="candidate"
            onClose={() => {
              setShowCreateModal(false);
              setEditingCandidate(null);
              setPrefillData(null);
            }}
            onSuccess={() => {
              setShowCreateModal(false);
              setEditingCandidate(null);
              setPrefillData(null);
              toast.success(editingCandidate ? 'Кандидат обновлен' : 'Кандидат создан');
            }}
          />
        )}
      </AnimatePresence>

      {/* Parser Modal */}
      <AnimatePresence>
        {showParserModal && (
          <ParserModal
            type="resume"
            onClose={() => setShowParserModal(false)}
            onParsed={(data) => handleParsedResume(data as ParsedResume)}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.type === 'bulk_delete' ? 'Удалить кандидатов' : 'Удалить кандидата'}
        message={
          confirmDialog.type === 'bulk_delete'
            ? `Вы уверены, что хотите удалить ${selectedIds.size} кандидатов? Это действие невозможно отменить.`
            : `Вы уверены, что хотите удалить "${confirmDialog.candidate?.name}"? Это действие невозможно отменить.`
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={confirmDialog.type === 'bulk_delete' ? handleConfirmBulkDelete : handleConfirmDelete}
        onCancel={() => setConfirmDialog({ open: false, candidate: null, type: 'delete' })}
        loading={actionLoading}
      />

      {/* Bulk Status Change Dialog */}
      <ConfirmDialog
        open={bulkStatusDialog.open}
        title="Изменить статус"
        message={`Изменить статус для ${selectedIds.size} кандидатов на "${bulkStatusDialog.status ? STATUS_LABELS[bulkStatusDialog.status] : ''}"?`}
        confirmLabel="Изменить"
        cancelLabel="Отмена"
        variant="info"
        onConfirm={handleConfirmBulkStatus}
        onCancel={() => setBulkStatusDialog({ open: false, status: null })}
        loading={actionLoading}
      />
    </div>
  );
}
