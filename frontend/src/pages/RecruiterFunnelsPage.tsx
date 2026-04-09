import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Briefcase,
  Users,
  ChevronRight,
  ChevronDown,
  Search,
  LayoutList,
  Columns3,
  X,
  Loader2,
  FolderOpen,
  Menu,
  Settings,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import { getUsers, getApplications, updateApplication, updateVacancy } from '@/services/api';
import type { Vacancy, VacancyStatus, VacancyApplication, ApplicationStage } from '@/types';
import { VacancyStatusBadge } from '@/components/vacancies';
import type { StageColumn } from '@/components/vacancies/StagesConfigModal';

// ==================== Constants ====================

const STATUS_FILTERS: { id: VacancyStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Открытые' },
  { id: 'paused', label: 'На паузе' },
  { id: 'closed', label: 'Закрытые' },
  { id: 'draft', label: 'Черновики' },
];

const STAGE_ORDER = [
  'applied', 'screening', 'phone_screen', 'interview',
  'assessment', 'offer', 'hired', 'rejected', 'withdrawn',
] as const;

const STAGE_LABELS: Record<string, string> = {
  applied: 'Новая заявка',
  screening: 'Отбор',
  phone_screen: 'Собеседование назначено',
  interview: 'Собеседование пройдено',
  assessment: 'Практика',
  offer: 'Оффер',
  hired: 'Вышел на работу',
  rejected: 'Отказ',
  withdrawn: 'Отозван',
};

const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string; badge: string }> = {
  applied:      { bg: 'bg-blue-500/10',   text: 'text-blue-400',    dot: 'bg-blue-400',    badge: 'bg-blue-500/15 text-blue-400' },
  screening:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: 'bg-cyan-400',    badge: 'bg-cyan-500/15 text-cyan-400' },
  phone_screen: { bg: 'bg-purple-500/10',  text: 'text-purple-400',  dot: 'bg-purple-400',  badge: 'bg-purple-500/15 text-purple-400' },
  interview:    { bg: 'bg-indigo-500/10',  text: 'text-indigo-400',  dot: 'bg-indigo-400',  badge: 'bg-indigo-500/15 text-indigo-400' },
  assessment:   { bg: 'bg-orange-500/10',  text: 'text-orange-400',  dot: 'bg-orange-400',  badge: 'bg-orange-500/15 text-orange-400' },
  offer:        { bg: 'bg-yellow-500/10',  text: 'text-yellow-400',  dot: 'bg-yellow-400',  badge: 'bg-yellow-500/15 text-yellow-400' },
  hired:        { bg: 'bg-green-500/10',   text: 'text-green-400',   dot: 'bg-green-400',   badge: 'bg-green-500/15 text-green-400' },
  rejected:     { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     badge: 'bg-red-500/15 text-red-400' },
  withdrawn:    { bg: 'bg-gray-500/10',    text: 'text-gray-400',    dot: 'bg-gray-400',    badge: 'bg-gray-500/15 text-gray-400' },
  // Extra colors for custom stages
  pink:         { bg: 'bg-pink-500/10',    text: 'text-pink-400',    dot: 'bg-pink-400',    badge: 'bg-pink-500/15 text-pink-400' },
  teal:         { bg: 'bg-teal-500/10',    text: 'text-teal-400',    dot: 'bg-teal-400',    badge: 'bg-teal-500/15 text-teal-400' },
  amber:        { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   badge: 'bg-amber-500/15 text-amber-400' },
  lime:         { bg: 'bg-lime-500/10',    text: 'text-lime-400',    dot: 'bg-lime-400',    badge: 'bg-lime-500/15 text-lime-400' },
  rose:         { bg: 'bg-rose-500/10',    text: 'text-rose-400',    dot: 'bg-rose-400',    badge: 'bg-rose-500/15 text-rose-400' },
  violet:       { bg: 'bg-violet-500/10',  text: 'text-violet-400',  dot: 'bg-violet-400',  badge: 'bg-violet-500/15 text-violet-400' },
  sky:          { bg: 'bg-sky-500/10',     text: 'text-sky-400',     dot: 'bg-sky-400',     badge: 'bg-sky-500/15 text-sky-400' },
};

// Color palette for picker
const COLOR_PALETTE = [
  { key: 'blue',    dot: 'bg-blue-400' },
  { key: 'cyan',    dot: 'bg-cyan-400' },
  { key: 'teal',    dot: 'bg-teal-400' },
  { key: 'green',   dot: 'bg-green-400' },
  { key: 'lime',    dot: 'bg-lime-400' },
  { key: 'yellow',  dot: 'bg-yellow-400' },
  { key: 'amber',   dot: 'bg-amber-400' },
  { key: 'orange',  dot: 'bg-orange-400' },
  { key: 'red',     dot: 'bg-red-400' },
  { key: 'rose',    dot: 'bg-rose-400' },
  { key: 'pink',    dot: 'bg-pink-400' },
  { key: 'purple',  dot: 'bg-purple-400' },
  { key: 'violet',  dot: 'bg-violet-400' },
  { key: 'indigo',  dot: 'bg-indigo-400' },
  { key: 'sky',     dot: 'bg-sky-400' },
  { key: 'gray',    dot: 'bg-gray-400' },
];

// Map color key to STAGE_COLORS key (some overlap with enum names)
const colorToStageColor = (colorKey?: string, enumVal?: string): string => {
  if (colorKey && STAGE_COLORS[colorKey]) return colorKey;
  if (enumVal && STAGE_COLORS[enumVal]) return enumVal;
  return 'screening'; // fallback cyan
};

const fallbackColor = { bg: 'bg-dark-400/10', text: 'text-dark-300', dot: 'bg-dark-400', badge: 'bg-dark-400/15 text-dark-300' };

// ==================== Types ====================

interface RecruiterGroup {
  userId: number;
  userName: string;
  vacancies: Vacancy[];
  expanded: boolean;
}

// ==================== Main Component ====================

export default function RecruiterFunnelsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { vacancies, isLoading, fetchVacancies, createVacancy } = useVacancyStore();
  const { user } = useAuthStore();

  const isHrAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  // UI state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [usersMap, setUsersMap] = useState<Record<number, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // ClickUp view: selected vacancy + candidates
  const selectedVacancyId = searchParams.get('v') ? Number(searchParams.get('v')) : null;
  const [view, setView] = useState<'funnels' | 'list' | 'board'>('funnels');
  const [candidates, setCandidates] = useState<VacancyApplication[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');

  // Load data
  useEffect(() => {
    fetchVacancies();
  }, [fetchVacancies]);

  useEffect(() => {
    if (isHrAdmin) {
      getUsers().then((users) => {
        const map: Record<number, string> = {};
        users.forEach((u) => { map[u.id] = u.name; });
        setUsersMap(map);
      }).catch(() => {});
    }
  }, [isHrAdmin]);

  // Filter vacancies
  const filteredVacancies = useMemo(() => {
    let result = vacancies;
    if (!isHrAdmin && user) {
      result = result.filter((v) => v.created_by === user.id);
    }
    if (statusFilter !== 'all') {
      result = result.filter((v) => v.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (v) => v.title.toLowerCase().includes(q) || v.department_name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [vacancies, user, isHrAdmin, statusFilter, search]);

  // Group by recruiter (for admin) or single group (for hr)
  const recruiterGroups = useMemo((): RecruiterGroup[] => {
    const groups: Record<number, RecruiterGroup> = {};
    const vacs = filteredVacancies;
    vacs.forEach((v) => {
      const uid = v.created_by ?? 0;
      if (!groups[uid]) {
        groups[uid] = {
          userId: uid,
          userName: v.created_by_name || usersMap[uid] || (uid === user?.id ? (user?.name || 'Мои') : 'Без автора'),
          vacancies: [],
          expanded: expandedGroups.has(uid),
        };
      }
      groups[uid].vacancies.push(v);
    });
    const result = Object.values(groups).sort((a, b) => a.userName.localeCompare(b.userName));

    // Auto-expand first group or single group
    if (result.length === 1 || (!isHrAdmin && result.length > 0)) {
      result.forEach(g => g.expanded = true);
    } else if (expandedGroups.size === 0 && result.length > 0) {
      // First load: expand first group
      result[0].expanded = true;
      setExpandedGroups(new Set([result[0].userId]));
    } else {
      result.forEach(g => { g.expanded = expandedGroups.has(g.userId); });
    }
    return result;
  }, [filteredVacancies, isHrAdmin, usersMap, expandedGroups, user]);

  // Selected vacancy
  const selectedVacancy = useMemo(
    () => vacancies.find((v) => v.id === selectedVacancyId),
    [vacancies, selectedVacancyId],
  );

  const selectedRecruiterName = useMemo(() => {
    if (!selectedVacancy) return '';
    const uid = selectedVacancy.created_by ?? 0;
    return selectedVacancy.created_by_name || usersMap[uid] || '';
  }, [selectedVacancy, usersMap]);

  // Load candidates when vacancy selected
  useEffect(() => {
    if (!selectedVacancyId) {
      setCandidates([]);
      if (view !== 'funnels') setView('funnels');
      return;
    }
    loadCandidates(selectedVacancyId);
    if (view === 'funnels') setView('list');
  }, [selectedVacancyId]);

  const loadCandidates = useCallback(async (vacancyId: number) => {
    setCandidatesLoading(true);
    try {
      const apps = await getApplications(vacancyId);
      setCandidates(apps);
    } catch {
      setCandidates([]);
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  // Filter candidates by search
  const filteredCandidates = useMemo(() => {
    if (!candidateSearch.trim()) return candidates;
    const q = candidateSearch.toLowerCase();
    return candidates.filter(
      (c) =>
        c.entity_name?.toLowerCase().includes(q) ||
        c.entity_email?.toLowerCase().includes(q) ||
        c.entity_phone?.includes(q),
    );
  }, [candidates, candidateSearch]);

  // Derive stages config from custom_stages or fallback to defaults
  // Each column has a unique `key` and optional `maps_to` (the real DB enum value)
  const stagesConfig = useMemo((): {
    keys: string[];
    labels: Record<string, string>;
    keyToEnum: Record<string, string>;   // column key → real enum value
    enumToKeys: Record<string, string[]>; // real enum → column keys that accept it
    colorKeys: Record<string, string>;   // column key → color key for STAGE_COLORS
    isVirtual: Record<string, boolean>;  // column key → has maps_to (can be deleted)
  } => {
    const cols = selectedVacancy?.custom_stages?.columns as StageColumn[] | undefined;
    if (cols && cols.length > 0) {
      const visible = cols.filter(c => c.visible);
      const enumToKeys: Record<string, string[]> = {};
      for (const c of visible) {
        const enumVal = c.maps_to || c.key;
        if (!enumToKeys[enumVal]) enumToKeys[enumVal] = [];
        enumToKeys[enumVal].push(c.key);
      }
      return {
        keys: visible.map(c => c.key),
        labels: Object.fromEntries(visible.map(c => [c.key, c.label])),
        keyToEnum: Object.fromEntries(visible.map(c => [c.key, c.maps_to || c.key])),
        enumToKeys,
        colorKeys: Object.fromEntries(visible.map(c => [c.key, colorToStageColor(c.color, c.maps_to || c.key)])),
        isVirtual: Object.fromEntries(visible.map(c => [c.key, !!c.maps_to])),
      };
    }
    const enumToKeys: Record<string, string[]> = {};
    for (const s of STAGE_ORDER) enumToKeys[s] = [s];
    return {
      keys: [...STAGE_ORDER],
      labels: { ...STAGE_LABELS },
      keyToEnum: Object.fromEntries(STAGE_ORDER.map(s => [s, s])),
      enumToKeys,
      colorKeys: Object.fromEntries(STAGE_ORDER.map(s => [s, s])),
      isVirtual: Object.fromEntries(STAGE_ORDER.map(s => [s, false])),
    };
  }, [selectedVacancy]);

  // Group candidates by stage columns (handles virtual stages via maps_to)
  const groupedByStage = useMemo(() => {
    const map = new Map<string, VacancyApplication[]>();
    for (const key of stagesConfig.keys) map.set(key, []);
    for (const c of filteredCandidates) {
      // Find which column(s) this candidate's stage maps to
      const targetKeys = stagesConfig.enumToKeys[c.stage];
      if (targetKeys && targetKeys.length > 0) {
        // Put in first matching column
        map.get(targetKeys[0])!.push(c);
      } else {
        // Unknown stage — show in its own group
        if (!map.has(c.stage)) map.set(c.stage, []);
        map.get(c.stage)!.push(c);
      }
    }
    const result: [string, VacancyApplication[]][] = [];
    for (const [key, items] of map) {
      result.push([key, items]);
    }
    return result;
  }, [filteredCandidates, stagesConfig]);

  // Handlers
  const toggleGroup = (userId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectVacancy = (vacancyId: number) => {
    setSearchParams({ v: String(vacancyId) });
    setCandidateSearch('');
    setCollapsedStages(new Set());
    setMobileSidebar(false);
  };

  const deselectVacancy = () => {
    setSearchParams({});
    setView('funnels');
  };

  const toggleStage = (stage: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const handleFunnelCreated = (vacancy: Vacancy) => {
    setShowCreateModal(false);
    selectVacancy(vacancy.id);
  };

  // Change candidate stage
  const handleStageChange = useCallback(async (applicationId: number, newStage: ApplicationStage) => {
    try {
      await updateApplication(applicationId, { stage: newStage });
      // Update local state immediately
      setCandidates((prev) =>
        prev.map((c) => c.id === applicationId ? { ...c, stage: newStage } : c)
      );
      toast.success(`Статус изменён → ${stagesConfig.labels[newStage] || STAGE_LABELS[newStage] || newStage}`);
      // Refresh vacancy store for updated counts
      fetchVacancies();
    } catch {
      toast.error('Ошибка смены статуса');
    }
  }, [fetchVacancies, stagesConfig]);

  // Build current columns array from vacancy or defaults
  const getCurrentColumns = useCallback((): StageColumn[] => {
    const cols = selectedVacancy?.custom_stages?.columns as StageColumn[] | undefined;
    if (cols && cols.length > 0) return cols;
    return STAGE_ORDER.map(key => ({ key, label: STAGE_LABELS[key] || key, visible: true }));
  }, [selectedVacancy]);

  // Inline rename stage
  const handleStageRename = useCallback(async (stageKey: string, newLabel: string) => {
    if (!selectedVacancyId || !newLabel.trim()) {
      setEditingStage(null);
      return;
    }
    const columns = getCurrentColumns().map(c =>
      c.key === stageKey ? { ...c, label: newLabel.trim() } : c
    );
    try {
      await updateVacancy(selectedVacancyId, { custom_stages: { columns } });
      fetchVacancies();
      toast.success('Этап переименован');
    } catch {
      toast.error('Ошибка сохранения');
    }
    setEditingStage(null);
  }, [selectedVacancyId, getCurrentColumns, fetchVacancies]);

  // Add new virtual stage — immediately show inline editor
  const handleAddStage = useCallback(async () => {
    if (!selectedVacancyId) return;
    const columns = getCurrentColumns();
    const key = `custom_${Date.now()}`;
    // Insert before rejected/withdrawn
    const rejIdx = columns.findIndex(c => (c.maps_to || c.key) === 'rejected');
    const newCol: StageColumn = { key, label: 'Новый этап', visible: true, maps_to: 'screening' };
    if (rejIdx >= 0) {
      columns.splice(rejIdx, 0, newCol);
    } else {
      columns.push(newCol);
    }
    try {
      await updateVacancy(selectedVacancyId, { custom_stages: { columns } });
      await fetchVacancies();
      // Activate inline editing on the new stage
      setEditingStage(key);
      setEditingLabel('Новый этап');
    } catch {
      toast.error('Ошибка добавления');
    }
  }, [selectedVacancyId, getCurrentColumns, fetchVacancies]);

  // Change stage color
  const handleStageColorChange = useCallback(async (stageKey: string, newColor: string) => {
    if (!selectedVacancyId) return;
    const columns = getCurrentColumns().map(c =>
      c.key === stageKey ? { ...c, color: newColor } : c
    );
    try {
      await updateVacancy(selectedVacancyId, { custom_stages: { columns } });
      fetchVacancies();
    } catch {
      toast.error('Ошибка сохранения');
    }
  }, [selectedVacancyId, getCurrentColumns, fetchVacancies]);

  // Delete virtual stage
  const handleStageDelete = useCallback(async (stageKey: string) => {
    if (!selectedVacancyId) return;
    const columns = getCurrentColumns().filter(c => c.key !== stageKey);
    if (columns.length < 2) {
      toast.error('Минимум 2 этапа');
      return;
    }
    try {
      await updateVacancy(selectedVacancyId, { custom_stages: { columns } });
      fetchVacancies();
      toast.success('Этап удалён');
    } catch {
      toast.error('Ошибка удаления');
    }
  }, [selectedVacancyId, getCurrentColumns, fetchVacancies]);

  const [colorPickerStage, setColorPickerStage] = useState<string | null>(null);

  const formatDate = (iso?: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch {
      return '';
    }
  };

  // ==================== Render ====================

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Mobile sidebar overlay */}
      {mobileSidebar && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      {/* ========== LEFT SIDEBAR: Recruiter tree ========== */}
      <aside className={clsx(
        'flex-shrink-0 border-r border-white/[0.06] bg-dark-900/95 backdrop-blur-xl flex flex-col overflow-hidden z-50 transition-transform duration-200',
        // Desktop: always visible
        'lg:relative lg:translate-x-0 lg:w-[260px]',
        // Mobile: slide-in overlay
        'fixed inset-y-0 left-0 w-[280px]',
        mobileSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <span className="text-xs font-semibold text-dark-400 uppercase tracking-wider">
            {isHrAdmin ? 'Рекрутеры' : 'Мои воронки'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1 hover:bg-white/[0.06] rounded transition-colors"
              title="Новая воронка"
            >
              <Plus className="w-3.5 h-3.5 text-dark-400" />
            </button>
            <button
              onClick={() => setMobileSidebar(false)}
              className="lg:hidden p-1 hover:bg-white/[0.06] rounded transition-colors"
            >
              <X className="w-3.5 h-3.5 text-dark-400" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-white/[0.04]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
            <input
              type="text"
              placeholder="Поиск воронок..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-xs text-dark-200 placeholder-dark-500 focus:outline-none focus:border-accent-500/40"
            />
          </div>
        </div>

        {/* Status filter pills */}
        <div className="px-3 py-2 border-b border-white/[0.04] flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={clsx(
                'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors',
                statusFilter === f.id
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'text-dark-500 hover:text-dark-300 hover:bg-white/[0.04]'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : recruiterGroups.length === 0 ? (
            <div className="px-4 py-8 text-center text-dark-500 text-xs">
              {search ? 'Ничего не найдено' : 'Нет воронок'}
            </div>
          ) : (
            recruiterGroups.map((group) => (
              <div key={group.userId}>
                {/* Recruiter folder header */}
                {isHrAdmin && (
                  <button
                    onClick={() => toggleGroup(group.userId)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors group"
                  >
                    {group.expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-dark-500 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-dark-500 flex-shrink-0" />
                    )}
                    <FolderOpen className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <span className="text-sm text-dark-200 truncate flex-1 text-left font-medium">
                      {group.userName}
                    </span>
                    <span className="text-[10px] text-dark-500 flex-shrink-0">
                      {group.vacancies.length}
                    </span>
                  </button>
                )}

                {/* Vacancy list */}
                {(group.expanded || !isHrAdmin) && (
                  <div className={isHrAdmin ? 'ml-3' : ''}>
                    {group.vacancies.map((v) => {
                      const isSelected = selectedVacancyId === v.id;
                      const count = v.applications_count ?? 0;
                      return (
                        <button
                          key={v.id}
                          onClick={() => selectVacancy(v.id)}
                          className={clsx(
                            'w-full flex items-center gap-2 pr-3 py-1.5 text-left transition-colors',
                            isHrAdmin ? 'pl-6' : 'pl-3',
                            isSelected
                              ? 'bg-accent-500/10 text-accent-400'
                              : 'hover:bg-white/[0.04] text-dark-300',
                          )}
                        >
                          <span className={clsx(
                            'w-1.5 h-1.5 rounded-full flex-shrink-0',
                            v.status === 'open' ? 'bg-green-400' :
                            v.status === 'paused' ? 'bg-yellow-400' :
                            v.status === 'closed' ? 'bg-red-400' : 'bg-dark-500'
                          )} />
                          <span className="text-sm truncate flex-1">{v.title}</span>
                          <span className={clsx(
                            'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                            isSelected ? 'bg-accent-500/20 text-accent-400' : 'bg-white/[0.06] text-dark-400',
                          )}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ========== MAIN CONTENT ========== */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* No vacancy selected — show funnels overview */}
        {!selectedVacancy ? (
          <div className="flex-1 flex flex-col overflow-y-auto p-4 lg:p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileSidebar(true)}
                  className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-white/[0.06] transition-colors"
                >
                  <Menu className="w-5 h-5 text-dark-300" />
                </button>
                <div>
                <h1 className="text-xl lg:text-2xl font-bold text-dark-50">
                  {isHrAdmin ? 'Воронки рекрутеров' : 'Мои воронки'}
                </h1>
                <p className="text-sm text-dark-400 mt-0.5">
                  {filteredVacancies.length} воронок
                  {isHrAdmin && ` у ${recruiterGroups.length} рекрутеров`}
                </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Новая воронка
              </button>
            </div>

            {/* Funnels grid */}
            {filteredVacancies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Briefcase className="w-10 h-10 text-dark-500" />
                <div className="text-center">
                  <p className="text-dark-100 font-medium">Пока нет воронок</p>
                  <p className="text-dark-400 text-sm mt-1">Создайте первую воронку для начала работы</p>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Создать воронку
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredVacancies.map((v) => (
                  <FunnelCard key={v.id} vacancy={v} onClick={() => selectVacancy(v.id)} />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Vacancy selected — show candidates */
          <>
            {/* Top bar: breadcrumb + view tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-5 py-2 sm:py-3 gap-2 border-b border-white/[0.06] bg-white/[0.01] flex-shrink-0">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1.5 text-sm min-w-0">
                <button
                  onClick={() => setMobileSidebar(true)}
                  className="lg:hidden p-1.5 -ml-1 rounded-lg hover:bg-white/[0.06] transition-colors flex-shrink-0"
                >
                  <Menu className="w-4 h-4 text-dark-400" />
                </button>
                <button
                  onClick={deselectVacancy}
                  className="text-dark-500 hover:text-dark-300 transition-colors hidden sm:inline"
                >
                  HR отдел
                </button>
                {isHrAdmin && selectedRecruiterName && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-dark-600 flex-shrink-0 hidden sm:block" />
                    <span className="text-dark-400 truncate max-w-[120px] lg:max-w-[180px] hidden sm:inline">{selectedRecruiterName}</span>
                  </>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-dark-600 flex-shrink-0 hidden sm:block" />
                <button
                  onClick={deselectVacancy}
                  className="sm:hidden text-dark-500 hover:text-dark-300 transition-colors text-xs"
                >
                  ← Назад
                </button>
                <span className="text-dark-200 font-medium truncate max-w-[180px] sm:max-w-[250px]">
                  {selectedVacancy.title}
                </span>
                <span className="text-xs text-dark-500 ml-1 sm:ml-2 flex-shrink-0">
                  {candidates.length}
                </span>
              </div>

              {/* View tabs + search */}
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <div className="relative flex-1 sm:flex-none">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
                  <input
                    type="text"
                    placeholder="Поиск..."
                    value={candidateSearch}
                    onChange={(e) => setCandidateSearch(e.target.value)}
                    className="w-full sm:w-44 pl-8 pr-3 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-xs text-dark-200 placeholder-dark-500 focus:outline-none focus:border-accent-500/40"
                  />
                </div>
                <div className="flex items-center bg-white/[0.03] rounded-lg border border-white/[0.06] p-0.5">
                  <button
                    onClick={() => setView('list')}
                    className={clsx(
                      'flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-md text-xs font-medium transition-colors',
                      view === 'list' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200',
                    )}
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Список</span>
                  </button>
                  <button
                    onClick={() => setView('board')}
                    className={clsx(
                      'flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-md text-xs font-medium transition-colors',
                      view === 'board' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200',
                    )}
                  >
                    <Columns3 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Доска</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto">
              {candidatesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : view === 'list' ? (
                /* ===== LIST VIEW: grouped by stage ===== */
                <div className="px-3 sm:px-5 py-3 space-y-1">
                  {groupedByStage.length === 0 ? (
                    <div className="text-center py-16 text-dark-500 text-sm">
                      {candidateSearch ? 'Ничего не найдено' : 'Нет кандидатов в этой воронке'}
                    </div>
                  ) : (
                    groupedByStage.map(([stage, items]) => {
                      const ck = stagesConfig.colorKeys[stage] || stagesConfig.keyToEnum[stage] || stage;
                      const colors = STAGE_COLORS[ck] || fallbackColor;
                      const collapsed = collapsedStages.has(stage);
                      const isVirtual = stagesConfig.isVirtual[stage];
                      return (
                        <div key={stage} className="mb-1">
                          {/* Stage group header — inline editable */}
                          <div
                            className={clsx(
                              'w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors group/stage relative',
                              colors.bg,
                            )}
                          >
                            <button onClick={() => toggleStage(stage)} className="flex-shrink-0">
                              {collapsed ? (
                                <ChevronRight className={clsx('w-4 h-4', colors.text)} />
                              ) : (
                                <ChevronDown className={clsx('w-4 h-4', colors.text)} />
                              )}
                            </button>
                            {/* Color dot — click to open color picker */}
                            <button
                              onClick={() => setColorPickerStage(colorPickerStage === stage ? null : stage)}
                              className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-transparent hover:ring-white/20 transition-all cursor-pointer', colors.dot)}
                              title="Изменить цвет"
                            />
                            {/* Color picker dropdown */}
                            {colorPickerStage === stage && (
                              <div className="absolute top-full left-8 mt-1 z-50 p-2 bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl">
                                <div className="grid grid-cols-8 gap-1.5">
                                  {COLOR_PALETTE.map(c => (
                                    <button
                                      key={c.key}
                                      onClick={() => {
                                        handleStageColorChange(stage, c.key);
                                        setColorPickerStage(null);
                                      }}
                                      className={clsx('w-5 h-5 rounded-full transition-transform hover:scale-125', c.dot)}
                                      title={c.key}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                            {editingStage === stage ? (
                              <input
                                autoFocus
                                value={editingLabel}
                                onChange={(e) => setEditingLabel(e.target.value)}
                                onBlur={() => handleStageRename(stage, editingLabel)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleStageRename(stage, editingLabel);
                                  if (e.key === 'Escape') setEditingStage(null);
                                }}
                                className={clsx(
                                  'bg-transparent border-b-2 border-current outline-none text-sm font-semibold uppercase px-1 py-0',
                                  colors.text,
                                )}
                              />
                            ) : (
                              <span
                                onDoubleClick={() => {
                                  setEditingStage(stage);
                                  setEditingLabel(stagesConfig.labels[stage] || STAGE_LABELS[stage] || stage);
                                }}
                                className={clsx('text-sm font-semibold uppercase cursor-text', colors.text)}
                                title="Дважды кликните для переименования"
                              >
                                {stagesConfig.labels[stage] || STAGE_LABELS[stage] || stage}
                              </span>
                            )}
                            <span className={clsx('text-xs ml-1', colors.text)}>
                              {items.length}
                            </span>
                            {/* Rename icon */}
                            <button
                              onClick={() => {
                                setEditingStage(stage);
                                setEditingLabel(stagesConfig.labels[stage] || STAGE_LABELS[stage] || stage);
                              }}
                              className="p-1 rounded hover:bg-white/[0.1] transition-colors opacity-0 group-hover/stage:opacity-100"
                              title="Переименовать"
                            >
                              <Settings className="w-3 h-3 text-dark-400" />
                            </button>
                            {/* Delete — only virtual stages */}
                            {isVirtual && (
                              <button
                                onClick={() => handleStageDelete(stage)}
                                className="p-1 rounded hover:bg-red-500/20 transition-colors opacity-0 group-hover/stage:opacity-100"
                                title="Удалить этап"
                              >
                                <Trash2 className="w-3 h-3 text-red-400/60 hover:text-red-400" />
                              </button>
                            )}
                          </div>

                          {/* Candidate rows */}
                          {!collapsed && (
                            <div className="mt-0.5">
                              {/* Column headers — hidden on mobile, show on md+ */}
                              <div className="hidden md:grid grid-cols-[1fr_140px_100px_140px_100px] gap-2 px-3 py-1.5 text-[11px] text-dark-500 font-medium uppercase tracking-wide">
                                <span>Имя</span>
                                <span>Статус</span>
                                <span>Дата</span>
                                <span>Telegram</span>
                                <span>Источник</span>
                              </div>

                              {items.map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => navigate(`/contacts/${c.entity_id}`)}
                                  className="flex flex-col md:grid md:grid-cols-[1fr_140px_100px_140px_100px] gap-1 md:gap-2 px-3 py-2.5 md:py-2 hover:bg-white/[0.03] rounded-lg cursor-pointer transition-colors border-b border-white/[0.03] last:border-b-0 group"
                                >
                                  {/* Row 1 on mobile: Name + Stage */}
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-6 h-6 rounded-full bg-accent-500/10 flex items-center justify-center text-[10px] text-accent-400 font-medium flex-shrink-0">
                                      {(c.entity_name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-sm text-dark-100 truncate group-hover:text-accent-400 transition-colors">
                                      {c.entity_name || 'Без имени'}
                                    </span>
                                    {/* Stage badge inline on mobile */}
                                    <div className="md:hidden ml-auto flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                      <StageDropdown
                                        currentStage={c.stage as ApplicationStage}
                                        onChangeStage={(newStage) => handleStageChange(c.id, newStage)}
                                        customLabels={stagesConfig.labels}
                                      />
                                    </div>
                                  </div>
                                  {/* Status badge — desktop only (separate column) */}
                                  <div className="hidden md:flex items-center" onClick={(e) => e.stopPropagation()}>
                                    <StageDropdown
                                      currentStage={c.stage as ApplicationStage}
                                      onChangeStage={(newStage) => handleStageChange(c.id, newStage)}
                                      customLabels={stagesConfig.labels}
                                    />
                                  </div>
                                  {/* Date */}
                                  <span className="text-xs text-dark-400 flex items-center hidden md:flex">
                                    {formatDate(c.applied_at)}
                                  </span>
                                  {/* Row 2 on mobile: meta info */}
                                  <div className="flex items-center gap-3 md:hidden pl-8 text-xs text-dark-400">
                                    {c.applied_at && <span>{formatDate(c.applied_at)}</span>}
                                    {c.entity_telegram && <span>@{c.entity_telegram}</span>}
                                    {c.source && <span>{c.source}</span>}
                                  </div>
                                  {/* Telegram — desktop only */}
                                  <span className="text-xs text-dark-400 truncate items-center hidden md:flex">
                                    {c.entity_telegram ? `@${c.entity_telegram}` : ''}
                                  </span>
                                  {/* Source — desktop only */}
                                  <span className="text-xs text-dark-400 truncate items-center hidden md:flex">
                                    {c.source || ''}
                                  </span>
                                </div>
                              ))}

                              {/* Add candidate button */}
                              <button
                                onClick={() => navigate(`/candidates?new=1&vacancy=${selectedVacancyId}`)}
                                className="flex items-center gap-2 px-3 py-2 text-xs text-dark-500 hover:text-dark-300 transition-colors w-full"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Добавить кандидата</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {/* Add stage button */}
                  {groupedByStage.length > 0 && (
                    <button
                      onClick={handleAddStage}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 mt-2 border border-dashed border-white/[0.1] rounded-lg text-dark-400 hover:text-dark-200 hover:border-white/[0.2] transition-colors text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Добавить этап
                    </button>
                  )}
                </div>
              ) : (
                /* ===== BOARD VIEW (kanban) ===== */
                <div className="flex gap-2 sm:gap-3 px-3 sm:px-5 py-3 overflow-x-auto h-full">
                  {groupedByStage.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-dark-500 text-sm">
                      {candidateSearch ? 'Ничего не найдено' : 'Нет кандидатов в этой воронке'}
                    </div>
                  ) : (
                    groupedByStage.map(([stage, items]) => {
                      const enumVal2 = stagesConfig.keyToEnum[stage] || stage;
                      const colors = STAGE_COLORS[enumVal2] || STAGE_COLORS[stage] || fallbackColor;
                      return (
                        <div
                          key={stage}
                          className="w-[240px] sm:w-[280px] flex-shrink-0 flex flex-col bg-white/[0.02] rounded-xl border border-white/[0.06] overflow-hidden"
                        >
                          {/* Column header */}
                          <div className={clsx('flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]', colors.bg)}>
                            <span className={clsx('w-2 h-2 rounded-full', colors.dot)} />
                            <span className={clsx('text-sm font-semibold', colors.text)}>
                              {stagesConfig.labels[stage] || STAGE_LABELS[stage] || stage}
                            </span>
                            <span className={clsx('text-xs ml-auto opacity-70', colors.text)}>
                              {items.length}
                            </span>
                          </div>

                          {/* Cards */}
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {items.map((c) => (
                              <div
                                key={c.id}
                                onClick={() => navigate(`/contacts/${c.entity_id}`)}
                                className="rounded-lg p-3 cursor-pointer border border-white/[0.06] hover:border-accent-500/30 bg-white/[0.02] transition-all group"
                              >
                                <div className="flex items-center gap-2 mb-1.5">
                                  <div className="w-6 h-6 rounded-full bg-accent-500/10 flex items-center justify-center text-[10px] text-accent-400 font-medium flex-shrink-0">
                                    {(c.entity_name || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-sm text-dark-100 truncate group-hover:text-accent-400 transition-colors font-medium">
                                    {c.entity_name || 'Без имени'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-dark-400">
                                  {c.entity_telegram && <span>@{c.entity_telegram}</span>}
                                  {c.source && <span className="ml-auto">{c.source}</span>}
                                </div>
                                {c.applied_at && (
                                  <div className="text-[10px] text-dark-500 mt-1">
                                    {formatDate(c.applied_at)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Add button */}
                          <button
                            onClick={() => navigate(`/candidates?new=1&vacancy=${selectedVacancyId}`)}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs text-dark-500 hover:text-dark-300 hover:bg-white/[0.03] transition-colors border-t border-white/[0.06]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Добавить
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Create Funnel Modal */}
      {showCreateModal && (
        <CreateFunnelModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleFunnelCreated}
          createVacancy={createVacancy}
        />
      )}

    </div>
  );
}

/* ===================== Create Funnel Modal ===================== */

function CreateFunnelModal({
  onClose,
  onCreated,
  createVacancy,
}: {
  onClose: () => void;
  onCreated: (vacancy: Vacancy) => void;
  createVacancy: (data: { title: string; status: VacancyStatus }) => Promise<Vacancy>;
}) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      toast.error('Название минимум 3 символа');
      return;
    }
    setSaving(true);
    try {
      const vacancy = await createVacancy({
        title: title.trim(),
        status: 'open' as VacancyStatus,
      });
      toast.success('Воронка создана');
      onCreated(vacancy);
    } catch {
      toast.error('Ошибка создания воронки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl border border-white/10 shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-dark-50">Новая воронка</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-dark-400 hover:text-dark-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block text-sm font-medium text-dark-200 mb-2">
              Название воронки <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Frontend React Developer"
              className="w-full px-4 py-2.5 glass-light border border-white/[0.08] rounded-lg text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-accent-500/50"
            />
            <p className="mt-1.5 text-xs text-dark-400">
              Стадии воронки можно настроить после создания через ⚙️
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-dark-300 hover:text-dark-100 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving || title.trim().length < 3}
              className="flex items-center gap-2 px-5 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Funnel Card ===================== */

/* ===================== Stage Dropdown ===================== */

function StageDropdown({
  currentStage,
  onChangeStage,
  customLabels,
}: {
  currentStage: ApplicationStage;
  onChangeStage: (stage: ApplicationStage) => void;
  customLabels?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const colors = STAGE_COLORS[currentStage] || fallbackColor;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'text-xs px-2.5 py-1 rounded-full font-medium cursor-pointer transition-all',
          'hover:ring-2 hover:ring-white/10',
          colors.badge,
        )}
      >
        {customLabels?.[currentStage] || STAGE_LABELS[currentStage] || currentStage}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-56 py-1 bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider font-semibold">
            Перенести в
          </div>
          {STAGE_ORDER.map((stage) => {
            const sc = STAGE_COLORS[stage] || fallbackColor;
            const isCurrent = stage === currentStage;
            return (
              <button
                key={stage}
                onClick={() => {
                  if (!isCurrent) onChangeStage(stage as ApplicationStage);
                  setOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors text-sm',
                  isCurrent
                    ? 'bg-white/[0.06] text-dark-200'
                    : 'hover:bg-white/[0.04] text-dark-300 hover:text-dark-100',
                )}
              >
                <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', sc.dot)} />
                <span className="flex-1">{customLabels?.[stage] || STAGE_LABELS[stage] || stage}</span>
                {isCurrent && (
                  <span className="text-[10px] text-dark-500">текущий</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===================== Funnel Card ===================== */

function FunnelCard({ vacancy, onClick }: { vacancy: Vacancy; onClick: () => void }) {
  const count = vacancy.applications_count ?? 0;
  const stageCounts = vacancy.stage_counts ?? {};
  const mainStages = ['applied', 'screening', 'phone_screen', 'interview', 'assessment', 'offer', 'hired'];
  const total = mainStages.reduce((s, k) => s + (stageCounts[k] || 0), 0);

  return (
    <div
      onClick={onClick}
      className="p-3 rounded-lg border border-white/[0.06] glass-light hover:border-white/[0.12] cursor-pointer transition-colors group"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-medium text-dark-100 group-hover:text-accent-400 transition-colors line-clamp-2">
          {vacancy.title}
        </h3>
        <ChevronRight className="w-4 h-4 text-dark-500 group-hover:text-accent-400 transition-colors shrink-0 mt-0.5" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <VacancyStatusBadge status={vacancy.status} />
        {vacancy.department_name && (
          <span className="text-xs text-dark-400 truncate">{vacancy.department_name}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-2">
        <Users className="w-3.5 h-3.5" />
        <span>{count} кандидатов</span>
      </div>
      {total > 0 && (
        <div className="flex gap-0.5 h-1 rounded-full overflow-hidden bg-white/[0.04]">
          {mainStages.map((stage) => {
            const c = stageCounts[stage] || 0;
            if (c === 0) return null;
            const pct = (c / total) * 100;
            return (
              <div
                key={stage}
                className={clsx(
                  'h-full rounded-full',
                  stage === 'applied' && 'bg-blue-500/70',
                  stage === 'screening' && 'bg-cyan-500/70',
                  stage === 'phone_screen' && 'bg-purple-500/70',
                  stage === 'interview' && 'bg-indigo-500/70',
                  stage === 'assessment' && 'bg-orange-500/70',
                  stage === 'offer' && 'bg-yellow-500/70',
                  stage === 'hired' && 'bg-green-500/70',
                )}
                style={{ width: `${Math.max(pct, 4)}%` }}
                title={`${stage}: ${c}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
