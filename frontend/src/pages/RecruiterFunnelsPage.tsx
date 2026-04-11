import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Briefcase,
  Users,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Loader2,
  FolderOpen,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutList,
  Columns3,
  FileText,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import { getUsers, getApplications, updateApplication, getApplicationHistory, getEntityFiles } from '@/services/api';
import type { EntityFile } from '@/services/api/entities';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [usersMap, setUsersMap] = useState<Record<number, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // ClickUp view: selected vacancy + candidates
  const selectedVacancyId = searchParams.get('v') ? Number(searchParams.get('v')) : null;
  const [candidates, setCandidates] = useState<VacancyApplication[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');

  // View mode: 'detail' (Huntflow-style) or 'list' (ClickUp-style grouped by stage)
  const [viewMode, setViewMode] = useState<'detail' | 'list'>('detail');

  // Master-detail state
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [candidateHistory, setCandidateHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'resume'>('info');
  const [entityFiles, setEntityFiles] = useState<EntityFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [currentResumePage, setCurrentResumePage] = useState(0);

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
      return;
    }
    loadCandidates(selectedVacancyId);
    setSelectedCandidateId(null);
    setSelectedTab('all');
    setCandidateHistory([]);
    setDetailTab('info');
    setCurrentResumePage(0);
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

  // Derive grouped as a Record for quick count lookup by key
  const groupedByStageMap = useMemo(() => {
    const map: Record<string, VacancyApplication[]> = {};
    for (const [key, items] of groupedByStage) {
      map[key] = items;
    }
    return map;
  }, [groupedByStage]);

  // Master-detail derived data
  const selectedCandidate = useMemo(
    () => candidates.find(c => c.id === selectedCandidateId) || null,
    [candidates, selectedCandidateId],
  );

  const tabFilteredCandidates = useMemo(() => {
    if (selectedTab === 'all') return filteredCandidates;
    return filteredCandidates.filter(c => {
      const candidateStageKeys = stagesConfig.enumToKeys[c.stage] || [];
      return candidateStageKeys.includes(selectedTab);
    });
  }, [filteredCandidates, selectedTab, stagesConfig]);

  // Load history when candidate selected
  useEffect(() => {
    if (!selectedCandidateId) {
      setCandidateHistory([]);
      return;
    }
    setHistoryLoading(true);
    getApplicationHistory(selectedCandidateId)
      .then(data => setCandidateHistory(Array.isArray(data) ? data : []))
      .catch(() => setCandidateHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [selectedCandidateId]);

  // Load entity files (resumes) when candidate selected
  useEffect(() => {
    if (!selectedCandidate?.entity_id) {
      setEntityFiles([]);
      return;
    }
    setFilesLoading(true);
    getEntityFiles(selectedCandidate.entity_id)
      .then(files => setEntityFiles(files))
      .catch(() => setEntityFiles([]))
      .finally(() => setFilesLoading(false));
  }, [selectedCandidate?.entity_id]);

  // Resume: original PDF + page images (JPEG renders from backend)
  const resumePdf = useMemo(
    () => entityFiles.find(f => f.file_type === 'resume' && f.mime_type === 'application/pdf') || null,
    [entityFiles],
  );
  const resumePages = useMemo(
    () => entityFiles
      .filter(f => f.file_type === 'resume' && f.mime_type === 'image/jpeg')
      .sort((a, b) => {
        // Sort by page number extracted from file_name "Резюме стр. N.jpg"
        const numA = parseInt(a.file_name.match(/(\d+)/)?.[1] || '0');
        const numB = parseInt(b.file_name.match(/(\d+)/)?.[1] || '0');
        return numA - numB;
      }),
    [entityFiles],
  );
  const hasResume = resumePdf !== null || resumePages.length > 0;

  // Auto-select first candidate when tab changes
  useEffect(() => {
    if (tabFilteredCandidates.length > 0 && !selectedCandidateId) {
      setSelectedCandidateId(tabFilteredCandidates[0].id);
    }
  }, [tabFilteredCandidates]);

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
    setMobileSidebar(false);
  };

  const deselectVacancy = () => {
    setSearchParams({});
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
        'flex-shrink-0 border-r border-white/[0.06] bg-dark-900/95 backdrop-blur-xl flex flex-col overflow-hidden z-50 transition-all duration-200',
        // Desktop: collapsible
        sidebarCollapsed
          ? 'lg:relative lg:translate-x-0 lg:w-0 lg:border-r-0 lg:overflow-hidden'
          : 'lg:relative lg:translate-x-0 lg:w-[260px]',
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
              onClick={() => setSidebarCollapsed(true)}
              className="hidden lg:block p-1 hover:bg-white/[0.06] rounded transition-colors"
              title="Свернуть панель"
            >
              <PanelLeftClose className="w-3.5 h-3.5 text-dark-400" />
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

      {/* Expand sidebar button (visible when collapsed) */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="hidden lg:flex items-center justify-center w-6 flex-shrink-0 border-r border-white/[0.06] bg-dark-900/50 hover:bg-dark-800/80 transition-colors group"
          title="Развернуть панель"
        >
          <PanelLeftOpen className="w-4 h-4 text-dark-500 group-hover:text-dark-300 transition-colors" />
        </button>
      )}

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
          /* Vacancy selected — show candidates (Huntflow-style master-detail) */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top bar: breadcrumb + search */}
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

              {/* Search + View toggle */}
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
                <div className="hidden sm:flex items-center bg-white/[0.03] rounded-lg border border-white/[0.06] p-0.5">
                  <button
                    onClick={() => setViewMode('detail')}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      viewMode === 'detail' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200',
                    )}
                    title="Детали"
                  >
                    <Columns3 className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline">Детали</span>
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      viewMode === 'list' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200',
                    )}
                    title="Список"
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline">Список</span>
                  </button>
                </div>
              </div>
            </div>

            {candidatesLoading ? (
              <div className="flex items-center justify-center py-16 flex-1">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : viewMode === 'list' ? (
              /* ===== LIST VIEW: grouped by stage (ClickUp-style) ===== */
              <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-1">
                {groupedByStage.length === 0 ? (
                  <div className="text-center py-16 text-dark-500 text-sm">
                    {candidateSearch ? 'Ничего не найдено' : 'Нет кандидатов в этой воронке'}
                  </div>
                ) : (
                  groupedByStage.map(([stage, items]) => {
                    const ck = stagesConfig.colorKeys[stage] || stagesConfig.keyToEnum[stage] || stage;
                    const colors = STAGE_COLORS[ck] || fallbackColor;
                    return (
                      <div key={stage} className="mb-1">
                        {/* Stage group header */}
                        <div className={clsx('w-full flex items-center gap-2 px-3 py-2 rounded-lg', colors.bg)}>
                          <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', colors.dot)} />
                          <span className={clsx('text-sm font-semibold uppercase', colors.text)}>
                            {stagesConfig.labels[stage] || STAGE_LABELS[stage] || stage}
                          </span>
                          <span className={clsx('text-xs ml-1', colors.text)}>{items.length}</span>
                        </div>
                        {/* Candidate rows */}
                        <div className="mt-0.5">
                          <div className="hidden md:grid grid-cols-[1fr_140px_100px_140px_100px] gap-2 px-3 py-1.5 text-[11px] text-dark-500 font-medium uppercase tracking-wide">
                            <span>Имя</span><span>Статус</span><span>Дата</span><span>Telegram</span><span>Источник</span>
                          </div>
                          {items.map((c) => (
                            <div
                              key={c.id}
                              onClick={() => navigate(`/contacts/${c.entity_id}`)}
                              className="flex flex-col md:grid md:grid-cols-[1fr_140px_100px_140px_100px] gap-1 md:gap-2 px-3 py-2.5 md:py-2 hover:bg-white/[0.03] rounded-lg cursor-pointer transition-colors border-b border-white/[0.03] last:border-b-0 group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-6 h-6 rounded-full bg-accent-500/10 flex items-center justify-center text-[10px] text-accent-400 font-medium flex-shrink-0">
                                  {(c.entity_name || '?').charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm text-dark-100 truncate group-hover:text-accent-400 transition-colors">
                                  {c.entity_name || 'Без имени'}
                                </span>
                                <div className="md:hidden ml-auto flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <StageDropdown
                                    currentStage={c.stage as ApplicationStage}
                                    onChangeStage={(newStage) => handleStageChange(c.id, newStage)}
                                    customLabels={stagesConfig.labels}
                                  />
                                </div>
                              </div>
                              <div className="hidden md:flex items-center" onClick={(e) => e.stopPropagation()}>
                                <StageDropdown
                                  currentStage={c.stage as ApplicationStage}
                                  onChangeStage={(newStage) => handleStageChange(c.id, newStage)}
                                  customLabels={stagesConfig.labels}
                                />
                              </div>
                              <span className="text-xs text-dark-400 items-center hidden md:flex">
                                {c.applied_at ? new Date(c.applied_at).toLocaleDateString('ru') : ''}
                              </span>
                              <div className="flex items-center gap-3 md:hidden pl-8 text-xs text-dark-400">
                                {c.applied_at && <span>{new Date(c.applied_at).toLocaleDateString('ru')}</span>}
                                {c.entity_telegram && <span>@{c.entity_telegram}</span>}
                                {c.source && <span>{c.source}</span>}
                              </div>
                              <span className="text-xs text-dark-400 truncate items-center hidden md:flex">
                                {c.entity_telegram ? `@${c.entity_telegram}` : ''}
                              </span>
                              <span className="text-xs text-dark-400 truncate items-center hidden md:flex">
                                {c.source || ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* ===== DETAIL VIEW: Huntflow-style master-detail ===== */
              <>
                {/* Stage tabs */}
                <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] overflow-x-auto no-scrollbar flex-shrink-0">
                  <button
                    onClick={() => { setSelectedTab('all'); setSelectedCandidateId(null); }}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                      selectedTab === 'all'
                        ? 'bg-accent-500 text-white'
                        : 'text-dark-400 hover:bg-white/[0.06]'
                    )}
                  >
                    Все <span className="ml-1 text-xs opacity-70">{filteredCandidates.length}</span>
                  </button>
                  {stagesConfig.keys.map(key => {
                    const count = groupedByStageMap[key]?.length || 0;
                    return (
                      <button
                        key={key}
                        onClick={() => { setSelectedTab(key); setSelectedCandidateId(null); }}
                        className={clsx(
                          'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                          selectedTab === key
                            ? 'bg-accent-500 text-white'
                            : 'text-dark-400 hover:bg-white/[0.06]'
                        )}
                      >
                        {stagesConfig.labels[key]} <span className="ml-1 text-xs opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Master-Detail split */}
                <div className="flex-1 flex overflow-hidden">
                  {/* Left: candidate list */}
                  <div className="w-[350px] flex-shrink-0 border-r border-white/[0.06] overflow-y-auto">
                    {tabFilteredCandidates.length === 0 ? (
                      <div className="flex items-center justify-center h-40 text-dark-500 text-sm">
                        Нет кандидатов
                      </div>
                    ) : (
                      tabFilteredCandidates.map(candidate => {
                        const isSelected = candidate.id === selectedCandidateId;
                        const initials = (candidate.entity_name || '?')[0].toUpperCase();
                        return (
                          <div
                            key={candidate.id}
                            onClick={() => { setSelectedCandidateId(candidate.id); setDetailTab('info'); }}
                            className={clsx(
                              'flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-white/[0.04] transition-colors',
                              isSelected
                                ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                                : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                            )}
                          >
                            <div className="w-9 h-9 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-sm font-medium flex-shrink-0">
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-dark-100 truncate">
                                {candidate.entity_name || 'Без имени'}
                              </div>
                              {candidate.entity_position && (
                                <div className="text-xs text-dark-500 truncate mt-0.5">
                                  {candidate.entity_position}
                                </div>
                              )}
                              <div className="text-xs text-dark-600 mt-0.5">
                                {candidate.source || ''}
                                {candidate.applied_at && (
                                  <span className="ml-1">{new Date(candidate.applied_at).toLocaleDateString('ru')}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Right: detail panel */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {selectedCandidate ? (
                      <>
                        {/* Detail tabs: Личные заметки / Резюме */}
                        <div className="flex items-center border-b border-white/[0.06] px-5 flex-shrink-0">
                          <button
                            onClick={() => setDetailTab('info')}
                            className={clsx(
                              'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                              detailTab === 'info'
                                ? 'border-accent-500 text-dark-100'
                                : 'border-transparent text-dark-400 hover:text-dark-200'
                            )}
                          >
                            Личные заметки
                          </button>
                          <button
                            onClick={() => setDetailTab('resume')}
                            className={clsx(
                              'px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                              detailTab === 'resume'
                                ? 'border-accent-500 text-dark-100'
                                : 'border-transparent text-dark-400 hover:text-dark-200'
                            )}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Резюме
                            {hasResume && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-500/15 text-accent-400 ml-1">
                                {resumePages.length || 1}
                              </span>
                            )}
                          </button>
                        </div>

                        {/* Tab content */}
                        <div className="flex-1 overflow-y-auto">
                          {detailTab === 'info' ? (
                            <div className="p-5 max-w-3xl">
                              {/* Action buttons */}
                              <div className="flex items-center gap-3 mb-6">
                                {selectedCandidate.entity_id && (
                                  <button
                                    onClick={() => navigate(`/contacts/${selectedCandidate.entity_id}`)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-lg text-sm text-dark-300 hover:bg-white/[0.04]"
                                  >
                                    <Users className="w-4 h-4" /> Открыть профиль
                                  </button>
                                )}
                              </div>

                              {/* Name & info */}
                              <h2 className="text-2xl font-semibold text-dark-100 mb-1">
                                {selectedCandidate.entity_name || 'Без имени'}
                              </h2>
                              {selectedCandidate.entity_position && (
                                <p className="text-dark-400 mb-4">{selectedCandidate.entity_position}</p>
                              )}

                              {/* Contact info */}
                              <div className="space-y-2 mb-6 text-sm">
                                {selectedCandidate.entity_phone && (
                                  <div className="flex items-center gap-3">
                                    <span className="text-dark-500 w-24">Телефон</span>
                                    <span className="text-dark-200">{selectedCandidate.entity_phone}</span>
                                  </div>
                                )}
                                {selectedCandidate.entity_email && (
                                  <div className="flex items-center gap-3">
                                    <span className="text-dark-500 w-24">Email</span>
                                    <span className="text-dark-200">{selectedCandidate.entity_email}</span>
                                  </div>
                                )}
                                {selectedCandidate.entity_telegram && (
                                  <div className="flex items-center gap-3">
                                    <span className="text-dark-500 w-24">Telegram</span>
                                    <span className="text-dark-200">@{selectedCandidate.entity_telegram}</span>
                                  </div>
                                )}
                                {selectedCandidate.source && (
                                  <div className="flex items-center gap-3">
                                    <span className="text-dark-500 w-24">Источник</span>
                                    <span className="text-dark-200">{selectedCandidate.source}</span>
                                  </div>
                                )}
                              </div>

                              {/* Current stage */}
                              <div className="mb-6 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-xs text-dark-500 mb-1">Текущий этап</div>
                                    <div className="text-sm font-medium text-dark-200">
                                      {stagesConfig.labels[
                                        (stagesConfig.enumToKeys[selectedCandidate.stage] || [])[0] || selectedCandidate.stage
                                      ] || selectedCandidate.stage}
                                    </div>
                                  </div>
                                  <StageDropdown
                                    currentStage={selectedCandidate.stage as ApplicationStage}
                                    onChangeStage={(newStage) => handleStageChange(selectedCandidate.id, newStage)}
                                    customLabels={stagesConfig.labels}
                                  />
                                </div>
                              </div>

                              {/* Compatibility score */}
                              {selectedCandidate.compatibility_score != null && (
                                <div className="mb-6 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                                  <div className="text-xs text-dark-500 mb-1">Совместимость</div>
                                  <div className="text-lg font-semibold text-accent-400">{selectedCandidate.compatibility_score.overall_score}%</div>
                                </div>
                              )}

                              {/* Notes */}
                              {selectedCandidate.notes && (
                                <div className="mb-6">
                                  <div className="text-xs text-dark-500 mb-2">Заметки</div>
                                  <div className="text-sm text-dark-300 whitespace-pre-wrap p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                                    {selectedCandidate.notes}
                                  </div>
                                </div>
                              )}

                              {/* History timeline */}
                              <div className="mt-6">
                                <div className="text-xs text-dark-500 mb-3 uppercase tracking-wider">История</div>
                                {historyLoading ? (
                                  <div className="flex items-center gap-2 text-dark-500 text-sm">
                                    <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
                                  </div>
                                ) : candidateHistory.length === 0 ? (
                                  <div className="text-sm text-dark-600">Нет записей</div>
                                ) : (
                                  <div className="space-y-3">
                                    {candidateHistory.map((entry: any, i: number) => (
                                      <div key={i} className="flex gap-3 text-sm">
                                        <div className="w-2 h-2 rounded-full bg-accent-500/50 mt-1.5 flex-shrink-0" />
                                        <div>
                                          <div className="text-dark-400">
                                            {entry.from_stage && (
                                              <>
                                                <span className="text-dark-500">{stagesConfig.labels[entry.from_stage] || STAGE_LABELS[entry.from_stage] || entry.from_stage}</span>
                                                <span className="mx-1">&rarr;</span>
                                              </>
                                            )}
                                            <span className="text-dark-300">{stagesConfig.labels[entry.to_stage] || STAGE_LABELS[entry.to_stage] || entry.to_stage}</span>
                                          </div>
                                          {entry.comment && (
                                            <div className="text-dark-500 mt-0.5">{entry.comment}</div>
                                          )}
                                          <div className="text-dark-600 text-xs mt-0.5">
                                            {entry.changed_by && <span>{entry.changed_by} &middot; </span>}
                                            {entry.created_at && new Date(entry.created_at).toLocaleString('ru')}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* Resume tab — Huntflow-style page viewer */
                            <div className="flex-1 flex flex-col h-full">
                              {filesLoading ? (
                                <div className="flex items-center justify-center py-16">
                                  <Loader2 className="w-6 h-6 animate-spin text-accent-500" />
                                </div>
                              ) : !hasResume ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                  <FileText className="w-12 h-12 text-dark-600 mb-3" />
                                  <p className="text-sm text-dark-400">Нет загруженных резюме</p>
                                  <p className="text-xs text-dark-500 mt-1">
                                    Загрузите PDF-резюме в профиле кандидата
                                  </p>
                                  {selectedCandidate.entity_id && (
                                    <button
                                      onClick={() => navigate(`/contacts/${selectedCandidate.entity_id}`)}
                                      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent-400 hover:bg-accent-500/10 rounded-lg transition-colors"
                                    >
                                      <Users className="w-3.5 h-3.5" />
                                      Открыть профиль
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="flex-1 flex flex-col">
                                  {/* Action bar */}
                                  <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                      {resumePdf && (
                                        <a
                                          href={`/api/entities/${resumePdf.entity_id}/files/${resumePdf.id}/download`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs text-dark-300 hover:bg-white/[0.04] transition-colors"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                          Скачать
                                        </a>
                                      )}
                                    </div>
                                    {/* Page indicator */}
                                    {resumePages.length > 1 && (
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => setCurrentResumePage(p => Math.max(0, p - 1))}
                                          disabled={currentResumePage === 0}
                                          className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
                                        >
                                          <ChevronRight className="w-4 h-4 text-dark-400 rotate-180" />
                                        </button>
                                        <span className="text-xs text-dark-400">
                                          Страница {currentResumePage + 1}/{resumePages.length}
                                        </span>
                                        <button
                                          onClick={() => setCurrentResumePage(p => Math.min(resumePages.length - 1, p + 1))}
                                          disabled={currentResumePage >= resumePages.length - 1}
                                          className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
                                        >
                                          <ChevronRight className="w-4 h-4 text-dark-400" />
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Resume file name */}
                                  {resumePdf && (
                                    <div className="px-5 py-2 border-b border-white/[0.04] flex-shrink-0">
                                      <a
                                        href={`/api/entities/${resumePdf.entity_id}/files/${resumePdf.id}/download`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs text-dark-400 hover:text-accent-400 transition-colors"
                                      >
                                        <Briefcase className="w-3 h-3" />
                                        {resumePdf.file_name}
                                      </a>
                                    </div>
                                  )}

                                  {/* Page image or PDF fallback */}
                                  <div className="flex-1 overflow-y-auto flex justify-center p-4 bg-dark-900/50">
                                    {resumePages.length > 0 ? (
                                      <img
                                        src={`/api/entities/${resumePages[currentResumePage].entity_id}/files/${resumePages[currentResumePage].id}/download`}
                                        alt={`Резюме стр. ${currentResumePage + 1}`}
                                        className="max-w-full h-auto rounded-lg shadow-2xl border border-white/[0.06]"
                                      />
                                    ) : resumePdf ? (
                                      <iframe
                                        src={`/api/entities/${resumePdf.entity_id}/files/${resumePdf.id}/download`}
                                        className="w-full h-full rounded-lg border border-white/[0.06] bg-white min-h-[600px]"
                                        title={resumePdf.file_name}
                                      />
                                    ) : null}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center h-full text-dark-500">
                        <div className="text-center">
                          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                          <p className="text-sm">Выберите кандидата из списка</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
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
