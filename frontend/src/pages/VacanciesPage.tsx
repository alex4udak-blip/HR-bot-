import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts } from '@/hooks';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Briefcase,
  MapPin,
  DollarSign,
  Clock,
  Users,
  ChevronLeft,
  Edit,
  Trash2,
  LayoutGrid,
  List,
  Upload
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Vacancy, VacancyStatus } from '@/types';
import {
  VACANCY_STATUS_LABELS,
  VACANCY_STATUS_COLORS,
  EMPLOYMENT_TYPES,
  formatSalary
} from '@/types';
import { getDepartments } from '@/services/api';
import type { Department, ParsedVacancy } from '@/services/api';
import VacancyForm from '@/components/vacancies/VacancyForm';
import VacancyDetail from '@/components/vacancies/VacancyDetail';
import KanbanBoard from '@/components/vacancies/KanbanBoard';
import ParserModal from '@/components/parser/ParserModal';
import {
  ContextMenu,
  createVacancyContextMenu,
  NoVacanciesEmpty,
  VacancyCardSkeleton,
  KeyboardShortcuts
} from '@/components/ui';

const STATUS_FILTERS: { id: VacancyStatus | 'all'; name: string }[] = [
  { id: 'all', name: 'Все' },
  { id: 'draft', name: 'Черновики' },
  { id: 'open', name: 'Открытые' },
  { id: 'paused', name: 'На паузе' },
  { id: 'closed', name: 'Закрытые' },
  { id: 'cancelled', name: 'Отменённые' },
];

export default function VacanciesPage() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<number | 'all'>('all');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVacancy, setEditingVacancy] = useState<Vacancy | null>(null);
  const [showParserModal, setShowParserModal] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<Vacancy> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    vacancies,
    currentVacancy,
    loading,
    fetchVacancies,
    fetchVacancy,
    deleteVacancy,
    setFilters,
    clearCurrentVacancy
  } = useVacancyStore();

  // Modal state check for keyboard shortcut handlers
  const isAnyModalOpen = showCreateModal || !!editingVacancy || showParserModal;

  // Keyboard shortcut handlers
  const handleOpenCreateModal = useCallback(() => {
    setPrefillData(null);
    setShowCreateModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    if (showParserModal) {
      setShowParserModal(false);
    } else if (showCreateModal || editingVacancy) {
      setShowCreateModal(false);
      setEditingVacancy(null);
      setPrefillData(null);
    }
  }, [showParserModal, showCreateModal, editingVacancy]);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleToggleKanban = useCallback(() => {
    if (currentVacancy) {
      setViewMode(viewMode === 'list' ? 'kanban' : 'list');
    }
  }, [currentVacancy, viewMode]);

  const handleEditVacancy = useCallback(() => {
    if (currentVacancy && !isAnyModalOpen) {
      setEditingVacancy(currentVacancy);
    }
  }, [currentVacancy, isAnyModalOpen]);

  const handleGoBack = useCallback(() => {
    if (vacancyId && !isAnyModalOpen) {
      navigate('/vacancies');
    }
  }, [vacancyId, isAnyModalOpen, navigate]);

  // Keyboard shortcuts for list view (no vacancy selected)
  useKeyboardShortcuts([
    {
      key: 'n',
      ctrlOrCmd: true,
      handler: handleOpenCreateModal,
      description: 'Open create vacancy modal',
    },
    {
      key: 'Escape',
      handler: handleCloseModal,
      description: 'Close any open modal',
    },
    {
      key: '/',
      handler: handleFocusSearch,
      description: 'Focus search input',
    },
  ], { enabled: !vacancyId || isAnyModalOpen });

  // Keyboard shortcuts for detail view (vacancy selected)
  useKeyboardShortcuts([
    {
      key: 'Escape',
      handler: isAnyModalOpen ? handleCloseModal : handleGoBack,
      description: 'Go back to list or close modal',
    },
    {
      key: 'e',
      handler: handleEditVacancy,
      description: 'Edit vacancy',
    },
    {
      key: 'k',
      handler: handleToggleKanban,
      description: 'Toggle Kanban view',
    },
  ], { enabled: !!vacancyId });

  // Load departments
  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const data = await getDepartments(-1);
        setDepartments(data);
      } catch (error) {
        console.error('Failed to load departments', error);
      }
    };
    loadDepartments();
  }, []);

  // Update filters when search/filters change
  useEffect(() => {
    setFilters({
      search: searchQuery || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      department_id: departmentFilter !== 'all' ? departmentFilter : undefined
    });
  }, [searchQuery, statusFilter, departmentFilter, setFilters]);

  // Fetch vacancies when filters change
  useEffect(() => {
    fetchVacancies();
  }, [fetchVacancies]);

  // Load specific vacancy if URL has vacancyId
  useEffect(() => {
    if (vacancyId) {
      fetchVacancy(parseInt(vacancyId));
    } else {
      clearCurrentVacancy();
    }
  }, [vacancyId, fetchVacancy, clearCurrentVacancy]);

  const handleVacancyClick = (vacancy: Vacancy) => {
    navigate(`/vacancies/${vacancy.id}`);
  };

  const handleBack = () => {
    navigate('/vacancies');
  };

  const handleDelete = async (vacancy: Vacancy) => {
    if (!confirm(`Удалить вакансию "${vacancy.title}"?`)) return;
    try {
      await deleteVacancy(vacancy.id);
      toast.success('Вакансия удалена');
      if (currentVacancy?.id === vacancy.id) {
        navigate('/vacancies');
      }
    } catch {
      toast.error('Ошибка при удалении вакансии');
    }
  };

  const handleCopyLink = (vacancy: Vacancy) => {
    const url = `${window.location.origin}/vacancies/${vacancy.id}`;
    navigator.clipboard.writeText(url);
    toast.success('Ссылка скопирована');
  };

  const getSalaryDisplay = (vacancy: Vacancy) => {
    if (!vacancy.salary_min && !vacancy.salary_max) return null;
    return formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency);
  };

  const handleParsedVacancy = (data: ParsedVacancy) => {
    // Convert parsed vacancy to prefill data for the form
    const prefill: Partial<Vacancy> = {
      title: data.title,
      description: data.description,
      requirements: data.requirements,
      responsibilities: data.responsibilities,
      salary_min: data.salary_min,
      salary_max: data.salary_max,
      salary_currency: data.salary_currency || 'RUB',
      location: data.location,
      employment_type: data.employment_type,
      experience_level: data.experience_level,
    };
    setPrefillData(prefill);
    setShowParserModal(false);
    setShowCreateModal(true);
    toast.success('Данные распознаны');
  };

  // Detail view
  if (currentVacancy && vacancyId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-4 p-4 border-b border-white/10">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{currentVacancy.title}</h1>
            <span className={clsx('text-xs px-2 py-0.5 rounded-full', VACANCY_STATUS_COLORS[currentVacancy.status])}>
              {VACANCY_STATUS_LABELS[currentVacancy.status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                viewMode === 'kanban' ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-white/5'
              )}
              title={viewMode === 'kanban' ? 'Показать детали' : 'Показать Kanban'}
            >
              {viewMode === 'kanban' ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setEditingVacancy(currentVacancy)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              title="Редактировать"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleDelete(currentVacancy)}
              className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
              title="Удалить"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {viewMode === 'kanban' ? (
            <KanbanBoard vacancy={currentVacancy} />
          ) : (
            <VacancyDetail vacancy={currentVacancy} />
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="w-7 h-7 text-blue-400" />
            Вакансии
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowParserModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              Импорт
            </button>
            <button
              onClick={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Новая вакансия
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Поиск по названию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  statusFilter === status.id
                    ? 'bg-blue-600 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                )}
              >
                {status.name}
              </button>
            ))}
          </div>

          {/* Department filter */}
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Все отделы</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Vacancies list */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <VacancyCardSkeleton key={i} />
            ))}
          </div>
        ) : vacancies.length === 0 ? (
          <NoVacanciesEmpty onCreate={() => setShowCreateModal(true)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {vacancies.map((vacancy) => (
                <ContextMenu
                  key={vacancy.id}
                  items={createVacancyContextMenu(
                    () => handleVacancyClick(vacancy),
                    () => setEditingVacancy(vacancy),
                    () => handleDelete(vacancy),
                    () => handleCopyLink(vacancy)
                  )}
                >
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => handleVacancyClick(vacancy)}
                    className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl cursor-pointer transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{vacancy.title}</h3>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full', VACANCY_STATUS_COLORS[vacancy.status])}>
                          {VACANCY_STATUS_LABELS[vacancy.status]}
                        </span>
                      </div>
                      {vacancy.priority > 0 && (
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full',
                          vacancy.priority === 2 ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'
                        )}>
                          {vacancy.priority === 2 ? 'Срочно' : 'Важно'}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="space-y-2 text-sm text-white/60">
                      {vacancy.location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <span>{vacancy.location}</span>
                        </div>
                      )}
                      {getSalaryDisplay(vacancy) && (
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          <span>{getSalaryDisplay(vacancy)}</span>
                        </div>
                      )}
                      {vacancy.employment_type && (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          <span>{EMPLOYMENT_TYPES.find(t => t.value === vacancy.employment_type)?.label || vacancy.employment_type}</span>
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="w-4 h-4 text-blue-400" />
                        <span>{vacancy.applications_count} кандидатов</span>
                      </div>
                      {Object.keys(vacancy.stage_counts).length > 0 && (
                        <div className="flex items-center gap-1">
                          {Object.entries(vacancy.stage_counts).slice(0, 3).map(([stage, count]) => (
                            <span key={stage} className="text-xs px-1.5 py-0.5 bg-white/5 rounded">
                              {count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {vacancy.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {vacancy.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="text-xs px-2 py-0.5 bg-white/5 rounded-full">
                            {tag}
                          </span>
                        ))}
                        {vacancy.tags.length > 4 && (
                          <span className="text-xs px-2 py-0.5 text-white/40">
                            +{vacancy.tags.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </motion.div>
                </ContextMenu>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || editingVacancy) && (
          <VacancyForm
            vacancy={editingVacancy || undefined}
            prefillData={prefillData || undefined}
            onClose={() => {
              setShowCreateModal(false);
              setEditingVacancy(null);
              setPrefillData(null);
            }}
            onSuccess={() => {
              setShowCreateModal(false);
              setEditingVacancy(null);
              setPrefillData(null);
              fetchVacancies();
            }}
          />
        )}
      </AnimatePresence>

      {/* Parser Modal */}
      <AnimatePresence>
        {showParserModal && (
          <ParserModal
            type="vacancy"
            onClose={() => setShowParserModal(false)}
            onParsed={(data) => handleParsedVacancy(data as ParsedVacancy)}
          />
        )}
      </AnimatePresence>

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcuts
        shortcuts={[
          { key: '?', description: 'Show keyboard shortcuts', global: true },
          { key: 'Esc', description: 'Close modal', global: true },
          { key: '/', description: 'Focus search input', global: true },
          { key: 'Ctrl/Cmd+N', description: 'Create vacancy' },
        ]}
      />
    </div>
  );
}
