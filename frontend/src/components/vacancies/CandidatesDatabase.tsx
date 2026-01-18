import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Phone,
  Mail,
  Briefcase,
  ExternalLink,
  Plus,
  Upload,
  Filter,
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
  Kanban,
  GripVertical
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { useVacancyStore } from '@/stores/vacancyStore';
import { logger } from '@/utils/logger';
import type { Entity, Vacancy, EntityStatus, ApplicationStage } from '@/types';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  PIPELINE_STAGES,
  STATUS_TO_STAGE_MAP,
  STAGE_TO_STATUS_MAP
} from '@/types';
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

// Stage filter: 'all' or specific stage
type StageFilter = 'all' | EntityStatus;

export default function CandidatesDatabase({ vacancies, onRefreshVacancies }: CandidatesDatabaseProps) {
  const navigate = useNavigate();

  // View modes
  type ViewMode = 'cards' | 'list' | 'kanban';

  // Local state
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [selectedStage, setSelectedStage] = useState<StageFilter>('all');
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

  // Drag state for Kanban stage change
  const [draggedForKanban, setDraggedForKanban] = useState<Entity | null>(null);
  const [dropTargetStage, setDropTargetStage] = useState<ApplicationStage | null>(null);

  // Track which candidates are currently being moved (prevents double-click)
  const [movingCandidates, setMovingCandidates] = useState<Set<number>>(new Set());

  // Kanban auto-scroll refs
  const kanbanContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<number | null>(null);
  const scrollDirectionRef = useRef<number>(0);
  const AUTO_SCROLL_THRESHOLD = 200;
  const AUTO_SCROLL_SPEED = 30;

  // Store
  const {
    entities,
    isLoading,
    setFilters,
    fetchEntities,
    typeCounts
  } = useEntityStore();

  const { addCandidateToVacancy } = useVacancyStore();

  // Fetch candidates on mount
  useEffect(() => {
    setFilters({ type: 'candidate' });
  }, [setFilters]);

  // Filter candidates by search and tags
  const searchFilteredCandidates = useMemo(() => {
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

  // Count candidates by stage
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: searchFilteredCandidates.length };
    PIPELINE_STAGES.forEach(stage => {
      counts[stage] = searchFilteredCandidates.filter(c => c.status === stage).length;
    });
    // Count candidates with unknown status as 'applied' (displayed as "Новый")
    const knownStatuses = new Set<string>(PIPELINE_STAGES);
    const unknownCount = searchFilteredCandidates.filter(c => !knownStatuses.has(c.status)).length;
    counts['applied'] = (counts['applied'] || 0) + unknownCount;
    return counts;
  }, [searchFilteredCandidates]);

  // Filter by selected stage
  const filteredCandidates = useMemo(() => {
    if (selectedStage === 'all') return searchFilteredCandidates;

    return searchFilteredCandidates.filter(c => {
      if (c.status === selectedStage) return true;
      // Include unknown statuses in 'applied' (displayed as "Новый")
      if (selectedStage === 'applied' && !(PIPELINE_STAGES as readonly string[]).includes(c.status)) {
        return true;
      }
      return false;
    });
  }, [searchFilteredCandidates, selectedStage]);

  // Group candidates by ApplicationStage for Kanban view
  // Maps EntityStatus -> ApplicationStage for grouping
  const candidatesByStatus = useMemo(() => {
    const grouped: Record<ApplicationStage, Entity[]> = {} as Record<ApplicationStage, Entity[]>;
    PIPELINE_STAGES.forEach(stage => {
      grouped[stage] = [];
    });
    searchFilteredCandidates.forEach(candidate => {
      // Convert EntityStatus to ApplicationStage for display
      const entityStatus = candidate.status as EntityStatus;
      const stage = STATUS_TO_STAGE_MAP[entityStatus] || 'applied';
      if (grouped[stage]) {
        grouped[stage].push(candidate);
      } else {
        grouped['applied'].push(candidate);  // Unknown statuses go to 'applied' (displayed as "Новый")
      }
    });
    return grouped;
  }, [searchFilteredCandidates]);

  // Get all unique tags from candidates
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    entities.forEach(c => c.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [entities]);

  // Get open vacancies for drag & drop
  const openVacancies = useMemo(() => {
    return vacancies.filter(v => v.status === 'open' || v.status === 'paused' || v.status === 'draft');
  }, [vacancies]);

  // Handlers - Vacancy drag
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

  // Handlers - Kanban stage drag
  const handleKanbanDragStart = (candidate: Entity) => {
    setDraggedForKanban(candidate);
    setDraggedCandidate(candidate); // Allow dragging to vacancies sidebar
  };

  const isMovingRef = useRef(false);

  const handleKanbanDragEnd = async (_e?: React.DragEvent | unknown, targetStage?: ApplicationStage) => {
    stopAutoScroll();

    // Use targetStage from onDrop event if available, otherwise use state
    const finalStage = targetStage || dropTargetStage;

    // Capture current dragged item before clearing state
    const itemToMove = draggedForKanban;

    // Reset drag state immediately to prevent double calls and UI flickering
    setDraggedForKanban(null);
    setDraggedCandidate(null);
    setDropTargetStage(null);

    if (itemToMove && finalStage && !isMovingRef.current) {
      // Convert ApplicationStage to EntityStatus for API call
      const entityStatus = STAGE_TO_STATUS_MAP[finalStage];

      // Check if status actually changed
      if (itemToMove.status === entityStatus) {
        return;
      }

      isMovingRef.current = true;
      try {
        logger.log(`[Kanban] Moving ${itemToMove.name} from ${itemToMove.status} to ${entityStatus}`);
        await updateEntityStatus(itemToMove.id, entityStatus);
        toast.success(`${itemToMove.name} → ${STATUS_LABELS[entityStatus]}`);
        fetchEntities();
      } catch (error) {
        logger.error('[Kanban] Move failed:', error);
        toast.error('Не удалось изменить статус');
      } finally {
        isMovingRef.current = false;
      }
    }
  };

  const handleStageDragOver = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    if (draggedForKanban) {
      setDropTargetStage(stage);
    }
  };

  const handleStageDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!currentTarget.contains(relatedTarget)) {
      setDropTargetStage(null);
    }
  };

  const handleStageDrop = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    e.stopPropagation();
    handleKanbanDragEnd(e, stage);
  };

  // Auto-scroll for kanban view
  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current !== null) {
      cancelAnimationFrame(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
    scrollDirectionRef.current = 0;
  }, []);

  const startAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current !== null) return;

    const scroll = () => {
      if (kanbanContainerRef.current && scrollDirectionRef.current !== 0) {
        kanbanContainerRef.current.scrollLeft += AUTO_SCROLL_SPEED * scrollDirectionRef.current;
        autoScrollIntervalRef.current = requestAnimationFrame(scroll);
      } else {
        stopAutoScroll();
      }
    };
    autoScrollIntervalRef.current = requestAnimationFrame(scroll);
  }, [stopAutoScroll]);

  const handleKanbanBoardDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!kanbanContainerRef.current || (!draggedForKanban && !draggedCandidate)) return;

    const board = kanbanContainerRef.current;
    const rect = board.getBoundingClientRect();
    const mouseX = e.clientX;

    const distanceFromLeft = mouseX - rect.left;
    const distanceFromRight = rect.right - mouseX;

    let newDirection = 0;
    if (distanceFromLeft < AUTO_SCROLL_THRESHOLD) {
      newDirection = -1 * (1 - Math.max(0, distanceFromLeft) / AUTO_SCROLL_THRESHOLD);
    } else if (distanceFromRight < AUTO_SCROLL_THRESHOLD) {
      newDirection = 1 * (1 - Math.max(0, distanceFromRight) / AUTO_SCROLL_THRESHOLD);
    }

    if (newDirection !== 0) {
      scrollDirectionRef.current = newDirection;
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  }, [draggedForKanban, draggedCandidate, startAutoScroll, stopAutoScroll]);

  useEffect(() => {
    return () => {
      if (autoScrollIntervalRef.current !== null) {
        cancelAnimationFrame(autoScrollIntervalRef.current);
      }
    };
  }, []);

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
        fetchEntities();
      }
      if (result.failed > 0) {
        toast.error(`Не удалось импортировать ${result.failed} файлов`);
      }
    } catch (err) {
      logger.error('Bulk import error:', err);
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
      month: 'short'
    });
  };

  // Quick status change handler for cards/list view (with double-click protection)
  const handleQuickStatusChange = async (candidate: Entity, newStatus: EntityStatus) => {
    // Prevent double-click
    if (movingCandidates.has(candidate.id)) return;

    setMovingCandidates(prev => new Set(prev).add(candidate.id));
    try {
      await updateEntityStatus(candidate.id, newStatus);
      toast.success(`${candidate.name} → ${STATUS_LABELS[newStatus]}`);
      fetchEntities();
    } catch (error) {
      logger.error('Status change failed:', error);
      toast.error('Не удалось изменить статус');
    } finally {
      setMovingCandidates(prev => {
        const next = new Set(prev);
        next.delete(candidate.id);
        return next;
      });
    }
  };

  // Check if a candidate is currently being moved
  const isMovingCandidate = (id: number) => movingCandidates.has(id);

  // Render candidate card
  const renderCandidateCard = (candidate: Entity, isListView: boolean = false) => {
    const mappedStage = STATUS_TO_STAGE_MAP[candidate.status as EntityStatus] || candidate.status;
    const currentStageIndex = (PIPELINE_STAGES as readonly string[]).indexOf(mappedStage as ApplicationStage);
    const nextStage = currentStageIndex >= 0 && currentStageIndex < PIPELINE_STAGES.length - 1
      ? PIPELINE_STAGES[currentStageIndex + 1]
      : null;

    if (isListView) {
      return (
        <motion.div
          key={candidate.id}
          layout
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: draggedCandidate?.id === candidate.id ? 0.5 : 1 }}
          exit={{ opacity: 0, y: -5 }}
          draggable
          onDragStart={() => handleDragStart(candidate)}
          onDragEnd={handleDragEnd}
          onClick={() => handleCandidateClick(candidate)}
          className={clsx(
            'flex items-center gap-4 p-3 bg-white/5 hover:bg-white/10 border rounded-lg cursor-pointer transition-all group',
            selectedCandidates.has(candidate.id) ? 'border-purple-500 bg-purple-500/10' : 'border-white/10'
          )}
        >
          <button
            onClick={(e) => handleToggleSelect(candidate.id, e)}
            className={clsx(
              'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
              selectedCandidates.has(candidate.id) ? 'bg-purple-600 border-purple-600' : 'border-white/20 hover:border-white/40'
            )}
          >
            {selectedCandidates.has(candidate.id) && <Check className="w-3 h-3" />}
          </button>
          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-sm flex-shrink-0">
            {getAvatarInitials(candidate.name || 'UK')}
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
            <div className="min-w-0">
              <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
              {candidate.position && <p className="text-xs text-white/50 truncate">{candidate.position}</p>}
            </div>
            <div className="text-xs text-white/60 space-y-0.5 min-w-0 hidden sm:block">
              {candidate.email && (
                <div className="flex items-center gap-1.5 truncate">
                  <Mail className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{candidate.email}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={clsx('px-2 py-1 text-xs rounded-full', STATUS_COLORS[candidate.status as EntityStatus] || 'bg-white/10')}>
                {STATUS_LABELS[candidate.status as EntityStatus] || candidate.status}
              </span>
              {nextStage && (
                <button
                  disabled={isMovingCandidate(candidate.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQuickStatusChange(candidate, STAGE_TO_STATUS_MAP[nextStage]);
                  }}
                  className={clsx(
                    "opacity-0 group-hover:opacity-100 px-2 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-full transition-all",
                    isMovingCandidate(candidate.id) && "!opacity-50 cursor-not-allowed"
                  )}
                >
                  {isMovingCandidate(candidate.id) ? '...' : `→ ${STATUS_LABELS[STAGE_TO_STATUS_MAP[nextStage]]}`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 items-center hidden lg:flex">
              {candidate.tags?.slice(0, 3).map(tag => (
                <span key={tag} className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/60">{tag}</span>
              ))}
              {(candidate.tags?.length || 0) > 3 && <span className="text-xs text-white/40">+{candidate.tags!.length - 3}</span>}
            </div>
          </div>
          <div className="text-xs hidden sm:block flex-shrink-0 min-w-[100px]">
            {candidate.vacancies_count && candidate.vacancies_count > 0 ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                {candidate.vacancies_count}
              </span>
            ) : (
              <span className="text-white/30 flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                --
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-white/40 flex-shrink-0">
            <Clock className="w-3 h-3" />
            {formatDate(candidate.created_at)}
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        key={candidate.id}
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        draggable
        onDragStart={() => handleDragStart(candidate)}
        onDragEnd={handleDragEnd}
        onClick={() => handleCandidateClick(candidate)}
        className={clsx(
          'p-3 bg-white/5 hover:bg-white/10 border rounded-xl cursor-pointer transition-all group overflow-hidden',
          selectedCandidates.has(candidate.id) ? 'border-purple-500 bg-purple-500/10' : 'border-white/10'
        )}
      >
        <div className="flex items-start gap-2 mb-2">
          <button
            onClick={(e) => handleToggleSelect(candidate.id, e)}
            className={clsx(
              'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors mt-0.5',
              selectedCandidates.has(candidate.id) ? 'bg-purple-600 border-purple-600' : 'border-white/20 hover:border-white/40'
            )}
          >
            {selectedCandidates.has(candidate.id) && <Check className="w-3 h-3" />}
          </button>
          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-sm flex-shrink-0">
            {getAvatarInitials(candidate.name || 'UK')}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
            {candidate.position && <p className="text-xs text-white/50 truncate">{candidate.position}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2 ml-7">
          <span className={clsx('px-2 py-0.5 text-xs rounded-full', STATUS_COLORS[candidate.status as EntityStatus] || 'bg-white/10')}>
            {STATUS_LABELS[candidate.status as EntityStatus] || candidate.status}
          </span>
          {nextStage && (
            <button
              disabled={isMovingCandidate(candidate.id)}
              onClick={(e) => {
                e.stopPropagation();
                handleQuickStatusChange(candidate, STAGE_TO_STATUS_MAP[nextStage]);
              }}
              className={clsx(
                "opacity-0 group-hover:opacity-100 px-2 py-0.5 text-xs bg-white/10 hover:bg-white/20 rounded-full transition-all",
                isMovingCandidate(candidate.id) && "!opacity-50 cursor-not-allowed"
              )}
            >
              {isMovingCandidate(candidate.id) ? '...' : `→ ${STATUS_LABELS[STAGE_TO_STATUS_MAP[nextStage]]}`}
            </button>
          )}
        </div>
        <div className="space-y-1 text-xs text-white/60 ml-7">
          {candidate.email && (
            <div className="flex items-center gap-1.5 truncate">
              <Mail className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{candidate.email}</span>
            </div>
          )}
          {candidate.phone && (
            <div className="flex items-center gap-1.5 truncate">
              <Phone className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{candidate.phone}</span>
            </div>
          )}
          {(candidate.expected_salary_min || candidate.expected_salary_max) && (
            <div className="flex items-center gap-1.5 text-green-400">
              <DollarSign className="w-3 h-3 flex-shrink-0" />
              <span>
                {formatSalary(candidate.expected_salary_min, candidate.expected_salary_max, candidate.expected_salary_currency)}
              </span>
            </div>
          )}
        </div>
        {candidate.tags && candidate.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 ml-7">
            {candidate.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/60 truncate max-w-[80px]">{tag}</span>
            ))}
            {candidate.tags.length > 3 && <span className="text-xs text-white/40">+{candidate.tags.length - 3}</span>}
          </div>
        )}
        <div className="mt-2 ml-7 text-xs">
          {candidate.vacancies_count && candidate.vacancies_count > 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Briefcase className="w-3 h-3" />
              <span className="truncate">
                {candidate.vacancy_names?.slice(0, 2).join(', ')}
                {candidate.vacancies_count > 2 && ` +${candidate.vacancies_count - 2}`}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-white/30">
              <Briefcase className="w-3 h-3" />
              <span>Без вакансии</span>
            </div>
          )}
        </div>
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
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap">
            <Users className="w-6 h-6 text-purple-400" />
            База кандидатов
            <span className="text-sm font-medium text-white/40 bg-white/5 px-2 py-0.5 rounded-full ml-1">
              {isLoading ? '...' : (typeCounts?.candidate || entities.length)}
            </span>
          </h2>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {selectedCandidates.size > 0 && (
              <button
                onClick={() => setShowAddToVacancyModal(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-xl text-sm font-medium transition-all shadow-lg shadow-purple-900/20 active:scale-95 whitespace-nowrap"
              >
                <Briefcase className="w-4 h-4" />
                <span>В вакансию</span>
                <span className="opacity-60">({selectedCandidates.size})</span>
              </button>
            )}
            <button
              onClick={() => setShowParserModal(true)}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all active:scale-95 whitespace-nowrap"
            >
              <Upload className="w-4 h-4 text-purple-400" />
              <span>Резюме</span>
            </button>
            <label className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all cursor-pointer active:scale-95 whitespace-nowrap">
              <FolderArchive className="w-4 h-4 text-blue-400" />
              <span>ZIP</span>
              <input ref={bulkImportInputRef} type="file" accept=".zip" onChange={handleBulkImport} className="hidden" />
            </label>
            <button
              onClick={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
              className="group flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-900/20 active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
              <span>Добавить</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
          <button
            onClick={() => setSelectedStage('all')}
            className={clsx(
              'px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-95',
              selectedStage === 'all' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
            )}
          >
            Все ({stageCounts.all})
          </button>
          {PIPELINE_STAGES.map(stage => (
            <button
              key={stage}
              onClick={() => setSelectedStage(stage)}
              className={clsx(
                'px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-95',
                selectedStage === stage ? `${STATUS_COLORS[stage]} shadow-lg` : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
              )}
            >
              {STATUS_LABELS[stage]} ({stageCounts[stage] || 0})
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-purple-400 transition-colors" />
            <input
              type="text"
              placeholder="Поиск по имени, email, навыкам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/50 focus:bg-white/10 text-sm transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-all active:scale-95 whitespace-nowrap',
                selectedTags.length > 0 ? 'bg-purple-600/20 border-purple-500/50 text-purple-300' : 'bg-white/5 border-white/10 hover:bg-white/10'
              )}
            >
              <Filter className="w-4 h-4" />
              <span>Навыки</span>
              {selectedTags.length > 0 && <span className="px-1.5 py-0.5 bg-purple-600 text-white text-[10px] rounded-full">{selectedTags.length}</span>}
            </button>
            {filteredCandidates.length > 0 && viewMode !== 'kanban' && (
              <button
                onClick={handleSelectAll}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-all active:scale-95 whitespace-nowrap',
                  selectedCandidates.size === filteredCandidates.length ? 'bg-purple-600/20 border-purple-500/50 text-purple-300' : 'bg-white/5 border-white/10 hover:bg-white/10'
                )}
              >
                <Check className="w-4 h-4" />
                <span>{selectedCandidates.size === filteredCandidates.length ? 'Снять' : 'Выбрать'}</span>
              </button>
            )}
            <div className="flex items-center bg-white/5 rounded-xl p-1 border border-white/10">
              <button
                onClick={() => setViewMode('cards')}
                className={clsx('p-2 rounded-lg transition-all active:scale-90', viewMode === 'cards' ? 'bg-purple-600 text-white shadow-md' : 'text-white/40 hover:text-white')}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={clsx('p-2 rounded-lg transition-all active:scale-90', viewMode === 'list' ? 'bg-purple-600 text-white shadow-md' : 'text-white/40 hover:text-white')}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={clsx('p-2 rounded-lg transition-all active:scale-90', viewMode === 'kanban' ? 'bg-purple-600 text-white shadow-md' : 'text-white/40 hover:text-white')}
              >
                <Kanban className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {showFilters && allTags.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-3 bg-white/5 rounded-lg border border-white/10 overflow-hidden">
              <div className="flex flex-wrap gap-2">
                {allTags.slice(0, 30).map(tag => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                    className={clsx('px-2.5 py-1 text-xs rounded-full border transition-colors', selectedTags.includes(tag) ? 'bg-purple-600/20 border-purple-500/50 text-purple-300' : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70')}
                  >
                    {tag}
                  </button>
                ))}
                {allTags.length > 30 && <span className="px-2.5 py-1 text-xs text-white/40">+{allTags.length - 30} ещё</span>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {isLoading && entities.length === 0 ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} variant="rounded" className="h-48 w-full" />)}
            </div>
          ) : filteredCandidates.length === 0 && viewMode !== 'kanban' ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-white/40">
                <UserCheck className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">{searchQuery || selectedTags.length > 0 ? 'Ничего не найдено' : 'Нет кандидатов'}</h3>
                <p className="text-sm mb-4">{searchQuery || selectedTags.length > 0 ? 'Попробуйте изменить параметры поиска' : 'Добавьте первого кандидата в базу'}</p>
                <button onClick={() => { setPrefillData(null); setShowCreateModal(true); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors">Добавить кандидата</button>
              </div>
            </div>
          ) : viewMode === 'kanban' ? (
            <div ref={kanbanContainerRef} className="h-full overflow-x-auto" onDragOver={handleKanbanBoardDragOver} onDragLeave={stopAutoScroll}>
              <div className="flex gap-3 h-full min-w-max p-1">
                {PIPELINE_STAGES.map(stage => (
                  <div
                    key={stage}
                    onDragOver={(e) => handleStageDragOver(e, stage)}
                    onDragLeave={handleStageDragLeave}
                    onDrop={(e) => handleStageDrop(e, stage)}
                    className={clsx(
                      'w-72 flex-shrink-0 flex flex-col bg-white/5 rounded-xl border transition-all',
                      dropTargetStage === stage
                        ? 'border-purple-500 bg-purple-500/10 scale-[1.02]'
                        : 'border-white/10'
                    )}
                  >
                    {/* Column Header */}
                    <div className={clsx('p-3 border-b border-white/10 rounded-t-xl', STATUS_COLORS[stage])}>
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">{STATUS_LABELS[stage]}</h3>
                        <span className="text-xs px-2 py-0.5 bg-black/20 rounded-full">{candidatesByStatus[stage]?.length || 0}</span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {candidatesByStatus[stage]?.map(candidate => (
                        <div key={candidate.id} draggable onDragStart={() => handleKanbanDragStart(candidate)} onDragEnd={() => handleKanbanDragEnd()} onClick={() => handleCandidateClick(candidate)} className={clsx('p-3 bg-gray-800/50 hover:bg-gray-800 border border-white/10 rounded-lg cursor-grab active:cursor-grabbing transition-all group', draggedForKanban?.id === candidate.id && 'opacity-50 scale-95')}>
                          <div className="flex items-start gap-2">
                            <GripVertical className="w-4 h-4 text-white/20 flex-shrink-0 mt-1" />
                            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium text-xs flex-shrink-0">{getAvatarInitials(candidate.name || 'UK')}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-medium text-sm truncate">{candidate.name}</h4>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <ExternalLink className="w-3.5 h-3.5 text-white/40" />
                                </div>
                              </div>
                              {candidate.position && <p className="text-xs text-white/50 truncate">{candidate.position}</p>}
                            </div>
                          </div>
                          {candidate.tags && candidate.tags.length > 0 && (
                            <div className="mt-2 ml-6 flex flex-wrap gap-1">
                              {candidate.tags.slice(0, 2).map(tag => <span key={tag} className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/50 truncate max-w-[70px]">{tag}</span>)}
                              {candidate.tags.length > 2 && <span className="text-xs text-white/30">+{candidate.tags.length - 2}</span>}
                            </div>
                          )}
                          <div className="mt-1.5 ml-6 flex items-center justify-between text-xs text-white/40">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3" />
                              {formatDate(candidate.created_at)}
                            </div>
                            {(() => {
                              const currentIndex = PIPELINE_STAGES.indexOf(stage as any);
                              const nStage = currentIndex >= 0 && currentIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentIndex + 1] : null;
                              return nStage && (
                                <button
                                  disabled={isMovingCandidate(candidate.id)}
                                  onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(candidate, STAGE_TO_STATUS_MAP[nStage]); }}
                                  className={clsx("hover:text-white transition-colors", isMovingCandidate(candidate.id) && "opacity-50 cursor-not-allowed")}
                                >
                                  {isMovingCandidate(candidate.id) ? '...' : '→'}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === 'list' ? (
            <div className="space-y-2">
              {filteredCandidates.map(candidate => renderCandidateCard(candidate, true))}
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredCandidates.map(candidate => renderCandidateCard(candidate, false))}
            </div>
          )}
        </div>

        <AnimatePresence>
          {draggedCandidate && openVacancies.length > 0 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="w-64 border-l border-white/10 bg-gray-900/80 p-3 overflow-y-auto">
              <div className="flex items-center gap-2 mb-3 text-sm text-white/60">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>Отпустите на вакансию</span>
              </div>
              <div className="space-y-2">
                {openVacancies.map(vacancy => (
                  <div key={vacancy.id} onDragOver={(e) => handleVacancyDragOver(e, vacancy.id)} onDragLeave={handleVacancyDragLeave} onDrop={handleDragEnd} className={clsx('p-3 rounded-lg border-2 border-dashed transition-all', dropTargetVacancy === vacancy.id ? 'border-purple-500 bg-purple-500/20 scale-105' : 'border-white/20 hover:border-white/30')}>
                    <h4 className="font-medium text-sm truncate">{vacancy.title}</h4>
                    <p className="text-xs text-white/40 mt-1">{vacancy.applications_count} кандидатов</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showCreateModal && <ContactForm prefillData={prefillData || undefined} defaultType="candidate" onClose={() => { setShowCreateModal(false); setPrefillData(null); }} onSuccess={() => { setShowCreateModal(false); setPrefillData(null); fetchEntities(); toast.success('Кандидат создан'); }} />}
        {showParserModal && <ParserModal type="resume" onClose={() => setShowParserModal(false)} onParsed={(data) => handleParsedResume(data as ParsedResume)} />}
        {showAddToVacancyModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAddToVacancyModal(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-gray-900 rounded-xl border border-white/10 shadow-xl overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold">Выберите вакансию</h3>
                <button onClick={() => setShowAddToVacancyModal(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
                {openVacancies.length === 0 ? <div className="text-center py-8 text-white/40"><Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" /><p className="text-sm">Нет открытых вакансий</p></div> : openVacancies.map(vacancy => (
                  <button key={vacancy.id} onClick={() => handleBulkAddToVacancy(vacancy.id)} className="w-full p-3 text-left bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors">
                    <h4 className="font-medium">{vacancy.title}</h4>
                    <p className="text-xs text-white/40 mt-1">{vacancy.department_name && `${vacancy.department_name} • `}{vacancy.applications_count} кандидатов</p>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
        {showBulkImportModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeBulkImportModal}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2"><FolderArchive className="w-5 h-5 text-purple-400" />Массовый импорт резюме</h3>
                {!bulkImportLoading && <button onClick={closeBulkImportModal} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>}
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
                    <div className="mt-4 p-4 bg-white/5 rounded-lg border border-white/10 space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg text-center">
                          <div className="text-2xl font-bold text-emerald-400">{bulkImportResult.successful}</div>
                          <div className="text-xs text-white/40">Успешно</div>
                        </div>
                        <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg text-center">
                          <div className="text-2xl font-bold text-rose-400">{bulkImportResult.failed}</div>
                          <div className="text-xs text-white/40">Ошибок</div>
                        </div>
                      </div>
                      {bulkImportResult.results && bulkImportResult.results.filter(r => !r.success).length > 0 && (
                        <div className="space-y-1.5 max-h-40 overflow-auto pr-2">
                          {bulkImportResult.results.filter(r => !r.success).map((result, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-xs text-rose-400 bg-rose-400/5 p-2 rounded">
                              <XCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{result.filename}</p>
                                <p className="opacity-70">{result.error || 'Ошибка импорта'}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {bulkImportResult.results && bulkImportResult.results.length > 0 && (
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {bulkImportResult.results.map((result, index) => (
                          <div key={index} className={clsx('flex items-center gap-3 p-3 rounded-lg border', result.success ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30')}>
                            {result.success ? <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{result.entity_name || result.filename}</p>
                              {result.error && <p className="text-xs text-red-400 truncate">{result.error}</p>}
                            </div>
                            {result.entity_id && <button onClick={() => { closeBulkImportModal(); navigate(`/contacts/${result.entity_id}`); }} className="text-xs text-blue-400 hover:text-blue-300">Открыть</button>}
                          </div>
                        ))}
                      </div>
                    )}
                    {bulkImportResult.error && <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-center"><p className="text-sm text-rose-400">{bulkImportResult.error}</p></div>}
                    <button onClick={closeBulkImportModal} className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all active:scale-95">Закрыть</button>
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
