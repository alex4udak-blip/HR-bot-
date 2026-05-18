import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Briefcase,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Loader2,
  FolderOpen,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  Mail,
  Calendar,
  MessageSquare,
  ThumbsUp,
  Paperclip,
  XCircle,
  Copy,
  Check,
  CheckSquare,
  Square,
  Printer,
  Tag,
  Pencil,
  Archive,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import { getUsers, getApplications, updateApplication, getApplicationHistory, getEntityFiles, reconvertResume, downloadEntityFile, bulkMoveApplications, getEntity, uploadEntityFile, createApplication } from '@/services/api';
import { getOrgStages } from '@/services/api/auth';
import { addEntityNote } from '@/services/api/entities';
import { getTags, getEntityTags, addTagToEntity, removeTagFromEntity, createTag } from '@/services/api/tags';
import type { Tag as TagType } from '@/services/api/tags';
import type { EntityFile } from '@/services/api/entities';
import type { Vacancy, VacancyStatus, VacancyApplication, ApplicationStage } from '@/types';
import { VacancyStatusBadge, VacancyForm } from '@/components/vacancies';
import type { StageColumn } from '@/components/vacancies/StagesConfigModal';
import ParserModal from '@/components/parser/ParserModal';
import { NewCandidateModal } from '@/pages/AllCandidatesPage';

// ==================== Constants ====================

const TAG_PALETTE = [
  { color: 'var(--hf-red-500)', label: 'Красный' },
  { color: 'var(--hf-status-blue)', label: 'Синий' },
  { color: 'var(--hf-green-500)', label: 'Зелёный' },
  { color: 'var(--hf-status-yellow)', label: 'Жёлтый' },
  { color: 'var(--hf-status-purple)', label: 'Фиолетовый' },
  { color: 'var(--hf-status-orange)', label: 'Оранжевый' },
  { color: 'var(--hf-status-pink)', label: 'Розовый' },
  { color: 'var(--hf-status-cyan)', label: 'Голубой' },
];

const STATUS_FILTERS: { id: VacancyStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Открытые' },
  { id: 'paused', label: 'На паузе' },
  { id: 'closed', label: 'Закрытые' },
  { id: 'draft', label: 'Черновики' },
];

const STATUS_FILTER_IDS = new Set<string>(STATUS_FILTERS.map((f) => f.id));

const STAGE_ORDER = [
  'applied', 'screening', 'phone_screen', 'interview',
  'assessment', 'offer', 'hired', 'rejected', 'withdrawn',
] as const;

// Единые лейблы стадий — синхронизированы с backend KANBAN_STATUS_LABELS
// (отображаются на /all-candidates). Не разводить разные наборы по страницам.
const STAGE_LABELS: Record<string, string> = {
  applied: 'Новый',
  screening: 'Скрининг',
  phone_screen: 'Практика',
  interview: 'Тех-практика',
  assessment: 'ИС',
  offer: 'Оффер',
  hired: 'Принят',
  rejected: 'Отклонён',
  withdrawn: 'Отозван',
};

const VACANCY_STAGE_TAB_LABELS: Record<string, string> = {
  applied: 'Отклики',
  screening: 'В работе',
  phone_screen: 'Новые',
  interview: 'Резюме у заказчика',
  assessment: 'Интервью с HR',
  offer: 'Выставлен оффер',
  hired: 'Оффер принят',
  rejected: 'Отказ',
  withdrawn: 'Отказ',
};

const formatVacancyListDate = (date?: string | null) => {
  if (!date) return 'не указана';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'не указана';
  return parsed.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).replace(/\sг\.$/, '');
};

const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string; badge: string }> = {
  applied:      { bg: 'bg-[var(--hf-status-blue-bg)]',   text: 'text-[var(--hf-status-blue)]',    dot: 'bg-[var(--hf-status-blue)]',    badge: 'bg-[var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]' },
  screening:    { bg: 'bg-[var(--hf-status-cyan-bg)]',    text: 'text-[var(--hf-cyan-400)]',    dot: 'bg-[var(--hf-status-cyan)]',    badge: 'bg-[var(--hf-status-cyan-badge)] text-[var(--hf-cyan-400)]' },
  phone_screen: { bg: 'bg-[var(--hf-status-purple-bg)]',  text: 'text-[var(--hf-status-purple)]',  dot: 'bg-[var(--hf-status-purple)]',  badge: 'bg-[var(--hf-status-purple-badge)] text-[var(--hf-status-purple)]' },
  interview:    { bg: 'bg-[var(--hf-status-indigo-bg)]',  text: 'text-[var(--hf-status-indigo)]',  dot: 'bg-[var(--hf-status-indigo)]',  badge: 'bg-[var(--hf-status-indigo-badge)] text-[var(--hf-status-indigo)]' },
  assessment:   { bg: 'bg-[var(--hf-status-orange-bg)]',  text: 'text-[var(--hf-status-orange)]',  dot: 'bg-[var(--hf-status-orange)]',  badge: 'bg-[var(--hf-status-orange-badge)] text-[var(--hf-status-orange)]' },
  offer:        { bg: 'bg-[var(--hf-status-yellow-bg)]',  text: 'text-[var(--hf-status-yellow)]',  dot: 'bg-[var(--hf-status-yellow)]',  badge: 'bg-[var(--hf-status-yellow-badge)] text-[var(--hf-status-yellow)]' },
  hired:        { bg: 'bg-[var(--hf-status-green-bg)]',   text: 'text-[var(--hf-status-green)]',   dot: 'bg-[var(--hf-status-green)]',   badge: 'bg-[var(--hf-status-green-badge)] text-[var(--hf-status-green)]' },
  rejected:     { bg: 'bg-[var(--hf-status-red-bg)]',     text: 'text-[var(--hf-status-red)]',     dot: 'bg-[var(--hf-status-red)]',     badge: 'bg-[var(--hf-status-red-badge)] text-[var(--hf-status-red)]' },
  withdrawn:    { bg: 'bg-[var(--hf-status-gray-bg)]',    text: 'text-[var(--hf-status-gray)]',    dot: 'bg-[var(--hf-status-gray)]',    badge: 'bg-[var(--hf-status-gray-badge)] text-[var(--hf-status-gray)]' },
  // Extra colors for custom stages
  pink:         { bg: 'bg-[var(--hf-status-pink-bg)]',    text: 'text-[var(--hf-status-pink)]',    dot: 'bg-[var(--hf-status-pink)]',    badge: 'bg-[var(--hf-status-pink-badge)] text-[var(--hf-status-pink)]' },
  teal:         { bg: 'bg-[var(--hf-status-teal-bg)]',    text: 'text-[var(--hf-status-teal)]',    dot: 'bg-[var(--hf-status-teal)]',    badge: 'bg-[var(--hf-status-teal-badge)] text-[var(--hf-status-teal)]' },
  amber:        { bg: 'bg-[var(--hf-status-yellow-bg)]',   text: 'text-[var(--hf-status-yellow)]',   dot: 'bg-[var(--hf-status-yellow)]',   badge: 'bg-[var(--hf-status-yellow-badge)] text-[var(--hf-status-yellow)]' },
  lime:         { bg: 'bg-[var(--hf-status-lime-bg)]',    text: 'text-[var(--hf-status-lime)]',    dot: 'bg-[var(--hf-status-lime)]',    badge: 'bg-[var(--hf-status-lime-badge)] text-[var(--hf-status-lime)]' },
  rose:         { bg: 'bg-[var(--hf-status-rose-bg)]',    text: 'text-[var(--hf-status-rose)]',    dot: 'bg-[var(--hf-status-rose)]',    badge: 'bg-[var(--hf-status-rose-badge)] text-[var(--hf-status-rose)]' },
  violet:       { bg: 'bg-[var(--hf-status-purple-bg)]',  text: 'text-[var(--hf-status-purple)]',  dot: 'bg-[var(--hf-status-purple)]',  badge: 'bg-[var(--hf-status-purple-badge)] text-[var(--hf-status-purple)]' },
  sky:          { bg: 'bg-[var(--hf-status-sky-bg)]',     text: 'text-[var(--hf-status-sky)]',     dot: 'bg-[var(--hf-status-sky)]',     badge: 'bg-[var(--hf-status-sky-badge)] text-[var(--hf-status-sky)]' },
};

// Map color key to STAGE_COLORS key (some overlap with enum names)
const colorToStageColor = (colorKey?: string, enumVal?: string): string => {
  if (colorKey && STAGE_COLORS[colorKey]) return colorKey;
  if (enumVal && STAGE_COLORS[enumVal]) return enumVal;
  return 'screening'; // fallback cyan
};

const fallbackColor = { bg: 'bg-[var(--hf-white-alpha-10)]', text: 'text-[var(--hf-dark-300)]', dot: 'bg-[var(--hf-dark-400)]', badge: 'bg-[var(--hf-white-alpha-15)] text-[var(--hf-dark-300)]' };

// ==================== Types ====================

interface RecruiterGroup {
  userId: number;
  userName: string;
  vacancies: Vacancy[];
  expanded: boolean;
}

// ==================== Copy Button Helper ====================

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      toast.success('Скопировано');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded text-[var(--hf-dark-600)] hover:text-[var(--hf-dark-300)] transition-colors opacity-0 group-hover:opacity-100"
      title="Копировать"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-[var(--hf-status-green)]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function HuntflowOptionsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M3 8h12m0 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm-6 8h12M9 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ==================== Main Component ====================

export default function RecruiterFunnelsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { vacancies, isLoading, fetchVacancies, updateVacancy, deleteVacancy } = useVacancyStore();
  const { user } = useAuthStore();

  const isHrAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  // UI state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVacancy, setEditingVacancy] = useState<Vacancy | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [usersMap, setUsersMap] = useState<Record<number, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // ClickUp view: selected vacancy + candidates
  const selectedVacancyId = searchParams.get('v') ? Number(searchParams.get('v')) : null;
  const [candidates, setCandidates] = useState<VacancyApplication[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [showVacancySearch, setShowVacancySearch] = useState(false);
  const [showNewCandidateModal, setShowNewCandidateModal] = useState(false);
  const [showParserModal, setShowParserModal] = useState(false);
  const [vacancyEmptyStagesExpanded, setVacancyEmptyStagesExpanded] = useState(false);
  const vacancySearchRef = useRef<HTMLInputElement>(null);
  const vacancyStageScrollRef = useRef<HTMLDivElement>(null);
  const [vacancyStageCanScroll, setVacancyStageCanScroll] = useState({
    left: false,
    right: false,
  });

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkStageDropdownOpen, setBulkStageDropdownOpen] = useState(false);
  const bulkStageRef = useRef<HTMLDivElement>(null);


  // Master-detail state
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [candidateHistory, setCandidateHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'resume'>('info');
  const [entityFiles, setEntityFiles] = useState<EntityFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [currentResumePage, setCurrentResumePage] = useState(0);
  const [reconverting, setReconverting] = useState(false);
  const [resumePageUrls, setResumePageUrls] = useState<Record<number, string>>({});
  const [resumeImageError, setResumeImageError] = useState(false);
  const [resumeTextMode, setResumeTextMode] = useState(false);
  const [entityExtraData, setEntityExtraData] = useState<Record<string, unknown> | null>(null);

  // Tags state
  const [orgTags, setOrgTags] = useState<TagType[]>([]);
  const [entityTags, setEntityTags] = useState<TagType[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0].color);
  const [creatingTag, setCreatingTag] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // "Add to vacancy" dropdown state
  const [showAddToVacancy, setShowAddToVacancy] = useState(false);
  const [addingToVacancy, setAddingToVacancy] = useState(false);
  const addToVacancyRef = useRef<HTMLDivElement>(null);

  // Org-level лейблы этапов с /all-candidates → ⚙️.
  // Маппинг: ApplicationStage (applied/screening/phone_screen/...) ↔
  //          EntityStatus       (new/screening/practice/...)
  const APP_TO_ENTITY_STAGE: Record<string, string> = {
    applied: 'new',
    screening: 'screening',
    phone_screen: 'practice',
    interview: 'tech_practice',
    assessment: 'is_interview',
    offer: 'offer',
    hired: 'hired',
    rejected: 'rejected',
  };
  const [orgStageOverrides, setOrgStageOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    getOrgStages()
      .then((r) => {
        const map: Record<string, string> = {};
        r.stages.forEach((s) => { map[s.key] = s.label; });
        setOrgStageOverrides(map);
      })
      .catch(() => { /* не критично — будут дефолты */ });
  }, []);

  // Load data
  useEffect(() => {
    fetchVacancies();
  }, [fetchVacancies]);

  useEffect(() => {
    const urlStatus = searchParams.get('status');
    const nextStatus =
      urlStatus && STATUS_FILTER_IDS.has(urlStatus)
        ? (urlStatus as VacancyStatus | 'all')
        : 'all';
    if (nextStatus !== statusFilter) {
      setStatusFilter(nextStatus);
    }
  }, [searchParams, statusFilter]);

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
      result = result.filter((v) => {
        // Search by vacancy title and department
        const matchTitle = v.title.toLowerCase().includes(q) || v.department_name?.toLowerCase().includes(q);
        // For admins: also search by recruiter name
        if (isHrAdmin) {
          const recruiterName = v.created_by_name || usersMap[v.created_by ?? 0] || '';
          return matchTitle || recruiterName.toLowerCase().includes(q);
        }
        return matchTitle;
      });
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

  const selectedVacancySearchTitle = encodeURIComponent(selectedVacancy?.title?.trim() || '');

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
    setSelectedIds(new Set());
    setVacancyEmptyStagesExpanded(false);
  }, [selectedVacancyId]);

  useEffect(() => {
    if (showVacancySearch) {
      requestAnimationFrame(() => vacancySearchRef.current?.focus());
    }
  }, [showVacancySearch]);

  const updateVacancyStageScrollState = useCallback(() => {
    const el = vacancyStageScrollRef.current;
    if (!el) return;
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setVacancyStageCanScroll({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  const scrollVacancyStageTabs = useCallback(
    (direction: 'left' | 'right') => {
      const el = vacancyStageScrollRef.current;
      if (!el) return;
      el.scrollBy({
        left: direction === 'left' ? -520 : 520,
        behavior: 'smooth',
      });
      window.setTimeout(updateVacancyStageScrollState, 320);
    },
    [updateVacancyStageScrollState],
  );

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

  // Авто-refresh когда юзер возвращается на вкладку браузера —
  // например, после добавления кандидата через волшебную кнопку из
  // другой вкладки. Иначе нужен F5 чтобы увидеть новых.
  useEffect(() => {
    const onFocus = () => {
      if (selectedVacancyId) loadCandidates(selectedVacancyId);
      fetchVacancies();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedVacancyId, loadCandidates, fetchVacancies]);

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
    // Утилита: для App-стадии находим org-override через mapping → EntityStatus.
    const labelFor = (appStage: string, fallback: string): string => {
      const entityKey = APP_TO_ENTITY_STAGE[appStage];
      if (entityKey && orgStageOverrides[entityKey]) return orgStageOverrides[entityKey];
      return fallback;
    };

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
        // Per-vacancy custom_stages всё ещё имеют приоритет, но если
        // лейбл там пустой/совпадает с дефолтом — берём org-override.
        labels: Object.fromEntries(visible.map(c => {
          const appKey = c.maps_to || c.key;
          return [c.key, labelFor(appKey, c.label)];
        })),
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
      // Для дефолтной воронки лейбл = org-override либо STAGE_LABELS.
      labels: Object.fromEntries(STAGE_ORDER.map(s => [s, labelFor(s, STAGE_LABELS[s] || s)])),
      keyToEnum: Object.fromEntries(STAGE_ORDER.map(s => [s, s])),
      enumToKeys,
      colorKeys: Object.fromEntries(STAGE_ORDER.map(s => [s, s])),
      isVirtual: Object.fromEntries(STAGE_ORDER.map(s => [s, false])),
    };
  }, [selectedVacancy, orgStageOverrides]);

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

  const vacancyPrimaryStageLimit = 5;

  const vacancyVisibleStageKeys = useMemo(() => {
    return stagesConfig.keys.filter((key, index) => {
      const count = groupedByStageMap[key]?.length || 0;
      return vacancyEmptyStagesExpanded || index < vacancyPrimaryStageLimit || count > 0 || selectedTab === key;
    });
  }, [groupedByStageMap, selectedTab, stagesConfig.keys, vacancyEmptyStagesExpanded]);

  const vacancyHiddenEmptyStages = Math.max(stagesConfig.keys.length - vacancyVisibleStageKeys.length, 0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateVacancyStageScrollState);
    const timer = window.setTimeout(updateVacancyStageScrollState, 260);
    window.addEventListener('resize', updateVacancyStageScrollState);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener('resize', updateVacancyStageScrollState);
    };
  }, [
    candidatesLoading,
    showVacancySearch,
    vacancyHiddenEmptyStages,
    vacancyVisibleStageKeys.length,
    selectedVacancyId,
    updateVacancyStageScrollState,
  ]);

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

  // Load entity extra_data for resume text view
  useEffect(() => {
    setResumeTextMode(false);
    setEntityExtraData(null);
    if (!selectedCandidate?.entity_id) return;
    getEntity(selectedCandidate.entity_id)
      .then(entity => setEntityExtraData(entity.extra_data || null))
      .catch(() => setEntityExtraData(null));
  }, [selectedCandidate?.entity_id]);

  // Resume: original document (PDF or DOC/DOCX) + page images (JPEG renders from backend)
  const resumeOriginal = useMemo(
    () => entityFiles.find(f => f.file_type === 'resume' && f.mime_type !== 'image/jpeg') || null,
    [entityFiles],
  );
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
  const hasResume = resumeOriginal !== null || resumePages.length > 0;

  // Load blob URLs for resume page images
  useEffect(() => {
    // Cleanup old URLs
    Object.values(resumePageUrls).forEach(url => URL.revokeObjectURL(url));
    setResumePageUrls({});
    setResumeImageError(false);
    setCurrentResumePage(0);

    if (resumePages.length === 0) return;

    resumePages.forEach((page, idx) => {
      downloadEntityFile(page.entity_id, page.id)
        .then(blob => {
          const url = URL.createObjectURL(blob);
          setResumePageUrls(prev => ({ ...prev, [idx]: url }));
        })
        .catch(() => {
          setResumeImageError(true);
        });
    });

    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(resumePageUrls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [resumePages]);

  // Reconvert handler
  const handleReconvert = async () => {
    if (!selectedCandidate?.entity_id) return;
    setReconverting(true);
    try {
      const result = await reconvertResume(selectedCandidate.entity_id);
      toast.success(`Пересоздано ${result.pages_created} стр.`);
      // Reload files
      const files = await getEntityFiles(selectedCandidate.entity_id);
      setEntityFiles(files);
    } catch {
      toast.error('Не удалось пересоздать страницы');
    } finally {
      setReconverting(false);
    }
  };

  // Print resume handler
  const handlePrintResume = useCallback(() => {
    const urls = Object.values(resumePageUrls).filter(Boolean);
    if (urls.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const imagesHtml = urls.map(url =>
      `<img src="${url}" style="max-width:100%;page-break-after:always;display:block;margin:0 auto;" />`
    ).join('');
    printWindow.document.write(`<!DOCTYPE html><html><head><title>\u0420\u0435\u0437\u044e\u043c\u0435</title><style>@media print{body{margin:0}img{page-break-after:always}}</style></head><body>${imagesHtml}</body></html>`);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  }, [resumePageUrls]);

  // Build resume text from entity extra_data
  const resumeTextContent = useMemo(() => {
    if (!entityExtraData) return null;
    const parts: string[] = [];
    if (entityExtraData.summary) {
      parts.push(String(entityExtraData.summary));
    }
    if (Array.isArray(entityExtraData.skills) && entityExtraData.skills.length > 0) {
      parts.push('\n--- \u041d\u0430\u0432\u044b\u043a\u0438 ---');
      parts.push((entityExtraData.skills as string[]).join(', '));
    }
    if (Array.isArray(entityExtraData.experience) && entityExtraData.experience.length > 0) {
      parts.push('\n--- \u041e\u043f\u044b\u0442 \u0440\u0430\u0431\u043e\u0442\u044b ---');
      for (const exp of entityExtraData.experience as Array<Record<string, string>>) {
        const line = [exp.position, exp.company, exp.start_date && exp.end_date ? `${exp.start_date} \u2014 ${exp.end_date}` : exp.start_date || exp.end_date].filter(Boolean).join(' | ');
        if (line) parts.push(line);
        if (exp.description) parts.push(exp.description);
        parts.push('');
      }
    }
    if (Array.isArray(entityExtraData.education) && entityExtraData.education.length > 0) {
      parts.push('\n--- \u041e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u043d\u0438\u0435 ---');
      for (const edu of entityExtraData.education as Array<Record<string, string>>) {
        const line = [edu.degree, edu.field, edu.institution, edu.year].filter(Boolean).join(' | ');
        if (line) parts.push(line);
      }
    }
    if (Array.isArray(entityExtraData.languages) && entityExtraData.languages.length > 0) {
      parts.push('\n--- \u042f\u0437\u044b\u043a\u0438 ---');
      parts.push((entityExtraData.languages as string[]).join(', '));
    }
    if (entityExtraData.location) {
      parts.push('\n--- \u041c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 ---');
      parts.push(String(entityExtraData.location));
    }
    if (entityExtraData.experience_years) {
      parts.push(`\n\u041e\u043f\u044b\u0442: ${entityExtraData.experience_years} \u043b\u0435\u0442`);
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }, [entityExtraData]);

  // Load org tags once
  useEffect(() => {
    getTags().then(setOrgTags).catch(() => setOrgTags([]));
  }, []);

  // Load entity tags when candidate selected
  useEffect(() => {
    if (!selectedCandidate?.entity_id) { setEntityTags([]); return; }
    getEntityTags(selectedCandidate.entity_id)
      .then(setEntityTags)
      .catch(() => setEntityTags([]));
  }, [selectedCandidate?.entity_id]);

  // Close tag dropdown on outside click
  useEffect(() => {
    if (!showTagDropdown) return;
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTagDropdown]);

  // Tag handlers
  const handleAddTag = useCallback(async (tagId: number) => {
    if (!selectedCandidate?.entity_id) return;
    try {
      await addTagToEntity(selectedCandidate.entity_id, tagId);
      const tag = orgTags.find(t => t.id === tagId);
      if (tag) setEntityTags(prev => [...prev, tag]);
    } catch {
      toast.error('Ошибка добавления метки');
    }
  }, [selectedCandidate?.entity_id, orgTags]);

  const handleRemoveTag = useCallback(async (tagId: number) => {
    if (!selectedCandidate?.entity_id) return;
    try {
      await removeTagFromEntity(selectedCandidate.entity_id, tagId);
      setEntityTags(prev => prev.filter(t => t.id !== tagId));
    } catch {
      toast.error('Ошибка удаления метки');
    }
  }, [selectedCandidate?.entity_id]);

  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    try {
      const tag = await createTag({ name: newTagName.trim(), color: newTagColor });
      setOrgTags(prev => [...prev, tag]);
      setNewTagName('');
      // Auto-add to current entity
      if (selectedCandidate?.entity_id) {
        await addTagToEntity(selectedCandidate.entity_id, tag.id);
        setEntityTags(prev => [...prev, tag]);
      }
    } catch {
      toast.error('Ошибка создания метки');
    } finally {
      setCreatingTag(false);
    }
  }, [newTagName, newTagColor, selectedCandidate?.entity_id]);

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

  const handleStatusFilterChange = (nextStatus: VacancyStatus | 'all') => {
    setStatusFilter(nextStatus);
    if (!selectedVacancyId) {
      setSearchParams(nextStatus === 'all' ? {} : { status: nextStatus });
    }
  };

  const selectVacancy = (vacancyId: number) => {
    const params: Record<string, string> = { v: String(vacancyId) };
    if (statusFilter !== 'all') params.status = statusFilter;
    setSearchParams(params);
    setCandidateSearch('');
    setMobileSidebar(false);
  };

  const deselectVacancy = () => {
    if (statusFilter !== 'all') {
      setSearchParams({ status: statusFilter });
      return;
    }
    setSearchParams({});
  };

  // Confirmation modal — единый для close/delete (window.confirm не везде работает в headless/iframe).
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'close' | 'delete';
    vacancy: Vacancy;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const handleCloseVacancy = (vacancy: Vacancy) => {
    setConfirmDialog({ type: 'close', vacancy });
  };

  const handleDeleteVacancy = (vacancy: Vacancy) => {
    setConfirmDialog({ type: 'delete', vacancy });
  };

  const runConfirmedAction = async () => {
    if (!confirmDialog) return;
    setConfirmBusy(true);
    try {
      if (confirmDialog.type === 'close') {
        await updateVacancy(confirmDialog.vacancy.id, { status: 'closed' });
        toast.success('Вакансия закрыта');
      } else {
        await deleteVacancy(confirmDialog.vacancy.id);
        toast.success('Вакансия удалена');
        if (selectedVacancyId === confirmDialog.vacancy.id) {
          setSearchParams({});
        }
      }
      setConfirmDialog(null);
      fetchVacancies();
    } catch {
      toast.error(confirmDialog.type === 'close' ? 'Ошибка при закрытии' : 'Ошибка при удалении');
    } finally {
      setConfirmBusy(false);
    }
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

  // ─── Interview scheduling modal ───
  const [interviewForCandidate, setInterviewForCandidate] = useState<typeof selectedCandidate | null>(null);
  const [interviewDateTime, setInterviewDateTime] = useState('');
  const [interviewSaving, setInterviewSaving] = useState(false);

  const handleSaveInterview = useCallback(async () => {
    if (!interviewForCandidate) return;
    if (!interviewDateTime) {
      toast.error('Выберите дату и время');
      return;
    }
    setInterviewSaving(true);
    try {
      // datetime-local даёт 'YYYY-MM-DDTHH:mm' без таймзоны — backend ожидает ISO
      const iso = new Date(interviewDateTime).toISOString();
      await updateApplication(interviewForCandidate.id, { next_interview_at: iso });
      toast.success('Интервью назначено');
      setInterviewForCandidate(null);
      setInterviewDateTime('');
    } catch {
      toast.error('Не удалось назначить интервью');
    } finally {
      setInterviewSaving(false);
    }
  }, [interviewForCandidate, interviewDateTime]);

  // ─── Comment textarea state ───
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);

  const handleSaveComment = useCallback(async (text: string) => {
    if (!selectedCandidate?.entity_id || !text.trim()) return;
    setCommentSaving(true);
    try {
      // Через POST /entities/{id}/notes — рекрутёру достаточно view-доступа.
      const resp = await addEntityNote(selectedCandidate.entity_id, {
        text: text.trim(),
        stage: selectedCandidate.stage as string | undefined,
        stage_label: stagesConfig.labels[selectedCandidate.stage] || (selectedCandidate.stage as string),
      });
      // Локально мерджим только что добавленный коммент в entity_data
      // — иначе пришлось бы ждать reload entity, и юзер думал бы что
      // 'не сохранилось'.
      setEntityExtraData((prev) => {
        const existing = Array.isArray(prev?.notes) ? (prev!.notes as unknown[]) : [];
        return { ...(prev || {}), notes: [...existing, resp.note] };
      });
      toast.success('Комментарий сохранён');
      if (commentRef.current) commentRef.current.value = '';
    } catch (err) {
      console.error('Failed to save comment:', err);
      toast.error('Не удалось сохранить комментарий');
    } finally {
      setCommentSaving(false);
    }
  }, [selectedCandidate, stagesConfig]);

  // ─── File attach (Файл button) ───
  const candidateFileInputRef = useRef<HTMLInputElement | null>(null);
  const [candidateFileUploading, setCandidateFileUploading] = useState(false);

  const handleCandidateFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCandidate?.entity_id) return;
    setCandidateFileUploading(true);
    try {
      await uploadEntityFile(selectedCandidate.entity_id, file, 'other');
      toast.success(`Файл "${file.name}" загружен`);
      // Re-fetch entity files so они показались в правой панели
      const fresh = await getEntityFiles(selectedCandidate.entity_id);
      setEntityFiles(fresh);
    } catch {
      toast.error('Ошибка загрузки файла');
    } finally {
      setCandidateFileUploading(false);
      if (e.target) e.target.value = '';
    }
  }, [selectedCandidate]);

  // Toggle checkbox selection for a candidate
  const toggleCandidateSelection = useCallback((candidateId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }, []);

  // Bulk move selected candidates to a stage
  const handleBulkMove = useCallback(async (stage: ApplicationStage) => {
    if (selectedIds.size === 0) return;
    setBulkMoving(true);
    setBulkStageDropdownOpen(false);
    try {
      const ids = Array.from(selectedIds);
      const updated = await bulkMoveApplications(ids, stage);
      const updatedMap = new Map(updated.map(a => [a.id, a]));
      setCandidates(prev =>
        prev.map(c => updatedMap.has(c.id) ? { ...c, stage } : c)
      );
      setSelectedIds(new Set());
      toast.success(`${ids.length} кандидатов перемещено`);
      fetchVacancies();
    } catch {
      toast.error('Ошибка массового перемещения');
    } finally {
      setBulkMoving(false);
    }
  }, [selectedIds, fetchVacancies]);

  // Bulk reject
  const handleBulkReject = useCallback(() => {
    handleBulkMove('rejected' as ApplicationStage);
  }, [handleBulkMove]);

  // Close bulk stage dropdown on outside click
  useEffect(() => {
    if (!bulkStageDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (bulkStageRef.current && !bulkStageRef.current.contains(e.target as Node)) {
        setBulkStageDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bulkStageDropdownOpen]);

  const anySelected = selectedIds.size > 0;

  // Close "add to vacancy" dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addToVacancyRef.current && !addToVacancyRef.current.contains(e.target as Node)) {
        setShowAddToVacancy(false);
      }
    };
    if (showAddToVacancy) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAddToVacancy]);

  // Get vacancies available for adding a candidate (exclude current vacancy, show only open ones)
  const availableVacanciesForCandidate = useMemo(() => {
    if (!selectedCandidate?.entity_id) return [];
    return vacancies.filter(v =>
      v.id !== selectedVacancyId &&
      v.status === 'open'
    );
  }, [vacancies, selectedVacancyId, selectedCandidate?.entity_id]);

  // Handle adding candidate to another vacancy
  const handleAddToVacancy = useCallback(async (targetVacancyId: number) => {
    if (!selectedCandidate?.entity_id) return;
    setAddingToVacancy(true);
    try {
      await createApplication(targetVacancyId, {
        vacancy_id: targetVacancyId,
        entity_id: selectedCandidate.entity_id,
        source: 'manual_add',
      });
      const targetVacancy = vacancies.find(v => v.id === targetVacancyId);
      toast.success(`Кандидат добавлен в «${targetVacancy?.title || targetVacancyId}»`);
      setShowAddToVacancy(false);
      fetchVacancies();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Ошибка добавления на вакансию';
      toast.error(detail);
    } finally {
      setAddingToVacancy(false);
    }
  }, [selectedCandidate?.entity_id, vacancies, fetchVacancies]);

  // ==================== Render ====================

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Mobile sidebar overlay (admin only) */}
      {isHrAdmin && mobileSidebar && (
        <div
          className="lg:hidden fixed inset-0 bg-[var(--hf-black-alpha-50)] z-40"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      {/* ========== LEFT SIDEBAR: Recruiter tree (admin only) ========== */}
      {isHrAdmin && !selectedVacancy && statusFilter !== 'closed' && <aside className={clsx(
        'flex-shrink-0 border-r border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-dark-panel-alpha-95)] backdrop-blur-xl flex flex-col overflow-hidden z-50 transition-all duration-200',
        // Desktop: collapsible
        sidebarCollapsed
          ? 'lg:relative lg:translate-x-0 lg:w-0 lg:border-r-0 lg:overflow-hidden'
          : 'lg:relative lg:translate-x-0 lg:w-[260px]',
        // Mobile: slide-in overlay
        'fixed inset-y-0 left-0 w-[280px]',
        mobileSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--hf-white-alpha-06)]">
          <span className="text-xs font-semibold text-[var(--hf-dark-400)] uppercase tracking-wider">
            {isHrAdmin ? 'Рекрутеры' : 'Мои воронки'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1 hover:bg-[var(--hf-white-alpha-06)] rounded transition-colors"
              title="Новая воронка"
            >
              <Plus className="w-3.5 h-3.5 text-[var(--hf-dark-400)]" />
            </button>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="hidden lg:block p-1 hover:bg-[var(--hf-white-alpha-06)] rounded transition-colors"
              title="Свернуть панель"
            >
              <PanelLeftClose className="w-3.5 h-3.5 text-[var(--hf-dark-400)]" />
            </button>
            <button
              onClick={() => setMobileSidebar(false)}
              className="lg:hidden p-1 hover:bg-[var(--hf-white-alpha-06)] rounded transition-colors"
            >
              <X className="w-3.5 h-3.5 text-[var(--hf-dark-400)]" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-[color:var(--hf-white-alpha-04)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--hf-dark-500)]" />
            <input
              type="text"
              placeholder={isHrAdmin ? "Поиск по рекрутеру..." : "Поиск воронок..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[var(--hf-white-alpha-03)] border border-[color:var(--hf-white-alpha-06)] rounded-lg text-xs text-[var(--hf-dark-200)] placeholder:text-[var(--hf-dark-500)] focus:outline-none focus:border-[color:var(--hf-accent-border-40)]"
            />
          </div>
        </div>

        {/* Status filter pills */}
        <div className="px-3 py-2 border-b border-[color:var(--hf-white-alpha-04)] flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => handleStatusFilterChange(f.id)}
              className={clsx(
                'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors',
                statusFilter === f.id
                  ? 'bg-[var(--hf-accent-bg-15)] text-[var(--hf-accent)]'
                  : 'text-[var(--hf-dark-500)] hover:text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)]'
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
              <div className="w-5 h-5 border-2 border-[var(--hf-accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : recruiterGroups.length === 0 ? (
            <div className="px-4 py-8 text-center text-[var(--hf-dark-500)] text-xs">
              {search ? 'Ничего не найдено' : 'Нет воронок'}
            </div>
          ) : (
            recruiterGroups.map((group) => (
              <div key={group.userId}>
                {/* Recruiter folder header */}
                {isHrAdmin && (
                  <button
                    onClick={() => toggleGroup(group.userId)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--hf-white-alpha-04)] transition-colors group"
                  >
                    {group.expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[var(--hf-dark-500)] flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--hf-dark-500)] flex-shrink-0" />
                    )}
                    <FolderOpen className="w-4 h-4 text-[var(--hf-status-purple)] flex-shrink-0" />
                    <span className="text-sm text-[var(--hf-dark-200)] truncate flex-1 text-left font-medium">
                      {group.userName}
                    </span>
                    <span className="text-[10px] text-[var(--hf-dark-500)] flex-shrink-0">
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
                              ? 'bg-[var(--hf-accent-bg-10)] text-[var(--hf-accent)]'
                              : 'hover:bg-[var(--hf-white-alpha-04)] text-[var(--hf-dark-300)]',
                          )}
                        >
                          <span className={clsx(
                            'w-1.5 h-1.5 rounded-full flex-shrink-0',
                            v.status === 'open' ? 'bg-[var(--hf-status-green)]' :
                            v.status === 'paused' ? 'bg-[var(--hf-status-yellow)]' :
                            v.status === 'closed' ? 'bg-[var(--hf-status-red)]' : 'bg-[var(--hf-dark-500)]'
                          )} />
                          <span className={clsx('text-sm truncate flex-1', !v.title?.trim() && 'italic text-[var(--hf-dark-500)]')}>{v.title?.trim() || 'Без названия'}</span>
                          <span className={clsx(
                            'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                            isSelected ? 'bg-[var(--hf-accent-bg-20)] text-[var(--hf-accent)]' : 'bg-[var(--hf-white-alpha-06)] text-[var(--hf-dark-400)]',
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
      </aside>}

      {/* Expand sidebar button (visible when collapsed, admin only) */}
      {isHrAdmin && !selectedVacancy && statusFilter !== 'closed' && sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="hidden lg:flex items-center justify-center w-6 flex-shrink-0 border-r border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-dark-panel-alpha-50)] hover:bg-[var(--hf-dark-panel-alpha-80)] transition-colors group"
          title="Развернуть панель"
        >
          <PanelLeftOpen className="w-4 h-4 text-[var(--hf-dark-500)] group-hover:text-[var(--hf-dark-300)] transition-colors" />
        </button>
      )}

      {/* ========== MAIN CONTENT ========== */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* No vacancy selected — show funnels overview */}
        {!selectedVacancy ? (
          statusFilter === 'closed' ? (
            <ClosedVacanciesView
              vacancies={filteredVacancies}
              isLoading={isLoading}
              search={search}
              onSearchChange={setSearch}
              onClearSearch={() => setSearch('')}
              onSelectVacancy={selectVacancy}
              onEditVacancy={setEditingVacancy}
              onDeleteVacancy={handleDeleteVacancy}
              usersMap={usersMap}
            />
          ) : (
          <div className="flex-1 flex flex-col overflow-y-auto p-4 lg:p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileSidebar(true)}
                  className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-[var(--hf-white-alpha-06)] transition-colors"
                >
                  <Menu className="w-5 h-5 text-[var(--hf-dark-300)]" />
                </button>
                <div>
                <h1 className="text-xl lg:text-2xl font-bold text-[var(--hf-dark-50)]">
                  {isHrAdmin ? 'Воронки рекрутеров' : 'Мои воронки'}
                </h1>
                <p className="text-sm text-[var(--hf-dark-400)] mt-0.5">
                  {filteredVacancies.length} воронок
                  {isHrAdmin && ` у ${recruiterGroups.length} рекрутеров`}
                </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--hf-accent)] hover:bg-[var(--hf-accent-hover)] text-[var(--hf-white)] text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Новая воронка
              </button>
            </div>

            {/* Funnels grid */}
            {filteredVacancies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Briefcase className="w-10 h-10 text-[var(--hf-dark-500)]" />
                <div className="text-center">
                  <p className="text-[var(--hf-dark-100)] font-medium">Пока нет воронок</p>
                  <p className="text-[var(--hf-dark-400)] text-sm mt-1">Создайте первую воронку для начала работы</p>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--hf-accent)] hover:bg-[var(--hf-accent-hover)] text-[var(--hf-white)] text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Создать воронку
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredVacancies.map((v) => (
                  <FunnelCard key={v.id} vacancy={v} onClick={() => selectVacancy(v.id)} onEdit={() => setEditingVacancy(v)} onClose={() => handleCloseVacancy(v)} onDelete={() => handleDeleteVacancy(v)} />
                ))}
              </div>
            )}
          </div>
          )
        ) : (
          /* Vacancy selected — show candidates (Huntflow-style master-detail) */
          <div className="hf-vacancy-workspace flex-1 flex flex-col overflow-hidden">
            {/* Top bar: kept for layout parity; visible search lives in stage island like /all-candidates */}
            <div className="hf-vacancy-topbar flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-5 py-2 sm:py-3 gap-2 border-b border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white-alpha-02)] flex-shrink-0">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1.5 text-sm min-w-0">
                <button
                  onClick={() => setMobileSidebar(true)}
                  className="lg:hidden p-1.5 -ml-1 rounded-lg hover:bg-[var(--hf-white-alpha-06)] transition-colors flex-shrink-0"
                >
                  <Menu className="w-4 h-4 text-[var(--hf-dark-400)]" />
                </button>
                <button
                  onClick={deselectVacancy}
                  className="sm:hidden text-[var(--hf-dark-500)] hover:text-[var(--hf-dark-300)] transition-colors text-xs"
                >
                  ← Назад
                </button>
                <span className={clsx(
                  'hf-vacancy-title',
                  'font-medium truncate max-w-[180px] sm:max-w-[250px]',
                  selectedVacancy.title?.trim() ? 'text-[var(--hf-dark-200)]' : 'text-[var(--hf-dark-500)] italic',
                )}>
                  {selectedVacancy.title?.trim() || 'Без названия'}{selectedVacancy.department_name ? ` · ${selectedVacancy.department_name}` : ''}
                </span>
                <span className="hf-vacancy-counter text-xs text-[var(--hf-dark-500)] ml-1 sm:ml-2 flex-shrink-0">
                  {candidates.length}
                </span>
              </div>

              {/* Search + Actions */}
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <div className="hf-vacancy-search relative flex-1 sm:flex-none">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--hf-dark-500)]" />
                  <input
                    type="text"
                    placeholder="Поиск..."
                    value={candidateSearch}
                    onChange={(e) => setCandidateSearch(e.target.value)}
                    className="w-full sm:w-44 pl-8 pr-3 py-1.5 bg-[var(--hf-white-alpha-03)] border border-[color:var(--hf-white-alpha-06)] rounded-lg text-xs text-[var(--hf-dark-200)] placeholder:text-[var(--hf-dark-500)] focus:outline-none focus:border-[color:var(--hf-accent-border-40)]"
                  />
                </div>
              </div>
            </div>

            {candidatesLoading ? (
              <div className="flex items-center justify-center py-16 flex-1">
                <div className="w-6 h-6 border-2 border-[var(--hf-accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              /* ===== DETAIL VIEW: Huntflow-style master-detail ===== */
              <>
                {/* Stage tabs: same visual shell as /all-candidates, vacancy-specific content */}
                <div className="hf-vacancy-stage-shell hf-top-stage-shell">
                  <div
                    ref={vacancyStageScrollRef}
                    onScroll={updateVacancyStageScrollState}
                    className={clsx(
                      'hf-vacancy-stage-tabs hf-top-stage-tabs no-scrollbar',
                      !showVacancySearch && 'hf-top-stage-tabs-padded',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setShowVacancySearch((value) => !value)}
                      className={clsx(
                        'hf-top-stage-search-toggle',
                        (showVacancySearch || candidateSearch) && 'hf-top-stage-search-toggle-active',
                      )}
                      title={showVacancySearch ? 'Скрыть поиск' : 'Открыть поиск'}
                      aria-pressed={showVacancySearch}
                    >
                      <Search className="h-[var(--hf-candidates-search-icon)] w-[var(--hf-candidates-search-icon)]" />
                    </button>

                    {showVacancySearch ? (
                      <div className="hf-top-stage-search">
                        <input
                          ref={vacancySearchRef}
                          value={candidateSearch}
                          onChange={(e) => setCandidateSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              if (candidateSearch) setCandidateSearch('');
                              else setShowVacancySearch(false);
                            }
                          }}
                          placeholder="Поиск по имени, почте, телефону..."
                          className="hf-top-stage-search-input"
                        />
                        {candidateSearch ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCandidateSearch('');
                              vacancySearchRef.current?.focus();
                            }}
                            className="hf-top-stage-search-action hf-top-stage-search-clear"
                            title="Очистить поиск"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => { setSelectedTab('all'); setSelectedCandidateId(null); }}
                          className={clsx(
                            'hf-top-stage-item hf-top-stage-all',
                            selectedTab === 'all'
                              ? 'hf-top-stage-item-active'
                              : 'hf-top-stage-item-idle',
                          )}
                        >
                          Из базы
                          <span className={clsx(
                            'hf-top-stage-badge',
                            selectedTab === 'all' && 'hf-top-stage-badge-active',
                          )}>
                            {filteredCandidates.length}
                          </span>
                          {selectedTab === 'all' && <span className="hf-top-stage-underline-all" />}
                        </button>

                        {vacancyVisibleStageKeys.map(key => {
                          const count = groupedByStageMap[key]?.length || 0;
                          const vacancyStageLabel = VACANCY_STAGE_TAB_LABELS[stagesConfig.keyToEnum[key] || key]
                            || stagesConfig.labels[key];
                          const isActive = selectedTab === key;
                          return (
                            <button
                              key={key}
                              onClick={() => { setSelectedTab(key); setSelectedCandidateId(null); }}
                              className={clsx(
                                'hf-top-stage-item',
                                isActive
                                  ? 'hf-top-stage-item-active'
                                  : 'hf-top-stage-item-idle',
                              )}
                            >
                              {vacancyStageLabel}
                              {count > 0 && <span className="hf-top-stage-badge hf-top-stage-badge-muted">{count}</span>}
                              {isActive && <span className="hf-top-stage-underline" />}
                            </button>
                          );
                        })}
                        {vacancyHiddenEmptyStages > 0 && (
                          <button
                            type="button"
                            onClick={() => setVacancyEmptyStagesExpanded(true)}
                            className="hf-top-stage-empty-group"
                          >
                            • • {vacancyHiddenEmptyStages} этапов без кандидатов • •
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="hf-top-stage-action-cell">
                    <button
                      type="button"
                      onClick={() => setEditingVacancy(selectedVacancy)}
                      className="hf-top-stage-action-btn"
                      title="Действия с вакансией"
                      aria-label="Действия с вакансией"
                    >
                      <HuntflowOptionsIcon className="hf-top-stage-options-icon" />
                    </button>
                  </div>
                  {!showVacancySearch && vacancyStageCanScroll.left ? (
                    <button
                      type="button"
                      onClick={() => scrollVacancyStageTabs('left')}
                      className="hf-top-stage-arrow hf-top-stage-arrow-left"
                      title="Прокрутить этапы влево"
                    >
                      <ChevronLeft className="hf-top-stage-arrow-icon" />
                    </button>
                  ) : null}
                  {!showVacancySearch && vacancyStageCanScroll.right ? (
                    <button
                      type="button"
                      onClick={() => scrollVacancyStageTabs('right')}
                      className="hf-top-stage-arrow hf-top-stage-arrow-right"
                      title="Прокрутить этапы вправо"
                    >
                      <ChevronRight className="hf-top-stage-arrow-icon" />
                    </button>
                  ) : null}
                </div>

                {tabFilteredCandidates.length === 0 && !candidateSearch.trim() ? (
                  <div className="hf-vacancy-empty flex-1 overflow-y-auto">
                    <section className="hf-vacancy-empty-card">
                      <h2>Взять кандидатов в работу</h2>
                      <div className="hf-vacancy-empty-actions">
                        <button
                          type="button"
                          onClick={() => navigate('/all-candidates')}
                          className="hf-vacancy-empty-link"
                        >
                          Найти в базе
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowNewCandidateModal(true)}
                          className="hf-vacancy-empty-link"
                        >
                          · Добавить новое резюме вручную
                        </button>
                      </div>

                      <h3>Найти на джоб-сайтах</h3>
                      <div className="hf-vacancy-job-links">
                        <a
                          href={`https://hh.ru/search/resume?text=${selectedVacancySearchTitle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          На Хедхантере
                        </a>
                        <a
                          href={`https://career.habr.com/resumes?q=${selectedVacancySearchTitle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          На Хабр Карьере
                        </a>
                        <a
                          href={`https://www.linkedin.com/search/results/all/?keywords=${selectedVacancySearchTitle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          На LinkedIn
                        </a>
                      </div>

                      <p className="hf-vacancy-empty-hint">
                        Сохраняйте найденные резюме одним кликом
                      </p>
                      <button
                        type="button"
                        onClick={() => toast('Расширение для сохранения резюме пока не подключено')}
                        className="hf-vacancy-empty-help"
                      >
                        Прочесть инструкцию
                      </button>
                    </section>
                  </div>
                ) : (
                /* Master-Detail split */
                <div className="hf-vacancy-master-detail flex-1 flex overflow-hidden">
                  {/* Left: candidate list */}
                  <div className="hf-vacancy-candidate-list w-[350px] flex-shrink-0 border-r border-[color:var(--hf-white-alpha-06)] overflow-hidden flex flex-col relative">
                    <div className={clsx('flex-1 overflow-y-auto', anySelected && 'pb-14')}>
                    {tabFilteredCandidates.length === 0 ? (
                      <div className="flex items-center justify-center h-40 text-[var(--hf-dark-500)] text-sm">
                        Нет кандидатов
                      </div>
                    ) : (
                      tabFilteredCandidates.map(candidate => {
                        const isSelected = candidate.id === selectedCandidateId;
                        const isChecked = selectedIds.has(candidate.id);
                        const initials = (candidate.entity_name || '?')[0].toUpperCase();
                        return (
                          <div
                            key={candidate.id}
                            onClick={() => { setSelectedCandidateId(candidate.id); setDetailTab('info'); }}
                            className={clsx(
                              'flex items-start gap-2 px-3 py-3 cursor-pointer border-b border-[color:var(--hf-white-alpha-04)] transition-colors group/card',
                              isChecked
                                ? 'bg-[var(--hf-accent-bg-10)] border-l-2 border-l-[var(--hf-accent)]'
                                : isSelected
                                  ? 'bg-[var(--hf-accent-bg-10)] border-l-2 border-l-[var(--hf-accent)]'
                                  : 'hover:bg-[var(--hf-white-alpha-03)] border-l-2 border-l-transparent'
                            )}
                          >
                            {/* Checkbox */}
                            <div
                              onClick={(e) => { e.stopPropagation(); toggleCandidateSelection(candidate.id); }}
                              className={clsx(
                                'flex items-center justify-center w-4 h-4 mt-2.5 flex-shrink-0 cursor-pointer transition-opacity',
                                anySelected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'
                              )}
                            >
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-[var(--hf-accent)]" />
                              ) : (
                                <Square className="w-4 h-4 text-[var(--hf-dark-500)] hover:text-[var(--hf-dark-300)]" />
                              )}
                            </div>
                            {(candidate as { entity_photo?: string }).entity_photo ? (
                              <img
                                src={(candidate as { entity_photo?: string }).entity_photo}
                                alt={candidate.entity_name || ''}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-[var(--hf-accent-bg-20)]"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[var(--hf-accent-bg-20)] flex items-center justify-center text-[var(--hf-accent)] text-sm font-medium flex-shrink-0">
                                {initials}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[var(--hf-dark-100)] truncate">
                                {candidate.entity_name || 'Без имени'}
                              </div>
                              {candidate.entity_position && (
                                <div className="text-xs text-[var(--hf-dark-500)] truncate mt-0.5">
                                  {candidate.entity_position}
                                </div>
                              )}
                              <div className="text-xs text-[var(--hf-dark-600)] mt-0.5">
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

                    {/* Bulk actions floating bar */}
                    {anySelected && (
                      <div className="absolute bottom-0 left-0 right-0 p-3 bg-[var(--hf-bg-dark-panel)] border-t border-[color:var(--hf-white-alpha-08)] flex items-center justify-between">
                        <span className="text-xs text-[var(--hf-dark-300)] font-medium">
                          Выбрано: {selectedIds.size}
                        </span>
                        <div className="flex items-center gap-2">
                          {/* Move dropdown */}
                          <div className="relative" ref={bulkStageRef}>
                            <button
                              onClick={() => setBulkStageDropdownOpen(!bulkStageDropdownOpen)}
                              disabled={bulkMoving}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--hf-accent-bg-15)] text-[var(--hf-accent)] hover:bg-[var(--hf-accent-bg-25)] transition-colors disabled:opacity-50"
                            >
                              {bulkMoving ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                              Переместить
                            </button>
                            {bulkStageDropdownOpen && (
                              <div className="absolute bottom-full left-0 mb-1 z-50 w-56 py-1 bg-[var(--hf-dark-panel-alpha-95)] backdrop-blur-xl border border-[color:var(--hf-white-alpha-10)] rounded-xl shadow-[var(--hf-shadow-2xl)] overflow-hidden">
                                <div className="px-3 py-1.5 text-[10px] text-[var(--hf-dark-500)] uppercase tracking-wider font-semibold">
                                  Перенести в
                                </div>
                                {STAGE_ORDER.map((stage) => {
                                  const sc = STAGE_COLORS[stage] || fallbackColor;
                                  return (
                                    <button
                                      key={stage}
                                      onClick={() => handleBulkMove(stage as ApplicationStage)}
                                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors text-sm hover:bg-[var(--hf-white-alpha-04)] text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)]"
                                    >
                                      <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', sc.dot)} />
                                      <span className="flex-1">{stagesConfig.labels[stage] || STAGE_LABELS[stage] || stage}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          {/* Reject */}
                          <button
                            onClick={handleBulkReject}
                            disabled={bulkMoving}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--hf-status-red-badge)] text-[var(--hf-status-red)] hover:bg-[var(--hf-status-red-badge)] transition-colors disabled:opacity-50"
                          >
                            Отказать
                          </button>
                          {/* Deselect */}
                          <button
                            onClick={() => setSelectedIds(new Set())}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg text-[var(--hf-dark-400)] hover:bg-[var(--hf-white-alpha-06)] transition-colors"
                          >
                            Снять
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: detail panel */}
                  <div className="hf-vacancy-detail flex-1 flex flex-col overflow-hidden">
                    {selectedCandidate ? (
                      <>
                        {/* Detail tabs: Личные заметки / Резюме */}
                        <div className="flex items-center border-b border-[color:var(--hf-white-alpha-06)] px-5 flex-shrink-0">
                          <button
                            onClick={() => setDetailTab('info')}
                            className={clsx(
                              'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                              detailTab === 'info'
                                ? 'border-[var(--hf-accent)] text-[var(--hf-dark-100)]'
                                : 'border-transparent text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-200)]'
                            )}
                          >
                            Личные заметки
                          </button>
                          <button
                            onClick={() => setDetailTab('resume')}
                            className={clsx(
                              'px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                              detailTab === 'resume'
                                ? 'border-[var(--hf-accent)] text-[var(--hf-dark-100)]'
                                : 'border-transparent text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-200)]'
                            )}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Резюме
                            {hasResume && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--hf-accent-bg-15)] text-[var(--hf-accent)] ml-1">
                                {resumePages.length || 1}
                              </span>
                            )}
                          </button>
                        </div>

                        {/* Tab content */}
                        <div className="flex-1 overflow-y-auto">
                          {detailTab === 'info' ? (
                            <div className="p-5 max-w-3xl">
                              {/* Top action buttons — Huntflow style */}
                              <div className="flex items-center gap-2 mb-6">
                                {selectedCandidate.entity_id && (
                                  <button
                                    onClick={() => navigate(`/all-candidates?entity=${selectedCandidate.entity_id}`)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 border border-[color:var(--hf-white-alpha-12)] rounded-lg text-sm text-[var(--hf-dark-200)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                  >
                                    <Users className="w-4 h-4" /> Открыть профиль
                                  </button>
                                )}
                                {selectedCandidate.entity_id && (
                                  <div className="relative" ref={addToVacancyRef}>
                                    <button
                                      onClick={() => setShowAddToVacancy(!showAddToVacancy)}
                                      disabled={addingToVacancy}
                                      className="flex items-center gap-1.5 px-3.5 py-2 border border-[color:var(--hf-white-alpha-12)] rounded-lg text-sm text-[var(--hf-dark-200)] hover:bg-[var(--hf-white-alpha-04)] transition-colors disabled:opacity-50"
                                    >
                                      {addingToVacancy ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Plus className="w-4 h-4" />
                                      )}
                                      Переместить
                                    </button>
                                    {showAddToVacancy && (
                                      <div className="absolute top-full left-0 mt-1 w-72 max-h-64 overflow-y-auto z-50 bg-[var(--hf-bg-dark-panel)] border border-[color:var(--hf-white-alpha-10)] rounded-xl shadow-[var(--hf-shadow-xl)]">
                                        {availableVacanciesForCandidate.length === 0 ? (
                                          <div className="px-4 py-3 text-sm text-[var(--hf-dark-400)]">Нет доступных вакансий</div>
                                        ) : (
                                          availableVacanciesForCandidate.map((v) => (
                                            <button
                                              key={v.id}
                                              onClick={() => handleAddToVacancy(v.id)}
                                              disabled={addingToVacancy}
                                              className="w-full text-left px-4 py-2.5 text-sm text-[var(--hf-dark-200)] hover:bg-[var(--hf-white-alpha-06)] transition-colors flex items-center gap-2 disabled:opacity-50"
                                            >
                                              <Briefcase className="w-3.5 h-3.5 text-[var(--hf-dark-400)] flex-shrink-0" />
                                              <span className="truncate">{v.title}</span>
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <button
                                  onClick={() => navigate(`/all-candidates?entity=${selectedCandidate.entity_id}`)}
                                  className="flex items-center gap-1.5 px-3.5 py-2 border border-[color:var(--hf-white-alpha-12)] rounded-lg text-sm text-[var(--hf-dark-200)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                >
                                  <Pencil className="w-4 h-4" /> Редактировать
                                </button>
                              </div>

                              {/* Name + large photo (Huntflow / AllCandidatesPage style) */}
                              <div className="flex items-start justify-between gap-4 mb-5">
                                <div className="flex-1 min-w-0">
                                  <h2 className="text-2xl font-bold text-[var(--hf-dark-50)] mb-1">
                                    {selectedCandidate.entity_name || 'Без имени'}
                                  </h2>
                                  {(selectedCandidate.entity_position || selectedCandidate.entity_company) && (
                                    <p className="text-sm text-[var(--hf-dark-400)]">
                                      {[selectedCandidate.entity_position, selectedCandidate.entity_company].filter(Boolean).join(' · ')}
                                    </p>
                                  )}
                                </div>
                                {(selectedCandidate as { entity_photo?: string }).entity_photo ? (
                                  <img
                                    src={(selectedCandidate as { entity_photo?: string }).entity_photo}
                                    alt={selectedCandidate.entity_name || ''}
                                    referrerPolicy="no-referrer"
                                    className="w-[120px] h-[150px] rounded-xl object-cover flex-shrink-0 bg-[var(--hf-accent-bg-20)]"
                                    onError={(e) => {
                                      const el = e.currentTarget as HTMLImageElement;
                                      el.style.display = 'none';
                                      el.nextElementSibling?.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <div className={clsx(
                                  'w-[120px] h-[150px] rounded-xl bg-[var(--hf-accent-bg-20)] flex items-center justify-center text-[var(--hf-accent)] text-4xl font-bold flex-shrink-0',
                                  (selectedCandidate as { entity_photo?: string }).entity_photo && 'hidden'
                                )}>
                                  {(selectedCandidate.entity_name || '?')[0].toUpperCase()}
                                </div>
                              </div>

                              {/* Contact info — Huntflow dotted-line rows */}
                              <div className="space-y-0 mb-6 text-sm">
                                {selectedCandidate.entity_phone && (
                                  <div className="group flex items-baseline gap-2 py-1.5">
                                    <span className="text-[var(--hf-dark-500)] flex-shrink-0">Телефон</span>
                                    <span className="flex-1 border-b border-dotted border-[color:var(--hf-white-alpha-08)]" />
                                    <a href={`tel:${selectedCandidate.entity_phone}`} className="text-[var(--hf-dark-200)] hover:text-[var(--hf-white)] transition-colors flex-shrink-0">
                                      {selectedCandidate.entity_phone}
                                    </a>
                                    <CopyButton value={selectedCandidate.entity_phone} />
                                  </div>
                                )}
                                {selectedCandidate.entity_email && (
                                  <div className="group flex items-baseline gap-2 py-1.5">
                                    <span className="text-[var(--hf-dark-500)] flex-shrink-0">Эл. почта</span>
                                    <span className="flex-1 border-b border-dotted border-[color:var(--hf-white-alpha-08)]" />
                                    <a href={`mailto:${selectedCandidate.entity_email}`} className="text-[var(--hf-dark-200)] hover:text-[var(--hf-white)] transition-colors flex-shrink-0">
                                      {selectedCandidate.entity_email}
                                    </a>
                                    <CopyButton value={selectedCandidate.entity_email} />
                                  </div>
                                )}
                                {selectedCandidate.entity_telegram && (
                                  <div className="group flex items-baseline gap-2 py-1.5">
                                    <span className="text-[var(--hf-dark-500)] flex-shrink-0">Telegram</span>
                                    <span className="flex-1 border-b border-dotted border-[color:var(--hf-white-alpha-08)]" />
                                    <a href={`https://t.me/${selectedCandidate.entity_telegram}`} target="_blank" rel="noopener noreferrer" className="text-[var(--hf-dark-200)] hover:text-[var(--hf-white)] transition-colors flex-shrink-0">
                                      @{selectedCandidate.entity_telegram}
                                    </a>
                                    <CopyButton value={`@${selectedCandidate.entity_telegram}`} />
                                  </div>
                                )}
                                {selectedCandidate.source && (
                                  <div className="flex items-baseline gap-2 py-1.5">
                                    <span className="text-[var(--hf-dark-500)] flex-shrink-0">Источник</span>
                                    <span className="flex-1 border-b border-dotted border-[color:var(--hf-white-alpha-08)]" />
                                    <span className="text-[var(--hf-dark-200)] flex-shrink-0">{selectedCandidate.source}</span>
                                  </div>
                                )}
                              </div>


                              {/* Tags / Metki */}
                              <div className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                  <Tag className="w-3.5 h-3.5 text-[var(--hf-dark-500)]" />
                                  <span className="text-xs font-medium text-[var(--hf-dark-500)] uppercase tracking-wider">Метки</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {entityTags.map(tag => (
                                    <span
                                      key={tag.id}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                                      style={{
                                        backgroundColor: `color-mix(in srgb, ${tag.color} 12%, transparent)`,
                                        color: tag.color,
                                        border: `1px solid color-mix(in srgb, ${tag.color} 25%, transparent)`,
                                      }}
                                    >
                                      {tag.name}
                                      <button
                                        onClick={() => handleRemoveTag(tag.id)}
                                        className="ml-0.5 hover:opacity-70 transition-opacity"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </span>
                                  ))}
                                  <div className="relative" ref={tagDropdownRef}>
                                    <button
                                      onClick={() => setShowTagDropdown(!showTagDropdown)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-[var(--hf-dark-400)] border border-dashed border-[color:var(--hf-white-alpha-10)] hover:border-[color:var(--hf-white-alpha-20)] hover:text-[var(--hf-dark-300)] transition-colors"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                    {showTagDropdown && (
                                      <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-[var(--hf-bg-dark-panel)] border border-[color:var(--hf-white-alpha-10)] rounded-lg shadow-[var(--hf-shadow-xl)] overflow-hidden">
                                        <div className="max-h-48 overflow-y-auto">
                                          {orgTags
                                            .filter(t => !entityTags.find(et => et.id === t.id))
                                            .map(tag => (
                                              <button
                                                key={tag.id}
                                                onClick={() => { handleAddTag(tag.id); setShowTagDropdown(false); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--hf-dark-200)] hover:bg-[var(--hf-white-alpha-04)] transition-colors text-left"
                                              >
                                                <span
                                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                                  style={{ backgroundColor: tag.color }}
                                                />
                                                {tag.name}
                                              </button>
                                            ))}
                                          {orgTags.filter(t => !entityTags.find(et => et.id === t.id)).length === 0 && (
                                            <div className="px-3 py-2 text-xs text-[var(--hf-dark-500)]">Нет доступных меток</div>
                                          )}
                                        </div>
                                        <div className="border-t border-[color:var(--hf-white-alpha-06)] p-2">
                                          <div className="flex items-center gap-1.5 mb-1.5">
                                            {TAG_PALETTE.map(p => (
                                              <button
                                                key={p.color}
                                                onClick={() => setNewTagColor(p.color)}
                                                className="w-4 h-4 rounded-full transition-transform"
                                                style={{
                                                  backgroundColor: p.color,
                                                  transform: newTagColor === p.color ? 'scale(1.3)' : 'scale(1)',
                                                  boxShadow: newTagColor === p.color ? `0 0 0 2px color-mix(in srgb, ${p.color} 38%, transparent)` : 'none',
                                                }}
                                              />
                                            ))}
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="text"
                                              value={newTagName}
                                              onChange={e => setNewTagName(e.target.value)}
                                              onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); }}
                                              placeholder="Новая метка..."
                                              className="flex-1 px-2 py-1 text-xs bg-[var(--hf-dark-700)] border border-[color:var(--hf-white-alpha-10)] rounded text-[var(--hf-dark-200)] placeholder:text-[var(--hf-dark-500)] focus:outline-none focus:border-[color:var(--hf-white-alpha-20)]"
                                            />
                                            <button
                                              onClick={handleCreateTag}
                                              disabled={creatingTag || !newTagName.trim()}
                                              className="px-2 py-1 text-xs rounded bg-[var(--hf-white-alpha-06)] text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-10)] disabled:opacity-40 transition-colors"
                                            >
                                              {creatingTag ? <Loader2 className="w-3 h-3 animate-spin" /> : '+'}
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Current stage — Huntflow style block */}
                              <div className="mb-5 p-4 rounded-xl border border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white-alpha-02)]">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-xs text-[var(--hf-dark-500)] mb-1">Текущий этап</div>
                                    <div className="text-base font-semibold text-[var(--hf-dark-100)]">
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
                                <div className="mb-5 p-4 rounded-xl border border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white-alpha-02)]">
                                  <div className="text-xs text-[var(--hf-dark-500)] mb-1">Совместимость</div>
                                  <div className="text-lg font-semibold text-[var(--hf-accent)]">{selectedCandidate.compatibility_score.overall_score}%</div>
                                </div>
                              )}

                              {/* Comment input — Huntflow style */}
                              <div className="mb-5">
                                <textarea
                                  ref={commentRef}
                                  placeholder="Написать комментарий... (Enter — отправить, Shift+Enter — новая строка)"
                                  className="w-full px-4 py-3 rounded-xl border border-[color:var(--hf-white-alpha-08)] bg-[var(--hf-white-alpha-02)] text-sm text-[var(--hf-dark-200)] placeholder:text-[var(--hf-dark-500)] focus:outline-none focus:border-[color:var(--hf-white-alpha-15)] resize-none disabled:opacity-50"
                                  rows={2}
                                  disabled={commentSaving}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      const val = (e.target as HTMLTextAreaElement).value;
                                      if (val.trim()) handleSaveComment(val);
                                    }
                                  }}
                                />
                              </div>

                              {/* Action chips — Huntflow outlined style */}
                              <div className="flex flex-wrap items-center gap-2 mb-5 pb-5 border-b border-[color:var(--hf-white-alpha-06)]">
                                <button
                                  onClick={() => {
                                    if (selectedCandidate.entity_email) {
                                      window.open(`mailto:${selectedCandidate.entity_email}`);
                                    } else {
                                      toast.error('Email кандидата не указан');
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-10)] text-sm text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                >
                                  <Mail className="w-3.5 h-3.5" /> Письмо
                                </button>
                                <button
                                  onClick={() => {
                                    setInterviewForCandidate(selectedCandidate);
                                    // Pre-fill: текущий next_interview_at в local input format
                                    const cur = selectedCandidate.next_interview_at;
                                    if (cur) {
                                      const d = new Date(cur);
                                      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                                        .toISOString().slice(0, 16);
                                      setInterviewDateTime(local);
                                    } else {
                                      setInterviewDateTime('');
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-10)] text-sm text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                >
                                  <Calendar className="w-3.5 h-3.5" /> Интервью
                                </button>
                                <button
                                  onClick={() => commentRef.current?.focus()}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-10)] text-sm text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" /> Комментарий
                                </button>
                                <button
                                  onClick={() => handleStageChange(selectedCandidate.id, 'offer' as ApplicationStage)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-10)] text-sm text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" /> Оффер
                                </button>
                                <button
                                  onClick={() => candidateFileInputRef.current?.click()}
                                  disabled={candidateFileUploading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-10)] text-sm text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors disabled:opacity-50"
                                >
                                  <Paperclip className="w-3.5 h-3.5" /> {candidateFileUploading ? 'Загрузка…' : 'Файл'}
                                </button>
                                <input
                                  type="file"
                                  ref={candidateFileInputRef}
                                  onChange={handleCandidateFileUpload}
                                  className="hidden"
                                />
                                <button
                                  onClick={() => handleStageChange(selectedCandidate.id, 'rejected' as ApplicationStage)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-status-red-badge)] text-sm text-[var(--hf-status-red)] hover:bg-[var(--hf-status-red-bg)] transition-colors"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Отказ
                                </button>
                              </div>

                              {/* Comments — те же что в /all-candidates,
                                  читаются из Entity.extra_data.notes */}
                              {Array.isArray(entityExtraData?.notes) && (entityExtraData!.notes as unknown[]).length > 0 && (
                                <div className="mb-5">
                                  <div className="text-xs text-[var(--hf-dark-500)] mb-2 uppercase tracking-wider">Комментарии</div>
                                  <div className="space-y-2">
                                    {(entityExtraData!.notes as Array<Record<string, unknown>>)
                                      .slice()
                                      .sort((a, b) => {
                                        const ta = a?.date ? new Date(a.date as string).getTime() : 0;
                                        const tb = b?.date ? new Date(b.date as string).getTime() : 0;
                                        return tb - ta;
                                      })
                                      .map((note, i) => {
                                        const stage = note.stage as string | undefined;
                                        const stageLabel = (note.stage_label as string | undefined)
                                          || (stage ? (stagesConfig.labels[stage] || stage) : null);
                                        const authorName = (note.author_name as string) || 'Аноним';
                                        const dateStr = note.date ? new Date(note.date as string).toLocaleString('ru-RU', {
                                          day: '2-digit', month: '2-digit', year: 'numeric',
                                          hour: '2-digit', minute: '2-digit',
                                        }) : '';
                                        return (
                                          <div
                                            key={(note.id as string) || `note-${i}`}
                                            className="rounded-lg border border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white-alpha-03)] p-3"
                                          >
                                            <div className="flex items-center justify-between mb-1.5 gap-2">
                                              <div className="flex items-center gap-2 min-w-0">
                                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0 bg-[var(--hf-white-alpha-08)] text-[color:var(--hf-white-alpha-70)]">
                                                  {(authorName || '?')[0].toUpperCase()}
                                                </div>
                                                <span className="text-xs font-medium text-[var(--hf-dark-200)] truncate">{authorName}</span>
                                                {stageLabel && (
                                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--hf-white-alpha-06)] text-[color:var(--hf-white-alpha-60)] flex-shrink-0">
                                                    {stageLabel}
                                                  </span>
                                                )}
                                              </div>
                                              <span className="text-[10px] text-[var(--hf-dark-500)] flex-shrink-0">{dateStr}</span>
                                            </div>
                                            <div className="text-sm text-[var(--hf-dark-200)] whitespace-pre-wrap break-words">
                                              {String(note.text)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}

                              {/* Legacy notes (VacancyApplication.notes string) */}
                              {selectedCandidate.notes && (
                                <div className="mb-5">
                                  <div className="text-xs text-[var(--hf-dark-500)] mb-2">Заметки</div>
                                  <div className="text-sm text-[var(--hf-dark-300)] whitespace-pre-wrap p-3 rounded-lg bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)]">
                                    {selectedCandidate.notes}
                                  </div>
                                </div>
                              )}

                              {/* History timeline — Huntflow style */}
                              <div className="mt-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="text-xs text-[var(--hf-dark-500)] uppercase tracking-wider font-medium">Действия</span>
                                  <span className="text-xs text-[var(--hf-dark-600)]">Все</span>
                                </div>
                                {historyLoading ? (
                                  <div className="flex items-center gap-2 text-[var(--hf-dark-500)] text-sm">
                                    <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
                                  </div>
                                ) : candidateHistory.length === 0 ? (
                                  <div className="text-sm text-[var(--hf-dark-600)]">Нет записей</div>
                                ) : (
                                  <div className="relative pl-6 border-l border-[color:var(--hf-white-alpha-08)]">
                                    {candidateHistory.map((entry: any, i: number) => {
                                      const toColorKey = colorToStageColor(
                                        stagesConfig.colorKeys[entry.to_stage],
                                        stagesConfig.keyToEnum[entry.to_stage] || entry.to_stage,
                                      );
                                      const toColors = STAGE_COLORS[toColorKey] || fallbackColor;
                                      const fromColorKey = entry.from_stage
                                        ? colorToStageColor(
                                            stagesConfig.colorKeys[entry.from_stage],
                                            stagesConfig.keyToEnum[entry.from_stage] || entry.from_stage,
                                          )
                                        : null;
                                      const fromColors = fromColorKey ? (STAGE_COLORS[fromColorKey] || fallbackColor) : null;

                                      return (
                                        <div key={i} className="relative pb-5 last:pb-0">
                                          {/* Timeline dot */}
                                          <div className={clsx(
                                            'absolute -left-[25px] w-3 h-3 rounded-full border-2 border-[color:var(--hf-dark-800)]',
                                            toColors.dot,
                                          )} />

                                          {/* Date */}
                                          <div className="text-xs text-[var(--hf-dark-600)] mb-1">
                                            {entry.created_at && new Date(entry.created_at).toLocaleString('ru', {
                                              day: 'numeric', month: 'short', year: 'numeric',
                                              hour: '2-digit', minute: '2-digit',
                                            })}
                                          </div>

                                          {/* Stage change badges */}
                                          {entry.from_stage ? (
                                            <div className="flex items-center gap-1.5 flex-wrap text-xs mb-1">
                                              <span className={clsx('px-2 py-0.5 rounded-full', fromColors?.badge)}>
                                                {stagesConfig.labels[entry.from_stage] || STAGE_LABELS[entry.from_stage] || entry.from_stage}
                                              </span>
                                              <span className="text-[var(--hf-dark-600)]">&rarr;</span>
                                              <span className={clsx('px-2 py-0.5 rounded-full', toColors.badge)}>
                                                {stagesConfig.labels[entry.to_stage] || STAGE_LABELS[entry.to_stage] || entry.to_stage}
                                              </span>
                                            </div>
                                          ) : (
                                            <div className="text-sm text-[var(--hf-dark-300)] mb-1">
                                              <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs', toColors.badge)}>
                                                {stagesConfig.labels[entry.to_stage] || STAGE_LABELS[entry.to_stage] || entry.to_stage}
                                              </span>
                                            </div>
                                          )}

                                          {/* Comment */}
                                          {entry.comment && (
                                            <div className="text-sm text-[var(--hf-dark-400)] mt-1 whitespace-pre-wrap pl-0.5">
                                              {entry.comment}
                                            </div>
                                          )}

                                          {/* Changed by */}
                                          {entry.changed_by && (
                                            <div className="text-xs text-[var(--hf-dark-600)] mt-1">{entry.changed_by}</div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* Resume tab — Huntflow-style page viewer */
                            <div className="flex-1 flex flex-col h-full">
                              {filesLoading ? (
                                <div className="flex items-center justify-center py-16">
                                  <Loader2 className="w-6 h-6 animate-spin text-[var(--hf-accent)]" />
                                </div>
                              ) : !hasResume ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                  <FileText className="w-12 h-12 text-[var(--hf-dark-600)] mb-3" />
                                  <p className="text-sm text-[var(--hf-dark-400)]">Нет загруженных резюме</p>
                                  <p className="text-xs text-[var(--hf-dark-500)] mt-1">
                                    Загрузите PDF-резюме в профиле кандидата
                                  </p>
                                  {selectedCandidate.entity_id && (
                                    <button
                                      onClick={() => navigate(`/all-candidates?entity=${selectedCandidate.entity_id}`)}
                                      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--hf-accent)] hover:bg-[var(--hf-accent-bg-10)] rounded-lg transition-colors"
                                    >
                                      <Users className="w-3.5 h-3.5" />
                                      Открыть профиль
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="flex-1 flex flex-col">
                                  {/* Action bar */}
                                  <div className="flex items-center justify-between px-5 py-2.5 border-b border-[color:var(--hf-white-alpha-06)] flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                      {resumeOriginal && (
                                        <a
                                          href={`/api/entities/${resumeOriginal.entity_id}/files/${resumeOriginal.id}/download`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-08)] text-xs text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                          Скачать
                                        </a>
                                      )}
                                      <button
                                        onClick={() => setResumeTextMode(v => !v)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${resumeTextMode ? 'border-[color:var(--hf-accent-border-30)] text-[var(--hf-accent)] bg-[var(--hf-accent-bg-10)]' : 'border-[color:var(--hf-white-alpha-08)] text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)]'}`}
                                      >
                                        <FileText className="w-3.5 h-3.5" />
                                        Текст
                                      </button>
                                      {Object.keys(resumePageUrls).length > 0 && (
                                        <button
                                          onClick={handlePrintResume}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-08)] text-xs text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)] transition-colors"
                                        >
                                          <Printer className="w-3.5 h-3.5" />
                                          Печать
                                        </button>
                                      )}
                                    </div>
                                    {/* Page indicator */}
                                    {resumePages.length > 1 && (
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => setCurrentResumePage(p => Math.max(0, p - 1))}
                                          disabled={currentResumePage === 0}
                                          className="p-1 rounded hover:bg-[var(--hf-white-alpha-06)] disabled:opacity-30 transition-colors"
                                        >
                                          <ChevronRight className="w-4 h-4 text-[var(--hf-dark-400)] rotate-180" />
                                        </button>
                                        <span className="text-xs text-[var(--hf-dark-400)]">
                                          Страница {currentResumePage + 1}/{resumePages.length}
                                        </span>
                                        <button
                                          onClick={() => setCurrentResumePage(p => Math.min(resumePages.length - 1, p + 1))}
                                          disabled={currentResumePage >= resumePages.length - 1}
                                          className="p-1 rounded hover:bg-[var(--hf-white-alpha-06)] disabled:opacity-30 transition-colors"
                                        >
                                          <ChevronRight className="w-4 h-4 text-[var(--hf-dark-400)]" />
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Resume file name */}
                                  {resumeOriginal && (
                                    <div className="px-5 py-2 border-b border-[color:var(--hf-white-alpha-04)] flex-shrink-0">
                                      <a
                                        href={`/api/entities/${resumeOriginal.entity_id}/files/${resumeOriginal.id}/download`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs text-[var(--hf-dark-400)] hover:text-[var(--hf-accent)] transition-colors"
                                      >
                                        <Briefcase className="w-3 h-3" />
                                        {resumeOriginal.file_name}
                                      </a>
                                    </div>
                                  )}

                                  {/* Page image / text view / PDF fallback */}
                                  <div className="flex-1 overflow-y-auto flex justify-center p-4 bg-[var(--hf-dark-panel-alpha-50)]">
                                    {resumeTextMode ? (
                                      <div className="w-full max-w-3xl">
                                        {resumeTextContent ? (
                                          <pre className="whitespace-pre-wrap font-mono text-sm text-[var(--hf-dark-200)] leading-relaxed p-6 bg-[var(--hf-dark-panel-alpha-80)] rounded-lg border border-[color:var(--hf-white-alpha-06)]">
                                            {resumeTextContent}
                                          </pre>
                                        ) : (
                                          <div className="flex flex-col items-center gap-3 py-16 text-center">
                                            <FileText className="w-10 h-10 text-[var(--hf-dark-600)]" />
                                            <p className="text-sm text-[var(--hf-dark-400)]">Текстовая версия недоступна</p>
                                            <p className="text-xs text-[var(--hf-dark-500)]">Данные резюме не были распарсены</p>
                                          </div>
                                        )}
                                      </div>
                                    ) : resumePages.length > 0 && !resumeImageError ? (
                                      resumePageUrls[currentResumePage] ? (
                                        <img
                                          src={resumePageUrls[currentResumePage]}
                                          alt={`Резюме стр. ${currentResumePage + 1}`}
                                          className="max-w-full h-auto rounded-lg shadow-[var(--hf-shadow-2xl)] border border-[color:var(--hf-white-alpha-06)]"
                                        />
                                      ) : (
                                        <div className="flex items-center justify-center py-20">
                                          <Loader2 className="w-6 h-6 text-[var(--hf-dark-500)] animate-spin" />
                                        </div>
                                      )
                                    ) : resumeImageError ? (
                                      <div className="flex flex-col items-center gap-4 py-16 text-center">
                                        <FileText className="w-12 h-12 text-[var(--hf-dark-600)]" />
                                        <p className="text-sm text-[var(--hf-dark-400)]">Страницы резюме не загружены</p>
                                        <p className="text-xs text-[var(--hf-dark-500)]">Файлы изображений отсутствуют в базе</p>
                                        <button
                                          onClick={handleReconvert}
                                          disabled={reconverting}
                                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--hf-accent-bg-20)] text-[var(--hf-accent)] hover:bg-[var(--hf-accent-bg-30)] transition-colors text-sm font-medium disabled:opacity-50"
                                        >
                                          {reconverting ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                          ) : (
                                            <FileText className="w-4 h-4" />
                                          )}
                                          {reconverting ? 'Пересоздание...' : 'Пересоздать из PDF'}
                                        </button>
                                      </div>
                                    ) : resumePdf ? (
                                      <iframe
                                        src={`/api/entities/${resumePdf.entity_id}/files/${resumePdf.id}/download`}
                                        className="w-full h-full rounded-lg border border-[color:var(--hf-white-alpha-06)] bg-[var(--hf-white)] min-h-[600px]"
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
                      <div className="hf-vacancy-no-selection flex-1 flex items-center justify-center h-full text-[var(--hf-dark-500)]">
                        <div className="text-center">
                          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                          <p className="text-sm">Выберите кандидата из списка</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Create / Edit Vacancy Modal — единая VacancyForm */}
      {showCreateModal && (
        <VacancyForm
          key="create-funnel"
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => { setShowCreateModal(false); fetchVacancies(); }}
        />
      )}

      {editingVacancy && (
        <VacancyForm
          key={`edit-${editingVacancy.id}`}
          vacancy={editingVacancy}
          onClose={() => setEditingVacancy(null)}
          onSuccess={() => { setEditingVacancy(null); fetchVacancies(); }}
        />
      )}

      {showNewCandidateModal && (
        <NewCandidateModal
          onClose={() => setShowNewCandidateModal(false)}
          onSaved={() => {
            setShowNewCandidateModal(false);
          }}
          onOpenParser={() => {
            setShowNewCandidateModal(false);
            setShowParserModal(true);
          }}
        />
      )}

      {showParserModal && (
        <ParserModal
          type="resume"
          onClose={() => setShowParserModal(false)}
          onParsed={() => {
            setShowParserModal(false);
            toast.success('Кандидат добавлен');
          }}
          onAttachedToEntity={() => {
            setShowParserModal(false);
          }}
        />
      )}

      {/* Interview scheduling modal — простой datetime-picker */}
      {interviewForCandidate && (
        <div
          className="fixed inset-0 bg-[var(--hf-black-alpha-50)] backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !interviewSaving && setInterviewForCandidate(null)}
        >
          <div
            className="glass rounded-xl p-5 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold text-[var(--hf-white)] mb-1">Назначить интервью</h3>
              <p className="text-xs text-[var(--hf-dark-400)]">
                {interviewForCandidate.entity_name}
              </p>
            </div>
            <input
              type="datetime-local"
              value={interviewDateTime}
              onChange={(e) => setInterviewDateTime(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--hf-white-alpha-03)] border border-[color:var(--hf-white-alpha-08)] rounded-lg text-sm text-[var(--hf-dark-100)] focus:outline-none focus:border-[var(--hf-accent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setInterviewForCandidate(null)}
                disabled={interviewSaving}
                className="px-3 py-1.5 text-sm text-[var(--hf-dark-300)] hover:text-[var(--hf-white)] transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={handleSaveInterview}
                disabled={interviewSaving || !interviewDateTime}
                className="px-4 py-1.5 text-sm font-medium bg-[var(--hf-accent)] hover:bg-[var(--hf-accent-hover)] text-[var(--hf-white)] rounded-lg transition-colors disabled:opacity-50"
              >
                {interviewSaving ? 'Сохраняем…' : 'Назначить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal — close / delete vacancy */}
      {confirmDialog && (
        <div
          className="fixed inset-0 bg-[var(--hf-black-alpha-50)] backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !confirmBusy && setConfirmDialog(null)}
        >
          <div
            className="glass rounded-xl p-5 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold text-[var(--hf-white)] mb-1">
                {confirmDialog.type === 'close' ? 'Закрыть вакансию?' : 'Удалить вакансию?'}
              </h3>
              <p className="text-sm text-[var(--hf-dark-300)]">
                «{confirmDialog.vacancy.title?.trim() || 'Без названия'}»
              </p>
              {confirmDialog.type === 'delete' && (
                <p className="text-xs text-[color:var(--hf-status-red)] mt-2">
                  Действие нельзя отменить. Кандидаты в воронке потеряют связь с этой вакансией.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={confirmBusy}
                className="px-3 py-1.5 text-sm text-[var(--hf-dark-300)] hover:text-[var(--hf-white)] transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={runConfirmedAction}
                disabled={confirmBusy}
                className={clsx(
                  'px-4 py-1.5 text-sm font-medium text-[var(--hf-white)] rounded-lg transition-colors disabled:opacity-50',
                  confirmDialog.type === 'delete'
                    ? 'bg-[var(--hf-red-500)] hover:bg-[var(--hf-red-600)]'
                    : 'bg-[var(--hf-status-yellow)] hover:bg-[var(--hf-status-yellow)]',
                )}
              >
                {confirmBusy
                  ? 'Применяем…'
                  : confirmDialog.type === 'close' ? 'Закрыть' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ===================== Closed Vacancies ===================== */

function ClosedVacanciesView({
  vacancies,
  isLoading,
  search,
  onSearchChange,
  onClearSearch,
  onSelectVacancy,
  onEditVacancy,
  onDeleteVacancy,
  usersMap,
}: {
  vacancies: Vacancy[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onSelectVacancy: (id: number) => void;
  onEditVacancy: (vacancy: Vacancy) => void;
  onDeleteVacancy: (vacancy: Vacancy) => void;
  usersMap: Record<number, string>;
}) {
  const [recruiterFilter, setRecruiterFilter] = useState('all');
  const [recruiterMenuOpen, setRecruiterMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortMode, setSortMode] = useState<'match' | 'closed_desc' | 'title_asc'>('match');

  const recruiterName = (vacancy: Vacancy) =>
    vacancy.created_by_name || usersMap[vacancy.created_by ?? 0] || 'Не указан';

  const recruiters = useMemo(() => {
    const map = new Map<string, string>();
    vacancies.forEach((vacancy) => {
      const key = String(vacancy.created_by ?? recruiterName(vacancy));
      if (!map.has(key)) map.set(key, recruiterName(vacancy));
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [vacancies, usersMap]);

  const visibleVacancies = useMemo(() => {
    const result = recruiterFilter === 'all'
      ? [...vacancies]
      : vacancies.filter((vacancy) => String(vacancy.created_by ?? recruiterName(vacancy)) === recruiterFilter);

    if (sortMode === 'closed_desc') {
      result.sort((a, b) => new Date(b.closes_at || b.updated_at).getTime() - new Date(a.closes_at || a.updated_at).getTime());
    }
    if (sortMode === 'title_asc') {
      result.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
    }
    return result;
  }, [vacancies, recruiterFilter, sortMode, usersMap]);

  const activeRecruiterLabel =
    recruiterFilter === 'all'
      ? 'Все'
      : recruiters.find(([key]) => key === recruiterFilter)?.[1] || 'Все';

  const sortLabel =
    sortMode === 'closed_desc'
      ? 'По дате закрытия'
      : sortMode === 'title_asc'
        ? 'По названию'
        : 'По соответствию';

  return (
    <div className="hf-closed-vacancies flex-1 min-w-0 overflow-y-auto">
      <div className="hf-closed-vacancies-inner">
        <header className="hf-closed-vacancies-searchbar">
          <button type="button" className="hf-closed-vacancies-search-kind">
            ВАКАНСИИ
          </button>
          <div className="hf-closed-vacancies-searchbox">
            <Search className="hf-closed-vacancies-search-icon" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Поиск в базе"
              aria-label="Поиск закрытых вакансий"
            />
            {search && (
              <button
                type="button"
                className="hf-closed-vacancies-clear"
                onClick={onClearSearch}
                aria-label="Очистить поиск"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        <div className="hf-closed-vacancies-toolbar">
          <div className="hf-closed-vacancies-filters">
            <div className="hf-closed-vacancies-filter-wrap">
              <button type="button" className="hf-closed-vacancies-filter hf-closed-vacancies-filter-active">
                Закрытые <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <div className="hf-closed-vacancies-filter-wrap">
              <button
                type="button"
                className="hf-closed-vacancies-filter"
                onClick={() => {
                  setRecruiterMenuOpen((value) => !value);
                  setSortMenuOpen(false);
                  setFiltersOpen(false);
                }}
              >
                Рекрутеры : {activeRecruiterLabel} <ChevronDown className="h-4 w-4" />
              </button>
              {recruiterMenuOpen && (
                <div className="hf-closed-vacancies-menu">
                  <button
                    type="button"
                    className={clsx(recruiterFilter === 'all' && 'hf-closed-vacancies-menu-active')}
                    onClick={() => {
                      setRecruiterFilter('all');
                      setRecruiterMenuOpen(false);
                    }}
                  >
                    Все
                  </button>
                  {recruiters.map(([key, name]) => (
                    <button
                      type="button"
                      key={key}
                      className={clsx(recruiterFilter === key && 'hf-closed-vacancies-menu-active')}
                      onClick={() => {
                        setRecruiterFilter(key);
                        setRecruiterMenuOpen(false);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="hf-closed-vacancies-filter-wrap">
              <button
                type="button"
                className="hf-closed-vacancies-filter"
                onClick={() => {
                  setFiltersOpen((value) => !value);
                  setRecruiterMenuOpen(false);
                  setSortMenuOpen(false);
                }}
              >
                Фильтры <ChevronDown className="h-4 w-4" />
              </button>
              {filtersOpen && (
                <div className="hf-closed-vacancies-menu hf-closed-vacancies-menu-note">
                  Дополнительные фильтры появятся, когда API начнёт отдавать заказчиков и офферы по закрытым вакансиям.
                </div>
              )}
            </div>
          </div>
          <div className="hf-closed-vacancies-filter-wrap">
            <button
              type="button"
              className="hf-closed-vacancies-filter hf-closed-vacancies-sort"
              onClick={() => {
                setSortMenuOpen((value) => !value);
                setRecruiterMenuOpen(false);
                setFiltersOpen(false);
              }}
            >
              {sortLabel} <ChevronDown className="h-4 w-4" />
            </button>
            {sortMenuOpen && (
              <div className="hf-closed-vacancies-menu">
                {[
                  ['match', 'По соответствию'],
                  ['closed_desc', 'По дате закрытия'],
                  ['title_asc', 'По названию'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={clsx(sortMode === key && 'hf-closed-vacancies-menu-active')}
                    onClick={() => {
                      setSortMode(key as typeof sortMode);
                      setSortMenuOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="hf-closed-vacancies-results" aria-label="Закрытые вакансии">
        <div className="hf-closed-vacancies-count">
          Найдено вакансий: {visibleVacancies.length}
        </div>

        {isLoading ? (
          <div className="hf-closed-vacancies-state">
            <Loader2 className="h-5 w-5 animate-spin" />
            Загрузка вакансий
          </div>
        ) : visibleVacancies.length === 0 ? (
          <div className="hf-closed-vacancies-state">
            {search ? 'Ничего не найдено' : 'Закрытых вакансий нет'}
          </div>
        ) : (
          <div className="hf-closed-vacancies-list">
            {visibleVacancies.map((vacancy) => {
              const openedAt = vacancy.published_at || vacancy.created_at;
              const closedAt = vacancy.closes_at || vacancy.updated_at;
              return (
                <article key={vacancy.id} className="hf-closed-vacancies-row">
                  <button
                    type="button"
                    className="hf-closed-vacancies-title"
                    onClick={() => onSelectVacancy(vacancy.id)}
                  >
                    <span className="hf-closed-vacancies-status">ЗАКРЫТА</span>
                    <span className="hf-closed-vacancies-title-text">{vacancy.title?.trim() || 'Без названия'}</span>
                  </button>
                  {vacancy.department_name && (
                    <div className="hf-closed-vacancies-department">{vacancy.department_name}</div>
                  )}
                  <div className="hf-closed-vacancies-meta">
                    <span>Открыта: {formatVacancyListDate(openedAt)}</span>
                    <span className="hf-closed-vacancies-dot">·</span>
                    <span>Закрыта: {formatVacancyListDate(closedAt)}</span>
                  </div>
                  <div className="hf-closed-vacancies-meta">
                    <span>Последнее действие: {formatVacancyListDate(vacancy.updated_at)}</span>
                  </div>
                  <div className="hf-closed-vacancies-meta">
                    <span>Рекрутер: {recruiterName(vacancy)}</span>
                  </div>
                  <div className="hf-closed-vacancies-footer">
                    <div className="hf-closed-vacancies-actions">
                      <button
                        type="button"
                        onClick={() => onEditVacancy(vacancy)}
                        aria-label="Редактировать вакансию"
                        title="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteVacancy(vacancy)}
                        aria-label="Удалить вакансию"
                        title="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        </section>
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
          'hover:ring-2 hover:ring-[var(--hf-white-alpha-10)]',
          colors.badge,
        )}
      >
        {customLabels?.[currentStage] || STAGE_LABELS[currentStage] || currentStage}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-56 py-1 bg-[var(--hf-dark-panel-alpha-95)] backdrop-blur-xl border border-[color:var(--hf-white-alpha-10)] rounded-xl shadow-[var(--hf-shadow-2xl)] overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] text-[var(--hf-dark-500)] uppercase tracking-wider font-semibold">
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
                    ? 'bg-[var(--hf-white-alpha-06)] text-[var(--hf-dark-200)]'
                    : 'hover:bg-[var(--hf-white-alpha-04)] text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)]',
                )}
              >
                <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', sc.dot)} />
                <span className="flex-1">{customLabels?.[stage] || STAGE_LABELS[stage] || stage}</span>
                {isCurrent && (
                  <span className="text-[10px] text-[var(--hf-dark-500)]">текущий</span>
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

function FunnelCard({ vacancy, onClick, onEdit, onClose, onDelete }: { vacancy: Vacancy; onClick: () => void; onEdit: () => void; onClose: () => void; onDelete: () => void }) {
  const count = vacancy.applications_count ?? 0;
  const stageCounts = vacancy.stage_counts ?? {};
  const mainStages = ['applied', 'screening', 'phone_screen', 'interview', 'assessment', 'offer', 'hired'];
  const total = mainStages.reduce((s, k) => s + (stageCounts[k] || 0), 0);

  return (
    <div
      onClick={onClick}
      className="p-3 rounded-lg border border-[color:var(--hf-white-alpha-06)] glass-light hover:border-[color:var(--hf-white-alpha-12)] cursor-pointer transition-colors group relative"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className={clsx(
          'text-sm font-medium group-hover:text-[var(--hf-accent)] transition-colors line-clamp-2 flex-1 mr-2',
          vacancy.title?.trim() ? 'text-[var(--hf-dark-100)]' : 'text-[var(--hf-dark-500)] italic',
        )}>
          {vacancy.title?.trim() || 'Без названия'}
        </h3>
        {/* Action buttons — приглушены до hover, но всегда видны */}
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="flex items-center gap-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded-md hover:bg-[var(--hf-white-alpha-10)] text-[var(--hf-dark-400)] hover:text-[var(--hf-white)] transition-colors"
              title="Редактировать"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {vacancy.status !== 'closed' && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="p-1 rounded-md hover:bg-[var(--hf-status-red-badge)] text-[var(--hf-dark-400)] hover:text-[var(--hf-status-red)] transition-colors"
                title="Закрыть вакансию"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded-md hover:bg-[var(--hf-status-red-badge)] text-[var(--hf-dark-400)] hover:text-[var(--hf-status-red)] transition-colors"
              title="Удалить воронку"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <ChevronRight className="w-4 h-4 text-[var(--hf-dark-500)] group-hover:text-[var(--hf-accent)] transition-colors mt-0.5" />
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <VacancyStatusBadge status={vacancy.status} />
        {vacancy.department_name && (
          <span className="text-xs text-[var(--hf-dark-400)] truncate">{vacancy.department_name}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--hf-dark-400)] mb-2">
        <Users className="w-3.5 h-3.5" />
        <span>{count} кандидатов</span>
      </div>
      {total > 0 && (
        <>
          <div
            className="flex items-center justify-between text-[10px] text-[var(--hf-dark-500)] mb-1"
            title="Распределение кандидатов по этапам воронки"
          >
            <span>Этапы</span>
            <span>{Math.round(((stageCounts['hired'] || 0) / total) * 100)}% наняты</span>
          </div>
          <div
            className="flex gap-0.5 h-1 rounded-full overflow-hidden bg-[var(--hf-white-alpha-04)]"
            title="Распределение кандидатов по этапам (наведите на сегмент)"
          >
            {mainStages.map((stage) => {
              const c = stageCounts[stage] || 0;
              if (c === 0) return null;
              const pct = (c / total) * 100;
              const stageLabel = STAGE_LABELS[stage] || stage;
              return (
                <div
                  key={stage}
                  className={clsx(
                    'h-full rounded-full',
                    stage === 'applied' && 'bg-[var(--hf-status-blue-badge)]',
                    stage === 'screening' && 'bg-[var(--hf-status-cyan-badge)]',
                    stage === 'phone_screen' && 'bg-[var(--hf-status-purple-badge)]',
                    stage === 'interview' && 'bg-[var(--hf-status-indigo-badge)]',
                    stage === 'assessment' && 'bg-[var(--hf-status-orange-badge)]',
                    stage === 'offer' && 'bg-[var(--hf-status-yellow-badge)]',
                    stage === 'hired' && 'bg-[var(--hf-status-green-badge)]',
                  )}
                  style={{ width: `${Math.max(pct, 4)}%` }}
                  title={`${stageLabel}: ${c} (${Math.round(pct)}%)`}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
