import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  ExternalLink,
  Plus,
  Upload,
  Filter,
  ChevronDown,
  X,
  Check,
  Clock,
  DollarSign,
  Users,
  UserCheck,
  Sparkles,
  FolderArchive,
  Loader2,
  CheckCircle,
  XCircle,
  LayoutGrid,
  List,
  Kanban
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Entity, Vacancy, EntityStatus } from '@/types';
import { CANDIDATE_PIPELINE_STAGES, STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { ParsedResume, BulkImportResponse } from '@/services/api';
import { formatSalary } from '@/utils';
import { bulkImportResumes, updateEntityStatus } from '@/services/api';
import ContactForm from '@/components/contacts/ContactForm';
import ParserModal from '@/components/parser/ParserModal';
import { Skeleton } from '@/components/ui';

interface CandidatesDatabaseProps {
  vacancies: Vacancy[];
  onRefreshVacancies: () => void;
}

export default function CandidatesDatabase({ vacancies, onRefreshVacancies }: CandidatesDatabaseProps) {
  const navigate = useNavigate();

  // View modes: grid, list, or kanban
  type ViewMode = 'grid' | 'list' | 'kanban';

  // Local state
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showParserModal, setShowParserModal] = useState(false);
  const [showAddToVacancyModal, setShowAddToVacancyModal] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<Entity> | null>(null);

  // Bulk import state
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkImportLoading, setBulkImportLoading] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState<BulkImportResponse | null>(null);
  const bulkImportInputRef = useRef<HTMLInputElement>(null);

  // Drag state for vacancy assignment
  const [draggedCandidate, setDraggedCandidate] = useState<Entity | null>(null);
  const [dropTargetVacancy, setDropTargetVacancy] = useState<number | null>(null);

  // Drag state for Kanban
  const [draggedForKanban, setDraggedForKanban] = useState<Entity | null>(null);
  const [dropTargetStage, setDropTargetStage] = useState<EntityStatus | null>(null);

  // Store
  const {
    entities,
    loading,
    setFilters,
    fetchEntities,
    typeCounts
  } = useEntityStore();

  const { addCandidateToVacancy } = useVacancyStore();

  // Fetch candidates on mount
  useEffect(() => {
    setFilters({ type: 'candidate' });
  }, [setFilters]);

  // Filter candidates locally by search
  const filteredCandidates = useMemo(() => {
    let result = entities;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query) ||
        c.phone?.includes(query) ||
        c.position?.toLowerCase().includes(query) ||
        c.company?.toLowerCase().includes(query) ||
        c.tags?.some(t => t.toLowerCase().includes(query))
      );
    }

    if (selectedTags.length > 0) {
      result = result.filter(c =>
        selectedTags.every(tag => c.tags?.includes(tag))
      );
    }

    return result;
  }, [entities, searchQuery, selectedTags]);

  // Get all unique tags from candidates
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    entities.forEach(c => c.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [entities]);

  // Get open vacancies for drag & drop targets
  const openVacancies = useMemo(() => {
    return vacancies.filter(v => v.status === 'open' || v.status === 'paused');
  }, [vacancies]);

  // Group candidates by status for Kanban view
  const candidatesByStatus = useMemo(() => {
    const grouped: Record<EntityStatus, Entity[]> = {} as Record<EntityStatus, Entity[]>;
    CANDIDATE_PIPELINE_STAGES.forEach(stage => {
      grouped[stage] = [];
    });
    filteredCandidates.forEach(candidate => {
      const status = candidate.status as EntityStatus;
      if (grouped[status]) {
        grouped[status].push(candidate);
      } else {
        // Default to 'new' if status not in pipeline
        grouped['new'].push(candidate);
      }
    });
    return grouped;
  }, [filteredCandidates]);

  // Handlers
  const handleDragStart = (candidate: Entity) => {
    setDraggedCandidate(candidate);
  };

  const handleDragEnd = async () => {
    if (draggedCandidate && dropTargetVacancy) {
      try {
        await addCandidateToVacancy(dropTargetVacancy, draggedCandidate.id, 'database_drag');
        toast.success(`${draggedCandidate.name} добавлен в вакансию`);
        onRefreshVacancies();
      } catch {
        toast.error('Не удалось добавить кандидата');
      }
    }
    setDraggedCandidate(null);
    setDropTargetVacancy(null);
  };

  const handleVacancyDragOver = (e: React.DragEvent, vacancyId: number) => {
    e.preventDefault();
    if (draggedCandidate) {
      setDropTargetVacancy(vacancyId);
    }
  };

  const handleVacancyDragLeave = () => {
    setDropTargetVacancy(null);
  };

  // Kanban drag handlers
  const handleKanbanDragStart = (candidate: Entity) => {
    setDraggedForKanban(candidate);
  };

  const handleKanbanDragEnd = async () => {
    if (draggedForKanban && dropTargetStage && draggedForKanban.status !== dropTargetStage) {
      try {
        await updateEntityStatus(draggedForKanban.id, dropTargetStage);
        toast.success(`${draggedForKanban.name} перемещён в "${STATUS_LABELS[dropTargetStage]}"`);
        fetchEntities(); // Refresh to get updated data
      } catch {
        toast.error('Не удалось изменить статус');
      }
    }
    setDraggedForKanban(null);
    setDropTargetStage(null);
  };

  const handleStageDragOver = (e: React.DragEvent, stage: EntityStatus) => {
    e.preventDefault();
    if (draggedForKanban) {
      setDropTargetStage(stage);
    }
  };

  const handleStageDragLeave = () => {
    setDropTargetStage(null);
  };

  const handleCandidateClick = (candidate: Entity) => {
    navigate(`/contacts/${candidate.id}`);
  };

  const handleToggleSelect = (candidateId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedCandidates.size === filteredCandidates.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(filteredCandidates.map(c => c.id)));
    }
  };

  const handleBulkAddToVacancy = async (vacancyId: number) => {
    if (selectedCandidates.size === 0) return;

    let success = 0;
    let failed = 0;

    for (const candidateId of selectedCandidates) {
      try {
        await addCandidateToVacancy(vacancyId, candidateId, 'database_bulk');
        success++;
      } catch {
        failed++;
      }
    }

    if (success > 0) {
      toast.success(`Добавлено ${success} кандидатов`);
      onRefreshVacancies();
    }
    if (failed > 0) {
      toast.error(`Не удалось добавить ${failed} кандидатов`);
    }

    setSelectedCandidates(new Set());
    setShowAddToVacancyModal(false);
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

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Пожалуйста, выберите ZIP файл');
      return;
    }

    setBulkImportLoading(true);
    setBulkImportResult(null);
    setShowBulkImportModal(true);

    try {
      const result = await bulkImportResumes(file);
      setBulkImportResult(result);

      if (result.successful > 0) {
        toast.success(`Импортировано ${result.successful} кандидатов`);
        fetchEntities(); // Refresh the list
      }
      if (result.failed > 0) {
        toast.error(`Не удалось импортировать ${result.failed} файлов`);
      }
    } catch (err) {
      console.error('Bulk import error:', err);
      toast.error('Ошибка массового импорта');
      setBulkImportResult({
        success: false,
        total_files: 0,
        successful: 0,
        failed: 0,
        results: [],
        error: err instanceof Error ? err.message : 'Неизвестная ошибка'
      });
    } finally {
      setBulkImportLoading(false);
      // Reset file input
      if (bulkImportInputRef.current) {
        bulkImportInputRef.current.value = '';
      }
    }
  };

  const closeBulkImportModal = () => {
    setShowBulkImportModal(false);
    setBulkImportResult(null);
  };

  const getAvatarInitials = (name: string) => {
    return name
      .split(' ')
      .slice(0, 2)
      .map(n => n[0])
      .join('')
      .toUpperCase();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            База кандидатов
            <span className="text-sm font-normal text-white/50">
              ({typeCounts.candidate || 0})
            </span>
          </h2>

          {/* Actions - wrapped on mobile */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Selection action */}
            {selectedCandidates.size > 0 && (
              <button
                onClick={() => setShowAddToVacancyModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm transition-colors whitespace-nowrap"
              >
                <Briefcase className="w-4 h-4" />
                <span className="hidden sm:inline">В вакансию</span>
                <span className="font-medium">({selectedCandidates.size})</span>
              </button>
            )}
            <button
              onClick={() => setShowParserModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Загрузить резюме</span>
              <span className="sm:hidden">Резюме</span>
            </button>
            <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors cursor-pointer whitespace-nowrap">
              <FolderArchive className="w-4 h-4" />
              <span className="hidden sm:inline">Массовый импорт</span>
              <span className="sm:hidden">ZIP</span>
              <input
                ref={bulkImportInputRef}
                type="file"
                accept=".zip"
                onChange={handleBulkImport}
                className="hidden"
              />
            </label>
            <button
              onClick={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Новый кандидат</span>
              <span className="sm:hidden">Новый</span>
            </button>
          </div>
        </div>

        {/* Search, Filters & View Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Поиск по имени, email, навыкам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* Filters */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors whitespace-nowrap',
              selectedTags.length > 0
                ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            )}
          >
            <Filter className="w-4 h-4" />
            Навыки
            {selectedTags.length > 0 && (
              <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs rounded-full">
                {selectedTags.length}
              </span>
            )}
            <ChevronDown className={clsx('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
          </button>

          {/* Select All */}
          {filteredCandidates.length > 0 && (
            <button
              onClick={handleSelectAll}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors whitespace-nowrap',
                selectedCandidates.size === filteredCandidates.length
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              )}
            >
              <Check className="w-4 h-4" />
              {selectedCandidates.size === filteredCandidates.length ? 'Снять' : 'Выбрать'}
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center bg-white/5 rounded-lg p-1 border border-white/10">
            <button
              onClick={() => setViewMode('kanban')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'kanban' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              )}
              title="Kanban"
            >
              <Kanban className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'grid' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              )}
              title="Сетка"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'list' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              )}
              title="Список"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tags Filter Dropdown */}
        <AnimatePresence>
          {showFilters && allTags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 p-3 bg-white/5 rounded-lg border border-white/10 overflow-hidden"
            >
              <div className="flex flex-wrap gap-2">
                {allTags.slice(0, 20).map(tag => (
                  <button
                    key={tag}
                    onClick={() => {
                      setSelectedTags(prev =>
                        prev.includes(tag)
                          ? prev.filter(t => t !== tag)
                          : [...prev, tag]
                      );
                    }}
                    className={clsx(
                      'px-2.5 py-1 text-xs rounded-full border transition-colors',
                      selectedTags.includes(tag)
                        ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                    )}
                  >
                    {tag}
                  </button>
                ))}
                {allTags.length > 20 && (
                  <span className="px-2.5 py-1 text-xs text-white/40">
                    +{allTags.length - 20} ещё
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Candidates Grid */}
        <div className="flex-1 overflow-auto p-4">
          {loading && entities.length === 0 ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Skeleton key={i} variant="rounded" className="h-48 w-full" />
              ))}
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-white/40">
                <UserCheck className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">
                  {searchQuery ? 'Ничего не найдено' : 'Нет кандидатов'}
                </h3>
                <p className="text-sm mb-4">
                  {searchQuery
                    ? 'Попробуйте изменить параметры поиска'
                    : 'Добавьте первого кандидата в базу'}
                </p>
                <button
                  onClick={() => {
                    setPrefillData(null);
                    setShowCreateModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors"
                >
                  Добавить кандидата
                </button>
              </div>
            </div>
          ) : viewMode === 'kanban' ? (
            /* Kanban View */
            <div className="h-full overflow-x-auto">
              <div className="flex gap-3 h-full min-w-max p-1">
                {CANDIDATE_PIPELINE_STAGES.map(stage => (
                  <div
                    key={stage}
                    onDragOver={(e) => handleStageDragOver(e, stage)}
                    onDragLeave={handleStageDragLeave}
                    onDrop={handleKanbanDragEnd}
                    className={clsx(
                      'w-72 flex-shrink-0 flex flex-col bg-white/5 rounded-xl border transition-all',
                      dropTargetStage === stage
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-white/10'
                    )}
                  >
                    {/* Column Header */}
                    <div className={clsx('p-3 border-b border-white/10 rounded-t-xl', STATUS_COLORS[stage])}>
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">{STATUS_LABELS[stage]}</h3>
                        <span className="text-xs px-2 py-0.5 bg-black/20 rounded-full">
                          {candidatesByStatus[stage]?.length || 0}
                        </span>
                      </div>
                    </div>

                    {/* Column Content */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {candidatesByStatus[stage]?.map(candidate => (
                        <motion.div
                          key={candidate.id}
                          layout
                          draggable
                          onDragStart={() => handleKanbanDragStart(candidate)}
                          onDragEnd={handleKanbanDragEnd}
                          onClick={() => handleCandidateClick(candidate)}
                          className={clsx(
                            'p-3 bg-gray-800/50 hover:bg-gray-800 border border-white/10 rounded-lg cursor-pointer transition-all',
                            draggedForKanban?.id === candidate.id && 'opacity-50'
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-xs flex-shrink-0">
                              {getAvatarInitials(candidate.name || 'UK')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
                              {candidate.position && (
                                <p className="text-xs text-white/50 truncate">{candidate.position}</p>
                              )}
                            </div>
                          </div>
                          {candidate.tags && candidate.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {candidate.tags.slice(0, 2).map(tag => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/50 truncate max-w-[70px]"
                                >
                                  {tag}
                                </span>
                              ))}
                              {candidate.tags.length > 2 && (
                                <span className="text-xs text-white/30">+{candidate.tags.length - 2}</span>
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex items-center justify-between text-xs text-white/40">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(candidate.created_at)}
                            </span>
                            {candidate.email && (
                              <Mail className="w-3 h-3" />
                            )}
                          </div>
                        </motion.div>
                      ))}
                      {(!candidatesByStatus[stage] || candidatesByStatus[stage].length === 0) && (
                        <div className="text-center py-8 text-white/30 text-sm">
                          Нет кандидатов
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {viewMode === 'grid' ? (
                /* Grid View */
                <motion.div
                  key="grid-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {filteredCandidates.map(candidate => (
                    <motion.div
                      key={candidate.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{
                        opacity: draggedCandidate?.id === candidate.id ? 0.5 : 1,
                        scale: draggedCandidate?.id === candidate.id ? 0.98 : 1
                      }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      draggable
                      onDragStart={() => handleDragStart(candidate)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleCandidateClick(candidate)}
                      className={clsx(
                        'p-3 bg-white/5 hover:bg-white/10 border rounded-xl cursor-pointer transition-all group overflow-hidden',
                        selectedCandidates.has(candidate.id)
                          ? 'border-purple-500/50 bg-purple-500/10'
                          : 'border-white/10'
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-start gap-2 mb-2">
                        {/* Checkbox */}
                        <button
                          onClick={(e) => handleToggleSelect(candidate.id, e)}
                          className={clsx(
                            'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors mt-0.5',
                            selectedCandidates.has(candidate.id)
                              ? 'bg-purple-600 border-purple-600'
                              : 'border-white/20 hover:border-white/40'
                          )}
                        >
                          {selectedCandidates.has(candidate.id) && (
                            <Check className="w-3 h-3" />
                          )}
                        </button>

                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-sm flex-shrink-0">
                          {getAvatarInitials(candidate.name || 'UK')}
                        </div>

                        {/* Name & Position */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
                          {candidate.position && (
                            <p className="text-xs text-white/50 truncate">{candidate.position}</p>
                          )}
                        </div>
                      </div>

                      {/* Contact Info */}
                      <div className="space-y-1 text-xs text-white/60 ml-7">
                        {candidate.email && (
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <Mail className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{candidate.email}</span>
                          </div>
                        )}
                        {candidate.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{candidate.phone}</span>
                          </div>
                        )}
                        {typeof candidate.extra_data?.location === 'string' && candidate.extra_data.location && (
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{candidate.extra_data.location}</span>
                          </div>
                        )}
                        {(candidate.expected_salary_min || candidate.expected_salary_max) && (
                          <div className="flex items-center gap-1.5 text-green-400">
                            <DollarSign className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">
                              {formatSalary(
                                candidate.expected_salary_min,
                                candidate.expected_salary_max,
                                candidate.expected_salary_currency
                              )}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Tags */}
                      {candidate.tags && candidate.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1 ml-7">
                          {candidate.tags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/60 truncate max-w-[80px]"
                            >
                              {tag}
                            </span>
                          ))}
                          {candidate.tags.length > 3 && (
                            <span className="px-1.5 py-0.5 text-xs text-white/40">
                              +{candidate.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Footer */}
                      <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-xs text-white/40 ml-7">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(candidate.created_at)}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCandidateClick(candidate);
                          }}
                          className="p-1 hover:bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                /* List View */
                <motion.div
                  key="list-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-2"
                >
                  {filteredCandidates.map(candidate => (
                    <motion.div
                      key={candidate.id}
                      layout
                      initial={{ opacity: 0, y: 5 }}
                      animate={{
                        opacity: draggedCandidate?.id === candidate.id ? 0.5 : 1
                      }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.15 }}
                      draggable
                      onDragStart={() => handleDragStart(candidate)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleCandidateClick(candidate)}
                      className={clsx(
                        'flex items-center gap-4 p-3 bg-white/5 hover:bg-white/10 border rounded-lg cursor-pointer transition-all group',
                        selectedCandidates.has(candidate.id)
                          ? 'border-purple-500/50 bg-purple-500/10'
                          : 'border-white/10'
                      )}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={(e) => handleToggleSelect(candidate.id, e)}
                        className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                          selectedCandidates.has(candidate.id)
                            ? 'bg-purple-600 border-purple-600'
                            : 'border-white/20 hover:border-white/40'
                        )}
                      >
                        {selectedCandidates.has(candidate.id) && (
                          <Check className="w-3 h-3" />
                        )}
                      </button>

                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-sm flex-shrink-0">
                        {getAvatarInitials(candidate.name || 'UK')}
                      </div>

                      {/* Main Info */}
                      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {/* Name & Position */}
                        <div className="min-w-0">
                          <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
                          {candidate.position && (
                            <p className="text-xs text-white/50 truncate">{candidate.position}</p>
                          )}
                        </div>

                        {/* Contact Info */}
                        <div className="text-xs text-white/60 space-y-0.5 min-w-0">
                          {candidate.email && (
                            <div className="flex items-center gap-1.5 truncate">
                              <Mail className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{candidate.email}</span>
                            </div>
                          )}
                          {candidate.phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3 h-3 flex-shrink-0" />
                              <span>{candidate.phone}</span>
                            </div>
                          )}
                        </div>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1 items-start">
                          {candidate.tags?.slice(0, 4).map(tag => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/60"
                            >
                              {tag}
                            </span>
                          ))}
                          {(candidate.tags?.length || 0) > 4 && (
                            <span className="px-1.5 py-0.5 text-xs text-white/40">
                              +{candidate.tags!.length - 4}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Date & Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0 text-xs text-white/40">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(candidate.created_at)}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCandidateClick(candidate);
                          }}
                          className="p-1.5 hover:bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Vacancies Drop Targets Sidebar */}
        {draggedCandidate && openVacancies.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-64 border-l border-white/10 bg-gray-900/50 p-3 overflow-y-auto"
          >
            <div className="flex items-center gap-2 mb-3 text-sm text-white/60">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>Перетащите на вакансию</span>
            </div>

            <div className="space-y-2">
              {openVacancies.map(vacancy => (
                <div
                  key={vacancy.id}
                  onDragOver={(e) => handleVacancyDragOver(e, vacancy.id)}
                  onDragLeave={handleVacancyDragLeave}
                  onDrop={handleDragEnd}
                  className={clsx(
                    'p-3 rounded-lg border-2 border-dashed transition-all',
                    dropTargetVacancy === vacancy.id
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-white/20 hover:border-white/30'
                  )}
                >
                  <h4 className="font-medium text-sm truncate">{vacancy.title}</h4>
                  <p className="text-xs text-white/40 mt-1">
                    {vacancy.applications_count} кандидатов
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreateModal && (
          <ContactForm
            prefillData={prefillData || undefined}
            defaultType="candidate"
            onClose={() => {
              setShowCreateModal(false);
              setPrefillData(null);
            }}
            onSuccess={() => {
              setShowCreateModal(false);
              setPrefillData(null);
              fetchEntities();
              toast.success('Кандидат создан');
            }}
          />
        )}

        {showParserModal && (
          <ParserModal
            type="resume"
            onClose={() => setShowParserModal(false)}
            onParsed={(data) => handleParsedResume(data as ParsedResume)}
          />
        )}

        {showAddToVacancyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowAddToVacancyModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-gray-900 rounded-xl border border-white/10 shadow-xl overflow-hidden"
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold">Выберите вакансию</h3>
                <button
                  onClick={() => setShowAddToVacancyModal(false)}
                  className="p-1 hover:bg-white/10 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
                {openVacancies.length === 0 ? (
                  <div className="text-center py-8 text-white/40">
                    <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Нет открытых вакансий</p>
                  </div>
                ) : (
                  openVacancies.map(vacancy => (
                    <button
                      key={vacancy.id}
                      onClick={() => handleBulkAddToVacancy(vacancy.id)}
                      className="w-full p-3 text-left bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
                    >
                      <h4 className="font-medium">{vacancy.title}</h4>
                      <p className="text-xs text-white/40 mt-1">
                        {vacancy.department_name && `${vacancy.department_name} • `}
                        {vacancy.applications_count} кандидатов
                      </p>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Bulk Import Modal */}
        {showBulkImportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={closeBulkImportModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark-900 border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <FolderArchive className="w-5 h-5 text-purple-400" />
                  Массовый импорт резюме
                </h3>
                {!bulkImportLoading && (
                  <button
                    onClick={closeBulkImportModal}
                    className="p-1 hover:bg-white/10 rounded"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="p-6">
                {bulkImportLoading ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
                    <p className="text-white/60">Обрабатываем резюме...</p>
                    <p className="text-sm text-white/40 mt-1">Это может занять несколько минут</p>
                  </div>
                ) : bulkImportResult ? (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="flex items-center justify-center gap-6 py-4">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-green-400">{bulkImportResult.successful}</p>
                        <p className="text-sm text-white/40">Успешно</p>
                      </div>
                      <div className="w-px h-12 bg-white/10" />
                      <div className="text-center">
                        <p className="text-3xl font-bold text-red-400">{bulkImportResult.failed}</p>
                        <p className="text-sm text-white/40">Ошибок</p>
                      </div>
                    </div>

                    {/* Results list */}
                    {bulkImportResult.results.length > 0 && (
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {bulkImportResult.results.map((result, index) => (
                          <div
                            key={index}
                            className={clsx(
                              'flex items-center gap-3 p-3 rounded-lg border',
                              result.success
                                ? 'bg-green-500/10 border-green-500/30'
                                : 'bg-red-500/10 border-red-500/30'
                            )}
                          >
                            {result.success ? (
                              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {result.entity_name || result.filename}
                              </p>
                              {result.error && (
                                <p className="text-xs text-red-400 truncate">{result.error}</p>
                              )}
                            </div>
                            {result.entity_id && (
                              <button
                                onClick={() => {
                                  closeBulkImportModal();
                                  navigate(`/contacts/${result.entity_id}`);
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300"
                              >
                                Открыть
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {bulkImportResult.error && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-sm text-red-400">{bulkImportResult.error}</p>
                      </div>
                    )}

                    <button
                      onClick={closeBulkImportModal}
                      className="w-full py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm transition-colors"
                    >
                      Закрыть
                    </button>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
