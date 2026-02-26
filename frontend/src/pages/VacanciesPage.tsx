import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrencyRates } from '@/hooks';
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
  Upload,
  Filter,
  X,
  Check,
  ChevronDown,
  Calendar,
  Database
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import type { Vacancy, VacancyStatus } from '@/types';
import { EMPLOYMENT_TYPES } from '@/types';
import { formatSalary } from '@/utils';
import { getDepartments } from '@/services/api';
import type { Department, ParsedVacancy } from '@/services/api';
import {
  VacancyForm,
  VacancyDetail,
  KanbanBoard,
  VacancyCardSkeleton,
  VacancyStatusBadge,
  CandidatesDatabase,
} from '@/components/vacancies';
import ParserModal from '@/components/parser/ParserModal';
import {
  ContextMenu,
  createVacancyContextMenu,
  EmptyVacancies,
  ConfirmDialog,
  ErrorMessage
} from '@/components/ui';
import { OnboardingTooltip } from '@/components/onboarding';

// Main tabs
type MainTab = 'vacancies' | 'database';

const STATUS_FILTERS: { id: VacancyStatus | 'all'; name: string }[] = [
  { id: 'all', name: 'Все' },
  { id: 'draft', name: 'Черновик' },
  { id: 'open', name: 'Открыта' },
  { id: 'paused', name: 'На паузе' },
  { id: 'closed', name: 'Закрыта' },
  { id: 'cancelled', name: 'Отменена' },
];

// Quick filter options
const SALARY_RANGES = [
  { id: 'any', label: 'Любая зарплата', min: undefined, max: undefined },
  { id: 'under100k', label: 'До 100k', min: undefined, max: 100000 },
  { id: '100k-200k', label: '100k - 200k', min: 100000, max: 200000 },
  { id: '200k-300k', label: '200k - 300k', min: 200000, max: 300000 },
  { id: '300k+', label: '300k+', min: 300000, max: undefined },
];

const DATE_RANGES = [
  { id: 'any', label: 'За всё время', days: undefined },
  { id: '7days', label: 'За 7 дней', days: 7 },
  { id: '30days', label: 'За 30 дней', days: 30 },
  { id: '90days', label: 'За 90 дней', days: 90 },
];

interface QuickFilters {
  statuses: VacancyStatus[];
  salaryRange: string;
  dateRange: string;
}

export default function VacanciesPage() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Check if user has access to candidate database feature
  const { hasFeature } = useAuthStore();
  const hasCandidateDatabase = hasFeature('candidate_database');

  // Main tab state - default to 'vacancies' if user doesn't have access to database
  const [mainTab, setMainTab] = useState<MainTab>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'database' && hasCandidateDatabase) {
      return 'database';
    }
    return 'vacancies';
  });

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

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    vacancy: Vacancy | null;
    type: 'delete' | 'close';
  }>({ open: false, vacancy: null, type: 'delete' });
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Quick filters state
  const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);
  const [quickFilters, setQuickFilters] = useState<QuickFilters>(() => {
    // Initialize from URL params
    const statusesParam = searchParams.get('statuses');
    const salaryParam = searchParams.get('salary');
    const dateParam = searchParams.get('date');
    return {
      statuses: statusesParam ? statusesParam.split(',') as VacancyStatus[] : [],
      salaryRange: salaryParam || 'any',
      dateRange: dateParam || 'any',
    };
  });
  const filtersDropdownRef = useRef<HTMLDivElement>(null);

  const {
    vacancies,
    currentVacancy,
    isLoading,
    error,
    fetchVacancies,
    fetchVacancy,
    deleteVacancy,
    setFilters,
    clearCurrentVacancy,
    clearError
  } = useVacancyStore();

  // Currency rates for salary conversion during filtering
  const { getComparableSalary } = useCurrencyRates();

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (quickFilters.statuses.length > 0) count++;
    if (quickFilters.salaryRange !== 'any') count++;
    if (quickFilters.dateRange !== 'any') count++;
    return count;
  }, [quickFilters]);

  // Filter vacancies based on quick filters
  // Note: Salary ranges are in RUB, so we convert vacancy salaries to RUB for comparison
  const filteredVacancies = useMemo(() => {
    return vacancies.filter((vacancy) => {
      // Status filter
      if (quickFilters.statuses.length > 0 && !quickFilters.statuses.includes(vacancy.status)) {
        return false;
      }

      // Salary range filter (with currency conversion)
      if (quickFilters.salaryRange !== 'any') {
        const salaryConfig = SALARY_RANGES.find(s => s.id === quickFilters.salaryRange);
        if (salaryConfig) {
          // Convert vacancy salary to RUB for comparison
          // This allows comparing salaries across different currencies
          const vacancySalaryInRUB = getComparableSalary(
            vacancy.salary_min,
            vacancy.salary_max,
            vacancy.salary_currency || 'RUB'
          );

          if (vacancySalaryInRUB === 0) {
            // No salary specified - exclude from salary filter
            return false;
          }

          if (salaryConfig.min !== undefined && vacancySalaryInRUB < salaryConfig.min) return false;
          if (salaryConfig.max !== undefined && vacancySalaryInRUB > salaryConfig.max) return false;
        }
      }

      // Date range filter
      if (quickFilters.dateRange !== 'any') {
        const dateConfig = DATE_RANGES.find(d => d.id === quickFilters.dateRange);
        if (dateConfig?.days) {
          const vacancyDate = new Date(vacancy.created_at);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - dateConfig.days);
          if (vacancyDate < cutoffDate) return false;
        }
      }

      return true;
    });
  }, [vacancies, quickFilters, getComparableSalary]);

  // Sync quick filters to URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);

    if (quickFilters.statuses.length > 0) {
      newParams.set('statuses', quickFilters.statuses.join(','));
    } else {
      newParams.delete('statuses');
    }

    if (quickFilters.salaryRange !== 'any') {
      newParams.set('salary', quickFilters.salaryRange);
    } else {
      newParams.delete('salary');
    }

    if (quickFilters.dateRange !== 'any') {
      newParams.set('date', quickFilters.dateRange);
    } else {
      newParams.delete('date');
    }

    setSearchParams(newParams, { replace: true });
  }, [quickFilters, setSearchParams, searchParams]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filtersDropdownRef.current && !filtersDropdownRef.current.contains(event.target as Node)) {
        setShowFiltersDropdown(false);
      }
    };

    if (showFiltersDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFiltersDropdown]);

  // Quick filter handlers
  const handleToggleStatusFilter = (status: VacancyStatus) => {
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

  const handleClearAllFilters = () => {
    setQuickFilters({
      statuses: [],
      salaryRange: 'any',
      dateRange: 'any',
    });
  };

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

  const handleDeleteClick = (vacancy: Vacancy) => {
    setConfirmDialog({ open: true, vacancy, type: 'delete' });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog.vacancy) return;
    setDeleteLoading(true);
    try {
      await deleteVacancy(confirmDialog.vacancy.id);
      toast.success('Вакансия удалена');
      if (currentVacancy?.id === confirmDialog.vacancy.id) {
        navigate('/vacancies');
      }
      setConfirmDialog({ open: false, vacancy: null, type: 'delete' });
    } catch {
      toast.error('Не удалось удалить вакансию');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelConfirm = () => {
    if (!deleteLoading) {
      setConfirmDialog({ open: false, vacancy: null, type: 'delete' });
    }
  };

  const handleRetryFetch = () => {
    clearError();
    if (vacancyId) {
      fetchVacancy(parseInt(vacancyId));
    } else {
      fetchVacancies();
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
    toast.success('Данные успешно извлечены');
  };

  // Handle main tab change
  const handleMainTabChange = (tab: MainTab) => {
    setMainTab(tab);
    const newParams = new URLSearchParams(searchParams);
    if (tab === 'database') {
      newParams.set('tab', 'database');
    } else {
      newParams.delete('tab');
    }
    setSearchParams(newParams, { replace: true });
  };

  // Detail view
  if (currentVacancy && vacancyId) {
    return (
      <div className="h-full w-full max-w-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-4 p-4 border-b border-white/10">
          <button
            onClick={handleBack}
            className="p-2 glass-button rounded-lg"
            title="К списку вакансий"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{currentVacancy.title}</h1>
            <VacancyStatusBadge status={currentVacancy.status} size="sm" />
          </div>
          {/* Navigation to candidates page */}
          <button
            onClick={() => navigate('/candidates')}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg text-sm transition-colors"
            title="Перейти к базе кандидатов"
          >
            <Users className="w-4 h-4" />
            К кандидатам
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
              data-tour="kanban-toggle"
              className={clsx(
                'p-2 rounded-lg transition-colors',
                viewMode === 'kanban' ? 'bg-blue-500/20 text-blue-300' : 'glass-button'
              )}
              title={viewMode === 'kanban' ? 'Показать детали' : 'Показать Kanban'}
            >
              {viewMode === 'kanban' ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setEditingVacancy(currentVacancy)}
              className="p-2 glass-button rounded-lg"
              title="Редактировать"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleDeleteClick(currentVacancy)}
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

        {/* Delete confirmation dialog for detail view */}
        <ConfirmDialog
          open={confirmDialog.open}
          title="Удалить вакансию"
          message="Вы уверены, что хотите удалить эту вакансию? Это действие невозможно отменить."
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelConfirm}
          loading={deleteLoading}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="h-full w-full max-w-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <OnboardingTooltip
              id="vacancies-page"
              content="Создавайте вакансии и отслеживайте кандидатов через воронку найма"
              position="bottom"
            >
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Briefcase className="w-7 h-7 text-blue-400" />
                Вакансии
              </h1>
            </OnboardingTooltip>

            {/* Main Tabs - Show "База" tab only if user has candidate_database feature */}
            {hasCandidateDatabase && (
              <div className="flex items-center glass-light rounded-lg p-1">
                <button
                  onClick={() => handleMainTabChange('vacancies')}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    mainTab === 'vacancies'
                      ? 'bg-blue-600 text-white'
                      : 'text-white/60 hover:text-white'
                  )}
                >
                  <Briefcase className="w-4 h-4" />
                  Вакансии
                </button>
                <button
                  onClick={() => handleMainTabChange('database')}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    mainTab === 'database'
                      ? 'bg-purple-600 text-white'
                      : 'text-white/60 hover:text-white'
                  )}
                >
                  <Database className="w-4 h-4" />
                  База
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Navigation to candidates page */}
            <button
              onClick={() => navigate('/candidates')}
              className="flex items-center gap-2 px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg text-sm transition-colors"
              title="Перейти к базе кандидатов"
            >
              <Users className="w-4 h-4" />
              К кандидатам
            </button>
            {mainTab === 'vacancies' && (
              <>
                <button
                  onClick={() => setShowParserModal(true)}
                  className="flex items-center gap-2 px-4 py-2 glass-button rounded-lg"
                >
                  <Upload className="w-4 h-4" />
                  Импорт
                </button>
                <button
                  onClick={() => {
                    setPrefillData(null);
                    setShowCreateModal(true);
                  }}
                  data-tour="create-vacancy"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Новая вакансия
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters - only show for vacancies tab */}
        {mainTab === 'vacancies' && (
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
              className="w-full pl-10 pr-4 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 p-1 glass-light rounded-lg">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  statusFilter === status.id
                    ? 'bg-blue-600 text-white'
                    : 'text-white/60 hover:text-white'
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
            className="px-3 py-2 glass-light rounded-lg text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Все отделы</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>

          {/* Quick Filters Dropdown */}
          <div className="relative" ref={filtersDropdownRef}>
            <button
              onClick={() => setShowFiltersDropdown(!showFiltersDropdown)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors',
                activeFilterCount > 0
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                  : 'glass-button'
              )}
            >
              <Filter className="w-4 h-4" />
              Фильтры
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center w-5 h-5 bg-blue-600 text-white text-xs rounded-full">
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
                  className="absolute right-0 top-full mt-2 w-80 glass rounded-xl shadow-xl z-50 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between p-3 border-b border-white/10">
                    <span className="font-medium text-sm">Быстрые фильтры</span>
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
                    {/* Status Filter (Multi-select) */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                        <Briefcase className="w-3.5 h-3.5" />
                        Статус
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['open', 'draft', 'paused', 'closed'] as VacancyStatus[]).map((status) => (
                          <button
                            key={status}
                            onClick={() => handleToggleStatusFilter(status)}
                            className={clsx(
                              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                              quickFilters.statuses.includes(status)
                                ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300'
                                : 'glass-button text-white/70'
                            )}
                          >
                            {quickFilters.statuses.includes(status) && <Check className="w-3 h-3" />}
                            {STATUS_FILTERS.find(s => s.id === status)?.name || status}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Salary Range Filter */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                        <DollarSign className="w-3.5 h-3.5" />
                        Зарплата
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {SALARY_RANGES.map((range) => (
                          <button
                            key={range.id}
                            onClick={() => handleSalaryRangeChange(range.id)}
                            className={clsx(
                              'px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                              quickFilters.salaryRange === range.id
                                ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300'
                                : 'glass-button text-white/70'
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
                        Дата создания
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {DATE_RANGES.map((range) => (
                          <button
                            key={range.id}
                            onClick={() => handleDateRangeChange(range.id)}
                            className={clsx(
                              'px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                              quickFilters.dateRange === range.id
                                ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300'
                                : 'glass-button text-white/70'
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Results count */}
                  <div className="p-3 border-t border-white/10 glass-light">
                    <span className="text-xs text-white/50">
                      Показано {filteredVacancies.length} из {vacancies.length} вакансий
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        )}
      </div>

      {/* Content - conditional based on mainTab */}
      {mainTab === 'database' && hasCandidateDatabase ? (
        <CandidatesDatabase
          vacancies={vacancies}
          onRefreshVacancies={fetchVacancies}
        />
      ) : (
      /* Vacancies list */
      <div className="flex-1 overflow-auto p-3 sm:p-4">
        {error ? (
          <ErrorMessage
            error={error}
            onRetry={handleRetryFetch}
          />
        ) : isLoading ? (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <VacancyCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredVacancies.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <EmptyVacancies
              variant={searchQuery ? 'search' : activeFilterCount > 0 ? 'filter' : 'primary'}
              query={searchQuery}
              onCreate={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredVacancies.map((vacancy) => (
                <ContextMenu
                  key={vacancy.id}
                  items={createVacancyContextMenu(
                    () => handleVacancyClick(vacancy),
                    () => setEditingVacancy(vacancy),
                    () => handleDeleteClick(vacancy),
                    () => handleCopyLink(vacancy)
                  )}
                >
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => handleVacancyClick(vacancy)}
                    className="p-4 glass-card rounded-xl cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{vacancy.title}</h3>
                        <VacancyStatusBadge status={vacancy.status} size="sm" />
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

                    {/* Owner & Department */}
                    {(vacancy.created_by_name || vacancy.department_name) && (
                      <div className="mt-3 flex items-center gap-3 text-xs text-white/40">
                        {vacancy.created_by_name && (
                          <span title="Владелец вакансии">👤 {vacancy.created_by_name}</span>
                        )}
                        {vacancy.department_name && (
                          <span title="Департамент">📁 {vacancy.department_name}</span>
                        )}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="w-4 h-4 text-blue-400" />
                        <span>{vacancy.applications_count} кандидатов</span>
                      </div>
                      {Object.keys(vacancy.stage_counts).length > 0 && (
                        <div className="flex items-center gap-1">
                          {Object.entries(vacancy.stage_counts).slice(0, 3).map(([stage, count]) => (
                            <span key={stage} className="text-xs px-1.5 py-0.5 glass-light rounded">
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
                          <span key={tag} className="text-xs px-2 py-0.5 glass-light rounded-full">
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
      )}

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

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title="Удалить вакансию"
        message="Вы уверены, что хотите удалить эту вакансию? Это действие невозможно отменить."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelConfirm}
        loading={deleteLoading}
      />
    </div>
  );
}
