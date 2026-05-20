import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrencyRates } from '@/hooks';
import { AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Briefcase,
  DollarSign,
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

const STATUS_FILTERS: { id: VacancyStatus | 'all'; name: string }[] = [
  { id: 'all', name: 'Все' },
  { id: 'pending_review', name: 'На рассмотрении' },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--hf-black-alpha-60)]" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 bg-[var(--hf-bg-dark)] border border-[color:var(--hf-white-alpha-10)] rounded-2xl shadow-[var(--hf-shadow-2xl)] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--hf-white-alpha-10)]">
          <h3 className="text-lg font-semibold">Назначить рекрутеров</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--hf-white-alpha-10)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          {/* Assign to all toggle */}
          <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--hf-white-alpha-03)] border border-[color:var(--hf-white-alpha-06)] cursor-pointer hover:bg-[var(--hf-white-alpha-05)] transition-colors">
            <input
              type="checkbox"
              checked={assignAll}
              onChange={() => setAssignAll(!assignAll)}
              className="w-4 h-4 rounded border-[color:var(--hf-white-alpha-20)] text-[var(--hf-cyan-700)] focus:ring-[var(--hf-cyan-500)]"
            />
            <div>
              <span className="text-sm font-medium">Назначить всем</span>
              <p className="text-xs text-[color:var(--hf-white-alpha-40)]">Все рекрутеры увидят эту заявку</p>
            </div>
          </label>

          {/* User list */}
          {!assignAll && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-[color:var(--hf-white-alpha-50)] mb-2">Выберите рекрутеров:</p>
              {users.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <div className="animate-spin w-5 h-5 border-2 border-[color:var(--hf-status-blue)] border-t-transparent rounded-full" />
                </div>
              ) : (
                users.map(u => (
                  <label
                    key={u.id}
                    className={clsx(
                      'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors',
                      selectedIds.includes(u.id)
                        ? 'bg-[var(--hf-status-blue-badge)] border border-[color:var(--hf-status-blue-badge)]'
                        : 'hover:bg-[var(--hf-white-alpha-03)] border border-transparent'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      className="w-4 h-4 rounded border-[color:var(--hf-white-alpha-20)] text-[var(--hf-cyan-700)] focus:ring-[var(--hf-cyan-500)]"
                    />
                    <span className="text-sm">{u.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[color:var(--hf-white-alpha-10)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-[color:var(--hf-white-alpha-60)] hover:text-[var(--hf-white)] hover:bg-[var(--hf-white-alpha-06)] transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={loading || (!assignAll && selectedIds.length === 0)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--hf-cyan-700)] hover:bg-[var(--hf-cyan-600)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {loading ? (
              <div className="animate-spin w-4 h-4 border-2 border-[color:var(--hf-white)] border-t-transparent rounded-full" />
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
  // Дефолтный таб 'Все' — иначе только что созданная заявка (status=pending_review)
  // не видна в открытом по умолчанию 'Открыта', и юзер думает что она пропала.
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('all');
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

  // Уже ли рекрутёр взял эту заявку в работу (есть клон с cloned_from_request_id)
  const hasAlreadyTaken = useCallback((vacancy: Vacancy) => {
    if (!user) return false;
    return vacancies.some(v =>
      v.created_by === user.id &&
      (v.extra_data as Record<string, unknown> | undefined)?.cloned_from_request_id === vacancy.id
    );
  }, [vacancies, user]);

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
      // Заявки page = только заявки, не персональные клоны рекрутёров.
      // Личные вакансии (включая клоны) живут в "Мои вакансии".
      const extra = vacancy.extra_data as Record<string, unknown> | undefined;
      const cloneSrc = extra?.cloned_from_request_id;
      if (typeof cloneSrc === 'number') return false;

      // Рекрутёр, который уже закрыл/отменил свой клон, больше не должен
      // видеть оригинальную заявку (бэкенд складывает его id в dismissed_by).
      if (user) {
        const dismissedBy = extra?.dismissed_by;
        if (Array.isArray(dismissedBy) && dismissedBy.includes(user.id)) return false;
      }

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

      // Main status tab filter (top tabs)
      if (statusFilter !== 'all' && vacancy.status !== statusFilter) {
        return false;
      }

      // Quick filter statuses (multi-select inside dropdown)
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
  }, [vacancies, quickFilters, getComparableSalary, showOnlyMine, assignmentFilter, statusFilter, user]);

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

  const formatVacancyDate = (value?: string) => {
    if (!value) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(value));
  };

  const getVacancyStatusLabel = (status: VacancyStatus) =>
    STATUS_FILTERS.find((item) => item.id === status)?.name || status;

  const getVacancyKindLabel = (vacancy: Vacancy) =>
    user && vacancy.created_by !== user.id && (vacancy.assigned_to?.includes(user.id) || vacancy.assigned_to_all)
      ? 'Заявка'
      : 'Вакансия';

  const getClosedVacancyDate = (vacancy: Vacancy) =>
    vacancy.status === 'closed' ? vacancy.closes_at || vacancy.updated_at : null;

  const getEmploymentTypeLabel = (value?: string) => {
    if (!value) return null;
    const normalizedValue = value.replace(/_/g, '-');
    return EMPLOYMENT_TYPES.find((type) => type.value === normalizedValue)?.label || value;
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
    <div className="vacancies-page h-full w-full max-w-full flex flex-col overflow-hidden text-[var(--hf-vacancies-page-text)]">
      {/* Header */}
      <div className="p-4 border-b border-[color:var(--hf-vacancies-page-border)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Briefcase className="w-7 h-7 text-[var(--hf-status-blue)]" />
              Заявки
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Navigation to candidates page */}
            <button
              onClick={() => navigate('/all-candidates')}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--hf-status-purple-badge)] hover:bg-[var(--hf-status-purple-bg)] text-[var(--hf-status-purple)] rounded-lg text-sm transition-colors"
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
                  className="flex items-center gap-2 px-5 py-2.5 bg-[var(--hf-cyan-600)] hover:bg-[var(--hf-cyan-400)] rounded-xl transition-all shadow-[var(--hf-shadow-lg)] shadow-[0_10px_15px_-3px_var(--hf-status-blue-badge)] hover:shadow-[0_10px_15px_-3px_var(--hf-status-blue-badge)] text-[var(--hf-white)] font-semibold text-sm animate-pulse-subtle"
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--hf-vacancies-page-faint)]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Поиск по названию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[var(--hf-vacancies-page-surface)] border border-[color:var(--hf-vacancies-page-border)] rounded-lg focus:outline-none focus:border-[var(--hf-cyan-500)] text-sm placeholder:text-[color:var(--hf-vacancies-page-soft)]"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 p-1 bg-[var(--hf-vacancies-page-surface-soft)] rounded-lg">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-md transition-all',
                  statusFilter === status.id
                    ? 'bg-[var(--hf-cyan-700)] text-[var(--hf-white)]'
                    : 'text-[color:var(--hf-vacancies-page-muted)] hover:text-[var(--hf-vacancies-page-text)] hover:bg-[var(--hf-vacancies-page-chip)]'
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
            className="px-3 py-2 bg-[var(--hf-vacancies-page-surface)] border border-[color:var(--hf-vacancies-page-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--hf-cyan-500)]"
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
                ? 'bg-[var(--hf-status-blue-badge)] border-[color:var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]'
                : 'border-[color:var(--hf-vacancies-page-border)] text-[color:var(--hf-vacancies-page-muted)] hover:text-[var(--hf-vacancies-page-text)] hover:bg-[var(--hf-vacancies-page-chip)]'
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
                  ? 'bg-[var(--hf-status-yellow-badge)] border-[color:var(--hf-status-yellow-badge)] text-[var(--hf-status-yellow)]'
                  : 'border-[color:var(--hf-vacancies-page-border)] text-[color:var(--hf-vacancies-page-muted)] hover:text-[var(--hf-vacancies-page-text)] hover:bg-[var(--hf-vacancies-page-chip)]'
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
                  ? 'bg-[var(--hf-status-blue-badge)] border-[color:var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]'
                  : 'glass-button'
              )}
            >
              <Filter className="w-4 h-4" />
              Фильтры
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center w-5 h-5 bg-[var(--hf-cyan-700)] text-[var(--hf-white)] text-xs rounded-full">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className={clsx('w-4 h-4 transition-transform', showFiltersDropdown && 'rotate-180')} />
            </button>

            {/* Dropdown Panel */}
            <>
              {showFiltersDropdown && (
                <div
                  className="absolute left-0 2xl:left-auto 2xl:right-0 top-full mt-2 w-80 border border-[color:var(--hf-vacancies-page-border)] bg-[var(--hf-vacancies-page-surface)] rounded-xl shadow-[var(--hf-shadow-xl)] z-50 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between p-3 border-b border-[color:var(--hf-vacancies-page-border)]">
                    <span className="font-medium text-sm">Быстрые фильтры</span>
                    {activeFilterCount > 0 && (
                      <button
                        onClick={handleClearAllFilters}
                        className="flex items-center gap-1 text-xs text-[var(--hf-status-red)] hover:text-[var(--hf-red-300)] transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Сбросить
                      </button>
                    )}
                  </div>

                  <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
                    {/* Status Filter (Multi-select) */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-[color:var(--hf-vacancies-page-muted)] mb-2">
                        <Briefcase className="w-3.5 h-3.5" />
                        Статус
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['open', 'pending_review', 'paused', 'closed'] as VacancyStatus[]).map((status) => (
                          <button
                            key={status}
                            onClick={() => handleToggleStatusFilter(status)}
                            className={clsx(
                              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                              quickFilters.statuses.includes(status)
                                ? 'bg-[var(--hf-status-blue-badge)] border border-[color:var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]'
                                : 'border border-[color:var(--hf-vacancies-page-border)] bg-[var(--hf-vacancies-page-surface)] text-[color:var(--hf-vacancies-page-muted)] hover:bg-[var(--hf-vacancies-page-chip)]'
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
                      <label className="flex items-center gap-2 text-xs font-medium text-[color:var(--hf-vacancies-page-muted)] mb-2">
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
                                ? 'bg-[var(--hf-status-blue-badge)] border border-[color:var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]'
                                : 'border border-[color:var(--hf-vacancies-page-border)] bg-[var(--hf-vacancies-page-surface)] text-[color:var(--hf-vacancies-page-muted)] hover:bg-[var(--hf-vacancies-page-chip)]'
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Date Range Filter */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-[color:var(--hf-vacancies-page-muted)] mb-2">
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
                                ? 'bg-[var(--hf-status-blue-badge)] border border-[color:var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]'
                                : 'border border-[color:var(--hf-vacancies-page-border)] bg-[var(--hf-vacancies-page-surface)] text-[color:var(--hf-vacancies-page-muted)] hover:bg-[var(--hf-vacancies-page-chip)]'
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Results count */}
                  <div className="p-3 border-t border-[color:var(--hf-vacancies-page-border)] bg-[var(--hf-vacancies-page-surface-soft)]">
                    <span className="text-xs text-[color:var(--hf-vacancies-page-soft)]">
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
      <div className="hf-vacancies-search-body">
        {error ? (
          <ErrorMessage
            error={error}
            onRetry={handleRetryFetch}
          />
        ) : isLoading ? (
          <div className="hf-vacancies-search-list" aria-label="Загрузка вакансий">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="hf-vacancies-search-row hf-vacancies-search-row-skeleton">
                <div className="hf-vacancies-search-skeleton-line hf-vacancies-search-skeleton-title" />
                <div className="hf-vacancies-search-skeleton-line" />
                <div className="hf-vacancies-search-skeleton-line hf-vacancies-search-skeleton-short" />
              </div>
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
          <section className="hf-vacancies-search-results" aria-label="Вакансии">
            <div className="hf-vacancies-search-count">
              Найдено вакансий: {filteredVacancies.length}
            </div>
            <div className="hf-vacancies-search-list">
              {filteredVacancies.map((vacancy) => {
                const closedDate = getClosedVacancyDate(vacancy);
                const salaryDisplay = getSalaryDisplay(vacancy);
                const employmentLabel = getEmploymentTypeLabel(vacancy.employment_type);
                const isRequestForMe = !isAdmin && user && vacancy.created_by !== user.id && isAssignedToMe(vacancy);
                const isAlreadyAssigned = vacancy.assigned_to_all || (vacancy.assigned_to && vacancy.assigned_to.length > 0);
                const showAdminAssign = isAdmin && (
                  vacancy.status === 'pending_review' ||
                  vacancy.status === 'draft' ||
                  (vacancy.status === 'open' && !isAlreadyAssigned)
                );
                const showAdminReassign = isAdmin && vacancy.status === 'open' && isAlreadyAssigned;
                const showTakeBtn = isRequestForMe && !hasAlreadyTaken(vacancy);
                const acceptedCount = vacancy.stage_counts.hired || 0;

                return (
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
                  <article
                    onClick={() => handleVacancyClick(vacancy)}
                    className="hf-vacancies-search-row"
                    aria-label={`${getVacancyStatusLabel(vacancy.status)}: ${vacancy.title?.trim() || 'Без названия'}`}
                  >
                    <div className="hf-vacancies-search-main">
                      <div className="hf-vacancies-search-title-row">
                          <VacancyStatusBadge status={vacancy.status} size="sm" />
                        <button
                          type="button"
                          className={clsx(
                            'hf-vacancies-search-title',
                            !vacancy.title?.trim() && 'hf-vacancies-search-title-empty',
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVacancyClick(vacancy);
                          }}
                        >
                          {vacancy.title?.trim() || 'Без названия'}
                        </button>
                        <span className="hf-vacancies-search-kind">{getVacancyKindLabel(vacancy)}</span>
                          {vacancy.applications_count > 0 && (
                          <span className="hf-vacancies-search-candidates">
                            <Users className="hf-vacancies-search-candidates-icon" />
                              {vacancy.applications_count}
                            </span>
                          )}
                        </div>

                      {vacancy.department_name && (
                        <div className="hf-vacancies-search-department">{vacancy.department_name}</div>
                      )}

                      <div className="hf-vacancies-search-meta">
                        <span>Открыта: {formatVacancyDate(vacancy.published_at || vacancy.created_at)}</span>
                        {closedDate && (
                          <>
                            <span className="hf-vacancies-search-dot">·</span>
                            <span>Закрыта: {formatVacancyDate(closedDate)}</span>
                          </>
                        )}
                        </div>

                      <div className="hf-vacancies-search-meta">
                        <span>Последнее действие: {formatVacancyDate(vacancy.updated_at)}</span>
                        </div>

                        {vacancy.created_by_name && (
                        <div className="hf-vacancies-search-meta">
                          <span>Рекрутер: {vacancy.created_by_name}</span>
                        </div>
                        )}

                      {vacancy.hiring_manager_name && (
                        <div className="hf-vacancies-search-meta">
                          <span>Заказчик: {vacancy.hiring_manager_name}</span>
                        </div>
                        )}

                      {(vacancy.location || salaryDisplay || employmentLabel) && (
                        <div className="hf-vacancies-search-meta hf-vacancies-search-extra">
                          {vacancy.location && <span>{vacancy.location}</span>}
                          {salaryDisplay && <span>{salaryDisplay}</span>}
                          {employmentLabel && <span>{employmentLabel}</span>}
                        </div>
                      )}

                      {acceptedCount > 0 && (
                        <div className="hf-vacancies-search-meta">
                          <span>Оффер принят: {acceptedCount}</span>
                        </div>
                      )}

                      {vacancy.tags.length > 0 && (
                        <div className="hf-vacancies-search-tags">
                          {vacancy.tags.slice(0, 4).map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                          {vacancy.tags.length > 4 && <span>+{vacancy.tags.length - 4}</span>}
                        </div>
                      )}
                    </div>

                    {(showAdminAssign || showAdminReassign || showTakeBtn || vacancy.priority > 0 || vacancy.visible_to_all) && (
                      <div className="hf-vacancies-search-side">
                        {vacancy.visible_to_all && (
                          <span className="hf-vacancies-search-chip" title="Видна всем сотрудникам">
                            Общая
                          </span>
                        )}
                        {vacancy.priority > 0 && (
                          <span className={clsx('hf-vacancies-search-chip', vacancy.priority === 2 && 'hf-vacancies-search-chip-urgent')}>
                            {vacancy.priority === 2 ? 'Срочно' : 'Важно'}
                          </span>
                        )}
                          {showAdminAssign && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setAssigningVacancy(vacancy); }}
                            className="hf-vacancies-search-action"
                            >
                            <UserPlus className="hf-vacancies-search-action-icon" />
                              {isAlreadyAssigned ? 'Переназначить' : 'Назначить'}
                            </button>
                          )}
                          {showAdminReassign && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setAssigningVacancy(vacancy); }}
                            className="hf-vacancies-search-action"
                            >
                            <UserPlus className="hf-vacancies-search-action-icon" />
                              Переназначить
                            </button>
                          )}
                          {showTakeBtn && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleTakeVacancy(vacancy); }}
                              disabled={takingVacancyId === vacancy.id}
                            className="hf-vacancies-search-action hf-vacancies-search-action-green"
                            >
                              {takingVacancyId === vacancy.id ? (
                              <div className="hf-vacancies-search-spinner" />
                              ) : (
                              <PlayCircle className="hf-vacancies-search-action-icon" />
                              )}
                              Взять в работу
                            </button>
                          )}
                        </div>
                      )}
                  </article>
                </ContextMenu>
                );
              })}
            </div>
          </section>
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
