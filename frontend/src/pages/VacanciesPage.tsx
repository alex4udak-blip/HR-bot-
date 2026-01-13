import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
  Upload,
  Filter,
  X,
  Check,
  ChevronDown,
  Calendar
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Vacancy, VacancyStatus } from '@/types';
import {
  EMPLOYMENT_TYPES,
  formatSalary
} from '@/types';
import { getDepartments } from '@/services/api';
import type { Department, ParsedVacancy } from '@/services/api';
import {
  VacancyForm,
  VacancyDetail,
  KanbanBoard,
  VacancyCardSkeleton,
  VacancyStatusBadge,
} from '@/components/vacancies';
import ParserModal from '@/components/parser/ParserModal';
import {
  ContextMenu,
  createVacancyContextMenu,
  NoVacanciesEmpty,
  KeyboardShortcuts,
  ConfirmDialog,
  ErrorMessage
} from '@/components/ui';

const STATUS_FILTERS: { id: VacancyStatus | 'all'; name: string }[] = [
  { id: 'all', name: 'All' },
  { id: 'draft', name: 'Draft' },
  { id: 'open', name: 'Open' },
  { id: 'paused', name: 'Paused' },
  { id: 'closed', name: 'Closed' },
  { id: 'cancelled', name: 'Cancelled' },
];

// Quick filter options
const SALARY_RANGES = [
  { id: 'any', label: 'Any Salary', min: undefined, max: undefined },
  { id: 'under100k', label: 'Under 100k', min: undefined, max: 100000 },
  { id: '100k-200k', label: '100k - 200k', min: 100000, max: 200000 },
  { id: '200k-300k', label: '200k - 300k', min: 200000, max: 300000 },
  { id: '300k+', label: '300k+', min: 300000, max: undefined },
];

const DATE_RANGES = [
  { id: 'any', label: 'Any Time', days: undefined },
  { id: '7days', label: 'Last 7 days', days: 7 },
  { id: '30days', label: 'Last 30 days', days: 30 },
  { id: '90days', label: 'Last 90 days', days: 90 },
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
    loading,
    error,
    fetchVacancies,
    fetchVacancy,
    deleteVacancy,
    setFilters,
    clearCurrentVacancy,
    clearError
  } = useVacancyStore();

  // Modal state check for keyboard shortcut handlers
  const isAnyModalOpen = showCreateModal || !!editingVacancy || showParserModal;

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (quickFilters.statuses.length > 0) count++;
    if (quickFilters.salaryRange !== 'any') count++;
    if (quickFilters.dateRange !== 'any') count++;
    return count;
  }, [quickFilters]);

  // Filter vacancies based on quick filters
  const filteredVacancies = useMemo(() => {
    return vacancies.filter((vacancy) => {
      // Status filter
      if (quickFilters.statuses.length > 0 && !quickFilters.statuses.includes(vacancy.status)) {
        return false;
      }

      // Salary range filter
      if (quickFilters.salaryRange !== 'any') {
        const salaryConfig = SALARY_RANGES.find(s => s.id === quickFilters.salaryRange);
        if (salaryConfig) {
          const vacancySalary = vacancy.salary_max || vacancy.salary_min || 0;
          if (salaryConfig.min !== undefined && vacancySalary < salaryConfig.min) return false;
          if (salaryConfig.max !== undefined && vacancySalary > salaryConfig.max) return false;
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
  }, [vacancies, quickFilters]);

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

  const handleDeleteClick = (vacancy: Vacancy) => {
    setConfirmDialog({ open: true, vacancy, type: 'delete' });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog.vacancy) return;
    setDeleteLoading(true);
    try {
      await deleteVacancy(confirmDialog.vacancy.id);
      toast.success('Vacancy deleted successfully');
      if (currentVacancy?.id === confirmDialog.vacancy.id) {
        navigate('/vacancies');
      }
      setConfirmDialog({ open: false, vacancy: null, type: 'delete' });
    } catch {
      toast.error('Failed to delete vacancy');
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
    toast.success('Link copied');
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
    toast.success('Data parsed successfully');
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
            <VacancyStatusBadge status={currentVacancy.status} size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                viewMode === 'kanban' ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-white/5'
              )}
              title={viewMode === 'kanban' ? 'Show Details' : 'Show Kanban'}
            >
              {viewMode === 'kanban' ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setEditingVacancy(currentVacancy)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleDeleteClick(currentVacancy)}
              className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
              title="Delete"
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
            Vacancies
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowParserModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
            <button
              onClick={() => {
                setPrefillData(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              New Vacancy
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
              placeholder="Search by title..."
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
            <option value="all">All Departments</option>
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
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              )}
            >
              <Filter className="w-4 h-4" />
              Filters
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
                  className="absolute right-0 top-full mt-2 w-80 bg-gray-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between p-3 border-b border-white/10">
                    <span className="font-medium text-sm">Quick Filters</span>
                    {activeFilterCount > 0 && (
                      <button
                        onClick={handleClearAllFilters}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Clear All
                      </button>
                    )}
                  </div>

                  <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
                    {/* Status Filter (Multi-select) */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-white/60 mb-2">
                        <Briefcase className="w-3.5 h-3.5" />
                        Status
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['open', 'draft', 'paused', 'closed'] as VacancyStatus[]).map((status) => (
                          <button
                            key={status}
                            onClick={() => handleToggleStatusFilter(status)}
                            className={clsx(
                              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                              quickFilters.statuses.includes(status)
                                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                                : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
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
                        Salary Range
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {SALARY_RANGES.map((range) => (
                          <button
                            key={range.id}
                            onClick={() => handleSalaryRangeChange(range.id)}
                            className={clsx(
                              'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                              quickFilters.salaryRange === range.id
                                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
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
                        Created Date
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {DATE_RANGES.map((range) => (
                          <button
                            key={range.id}
                            onClick={() => handleDateRangeChange(range.id)}
                            className={clsx(
                              'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                              quickFilters.dateRange === range.id
                                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                                : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Results count */}
                  <div className="p-3 border-t border-white/10 bg-white/5">
                    <span className="text-xs text-white/50">
                      Showing {filteredVacancies.length} of {vacancies.length} vacancies
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Vacancies list */}
      <div className="flex-1 overflow-auto p-3 sm:p-4">
        {error ? (
          <ErrorMessage
            error={error}
            onRetry={handleRetryFetch}
          />
        ) : loading ? (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <VacancyCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredVacancies.length === 0 ? (
          <NoVacanciesEmpty onCreate={() => setShowCreateModal(true)} />
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
                    className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl cursor-pointer transition-colors group"
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
                          {vacancy.priority === 2 ? 'Urgent' : 'Important'}
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
                        <span>{vacancy.applications_count} candidates</span>
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

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title="Delete Vacancy"
        message="Are you sure you want to delete this vacancy? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelConfirm}
        loading={deleteLoading}
      />
    </div>
  );
}
