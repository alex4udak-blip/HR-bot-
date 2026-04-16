import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrencyRates } from '@/hooks';
import { AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Briefcase,
  MapPin,
  DollarSign,
  Clock,
  Users,
  Upload,
  Filter,
  X,
  Check,
  ChevronDown,
  Calendar,
  UserPlus,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import type { Vacancy, VacancyStatus } from '@/types';
import { EMPLOYMENT_TYPES } from '@/types';
import { formatSalary } from '@/utils';
import { getDepartments, assignVacancy, takeVacancy, getAssignableUsers } from '@/services/api';
import type { Department, ParsedVacancy, AssignableUser } from '@/services/api';
import {
  VacancyForm,
  VacancyCardSkeleton,
  VacancyStatusBadge,
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

const STATUS_BORDER_COLORS: Record<string, string> = {
  open: 'border-l-green-500',
  draft: 'border-l-gray-500',
  closed: 'border-l-red-500',
  paused: 'border-l-yellow-500',
  cancelled: 'border-l-gray-600',
};

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

// Assign vacancy modal
function AssignModal({
  vacancy,
  onClose,
  onAssigned,
}: {
  vacancy: Vacancy;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>(vacancy.assigned_to || []);
  const [assignAll, setAssignAll] = useState(vacancy.assigned_to_all || false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getAssignableUsers().then(setUsers).catch(() => toast.error('Не удалось загрузить пользователей'));
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await assignVacancy(vacancy.id, selectedIds, assignAll);
      toast.success('Вакансия назначена');
      onAssigned();
    } catch {
      toast.error('Не удалось назначить вакансию');
    } finally {
      setLoading(false);
    }
  };

  const toggleUser = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 bg-dark-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-lg font-semibold">Назначить рекрутеров</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          {/* Assign to all toggle */}
          <label className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] cursor-pointer hover:bg-white/[0.05] transition-colors">
            <input
              type="checkbox"
              checked={assignAll}
              onChange={() => setAssignAll(!assignAll)}
              className="w-4 h-4 rounded border-white/20 text-blue-500 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium">Назначить всем</span>
              <p className="text-xs text-white/40">Все рекрутеры увидят эту заявку</p>
            </div>
          </label>

          {/* User list */}
          {!assignAll && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-white/50 mb-2">Выберите рекрутеров:</p>
              {users.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <div className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full" />
                </div>
              ) : (
                users.map(u => (
                  <label
                    key={u.id}
                    className={clsx(
                      'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors',
                      selectedIds.includes(u.id)
                        ? 'bg-blue-500/15 border border-blue-500/30'
                        : 'hover:bg-white/[0.03] border border-transparent'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      className="w-4 h-4 rounded border-white/20 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-sm">{u.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={loading || (!assignAll && selectedIds.length === 0)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {loading ? (
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            Назначить
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VacanciesPage() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('open');
  const [departmentFilter, setDepartmentFilter] = useState<number | 'all'>('all');
  const [departments, setDepartments] = useState<Department[]>([]);
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
    updateVacancy,
    deleteVacancy,
    setFilters,
    clearCurrentVacancy,
    clearError
  } = useVacancyStore();

  // Auth state for role-based UI
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  // Task 9: "My vacancies" filter — non-admin users see only their vacancies by default
  const [showOnlyMine, setShowOnlyMine] = useState(!isAdmin);

  // Task 12: Assignment filter for unassigned requests
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'unassigned'>('all');

  // Assign modal state
  const [assigningVacancy, setAssigningVacancy] = useState<Vacancy | null>(null);

  // Take vacancy handler
  const [takingVacancyId, setTakingVacancyId] = useState<number | null>(null);
  const handleTakeVacancy = useCallback(async (vacancy: Vacancy) => {
    setTakingVacancyId(vacancy.id);
    try {
      await takeVacancy(vacancy.id);
      toast.success('Заявка взята в работу');
      fetchVacancies();
    } catch {
      toast.error('Не удалось взять заявку');
    } finally {
      setTakingVacancyId(null);
    }
  }, [fetchVacancies]);

  // Check if a vacancy is assigned to the current user
  const isAssignedToMe = useCallback((vacancy: Vacancy) => {
    if (!user) return false;
    if (vacancy.assigned_to_all) return true;
    if (vacancy.assigned_to && vacancy.assigned_to.includes(user.id)) return true;
    return false;
  }, [user]);

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
      // Task 9: "My vacancies" filter
      if (showOnlyMine && user) {
        const isMine = vacancy.created_by === user.id
          || (vacancy.assigned_to && vacancy.assigned_to.includes(user.id))
          || vacancy.assigned_to_all === true;
        if (!isMine) return false;
      }

      // Task 12: Unassigned requests filter
      if (assignmentFilter === 'unassigned') {
        const hasAssignment = (vacancy.assigned_to && vacancy.assigned_to.length > 0) || vacancy.assigned_to_all;
        if (hasAssignment) return false;
      }

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
  }, [vacancies, quickFilters, getComparableSalary, showOnlyMine, assignmentFilter, user]);

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

  // Task 14: Close vacancy handler
  const handleCloseClick = (vacancy: Vacancy) => {
    setConfirmDialog({ open: true, vacancy, type: 'close' });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog.vacancy) return;
    setDeleteLoading(true);
    try {
      if (confirmDialog.type === 'close') {
        // Task 14: Close vacancy and auto-switch to "open" filter
        await updateVacancy(confirmDialog.vacancy.id, { status: 'closed' });
        toast.success('Вакансия закрыта');
        setStatusFilter('open');
        fetchVacancies();
      } else {
        await deleteVacancy(confirmDialog.vacancy.id);
        toast.success('Вакансия удалена');
        if (currentVacancy?.id === confirmDialog.vacancy.id) {
          navigate('/vacancies');
        }
      }
      setConfirmDialog({ open: false, vacancy: null, type: 'delete' });
    } catch {
      toast.error(confirmDialog.type === 'close' ? 'Не удалось закрыть вакансию' : 'Не удалось удалить вакансию');
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
  // Detail view — directly show edit form for the vacancy
  if (currentVacancy && vacancyId) {
    return (
      <div className="h-full w-full max-w-full flex flex-col overflow-hidden">
        <VacancyForm
          key={`edit-${currentVacancy.id}`}
          vacancy={currentVacancy}
          onClose={handleBack}
          onSuccess={() => {
            fetchVacancy(currentVacancy.id);
            fetchVacancies();
            toast.success('Заявка обновлена');
          }}
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
                Заявки
              </h1>
            </OnboardingTooltip>
          </div>

          <div className="flex items-center gap-2">
            {/* Navigation to candidates page */}
            <button
              onClick={() => navigate('/all-candidates')}
              className="flex items-center gap-2 px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg text-sm transition-colors"
              title="Перейти к базе кандидатов"
            >
              <Users className="w-4 h-4" />
              К кандидатам
            </button>
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
                  title="Создать вакансию"
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 text-white font-semibold text-sm animate-pulse-subtle"
                >
                  <Plus className="w-5 h-5" strokeWidth={2.5} />
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
              className="w-full pl-10 pr-4 py-2 bg-white/[0.03] rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 p-1 bg-white/[0.03] rounded-lg">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-md transition-all',
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
            className="px-3 py-2 bg-white/[0.03] rounded-lg text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Все отделы</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>

          {/* Task 9: "My vacancies" toggle */}
          <button
            onClick={() => setShowOnlyMine(!showOnlyMine)}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border',
              showOnlyMine
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                : 'border-white/10 text-white/60 hover:text-white hover:bg-white/[0.05]'
            )}
          >
            <Users className="w-4 h-4" />
            {showOnlyMine ? 'Только мои' : 'Все вакансии'}
          </button>

          {/* Task 12: Unassigned requests filter */}
          {isAdmin && (
            <button
              onClick={() => setAssignmentFilter(prev => prev === 'all' ? 'unassigned' : 'all')}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border',
                assignmentFilter === 'unassigned'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'border-white/10 text-white/60 hover:text-white hover:bg-white/[0.05]'
              )}
            >
              <UserPlus className="w-4 h-4" />
              {assignmentFilter === 'unassigned' ? 'Нераспределённые' : 'Все заявки'}
            </button>
          )}

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
            <>
              {showFiltersDropdown && (
                <div
                  className="absolute right-0 top-full mt-2 w-80 border border-white/[0.06] bg-white/[0.02] rounded-xl shadow-xl z-50 overflow-hidden"
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
                  <div className="p-3 border-t border-white/10 bg-white/[0.03]">
                    <span className="text-xs text-white/50">
                      Показано {filteredVacancies.length} из {vacancies.length} вакансий
                    </span>
                  </div>
                </div>
              )}
            </>
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
            <>
              {filteredVacancies.map((vacancy) => (
                <ContextMenu
                  key={vacancy.id}
                  items={[
                    ...createVacancyContextMenu(
                      () => handleVacancyClick(vacancy),
                      () => setEditingVacancy(vacancy),
                      () => handleDeleteClick(vacancy),
                      () => handleCopyLink(vacancy)
                    ),
                    ...(vacancy.status === 'open' || vacancy.status === 'paused' ? [{
                      id: 'close',
                      label: 'Закрыть вакансию',
                      icon: XCircle,
                      onClick: () => handleCloseClick(vacancy),
                      divider: true,
                    }] : []),
                  ]}
                >
                  <div
                    onClick={() => handleVacancyClick(vacancy)}
                    className={clsx(
                      'p-4 border border-white/[0.06] bg-white/[0.02] rounded-xl cursor-pointer group transition-all hover:bg-white/[0.04] hover:border-white/[0.1] border-l-[3px]',
                      STATUS_BORDER_COLORS[vacancy.status] || 'border-l-gray-600'
                    )}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{vacancy.title}</h3>
                        <div className="flex items-center gap-2">
                          <VacancyStatusBadge status={vacancy.status} size="sm" />
                          {(user && vacancy.created_by !== user.id && (vacancy.assigned_to?.includes(user.id) || vacancy.assigned_to_all)) ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              Заявка
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300/70">
                              Вакансия
                            </span>
                          )}
                          {vacancy.applications_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                              <Users className="w-3 h-3" />
                              {vacancy.applications_count}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {vacancy.visible_to_all && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300" title="Видна всем сотрудникам">
                            Общая
                          </span>
                        )}
                        {vacancy.priority > 0 && (
                          <span className={clsx(
                            'text-xs px-2 py-0.5 rounded-full',
                            vacancy.priority === 2 ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'
                          )}>
                            {vacancy.priority === 2 ? 'Срочно' : 'Важно'}
                          </span>
                        )}
                      </div>
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

                    {/* Assignment actions */}
                    {vacancy.status === 'draft' && (
                      <div className="mt-3 flex items-center gap-2">
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setAssigningVacancy(vacancy); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/20 rounded-lg transition-colors"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            Назначить
                          </button>
                        )}
                        {!isAdmin && isAssignedToMe(vacancy) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleTakeVacancy(vacancy); }}
                            disabled={takingVacancyId === vacancy.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-500/15 hover:bg-green-500/25 text-green-300 border border-green-500/20 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {takingVacancyId === vacancy.id ? (
                              <div className="animate-spin w-3.5 h-3.5 border-2 border-green-300 border-t-transparent rounded-full" />
                            ) : (
                              <PlayCircle className="w-3.5 h-3.5" />
                            )}
                            Взять в работу
                          </button>
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
                            <span key={stage} className="text-xs px-1.5 py-0.5 bg-white/[0.03] rounded">
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
                          <span key={tag} className="text-xs px-2 py-0.5 bg-white/[0.03] rounded-full">
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
                  </div>
                </ContextMenu>
              ))}
            </>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence mode="wait">
        {(showCreateModal || editingVacancy) && (
          <VacancyForm
            key={editingVacancy ? `edit-list-${editingVacancy.id}` : 'create'}
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
        title={confirmDialog.type === 'close' ? 'Закрыть вакансию' : 'Удалить вакансию'}
        message={confirmDialog.type === 'close'
          ? 'Вы уверены, что хотите закрыть эту вакансию? Она переместится в статус "Закрыта".'
          : 'Вы уверены, что хотите удалить эту вакансию? Это действие невозможно отменить.'}
        confirmLabel={confirmDialog.type === 'close' ? 'Закрыть' : 'Удалить'}
        cancelLabel="Отмена"
        variant={confirmDialog.type === 'close' ? 'warning' : 'danger'}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelConfirm}
        loading={deleteLoading}
      />

      {/* Assign Modal */}
      {assigningVacancy && (
        <AssignModal
          vacancy={assigningVacancy}
          onClose={() => setAssigningVacancy(null)}
          onAssigned={() => {
            setAssigningVacancy(null);
            fetchVacancies();
          }}
        />
      )}
    </div>
  );
}
