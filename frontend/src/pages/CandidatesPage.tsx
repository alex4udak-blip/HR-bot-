import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  UserCheck,
  Phone,
  Mail,
  Upload,
  Edit,
  Trash2,
  Briefcase,
  LayoutGrid,
  List,
  Users,
  ChevronRight,
  Star,
  Clock,
  ExternalLink,
  GripVertical
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Entity, Vacancy, VacancyApplication, ApplicationStage } from '@/types';
import {
  PIPELINE_STAGES,
  APPLICATION_STAGE_LABELS,
  APPLICATION_STAGE_COLORS,
  VACANCY_STATUS_LABELS,
  VACANCY_STATUS_COLORS
} from '@/types';
import type { ParsedResume } from '@/services/api';
import ContactForm from '@/components/contacts/ContactForm';
import ParserModal from '@/components/parser/ParserModal';
import VacancyForm from '@/components/vacancies/VacancyForm';
import AddCandidateModal from '@/components/vacancies/AddCandidateModal';
import ApplicationDetailModal from '@/components/vacancies/ApplicationDetailModal';
import { ConfirmDialog, ErrorMessage, Skeleton } from '@/components/ui';
import { OnboardingTooltip } from '@/components/onboarding';

// View modes
type ViewMode = 'list' | 'kanban';

// Stage tabs for filtering
const ALL_STAGES_TAB = 'all';

export default function CandidatesPage() {
  const navigate = useNavigate();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [selectedVacancyId, setSelectedVacancyId] = useState<number | null>(null);
  const [selectedStage, setSelectedStage] = useState<ApplicationStage | typeof ALL_STAGES_TAB>(ALL_STAGES_TAB);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // UI State
  const [showCreateCandidateModal, setShowCreateCandidateModal] = useState(false);
  const [showCreateVacancyModal, setShowCreateVacancyModal] = useState(false);
  const [showAddToVacancyModal, setShowAddToVacancyModal] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<Entity | null>(null);
  const [showParserModal, setShowParserModal] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<Entity> | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<VacancyApplication | null>(null);

  // Drag state for kanban
  const [draggedApp, setDraggedApp] = useState<VacancyApplication | null>(null);
  const [dropTargetStage, setDropTargetStage] = useState<ApplicationStage | null>(null);

  // Confirmation dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    candidate: Entity | null;
    application: VacancyApplication | null;
    type: 'delete_candidate' | 'delete_application';
  }>({ open: false, candidate: null, application: null, type: 'delete_candidate' });
  const [actionLoading, setActionLoading] = useState(false);

  // Stores
  const {
    deleteEntity,
    setFilters
  } = useEntityStore();

  const {
    vacancies,
    kanbanBoard,
    kanbanLoading,
    loading: vacanciesLoading,
    error: vacanciesError,
    fetchVacancies,
    fetchKanbanBoard,
    moveApplication,
    removeApplication
  } = useVacancyStore();

  // Open vacancies only
  const openVacancies = useMemo(() => {
    return vacancies.filter(v => v.status === 'open' || v.status === 'paused');
  }, [vacancies]);

  // Current vacancy
  const currentVacancy = useMemo(() => {
    return vacancies.find(v => v.id === selectedVacancyId) || null;
  }, [vacancies, selectedVacancyId]);

  // Filter applications by selected stage
  const filteredApplications = useMemo(() => {
    if (!kanbanBoard) return [];

    const allApps = kanbanBoard.columns.flatMap(col => col.applications);

    if (selectedStage === ALL_STAGES_TAB) {
      return allApps;
    }

    return allApps.filter(app => app.stage === selectedStage);
  }, [kanbanBoard, selectedStage]);

  // Get stage counts
  const stageCounts = useMemo(() => {
    if (!kanbanBoard) return {};

    const counts: Record<string, number> = { all: kanbanBoard.total_count };
    kanbanBoard.columns.forEach(col => {
      counts[col.stage] = col.count;
    });

    return counts;
  }, [kanbanBoard]);

  // Load data on mount
  useEffect(() => {
    fetchVacancies();
    setFilters({ type: 'candidate' });
  }, [fetchVacancies, setFilters]);

  // Load kanban when vacancy selected
  useEffect(() => {
    if (selectedVacancyId) {
      fetchKanbanBoard(selectedVacancyId);
    }
  }, [selectedVacancyId, fetchKanbanBoard]);

  // Select first vacancy if none selected
  useEffect(() => {
    if (!selectedVacancyId && openVacancies.length > 0) {
      setSelectedVacancyId(openVacancies[0].id);
    }
  }, [selectedVacancyId, openVacancies]);

  // Drag handlers
  const handleDragStart = (app: VacancyApplication) => {
    setDraggedApp(app);
  };

  const handleDragEnd = async () => {
    if (draggedApp && dropTargetStage && dropTargetStage !== draggedApp.stage) {
      try {
        await moveApplication(draggedApp.id, dropTargetStage);
        toast.success(`Кандидат перемещён в "${APPLICATION_STAGE_LABELS[dropTargetStage]}"`);
      } catch {
        toast.error('Ошибка при перемещении');
      }
    }
    setDraggedApp(null);
    setDropTargetStage(null);
  };

  const handleColumnDragOver = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    if (draggedApp) {
      setDropTargetStage(stage);
    }
  };

  const handleColumnDragLeave = () => {
    setDropTargetStage(null);
  };

  // Other handlers
  const handleVacancySelect = (vacancyId: number) => {
    setSelectedVacancyId(vacancyId);
    setSelectedStage(ALL_STAGES_TAB);
  };

  const handleApplicationClick = (app: VacancyApplication) => {
    setSelectedApplication(app);
  };

  const handleViewCandidateProfile = (app: VacancyApplication) => {
    navigate(`/contacts/${app.entity_id}`);
  };

  const handleDeleteApplication = (app: VacancyApplication) => {
    setConfirmDialog({ open: true, candidate: null, application: app, type: 'delete_application' });
  };

  const handleConfirmDelete = async () => {
    setActionLoading(true);
    try {
      if (confirmDialog.type === 'delete_candidate' && confirmDialog.candidate) {
        await deleteEntity(confirmDialog.candidate.id);
        toast.success('Кандидат удален');
      } else if (confirmDialog.type === 'delete_application' && confirmDialog.application) {
        await removeApplication(confirmDialog.application.id);
        toast.success('Кандидат удалён из вакансии');
      }
      setConfirmDialog({ open: false, candidate: null, application: null, type: 'delete_candidate' });
    } catch {
      toast.error('Ошибка при удалении');
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
    setShowCreateCandidateModal(true);
    toast.success('Данные распознаны');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short'
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

  // Render vacancy sidebar item
  const renderVacancyItem = (vacancy: Vacancy) => {
    const isSelected = vacancy.id === selectedVacancyId;

    return (
      <button
        key={vacancy.id}
        onClick={() => handleVacancySelect(vacancy.id)}
        className={clsx(
          'w-full text-left p-3 rounded-lg border transition-all duration-200',
          isSelected
            ? 'bg-cyan-500/20 border-cyan-500/50'
            : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className={clsx('font-medium truncate text-sm', isSelected && 'text-cyan-300')}>
              {vacancy.title}
            </h4>
            {vacancy.department_name && (
              <p className="text-xs text-white/40 truncate mt-0.5">{vacancy.department_name}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={clsx('text-xs px-1.5 py-0.5 rounded', VACANCY_STATUS_COLORS[vacancy.status])}>
              {VACANCY_STATUS_LABELS[vacancy.status]}
            </span>
            <span className="text-xs text-white/40">
              {vacancy.applications_count} канд.
            </span>
          </div>
        </div>
      </button>
    );
  };

  // Render kanban card
  const renderKanbanCard = (app: VacancyApplication) => (
    <motion.div
      key={app.id}
      layout
      draggable
      onDragStart={() => handleDragStart(app)}
      onDragEnd={handleDragEnd}
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: draggedApp?.id === app.id ? 0.5 : 1,
        y: 0,
        scale: draggedApp?.id === app.id ? 0.98 : 1
      }}
      className={clsx(
        'p-3 bg-gray-800 rounded-lg border cursor-grab active:cursor-grabbing',
        'hover:border-white/30 transition-all duration-200 group',
        draggedApp?.id === app.id
          ? 'border-cyan-500/50 shadow-lg'
          : 'border-white/10'
      )}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GripVertical className="w-4 h-4 text-white/30 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h4 className="font-medium truncate text-sm">{app.entity_name}</h4>
            {app.entity_position && (
              <p className="text-xs text-white/40 truncate">{app.entity_position}</p>
            )}
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleApplicationClick(app);
            }}
            className="p-1 hover:bg-white/10 rounded"
            title="Детали"
          >
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleViewCandidateProfile(app);
            }}
            className="p-1 hover:bg-white/10 rounded"
            title="Профиль"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteApplication(app);
            }}
            className="p-1 hover:bg-red-500/20 text-red-400 rounded"
            title="Удалить"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-1 text-xs text-white/60 ml-6">
        {app.entity_email && (
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{app.entity_email}</span>
          </div>
        )}
        {app.entity_phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="w-3 h-3 flex-shrink-0" />
            <span>{app.entity_phone}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 ml-6">
        <div className="flex items-center gap-2">
          {app.rating && (
            <div className="flex items-center gap-0.5 text-yellow-400">
              <Star className="w-3 h-3 fill-current" />
              <span className="text-xs">{app.rating}</span>
            </div>
          )}
          {app.source && (
            <span className="text-xs px-1.5 py-0.5 bg-white/5 rounded text-white/40">
              {app.source}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-white/40">
          <Clock className="w-3 h-3" />
          {formatDate(app.applied_at)}
        </div>
      </div>

      {/* Notes Preview */}
      {app.notes && (
        <div className="mt-2 p-2 bg-white/5 rounded text-xs text-white/60 line-clamp-2 ml-6">
          {app.notes}
        </div>
      )}
    </motion.div>
  );

  // Render kanban column
  const renderKanbanColumn = (stage: ApplicationStage) => {
    const column = kanbanBoard?.columns.find(c => c.stage === stage);
    const apps = column?.applications || [];
    const isDropTarget = dropTargetStage === stage && draggedApp?.stage !== stage;

    return (
      <div
        key={stage}
        className={clsx(
          'w-72 flex-shrink-0 flex flex-col rounded-xl border transition-all duration-200',
          isDropTarget
            ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/20'
            : 'border-white/10 bg-white/5'
        )}
        onDragOver={(e) => handleColumnDragOver(e, stage)}
        onDragLeave={handleColumnDragLeave}
        onDrop={handleDragEnd}
      >
        {/* Column Header */}
        <div className={clsx(
          'p-3 border-b border-white/10 flex items-center justify-between',
          APPLICATION_STAGE_COLORS[stage]
        )}>
          <div className="flex items-center gap-2">
            <span className="font-medium">{APPLICATION_STAGE_LABELS[stage]}</span>
            <span className="text-xs px-2 py-0.5 bg-black/20 rounded-full">
              {apps.length}
            </span>
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          <AnimatePresence mode="popLayout">
            {apps.map(app => renderKanbanCard(app))}
          </AnimatePresence>

          {/* Empty state */}
          {apps.length === 0 && !isDropTarget && (
            <div className="h-24 flex flex-col items-center justify-center text-white/20 text-sm">
              <Users className="w-6 h-6 mb-1" />
              <span>Пусто</span>
            </div>
          )}

          {/* Drop zone indicator */}
          {apps.length === 0 && isDropTarget && (
            <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed border-cyan-500/50 rounded-lg text-cyan-400 text-sm">
              <span>Отпустите здесь</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full max-w-full flex overflow-hidden">
      {/* Vacancy Sidebar */}
      <div className={clsx(
        'flex flex-col border-r border-white/10 bg-gray-900/50 transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-72'
      )}>
        {/* Sidebar Header */}
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-cyan-400" />
              <span className="font-medium">Вакансии</span>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ChevronRight className={clsx(
              'w-4 h-4 transition-transform',
              sidebarCollapsed ? '' : 'rotate-180'
            )} />
          </button>
        </div>

        {/* Sidebar Content */}
        {!sidebarCollapsed && (
          <>
            {/* Add Vacancy Button */}
            <div className="p-3 border-b border-white/10">
              <button
                onClick={() => setShowCreateVacancyModal(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Новая вакансия
              </button>
            </div>

            {/* Vacancies List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {vacanciesLoading && vacancies.length === 0 ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} variant="rounded" className="h-20 w-full" />
                  ))}
                </div>
              ) : openVacancies.length === 0 ? (
                <div className="text-center py-8 text-white/40">
                  <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Нет открытых вакансий</p>
                  <button
                    onClick={() => setShowCreateVacancyModal(true)}
                    className="mt-2 text-cyan-400 text-sm hover:underline"
                  >
                    Создать вакансию
                  </button>
                </div>
              ) : (
                openVacancies.map(vacancy => renderVacancyItem(vacancy))
              )}
            </div>
          </>
        )}

        {/* Collapsed state icons */}
        {sidebarCollapsed && (
          <div className="flex-1 flex flex-col items-center py-3 space-y-2">
            <button
              onClick={() => setShowCreateVacancyModal(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              title="Новая вакансия"
            >
              <Plus className="w-5 h-5 text-cyan-400" />
            </button>
            {openVacancies.slice(0, 5).map(vacancy => (
              <button
                key={vacancy.id}
                onClick={() => handleVacancySelect(vacancy.id)}
                className={clsx(
                  'w-10 h-10 rounded-lg flex items-center justify-center text-xs font-medium transition-colors',
                  vacancy.id === selectedVacancyId
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'bg-white/5 hover:bg-white/10 text-white/60'
                )}
                title={vacancy.title}
              >
                {vacancy.title.slice(0, 2).toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <OnboardingTooltip
                id="candidates-page"
                content="Управляйте кандидатами по вакансиям, перетаскивайте между этапами"
                position="bottom"
              >
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <UserCheck className="w-6 h-6 text-cyan-400" />
                  {currentVacancy ? currentVacancy.title : 'База кандидатов'}
                </h1>
              </OnboardingTooltip>
              {currentVacancy && (
                <span className="text-sm text-white/40">
                  {kanbanBoard?.total_count || 0} кандидатов
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* View Mode Toggle */}
              <div className="flex items-center bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('kanban')}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    viewMode === 'kanban' ? 'bg-cyan-600 text-white' : 'text-white/60 hover:text-white'
                  )}
                  title="Kanban"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    viewMode === 'list' ? 'bg-cyan-600 text-white' : 'text-white/60 hover:text-white'
                  )}
                  title="Список"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => setShowParserModal(true)}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors"
              >
                <Upload className="w-4 h-4" />
                Загрузить резюме
              </button>

              {currentVacancy && (
                <button
                  onClick={() => setShowAddToVacancyModal(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Добавить кандидата
                </button>
              )}
            </div>
          </div>

          {/* Stage Tabs */}
          {currentVacancy && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedStage(ALL_STAGES_TAB)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors',
                  selectedStage === ALL_STAGES_TAB
                    ? 'bg-cyan-600 text-white'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                )}
              >
                Все ({stageCounts.all || 0})
              </button>
              {PIPELINE_STAGES.map(stage => (
                <button
                  key={stage}
                  onClick={() => setSelectedStage(stage)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors',
                    selectedStage === stage
                      ? APPLICATION_STAGE_COLORS[stage]
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {APPLICATION_STAGE_LABELS[stage]} ({stageCounts[stage] || 0})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {!currentVacancy ? (
            // No vacancy selected - show all candidates
            <div className="h-full flex items-center justify-center text-white/40">
              <div className="text-center">
                <Briefcase className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">Выберите вакансию</h3>
                <p className="text-sm">Выберите вакансию в боковой панели для просмотра кандидатов</p>
                <button
                  onClick={() => setShowCreateVacancyModal(true)}
                  className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white text-sm transition-colors"
                >
                  Создать вакансию
                </button>
              </div>
            </div>
          ) : kanbanLoading ? (
            // Loading
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full" />
            </div>
          ) : vacanciesError ? (
            // Error
            <div className="h-full flex items-center justify-center p-4">
              <ErrorMessage error={vacanciesError} onRetry={() => fetchKanbanBoard(selectedVacancyId!)} />
            </div>
          ) : viewMode === 'kanban' ? (
            // Kanban View
            <div className="h-full overflow-x-auto p-4">
              <div className="flex gap-4 h-full min-w-max">
                {PIPELINE_STAGES.map(stage => renderKanbanColumn(stage))}
              </div>
            </div>
          ) : (
            // List View
            <div className="h-full overflow-auto p-4">
              {filteredApplications.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-white/40">
                  <div className="text-center">
                    <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Нет кандидатов на этом этапе</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredApplications.map(app => (
                    <div
                      key={app.id}
                      onClick={() => handleApplicationClick(app)}
                      className="p-4 bg-white/5 rounded-xl border border-white/10 cursor-pointer hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 font-medium text-sm">
                            {getAvatarInitials(app.entity_name || '')}
                          </div>
                          <div>
                            <h4 className="font-medium">{app.entity_name}</h4>
                            <p className="text-sm text-white/50">{app.entity_position || app.entity_email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={clsx('text-xs px-2 py-1 rounded-full', APPLICATION_STAGE_COLORS[app.stage])}>
                            {APPLICATION_STAGE_LABELS[app.stage]}
                          </span>
                          <span className="text-sm text-white/40">{formatDate(app.applied_at)}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewCandidateProfile(app);
                            }}
                            className="p-2 hover:bg-white/5 rounded-lg text-white/60 hover:text-white"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreateCandidateModal && (
          <ContactForm
            prefillData={prefillData || undefined}
            defaultType="candidate"
            onClose={() => {
              setShowCreateCandidateModal(false);
              setPrefillData(null);
            }}
            onSuccess={() => {
              setShowCreateCandidateModal(false);
              setPrefillData(null);
              toast.success('Кандидат создан');
            }}
          />
        )}

        {editingCandidate && (
          <ContactForm
            entity={editingCandidate}
            defaultType="candidate"
            onClose={() => setEditingCandidate(null)}
            onSuccess={() => {
              setEditingCandidate(null);
              toast.success('Кандидат обновлен');
            }}
          />
        )}

        {showCreateVacancyModal && (
          <VacancyForm
            onClose={() => setShowCreateVacancyModal(false)}
            onSuccess={() => {
              setShowCreateVacancyModal(false);
              fetchVacancies();
              toast.success('Вакансия создана');
            }}
          />
        )}

        {showAddToVacancyModal && selectedVacancyId && (
          <AddCandidateModal
            vacancyId={selectedVacancyId}
            onClose={() => setShowAddToVacancyModal(false)}
          />
        )}

        {selectedApplication && (
          <ApplicationDetailModal
            application={selectedApplication}
            onClose={() => setSelectedApplication(null)}
          />
        )}

        {showParserModal && (
          <ParserModal
            type="resume"
            onClose={() => setShowParserModal(false)}
            onParsed={(data) => handleParsedResume(data as ParsedResume)}
          />
        )}
      </AnimatePresence>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.type === 'delete_application' ? 'Удалить из вакансии' : 'Удалить кандидата'}
        message={
          confirmDialog.type === 'delete_application'
            ? 'Удалить этого кандидата из вакансии? Сам контакт останется в базе.'
            : 'Удалить кандидата? Это действие невозможно отменить.'
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDialog({ open: false, candidate: null, application: null, type: 'delete_candidate' })}
        loading={actionLoading}
      />
    </div>
  );
}
