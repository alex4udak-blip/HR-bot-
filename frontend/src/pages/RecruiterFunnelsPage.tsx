import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useHorizontalScroll } from '../hooks/useHorizontalScroll';
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
  Printer,
  Tag,
  Pencil,
  Archive,
  Trash2,
  Inbox,
  MoreHorizontal,
  RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import { getUsers, getApplications, updateApplication, deleteApplication, getApplicationHistory, deleteApplicationHistory, getEntityFiles, reconvertResume, downloadEntityFile, bulkMoveApplications, getEntity, uploadEntityFile, createApplication } from '@/services/api';
import { getOrgStages } from '@/services/api/auth';
import { addEntityNote, deleteEntityNote } from '@/services/api/entities';
import { getTags, getEntityTags, addTagToEntity, removeTagFromEntity, createTag } from '@/services/api/tags';
import type { Tag as TagType } from '@/services/api/tags';
import type { EntityFile } from '@/services/api/entities';
import type { Vacancy, VacancyStatus, VacancyApplication, ApplicationStage } from '@/types';
import { VacancyStatusBadge, VacancyForm } from '@/components/vacancies';
import type { StageColumn } from '@/components/vacancies/StagesConfigModal';
import type { KanbanCard } from '@/services/api/candidates';
import { EditCandidateModal } from './AllCandidatesPage';
import { HuntflowComposer } from '@/components/hr/HuntflowComposer';
import {
  HuntflowActionChip,
  HuntflowEditorIcon,
  HuntflowInfoRow,
  HuntflowOptionsIcon,
} from '@/components/hr/HuntflowControls';
import {
  HUNTFLOW_VACANCY_STATUS_FILTERS,
  getHuntflowVacancyStatusFilterLabel,
} from '@/components/hr/huntflowVacancyStatus';

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

const STATUS_FILTER_IDS = new Set<string>(HUNTFLOW_VACANCY_STATUS_FILTERS.map((f) => f.id));

const getRecruiterStatusDotClass = (status: VacancyStatus) => {
  if (status === 'open') return 'hf-recruiter-status-dot-open';
  if (status === 'paused') return 'hf-recruiter-status-dot-paused';
  if (status === 'closed') return 'hf-recruiter-status-dot-closed';
  if (status === 'pending_review') return 'hf-recruiter-status-dot-pending';
  if (status === 'cancelled') return 'hf-recruiter-status-dot-cancelled';
  return 'hf-recruiter-status-dot-default';
};

const STAGE_ORDER = [
  'applied', 'screening', 'phone_screen', 'interview',
  'assessment', 'offer', 'hired', 'rejected', 'withdrawn', 'reserve',
] as const;

// Единые лейблы стадий — синхронизированы с backend KANBAN_STATUS_LABELS
// (отображаются на /all-candidates). Не разводить разные наборы по страницам.
const STAGE_LABELS: Record<string, string> = {
  applied: 'Новый',
  screening: 'Выполняет ТЗ',
  phone_screen: 'Интервью с HR',
  interview: 'Интервью с заказчиком',
  assessment: 'Принятие решения',
  offer: 'Выставлен оффер',
  hired: 'Оффер принят',
  rejected: 'Отказ',
  withdrawn: 'Отозван',
  reserve: 'Резерв',
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

const getClosedVacancyDate = (vacancy: Vacancy) =>
  vacancy.closes_at || vacancy.updated_at || vacancy.created_at;

const getCandidateFallbackInitial = (name?: string | null) =>
  name?.match(/[0-9A-Za-zА-Яа-яЁё]/)?.[0]?.toUpperCase() || '?';

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
  reserve:      { bg: 'bg-[var(--hf-status-gray-bg)]',    text: 'text-[var(--hf-status-gray)]',    dot: 'bg-[var(--hf-status-gray)]',    badge: 'bg-[var(--hf-status-gray-badge)] text-[var(--hf-status-gray)]' },
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

type VacancyStagesConfig = {
  keys: string[];
  labels: Record<string, string>;
  keyToEnum: Record<string, string>;
  enumToKeys: Record<string, string[]>;
  colorKeys: Record<string, string>;
  isVirtual: Record<string, boolean>;
};

function ClosedVacancyDetail({
  vacancy,
  stageKeys,
  stagesConfig,
  groupedByStageMap,
  onReopen,
  onEdit,
}: {
  vacancy: Vacancy;
  stageKeys: string[];
  stagesConfig: VacancyStagesConfig;
  groupedByStageMap: Record<string, VacancyApplication[]>;
  onReopen: () => void;
  onEdit: () => void;
}) {
  // Горизонтальный скролл табов этапов — самодостаточно через единый хук.
  const {
    ref: stageScrollRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft: scrollStagesLeft,
    scrollRight: scrollStagesRight,
  } = useHorizontalScroll<HTMLDivElement>({ step: 520 });
  const [activeClosedStage, setActiveClosedStage] = useState<'summary' | string>('summary');
  const activeStageCandidates =
    activeClosedStage === 'summary'
      ? []
      : groupedByStageMap[activeClosedStage] || [];
  const activeStageLabel =
    activeClosedStage === 'summary'
      ? ''
      : stagesConfig.labels[activeClosedStage] || activeClosedStage;

  return (
    <div className="hf-vacancy-workspace hf-vacancy-workspace-closed flex-1 flex flex-col overflow-hidden">
      <div className="hf-vacancy-stage-shell hf-top-stage-shell">
        <div className="hf-vacancy-source-tabs hf-vacancy-source-tabs-closed">
          <button
            type="button"
            onClick={() => setActiveClosedStage('summary')}
            className={clsx(
              'hf-vacancy-source-tab',
              activeClosedStage === 'summary' && 'hf-vacancy-source-tab-active',
            )}
          >
            Вакансия закрыта
          </button>
        </div>
        <div
          ref={stageScrollRef}
          className="hf-vacancy-stage-tabs hf-top-stage-tabs hf-top-stage-tabs-padded no-scrollbar"
        >
          {stageKeys.map((key) => {
            const count = groupedByStageMap[key]?.length || 0;
            const vacancyStageLabel = stagesConfig.labels[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveClosedStage(key)}
                className={clsx(
                  'hf-top-stage-item',
                  activeClosedStage === key
                    ? 'hf-top-stage-item-active'
                    : 'hf-top-stage-item-idle',
                )}
              >
                {vacancyStageLabel}
                {count > 0 && <span className="hf-top-stage-badge hf-top-stage-badge-muted">{count}</span>}
                {activeClosedStage === key && <span className="hf-top-stage-underline" />}
              </button>
            );
          })}
        </div>
        <div className="hf-top-stage-action-cell">
          <button
            type="button"
            onClick={onEdit}
            className="hf-top-stage-action-btn"
            title="Информация о вакансии"
            aria-label="Информация о вакансии"
          >
            <HuntflowOptionsIcon className="hf-top-stage-options-icon" />
          </button>
        </div>
        {canScrollLeft ? (
          <button
            type="button"
            onClick={scrollStagesLeft}
            className="hf-top-stage-arrow hf-top-stage-arrow-left"
            title="Прокрутить этапы влево"
          >
            <ChevronLeft className="hf-top-stage-arrow-icon" />
          </button>
        ) : null}
        {canScrollRight ? (
          <button
            type="button"
            onClick={scrollStagesRight}
            className="hf-top-stage-arrow hf-top-stage-arrow-right"
            title="Прокрутить этапы вправо"
          >
            <ChevronRight className="hf-top-stage-arrow-icon" />
          </button>
        ) : null}
      </div>

      <div className="hf-vacancy-closed-panel flex-1 overflow-y-auto">
        {activeClosedStage === 'summary' ? (
          <section className="hf-vacancy-closed-card">
            <Inbox className="hf-vacancy-closed-icon" />
            <h2>Вакансия закрыта {formatVacancyListDate(getClosedVacancyDate(vacancy))}</h2>
            <p className="hf-vacancy-closed-status">Все наняты</p>
            <p className="hf-vacancy-closed-muted">Нет закрытых позиций</p>
            <div className="hf-vacancy-closed-actions">
              <button type="button" onClick={onReopen} className="hf-vacancy-closed-button">
                Открыть заново
              </button>
              <button type="button" onClick={onEdit} className="hf-vacancy-closed-button">
                Информация о вакансии
              </button>
            </div>
            <div className="hf-vacancy-closed-note">
              <strong>Открывайте старые вакансии вместо создания новых</strong>
              <span>
                Статистика посчитается корректно, история работы не потеряется,
                а кандидаты автоматически снимутся с этапов.
              </span>
            </div>
          </section>
        ) : (
          <section className="hf-vacancy-closed-stage">
            <div className="hf-vacancy-closed-stage-head">
              <h2>{activeStageLabel}</h2>
              <span>{activeStageCandidates.length}</span>
            </div>
            {activeStageCandidates.length === 0 ? (
              <div className="hf-vacancy-closed-stage-empty">
                На этом этапе пока нет кандидатов
              </div>
            ) : (
              <div className="hf-vacancy-closed-stage-list">
                {activeStageCandidates.map((candidate) => (
                  <div key={candidate.id} className="hf-vacancy-closed-stage-row">
                    <div className="hf-vacancy-closed-stage-name">
                      {candidate.entity_name || 'Без имени'}
                    </div>
                    {candidate.entity_position ? (
                      <div className="hf-vacancy-closed-stage-meta">
                        {candidate.entity_position}
                      </div>
                    ) : null}
                    {candidate.entity_company || candidate.source ? (
                      <div className="hf-vacancy-closed-stage-meta">
                        {candidate.entity_company || candidate.source}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
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
  const [recruiterSearch, setRecruiterSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('all');
  const [selectedRecruiterFilter, setSelectedRecruiterFilter] = useState<number | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showRecruiterMenu, setShowRecruiterMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVacancy, setEditingVacancy] = useState<Vacancy | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [usersMap, setUsersMap] = useState<Record<number, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const recruiterAutoExpandedRef = useRef(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const recruiterMenuRef = useRef<HTMLDivElement>(null);

  // ClickUp view: selected vacancy + candidates
  const selectedVacancyId = searchParams.get('v') ? Number(searchParams.get('v')) : null;
  const [candidates, setCandidates] = useState<VacancyApplication[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  // Горизонтальный скролл табов этапов (инлайн detail-view) — единый хук.
  const {
    ref: vacancyStageScrollRef,
    canScrollLeft: vacancyStageCanScrollLeft,
    canScrollRight: vacancyStageCanScrollRight,
    scrollLeft: scrollVacancyStagesLeft,
    scrollRight: scrollVacancyStagesRight,
  } = useHorizontalScroll<HTMLDivElement>({ step: 520 });

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
  const [editingCandidateCard, setEditingCandidateCard] = useState<KanbanCard | null>(null);
  const [personalNoteComposerOpen, setPersonalNoteComposerOpen] = useState(false);
  const [personalNoteText, setPersonalNoteText] = useState('');
  const [stageCommentComposerOpen, setStageCommentComposerOpen] = useState(false);
  const [stageCommentText, setStageCommentText] = useState('');
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
  const [showVacancyTopSearch, setShowVacancyTopSearch] = useState(false);
  const vacancyTopSearchRef = useRef<HTMLInputElement>(null);

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

  const scopedVacancies = useMemo(() => {
    let result = vacancies;
    // Исходные заявки, у которых уже есть клон («взяли в работу»), —
    // это НЕ рабочие вакансии, а заявки. После «Взять в работу» оригинал
    // переходит в status=open и без этого фильтра дублировал клон в списке
    // вакансий рекрутёра (видно как два одинаковых «Тест»).
    const clonedSourceIds = new Set<number>();
    vacancies.forEach((v) => {
      const src = (v.extra_data as Record<string, unknown> | undefined)
        ?.cloned_from_request_id;
      if (typeof src === 'number') clonedSourceIds.add(src);
    });
    result = result.filter((v) => !clonedSourceIds.has(v.id));
    if (!isHrAdmin && user) {
      result = result.filter((v) => v.created_by === user.id);
    }
    if (statusFilter !== 'all') {
      result = result.filter((v) => v.status === statusFilter);
    }
    return result;
  }, [vacancies, user, isHrAdmin, statusFilter]);

  // Filter vacancies
  const filteredVacancies = useMemo(() => {
    let result = scopedVacancies;
    if (isHrAdmin && selectedRecruiterFilter !== null) {
      result = result.filter((v) => (v.created_by ?? 0) === selectedRecruiterFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((v) => {
        return v.title.toLowerCase().includes(q) || Boolean(v.department_name?.toLowerCase().includes(q));
      });
    }
    return result;
  }, [scopedVacancies, isHrAdmin, selectedRecruiterFilter, search]);

  useEffect(() => {
    if (!isHrAdmin || recruiterAutoExpandedRef.current || scopedVacancies.length === 0) return;

    const groups = new Map<number, string>();
    scopedVacancies.forEach((v) => {
      const uid = v.created_by ?? 0;
      if (!groups.has(uid)) {
        groups.set(uid, v.created_by_name || usersMap[uid] || (uid === user?.id ? (user?.name || 'Мои') : 'Без автора'));
      }
    });

    const firstGroup = Array.from(groups.entries()).sort((a, b) => a[1].localeCompare(b[1]))[0];
    if (!firstGroup) return;

    recruiterAutoExpandedRef.current = true;
    setExpandedGroups(new Set([firstGroup[0]]));
  }, [isHrAdmin, scopedVacancies, user, usersMap]);

  // Group by recruiter (for admin) or single group (for hr)
  const recruiterGroups = useMemo((): RecruiterGroup[] => {
    const groups: Record<number, RecruiterGroup> = {};
    const vacs = scopedVacancies;
    vacs.forEach((v) => {
      const uid = v.created_by ?? 0;
      if (!groups[uid]) {
        groups[uid] = {
          userId: uid,
          userName: v.created_by_name || usersMap[uid] || (uid === user?.id ? (user?.name || 'Мои') : 'Без автора'),
          vacancies: [],
          expanded: !isHrAdmin || expandedGroups.has(uid),
        };
      }
      groups[uid].vacancies.push(v);
    });
    return Object.values(groups).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [scopedVacancies, isHrAdmin, usersMap, expandedGroups, user]);

  const filteredRecruiterCount = useMemo(() => {
    const ids = new Set<string>();
    filteredVacancies.forEach((vacancy) => {
      ids.add(String(vacancy.created_by ?? vacancy.created_by_name ?? 'unknown'));
    });
    return ids.size;
  }, [filteredVacancies]);

  const recruiterFilterOptions = useMemo(() => (
    recruiterGroups.map((group) => ({
      id: group.userId,
      name: group.userName,
      count: group.vacancies.length,
    }))
  ), [recruiterGroups]);

  const statusFilterLabel = useMemo(() => {
    if (statusFilter === 'all') return 'Все вакансии';
    return getHuntflowVacancyStatusFilterLabel(statusFilter) || 'Все вакансии';
  }, [statusFilter]);

  const recruiterFilterLabel = useMemo(() => {
    if (selectedRecruiterFilter === null) return 'Все';
    return recruiterFilterOptions.find((item) => item.id === selectedRecruiterFilter)?.name || 'Все';
  }, [recruiterFilterOptions, selectedRecruiterFilter]);

  const visibleRecruiterGroups = useMemo(() => {
    if (!recruiterSearch.trim()) return recruiterGroups;
    const q = recruiterSearch.trim().toLowerCase();
    return recruiterGroups.filter((group) => group.userName.toLowerCase().includes(q));
  }, [recruiterGroups, recruiterSearch]);

  // Selected vacancy
  const selectedVacancy = useMemo(
    () => vacancies.find((v) => v.id === selectedVacancyId),
    [vacancies, selectedVacancyId],
  );


  // Load candidates when vacancy selected
  useEffect(() => {
    if (!selectedVacancyId) {
      setCandidates([]);
      return;
    }
    loadCandidates(selectedVacancyId);
    setSelectedCandidateId(null);
    setSelectedTab('applied');
    setCandidateHistory([]);
    setDetailTab('info');
    setCurrentResumePage(0);
    setSelectedIds(new Set());
  }, [selectedVacancyId]);

  const loadCandidates = useCallback(async (vacancyId: number, silent = false) => {
    if (!silent) setCandidatesLoading(true);
    try {
      const apps = await getApplications(vacancyId);
      setCandidates(apps);
    } catch {
      if (!silent) setCandidates([]);
    } finally {
      if (!silent) setCandidatesLoading(false);
    }
  }, []);

  // Авто-refresh когда юзер возвращается на вкладку браузера —
  // например, после добавления кандидата через волшебную кнопку из
  // другой вкладки. Иначе нужен F5 чтобы увидеть новых.
  // ВАЖНО: рефреш ТИХИЙ (silent) — без скелетонов-лоадеров. Раньше обычный
  // alt-tab перерисовывал список со скелетоном и выглядел как перезагрузка
  // страницы. Плюс троттл: не чаще раза в 3с.
  useEffect(() => {
    let lastRun = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastRun < 3000) return;
      lastRun = now;
      if (selectedVacancyId) loadCandidates(selectedVacancyId, true);
      fetchVacancies(true);
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

  const getVacancyStageLabel = useCallback((stageOrKey: string) => {
    return (
      stagesConfig.labels[stageOrKey] ||
      STAGE_LABELS[stageOrKey] ||
      stageOrKey
    );
  }, [stagesConfig]);

  const vacancyStageDropdownLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const key of stagesConfig.keys) {
      labels[key] = getVacancyStageLabel(key);
    }
    for (const stage of STAGE_ORDER) {
      labels[stage] = getVacancyStageLabel(stage);
    }
    return labels;
  }, [getVacancyStageLabel, stagesConfig.keys]);

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
        // Этап аппликации не маппится ни в одну ВИДИМУЮ колонку (например,
        // кандидата добавили со stage=applied, а в кастомной воронке нет
        // колонки «Новый»). Раньше он уезжал в отдельную группу, которой нет в
        // vacancyVisibleStageKeys → колонка не рендерилась и кандидат ИСЧЕЗАЛ.
        // Теперь кладём его в первую видимую колонку, чтобы он не пропадал.
        const fallbackKey = stagesConfig.keys[0];
        if (fallbackKey) {
          map.get(fallbackKey)!.push(c);
        } else {
          if (!map.has(c.stage)) map.set(c.stage, []);
          map.get(c.stage)!.push(c);
        }
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

  const vacancyWorkflowKeys = stagesConfig.keys;

  const vacancyVisibleStageKeys = useMemo(() => {
    return vacancyWorkflowKeys;
  }, [vacancyWorkflowKeys]);

  // Master-detail derived data
  const selectedCandidate = useMemo(
    () => candidates.find(c => c.id === selectedCandidateId) || null,
    [candidates, selectedCandidateId],
  );

  // Карточка этапа — 2 цвета: активный этап зелёный, отказ/отозван — серый.
  const stageCardStyle: CSSProperties | undefined =
    selectedCandidate && !['rejected', 'withdrawn'].includes(selectedCandidate.stage as string)
      ? ({ '--hf-stage-accent': '#22c55e', '--hf-stage-card-bg': 'rgba(34, 197, 94, 0.1)' } as CSSProperties)
      : undefined;

  const tabFilteredCandidates = useMemo(() => {
    if (selectedTab === 'all') return filteredCandidates;
    return filteredCandidates.filter(c => {
      const mapped = stagesConfig.enumToKeys[c.stage];
      // Тот же фолбэк, что в groupedByStage: кандидат без маппинга этапа
      // относится к первой видимой колонке, иначе он невидим в любой вкладке.
      const candidateStageKeys =
        mapped && mapped.length > 0
          ? mapped
          : stagesConfig.keys[0]
            ? [stagesConfig.keys[0]]
            : [];
      return candidateStageKeys.includes(selectedTab);
    });
  }, [filteredCandidates, selectedTab, stagesConfig]);

  useEffect(() => {
    if (selectedTab === 'all') return;
    const activeKeys = new Set(stagesConfig.keys);
    if (!activeKeys.has(selectedTab)) {
      setSelectedTab(vacancyWorkflowKeys[0] || 'all');
    }
  }, [selectedTab, stagesConfig.keys, vacancyWorkflowKeys]);

  useEffect(() => {
    if (tabFilteredCandidates.length === 0) {
      if (selectedCandidateId !== null) setSelectedCandidateId(null);
      return;
    }
    if (!selectedCandidateId || !tabFilteredCandidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(tabFilteredCandidates[0].id);
      setDetailTab('info');
    }
  }, [selectedCandidateId, tabFilteredCandidates]);

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

  useEffect(() => {
    setPersonalNoteText('');
    setPersonalNoteComposerOpen(false);
    setStageCommentText('');
    setStageCommentComposerOpen(false);
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

  const vacancyEntityNotes = useMemo(() => {
    if (!Array.isArray(entityExtraData?.notes)) return [];
    return (entityExtraData.notes as Array<Record<string, unknown>>)
      .slice()
      .sort((a, b) => {
        const ta = a?.date ? new Date(a.date as string).getTime() : 0;
        const tb = b?.date ? new Date(b.date as string).getTime() : 0;
        return tb - ta;
      });
  }, [entityExtraData]);
  const vacancyPersonalNotes = useMemo(
    () => vacancyEntityNotes.filter((note) => !note.stage),
    [vacancyEntityNotes],
  );
  const vacancyWorkflowComments = useMemo(
    () => vacancyEntityNotes.filter((note) => Boolean(note.stage)),
    [vacancyEntityNotes],
  );

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
    setShowStatusMenu(false);
    if (!selectedVacancyId) {
      setSearchParams(nextStatus === 'all' ? {} : { status: nextStatus });
    }
  };

  const handleRecruiterFilterChange = (userId: number | null) => {
    if (!isHrAdmin) {
      setSelectedRecruiterFilter(null);
      setShowRecruiterMenu(false);
      return;
    }
    setSelectedRecruiterFilter(userId);
    setShowRecruiterMenu(false);
    if (userId !== null) {
      setExpandedGroups((prev) => new Set(prev).add(userId));
    }
    if (selectedVacancyId) {
      deselectVacancy();
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

  const handleReopenVacancy = async (vacancy: Vacancy) => {
    try {
      await updateVacancy(vacancy.id, { status: 'open' });
      toast.success('Вакансия открыта заново');
      setStatusFilter('open');
      setSearchParams({ v: String(vacancy.id), status: 'open' });
      fetchVacancies();
    } catch {
      toast.error('Не удалось открыть вакансию заново');
    }
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
        fetchVacancies();
      } else {
        await deleteVacancy(confirmDialog.vacancy.id);
        toast.success('Вакансия удалена');
        // НЕ рефетчим после удаления: store уже убрал вакансию из списка.
        // Рефетч сразу после delete мог вернуть её обратно из-за read-after-write
        // задержки (реплика/кэш) — отсюда «удаляется только со второго раза».
        if (selectedVacancyId === confirmDialog.vacancy.id) {
          setSearchParams({});
        }
      }
      setConfirmDialog(null);
    } catch {
      toast.error(confirmDialog.type === 'close' ? 'Ошибка при закрытии' : 'Ошибка при удалении');
    } finally {
      setConfirmBusy(false);
    }
  };

  // Change candidate stage
  const handleStageChange = useCallback(async (applicationId: number, newStage: ApplicationStage, comment?: string) => {
    try {
      await updateApplication(applicationId, { stage: newStage, ...(comment ? { comment } : {}) });
      // Локально двигаем кандидата на новый этап.
      setCandidates((prev) =>
        prev.map((c) => c.id === applicationId ? { ...c, stage: newStage } : c)
      );
      // НЕ переключаем вкладку и НЕ «следуем» за кандидатом (требование Маши):
      // остаёмся на текущем этапе, карточка просто исчезает из текущего списка.
      // Дальше выбором управляет эффект [selectedCandidateId, tabFilteredCandidates]:
      // если на этапе никого не осталось — выбор снимается и показывается заглушка
      // «На этом этапе пока нет кандидатов»; иначе выбирается первый оставшийся.
      toast.success(`Статус изменён → ${getVacancyStageLabel(newStage)}`);
      // Refresh vacancy store for updated counts
      fetchVacancies();
    } catch {
      toast.error('Ошибка смены статуса');
    }
  }, [fetchVacancies, getVacancyStageLabel]);

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

  // ─── Богатый пикер смены этапа (как на «Все кандидаты»): список этапов +
  // редактор «Записать комментарий». Заменяет узкий StageDropdown. ───
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [stagePickerPending, setStagePickerPending] = useState<ApplicationStage | null>(null);
  const [stagePickerComment, setStagePickerComment] = useState('');
  const stagePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stagePickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (stagePickerRef.current && !stagePickerRef.current.contains(e.target as Node)) {
        setStagePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [stagePickerOpen]);

  // ─── Меню действий со статусом («⋯»): убрать из вакансии / откатить этап ───
  const [candidateMenuOpen, setCandidateMenuOpen] = useState(false);
  const candidateMenuRef = useRef<HTMLDivElement>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => {
    if (!candidateMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (candidateMenuRef.current && !candidateMenuRef.current.contains(e.target as Node)) {
        setCandidateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [candidateMenuOpen]);

  // Прошлый этап для отката — from_stage самой свежей записи истории
  // (to_stage у неё = текущий этап).
  const prevStage = useMemo<ApplicationStage | null>(() => {
    if (!Array.isArray(candidateHistory) || candidateHistory.length === 0) return null;
    const latest = [...candidateHistory].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
    return (latest?.from_stage as ApplicationStage | null) || null;
  }, [candidateHistory]);

  const handleRevertStage = useCallback(async () => {
    if (!selectedCandidate || !prevStage) return;
    setCandidateMenuOpen(false);
    await handleStageChange(selectedCandidate.id, prevStage);
  }, [selectedCandidate, prevStage, handleStageChange]);

  const handleRemoveFromVacancy = useCallback(async () => {
    if (!selectedCandidate) return;
    setRemoveBusy(true);
    try {
      await deleteApplication(selectedCandidate.id);
      // Локально убираем отклик — кандидат исчезает из текущего списка; выбором
      // дальше управляет эффект (как при смене этапа): останемся на вкладке,
      // последний → заглушка «На этом этапе пока нет кандидатов».
      setCandidates((prev) => prev.filter((c) => c.id !== selectedCandidate.id));
      toast.success('Кандидат убран из вакансии');
      setRemoveConfirmOpen(false);
      setCandidateMenuOpen(false);
      fetchVacancies();
    } catch {
      toast.error('Не удалось убрать из вакансии');
    } finally {
      setRemoveBusy(false);
    }
  }, [selectedCandidate, fetchVacancies]);

  const saveEntityNote = useCallback(async (
    text: string,
    stage?: string | null,
    stageLabel?: string | null,
  ) => {
    if (!selectedCandidate?.entity_id || !text.trim()) return;
    setCommentSaving(true);
    try {
      // Через POST /entities/{id}/notes — рекрутёру достаточно view-доступа.
      const resp = await addEntityNote(selectedCandidate.entity_id, {
        text: text.trim(),
        stage,
        stage_label: stageLabel,
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
  }, [selectedCandidate?.entity_id]);

  const handleSaveComment = useCallback(async (text: string) => {
    await saveEntityNote(
      text,
      selectedCandidate?.stage as string | undefined,
      selectedCandidate?.stage ? getVacancyStageLabel(selectedCandidate.stage as string) : null,
    );
  }, [getVacancyStageLabel, saveEntityNote, selectedCandidate?.stage]);

  const handleSavePersonalNote = useCallback(async () => {
    const text = personalNoteText.trim();
    if (!text) return;
    await saveEntityNote(text, null, 'Личная заметка');
    setPersonalNoteText('');
    setPersonalNoteComposerOpen(false);
  }, [personalNoteText, saveEntityNote]);

  const handleSaveStageComment = useCallback(async () => {
    const text = stageCommentText.trim();
    if (!text) return;
    await handleSaveComment(text);
    setStageCommentText('');
    setStageCommentComposerOpen(false);
  }, [handleSaveComment, stageCommentText]);

  // Этапы для пикера — тот же список и лейблы, что были в StageDropdown.
  const stagePickerOptions = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        status: stage as ApplicationStage,
        label: vacancyStageDropdownLabels[stage] || STAGE_LABELS[stage] || stage,
      })),
    [vacancyStageDropdownLabels],
  );

  // Сохранение из пикера: коммент привязывается к ВЫБРАННОМУ этапу (дату ставит
  // сервер), затем кандидат переносится. Коммент необязателен — можно просто
  // сменить этап.
  const handleStagePickerSave = useCallback(async () => {
    if (!selectedCandidate) return;
    const target = (stagePickerPending ?? (selectedCandidate.stage as ApplicationStage)) as ApplicationStage;
    const text = stagePickerComment.trim();
    const isMove = target !== selectedCandidate.stage;
    if (isMove) {
      // Коммент уходит В САМ переход → в истории «X → Y: текст», отдельную заметку не создаём.
      await handleStageChange(selectedCandidate.id, target, text || undefined);
    } else if (text) {
      // Без смены этапа — обычный коммент к текущему этапу.
      await saveEntityNote(text, target as string, getVacancyStageLabel(target as string));
    }
    setStagePickerComment('');
    setStagePickerOpen(false);
  }, [
    selectedCandidate,
    stagePickerPending,
    stagePickerComment,
    saveEntityNote,
    getVacancyStageLabel,
    handleStageChange,
  ]);

  const handleDeleteNote = useCallback(async (note: Record<string, unknown>) => {
    if (!selectedCandidate?.entity_id) return;
    // Новые заметки удаляются по id; у старых (до коммита 9bac610) id нет —
    // бэкенд поддерживает фолбэк по дате через ключ "date:<iso>".
    const key = (note.id as string) || (note.date ? `date:${note.date as string}` : '');
    if (!key) {
      toast.error('Не удалось определить комментарий');
      return;
    }
    try {
      await deleteEntityNote(selectedCandidate.entity_id, key);
      setEntityExtraData((prev) => {
        const existing = Array.isArray(prev?.notes)
          ? (prev!.notes as Array<Record<string, unknown>>)
          : [];
        return { ...(prev || {}), notes: existing.filter((n) => n !== note) };
      });
      toast.success('Комментарий удалён');
    } catch {
      toast.error('Не удалось удалить комментарий');
    }
  }, [selectedCandidate?.entity_id]);

  const handleDeleteHistory = useCallback(async (historyId: number) => {
    if (!selectedCandidate || !historyId) return;
    try {
      await deleteApplicationHistory(selectedCandidate.id, historyId);
      setCandidateHistory((prev) => prev.filter((h: any) => h.id !== historyId));
      toast.success('Запись истории удалена');
    } catch {
      toast.error('Не удалось удалить запись');
    }
  }, [selectedCandidate]);

  const renderVacancyNoteCard = useCallback((note: Record<string, unknown>, i: number) => {
    const stage = note.stage as string | undefined;
    const stageLabel = (note.stage_label as string | undefined)
      || (stage ? getVacancyStageLabel(stage) : null);
    const authorName = (note.author_name as string) || 'Аноним';
    const dateStr = note.date ? new Date(note.date as string).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) : '';
    return (
      <div
        key={(note.id as string) || `note-${i}`}
        className={clsx(
          'hf-vacancy-note-card',
          stage && 'hf-vacancy-note-card-workflow',
        )}
      >
        <div className="hf-vacancy-note-avatar">
          {(authorName || '?')[0].toUpperCase()}
        </div>
        <div className="hf-vacancy-note-body">
          <div className="hf-vacancy-note-meta">
            <span className="hf-vacancy-note-author">{authorName}</span>
            {stageLabel && (
              <span className="hf-vacancy-note-stage">{stageLabel}</span>
            )}
            <span className="hf-vacancy-note-date">{dateStr}</span>
            {(note.id || note.date) ? (
              <button
                type="button"
                onClick={() => handleDeleteNote(note)}
                title="Удалить комментарий"
                className="ml-auto flex-shrink-0 rounded p-0.5 text-[var(--hf-main-400)] transition-colors hover:text-[var(--hf-status-red)]"
              >
                <Trash2 className="h-[14px] w-[14px]" />
              </button>
            ) : null}
          </div>
          <div className="hf-vacancy-note-text">
            {String(note.text)}
          </div>
        </div>
      </div>
    );
  }, [getVacancyStageLabel, handleDeleteNote]);

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
    } catch (err) {
      // B7-fix: показываем реальную причину с бэка (размер/тип/нет места и т.п.)
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Ошибка загрузки файла');
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

  useEffect(() => {
    if (showVacancyTopSearch) {
      vacancyTopSearchRef.current?.focus();
    }
  }, [showVacancyTopSearch]);

  useEffect(() => {
    if (isHrAdmin) return;
    setSelectedRecruiterFilter(null);
    setShowRecruiterMenu(false);
    setRecruiterSearch('');
  }, [isHrAdmin]);

  useEffect(() => {
    if (!showStatusMenu && !showRecruiterMenu) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) {
        setShowStatusMenu(false);
      }
      if (recruiterMenuRef.current && !recruiterMenuRef.current.contains(target)) {
        setShowRecruiterMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStatusMenu, showRecruiterMenu]);

  // Get vacancies available for adding a candidate (exclude current vacancy, show only open ones)
  const availableVacanciesForCandidate = useMemo(() => {
    if (!selectedCandidate?.entity_id) return [];
    return vacancies.filter(v =>
      v.id !== selectedVacancyId &&
      v.status === 'open'
    );
  }, [vacancies, selectedVacancyId, selectedCandidate?.entity_id]);

  const buildCandidateEditCard = useCallback((candidate: VacancyApplication): KanbanCard => ({
    id: candidate.entity_id,
    name: candidate.entity_name || 'Без имени',
    email: candidate.entity_email || undefined,
    phone: candidate.entity_phone || undefined,
    telegram_username: candidate.entity_telegram || undefined,
    position: candidate.entity_position || undefined,
    source: candidate.source || undefined,
    recruiter_name: selectedVacancy?.created_by_name,
    created_at: candidate.applied_at,
    tags: entityTags.map((tag) => tag.name),
    company: candidate.entity_company || undefined,
    vacancy_name: selectedVacancy?.title || candidate.vacancy_title,
    rejection_reason: candidate.rejection_reason || undefined,
    extra_data: entityExtraData || undefined,
  }), [entityExtraData, entityTags, selectedVacancy]);

  const handleCandidateSaved = useCallback((updated: Partial<KanbanCard>) => {
    if (!editingCandidateCard) return;
    setCandidates((items) => items.map((candidate) => (
      candidate.entity_id === editingCandidateCard.id
        ? {
            ...candidate,
            entity_name: updated.name ?? candidate.entity_name,
            entity_email: updated.email ?? candidate.entity_email,
            entity_phone: updated.phone ?? candidate.entity_phone,
            entity_telegram: updated.telegram_username ?? candidate.entity_telegram,
            entity_position: updated.position ?? candidate.entity_position,
            entity_company: updated.company ?? candidate.entity_company,
          }
        : candidate
    )));
    setEditingCandidateCard(null);
  }, [editingCandidateCard]);

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
      {isHrAdmin && !selectedVacancy && <aside className={clsx(
        'hf-recruiter-sidebar flex-shrink-0 flex flex-col overflow-hidden z-50 transition-all duration-200',
        // Desktop: collapsible
        sidebarCollapsed
          ? 'lg:relative lg:translate-x-0 lg:w-0 lg:border-r-0 lg:overflow-hidden'
          : 'lg:relative lg:translate-x-0 lg:w-[260px]',
        // Mobile: slide-in overlay
        'fixed inset-y-0 left-0 w-[280px]',
        mobileSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        {/* Header */}
        <div className="hf-recruiter-sidebar-head">
          <span className="hf-recruiter-sidebar-title">
            {isHrAdmin ? 'Рекрутеры' : 'Мои вакансии'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateModal(true)}
              className="hf-recruiter-sidebar-icon-btn"
              title="Новая вакансия"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="hf-recruiter-sidebar-icon-btn hidden lg:block"
              title="Свернуть панель"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setMobileSidebar(false)}
              className="hf-recruiter-sidebar-icon-btn lg:hidden"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="hf-recruiter-search-wrap">
          <div className="relative">
            <Search className="hf-recruiter-search-icon" />
            <input
              type="text"
              placeholder={isHrAdmin ? "Поиск по рекрутеру..." : "Поиск вакансий..."}
              value={recruiterSearch}
              onChange={(e) => setRecruiterSearch(e.target.value)}
              className="hf-recruiter-search-input"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--hf-accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visibleRecruiterGroups.length === 0 ? (
            <div className="hf-recruiter-empty">
              {recruiterSearch ? 'Ничего не найдено' : 'Нет вакансий'}
            </div>
          ) : (
            visibleRecruiterGroups.map((group) => (
              <div key={group.userId}>
                {/* Recruiter folder header */}
                {isHrAdmin && (
                  <button
                    onClick={() => toggleGroup(group.userId)}
                    className="hf-recruiter-group-btn group"
                  >
                    {group.expanded ? (
                      <ChevronDown className="hf-recruiter-chevron" />
                    ) : (
                      <ChevronRight className="hf-recruiter-chevron" />
                    )}
                    <FolderOpen className="hf-recruiter-folder-icon" />
                    <span className="hf-recruiter-group-name">
                      {group.userName}
                    </span>
                    <span className="hf-recruiter-count">
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
                            'hf-recruiter-vacancy-btn',
                            isHrAdmin ? 'pl-6' : 'pl-3',
                            isSelected && 'hf-recruiter-vacancy-btn-active',
                          )}
                        >
                          <span className={clsx(
                            'hf-recruiter-status-dot',
                            getRecruiterStatusDotClass(v.status),
                          )} />
                          <span className={clsx('hf-recruiter-vacancy-title', !v.title?.trim() && 'hf-recruiter-vacancy-title-empty')}>{v.title?.trim() || 'Без названия'}</span>
                          <span className={clsx(
                            'hf-recruiter-count',
                            isSelected && 'hf-recruiter-count-active',
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
      {isHrAdmin && !selectedVacancy && sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="hf-recruiter-sidebar-expand hidden lg:flex group"
          title="Развернуть панель"
        >
          <PanelLeftOpen className="w-4 h-4 transition-colors" />
        </button>
      )}

      {/* ========== MAIN CONTENT ========== */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* No vacancy selected — show funnels overview */}
        {!selectedVacancy ? (
          <div className="vacancies-page flex-1 w-full max-w-full flex flex-col overflow-hidden text-[var(--hf-vacancies-page-text)]">
            <div className="hf-funnels-overview-head">
              <div className="hf-funnels-toolbar-shell">
                <div className="hf-funnels-toolbar">
                  <button
                    onClick={() => setMobileSidebar(true)}
                    className="hf-funnels-mobile-sidebar-btn lg:hidden"
                    aria-label="Открыть список рекрутеров"
                  >
                    <Menu className="hf-funnels-mobile-sidebar-icon" />
                  </button>
                  <label className={clsx('hf-funnels-search', search && 'hf-funnels-search-active')}>
                    <Search className="hf-funnels-search-icon" />
                    <input
                      type="text"
                      placeholder="Поиск по названию..."
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="hf-funnels-search-input"
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                        }}
                        className="hf-funnels-search-clear"
                        title="Очистить поиск"
                      >
                        <X className="hf-funnels-search-clear-icon" />
                      </button>
                    )}
                  </label>

                  <div className="hf-funnels-filter-wrap" ref={statusMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowStatusMenu((value) => !value)}
                    className="hf-funnels-filter"
                    aria-haspopup="menu"
                    aria-expanded={showStatusMenu}
                  >
                    <span>{statusFilterLabel}</span>
                    <ChevronDown className={clsx('hf-funnels-filter-icon', showStatusMenu && 'hf-funnels-filter-icon-open')} />
                  </button>
                  {showStatusMenu && (
                    <div className="hf-funnels-menu hf-funnels-status-menu" role="menu">
                      {HUNTFLOW_VACANCY_STATUS_FILTERS.map((status) => (
                        <button
                          key={status.id}
                          type="button"
                          role="menuitem"
                          onClick={() => handleStatusFilterChange(status.id)}
                          className={clsx(
                            'hf-funnels-menu-option',
                            statusFilter === status.id && 'hf-funnels-menu-option-active',
                          )}
                        >
                          <Check className="hf-funnels-menu-check" />
                          <span>{status.id === 'all' ? 'Все вакансии' : status.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  </div>

                  {isHrAdmin && (
                    <div className="hf-funnels-filter-wrap" ref={recruiterMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowRecruiterMenu((value) => !value)}
                        className="hf-funnels-filter"
                        aria-haspopup="menu"
                        aria-expanded={showRecruiterMenu}
                      >
                        <Users className="hf-funnels-filter-leading-icon" />
                        <span>Рекрутеры: {recruiterFilterLabel}</span>
                        <ChevronDown className={clsx('hf-funnels-filter-icon', showRecruiterMenu && 'hf-funnels-filter-icon-open')} />
                      </button>
                      {showRecruiterMenu && (
                        <div className="hf-funnels-menu hf-funnels-recruiter-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => handleRecruiterFilterChange(null)}
                            className={clsx(
                              'hf-funnels-menu-option',
                              selectedRecruiterFilter === null && 'hf-funnels-menu-option-active',
                            )}
                          >
                            <Check className="hf-funnels-menu-check" />
                            <span className="hf-funnels-recruiter-avatar">Все</span>
                            <span className="hf-funnels-recruiter-menu-text">
                              <span>Все рекрутеры</span>
                              <span>{scopedVacancies.length} вакансий</span>
                            </span>
                          </button>
                          {recruiterFilterOptions.length === 0 ? (
                            <div className="hf-funnels-menu-empty">Нет рекрутеров</div>
                          ) : (
                            recruiterFilterOptions.map((recruiter) => (
                              <button
                                key={recruiter.id}
                                type="button"
                                role="menuitem"
                                onClick={() => handleRecruiterFilterChange(recruiter.id)}
                                className={clsx(
                                  'hf-funnels-menu-option',
                                  selectedRecruiterFilter === recruiter.id && 'hf-funnels-menu-option-active',
                                )}
                              >
                                <Check className="hf-funnels-menu-check" />
                                <span className="hf-funnels-recruiter-avatar">
                                  {recruiter.name[0]?.toUpperCase() || 'Р'}
                                </span>
                                <span className="hf-funnels-recruiter-menu-text">
                                  <span>{recruiter.name}</span>
                                  <span>{recruiter.count} вакансий</span>
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  data-tour="create-vacancy"
                  aria-label="Создать вакансию"
                  title="Создать вакансию"
                  className="hf-funnels-icon-action-btn hf-funnels-overview-create"
                >
                  <Plus className="hf-funnels-icon-action" strokeWidth={2.25} />
                </button>
              </div>
            </div>

            <div className="hf-vacancies-search-body">
              <section className="hf-vacancies-search-results">
                <div className="hf-vacancies-search-count">
                  Найдено вакансий: {filteredVacancies.length}
                  {isHrAdmin && ` у ${filteredRecruiterCount} рекрутеров`}
                </div>
                <div className="hf-vacancies-search-list">
                  {filteredVacancies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                      <Briefcase className="w-10 h-10 text-[var(--hf-vacancies-page-faint)]" />
                      <div>
                        <p className="text-[var(--hf-vacancies-page-text)] font-medium">
                          {search ? 'Ничего не найдено' : 'Пока нет вакансий'}
                        </p>
                        <p className="text-[var(--hf-vacancies-page-muted)] text-sm mt-1">
                          {search ? 'Измените поиск или фильтр статуса' : 'Создайте первую вакансию для начала работы'}
                        </p>
                      </div>
                      {!search && (
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-[var(--hf-cyan-600)] hover:bg-[var(--hf-cyan-400)] text-[var(--hf-white)] text-sm font-medium rounded-lg transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          Создать вакансию
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredVacancies.map((v) => {
                      const count = v.applications_count ?? 0;
                      return (
                        <div
                          key={v.id}
                          onClick={() => selectVacancy(v.id)}
                          className="hf-vacancies-search-row"
                        >
                          <div className="hf-vacancies-search-main">
                            <div className="hf-vacancies-search-title-row">
                              <VacancyStatusBadge status={v.status} size="sm" />
                              <span
                                className={clsx(
                                  'hf-vacancies-search-title',
                                  !v.title?.trim() && 'hf-vacancies-search-title-empty',
                                )}
                              >
                                {v.title?.trim() || 'Без названия'}
                              </span>
                              <span className="hf-vacancies-search-kind">Вакансия</span>
                              {count > 0 && (
                                <span className="hf-vacancies-search-candidates">
                                  <Users className="hf-vacancies-search-candidates-icon" />
                                  {count}
                                </span>
                              )}
                            </div>
                            <div className="hf-vacancies-search-meta">
                              <span>Открыта: {formatVacancyListDate(v.created_at)}</span>
                              {v.updated_at && (
                                <span>Последнее действие: {formatVacancyListDate(v.updated_at)}</span>
                              )}
                              <span>Рекрутер: {v.created_by_name || usersMap[v.created_by ?? 0] || 'Не назначен'}</span>
                            </div>
                            <div className="hf-vacancies-search-department">
                              {v.department_name || 'Общая'}
                            </div>
                          </div>
                          <div className="hf-vacancies-search-side">
                            <span className="hf-vacancies-search-chip">
                              {count} кандидатов
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingVacancy(v);
                                }}
                                className="hf-vacancies-search-action"
                                title="Редактировать"
                              >
                                <Pencil className="hf-vacancies-search-action-icon" />
                              </button>
                              {v.status !== 'closed' && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCloseVacancy(v);
                                  }}
                                  className="hf-vacancies-search-action"
                                  title="Закрыть вакансию"
                                >
                                  <Archive className="hf-vacancies-search-action-icon" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteVacancy(v);
                                }}
                                className="hf-vacancies-search-action"
                                title="Удалить"
                              >
                                <Trash2 className="hf-vacancies-search-action-icon" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : selectedVacancy.status === 'closed' ? (
          <ClosedVacancyDetail
            vacancy={selectedVacancy}
            stageKeys={vacancyVisibleStageKeys}
            stagesConfig={stagesConfig}
            groupedByStageMap={groupedByStageMap}
            onReopen={() => handleReopenVacancy(selectedVacancy)}
            onEdit={() => setEditingVacancy(selectedVacancy)}
          />
        ) : (
          /* Vacancy selected — show candidates (Huntflow-style master-detail) */
          <div className="hf-vacancy-workspace flex-1 flex flex-col overflow-hidden">
            {/* Top bar: vacancy title context; search lives in the stage island like /all-candidates */}
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
                    className={clsx(
                      'hf-vacancy-stage-tabs hf-top-stage-tabs no-scrollbar',
                      !showVacancyTopSearch && 'hf-top-stage-tabs-padded',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (showVacancyTopSearch || candidateSearch) {
                          setCandidateSearch('');
                          setShowVacancyTopSearch(false);
                          return;
                        }
                        setShowVacancyTopSearch(true);
                      }}
                      className={clsx(
                        'hf-top-stage-search-toggle hf-vacancy-stage-search-toggle',
                        (showVacancyTopSearch || candidateSearch) && 'hf-top-stage-search-toggle-active',
                      )}
                      title={showVacancyTopSearch ? 'Скрыть поиск' : 'Открыть поиск'}
                      aria-pressed={showVacancyTopSearch}
                    >
                      <Search className="h-[var(--hf-candidates-search-icon)] w-[var(--hf-candidates-search-icon)]" />
                    </button>

                    {showVacancyTopSearch || candidateSearch ? (
                      <div className="hf-top-stage-search hf-vacancy-stage-search">
                        <input
                          ref={vacancyTopSearchRef}
                          value={candidateSearch}
                          onChange={(event) => setCandidateSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              if (candidateSearch) setCandidateSearch('');
                              else setShowVacancyTopSearch(false);
                            }
                          }}
                          placeholder="Поиск по имени, должности..."
                          className="hf-top-stage-search-input"
                        />
                        {candidateSearch ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCandidateSearch('');
                              vacancyTopSearchRef.current?.focus();
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
                        {vacancyVisibleStageKeys.map(key => {
                          const count = groupedByStageMap[key]?.length || 0;
                          const vacancyStageLabel = stagesConfig.labels[key];
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
                  {vacancyStageCanScrollLeft && !showVacancyTopSearch && !candidateSearch ? (
                    <button
                      type="button"
                      onClick={scrollVacancyStagesLeft}
                      className="hf-top-stage-arrow hf-top-stage-arrow-left"
                      title="Прокрутить этапы влево"
                    >
                      <ChevronLeft className="hf-top-stage-arrow-icon" />
                    </button>
                  ) : null}
                  {vacancyStageCanScrollRight && !showVacancyTopSearch && !candidateSearch ? (
                    <button
                      type="button"
                      onClick={scrollVacancyStagesRight}
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
                      <h2>На этом этапе пока нет кандидатов</h2>
                      <p className="hf-vacancy-empty-text">
                        Кандидаты появятся здесь после перемещения на выбранный этап.
                      </p>
                    </section>
                  </div>
                ) : (
                /* Master-Detail split */
                <div className="hf-candidates-master">
                  {/* Left: candidate list */}
                  <div className="hf-candidates-list-panel relative">
                    <div className={clsx('hf-candidates-list-scroll', anySelected && 'pb-14')}>
                    {tabFilteredCandidates.length === 0 ? (
                      <div className="flex items-center justify-center h-40 text-hf-xxs text-[var(--hf-main-500)] hf-dark-disabled:text-[color:var(--hf-white-alpha-40)]">
                        Нет кандидатов
                      </div>
                    ) : (
                      tabFilteredCandidates.map(candidate => {
                        const isSelected = candidate.id === selectedCandidateId;
                        const isChecked = selectedIds.has(candidate.id);
                        const listMetaPrimary = candidate.entity_company || candidate.source;
                        return (
                          <div
                            key={candidate.id}
                            onClick={() => { setSelectedCandidateId(candidate.id); setDetailTab('info'); }}
                            className={clsx(
                              'hf-candidate-row',
                              isChecked || isSelected
                                ? 'hf-candidate-row-selected'
                                : 'hf-candidate-row-idle',
                            )}
                          >
                            {/* Avatar / checkmark zone — same interaction as /all-candidates */}
                            <div
                              onClick={(e) => { e.stopPropagation(); toggleCandidateSelection(candidate.id); }}
                              className="hf-candidate-avatar-zone"
                            >
                              {isChecked ? (
                                (candidate as { entity_photo?: string }).entity_photo ? (
                                  <div className="hf-candidate-avatar-check">
                                    <img
                                      src={(candidate as { entity_photo?: string }).entity_photo}
                                      alt={candidate.entity_name || ''}
                                      referrerPolicy="no-referrer"
                                      className="hf-candidate-avatar-check-img"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    <div className="hf-candidate-avatar-check-overlay">
                                      <Check className="hf-candidate-check-icon" />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="hf-candidate-avatar-check">
                                    <Check className="hf-candidate-check-icon" />
                                  </div>
                                )
                              ) : (
                                <>
                                  {(candidate as { entity_photo?: string }).entity_photo ? (
                                    <img
                                      src={(candidate as { entity_photo?: string }).entity_photo}
                                      alt={candidate.entity_name || ''}
                                      referrerPolicy="no-referrer"
                                      className="hf-candidate-avatar"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  ) : (
                                    <div className="hf-candidate-avatar-fallback">
                                      <span className="hf-candidate-avatar-head" />
                                      <span className="hf-candidate-avatar-body" />
                                    </div>
                                  )}
                                  <div className="hf-candidate-avatar-hover">
                                    <Check className="hf-candidate-check-icon" />
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="hf-candidate-row-copy">
                              <div className="flex items-center min-w-0">
                                <div className="hf-candidate-row-name">
                                  {candidate.entity_name || 'Без имени'}
                                </div>
                              </div>
                              {candidate.entity_position && (
                                <div className="hf-candidate-row-subtitle">
                                  {candidate.entity_position}
                                </div>
                              )}
                              <div className="hf-candidate-row-meta">
                                {listMetaPrimary && (
                                  <span
                                    className="hf-candidate-row-meta-text"
                                    title={listMetaPrimary}
                                  >
                                    {listMetaPrimary}
                                  </span>
                                )}
                                {listMetaPrimary && candidate.applied_at && (
                                  <span className="hf-candidate-row-meta-dot">·</span>
                                )}
                                {candidate.applied_at && (
                                  <span className="hf-candidate-row-date">
                                    {new Date(candidate.applied_at).toLocaleDateString('ru')}
                                  </span>
                                )}
                              </div>
                              <div className="sr-only">
                                {candidate.entity_name || 'Без имени'}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    </div>

                    {/* Bulk actions floating bar */}
                    {anySelected && (
                      <div className="absolute bottom-0 left-0 right-0 p-3 bg-[var(--hf-white)] border-t border-[var(--hf-ui-divider)] shadow-[0_-8px_24px_var(--hf-alpha-100)] flex items-center justify-between">
                        <span className="text-xs text-[var(--hf-main-600)] font-medium">
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
                              <div className="absolute bottom-full left-0 mb-1 z-50 w-56 py-1 bg-[var(--hf-white)] border border-[var(--hf-ui-border)] rounded-xl shadow-[var(--hf-shadow-2xl)] overflow-hidden">
                                <div className="px-3 py-1.5 text-[10px] text-[var(--hf-main-500)] uppercase tracking-wider font-semibold">
                                  Перенести в
                                </div>
                                {STAGE_ORDER.map((stage) => {
                                  const sc = STAGE_COLORS[stage] || fallbackColor;
                                  return (
                                    <button
                                      key={stage}
                                      onClick={() => handleBulkMove(stage as ApplicationStage)}
                                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors text-sm hover:bg-[var(--hf-ui-hover)] text-[var(--hf-main-700)] hover:text-[var(--hf-main-900)]"
                                    >
                                      <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', sc.dot)} />
                                      <span className="flex-1">{getVacancyStageLabel(stage)}</span>
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
                            className="px-2.5 py-1 text-xs font-medium rounded-lg text-[var(--hf-main-600)] hover:bg-[var(--hf-ui-hover)] transition-colors"
                          >
                            Снять
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: detail panel */}
                  <div className="hf-candidates-detail-panel hf-vacancy-detail flex-1 bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-bg-dark)] rounded-hf-l flex flex-col overflow-hidden">
                    {selectedCandidate ? (
                      <>
                        {/* Detail tabs: Личные заметки / Резюме */}
                        <div className={clsx(
                          'flex items-center border-b border-[color:var(--hf-white-alpha-06)] px-5 flex-shrink-0',
                          detailTab === 'info' && 'hidden',
                        )}>
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
                            <div className="p-[var(--hf-space-xxl)] max-w-[1220px]">
                              {/* Top action buttons — Huntflow style */}
                              <div className="hf-profile-action-bar">
                                {selectedCandidate.entity_id && (
                                  <button
                                    onClick={() => navigate(`/all-candidates?entity=${selectedCandidate.entity_id}`)}
                                    className="hf-profile-action-btn"
                                  >
                                    <Users className="hf-profile-action-icon" /> Открыть профиль
                                  </button>
                                )}
                                {selectedCandidate.entity_id && (
                                  <div className="relative" ref={addToVacancyRef}>
                                    <button
                                      onClick={() => setShowAddToVacancy(!showAddToVacancy)}
                                      disabled={addingToVacancy}
                                      className="hf-profile-action-btn disabled:opacity-50"
                                    >
                                      {addingToVacancy ? (
                                        <Loader2 className="hf-profile-action-icon animate-spin" />
                                      ) : (
                                        <Plus className="hf-profile-action-icon" />
                                      )}
                                      Переместить
                                    </button>
                                    {showAddToVacancy && (
                                      <div className="hf-profile-vacancy-menu absolute top-full left-0 mt-1 w-72 max-h-64 overflow-y-auto z-50">
                                        {availableVacanciesForCandidate.length === 0 ? (
                                          <div className="hf-profile-vacancy-menu-empty">Нет доступных вакансий</div>
                                        ) : (
                                          availableVacanciesForCandidate.map((v) => (
                                            <button
                                              key={v.id}
                                              onClick={() => handleAddToVacancy(v.id)}
                                              disabled={addingToVacancy}
                                              className="hf-profile-vacancy-menu-item"
                                            >
                                              <Briefcase className="hf-profile-vacancy-menu-icon" />
                                              <span className="truncate">{v.title}</span>
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <button
                                  onClick={() => setEditingCandidateCard(buildCandidateEditCard(selectedCandidate))}
                                  className="hf-profile-action-btn"
                                >
                                  <Pencil className="hf-profile-action-icon" /> Редактировать
                                </button>
                              </div>

                              {/* Name + large photo (Huntflow / AllCandidatesPage style) */}
                              <div className="hf-profile-summary">
                                <div className="hf-profile-summary-copy">
                                  <h2 className="hf-profile-title">
                                    {selectedCandidate.entity_name || 'Без имени'}
                                  </h2>
                                  {(selectedCandidate.entity_position || selectedCandidate.entity_company) && (
                                    <p className="hf-profile-subtitle">
                                      {[selectedCandidate.entity_position, selectedCandidate.entity_company].filter(Boolean).join(' · ')}
                                    </p>
                                  )}

                              {/* Contact info — Huntflow dotted-line rows */}
                              <div className="mb-[var(--hf-space-xl)]">
                                {selectedCandidate.entity_phone && (
                                  <HuntflowInfoRow label="Телефон">
                                    <div className="flex items-center gap-2">
                                      <a href={`tel:${selectedCandidate.entity_phone}`} className="text-[var(--hf-main-900)] hover:text-[var(--hf-cyan-700)] transition-colors">
                                        {selectedCandidate.entity_phone}
                                      </a>
                                      <CopyButton value={selectedCandidate.entity_phone} />
                                    </div>
                                  </HuntflowInfoRow>
                                )}
                                {selectedCandidate.entity_email && (
                                  <HuntflowInfoRow label="Эл. почта">
                                    <div className="flex items-center gap-2">
                                      <a href={`mailto:${selectedCandidate.entity_email}`} className="text-[var(--hf-main-900)] hover:text-[var(--hf-cyan-700)] transition-colors">
                                        {selectedCandidate.entity_email}
                                      </a>
                                      <CopyButton value={selectedCandidate.entity_email} />
                                    </div>
                                  </HuntflowInfoRow>
                                )}
                                {selectedCandidate.entity_telegram && (
                                  <HuntflowInfoRow label="Telegram">
                                    <div className="flex items-center gap-2">
                                      <a href={`https://t.me/${selectedCandidate.entity_telegram}`} target="_blank" rel="noopener noreferrer" className="text-[var(--hf-main-900)] hover:text-[var(--hf-cyan-700)] transition-colors">
                                        @{selectedCandidate.entity_telegram}
                                      </a>
                                      <CopyButton value={`@${selectedCandidate.entity_telegram}`} />
                                    </div>
                                  </HuntflowInfoRow>
                                )}
                                {selectedCandidate.source && (
                                  <HuntflowInfoRow label="Источник">
                                    <span className="text-[var(--hf-main-900)]">{selectedCandidate.source}</span>
                                  </HuntflowInfoRow>
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
                                      <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-[var(--hf-white)] border border-[var(--hf-ui-border)] rounded-lg shadow-[var(--hf-shadow-xl)] overflow-hidden">
                                        <div className="max-h-48 overflow-y-auto">
                                          {orgTags
                                            .filter(t => !entityTags.find(et => et.id === t.id))
                                            .map(tag => (
                                              <button
                                                key={tag.id}
                                                onClick={() => { handleAddTag(tag.id); setShowTagDropdown(false); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--hf-main-800)] hover:bg-[var(--hf-ui-hover)] transition-colors text-left"
                                              >
                                                <span
                                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                                  style={{ backgroundColor: tag.color }}
                                                />
                                                {tag.name}
                                              </button>
                                            ))}
                                          {orgTags.filter(t => !entityTags.find(et => et.id === t.id)).length === 0 && (
                                            <div className="px-3 py-2 text-xs text-[var(--hf-main-500)]">Нет доступных меток</div>
                                          )}
                                        </div>
                                        <div className="border-t border-[var(--hf-ui-divider)] p-2">
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
                                              className="flex-1 px-2 py-1 text-xs bg-[var(--hf-white)] border border-[var(--hf-ui-border)] rounded text-[var(--hf-main-900)] placeholder:text-[var(--hf-main-500)] focus:outline-none focus:border-[var(--hf-cyan-500)]"
                                            />
                                            <button
                                              onClick={handleCreateTag}
                                              disabled={creatingTag || !newTagName.trim()}
                                              className="px-2 py-1 text-xs rounded bg-[var(--hf-ui-hover)] text-[var(--hf-main-800)] hover:bg-[var(--hf-main-200)] disabled:opacity-40 transition-colors"
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
                                </div>
                                {(selectedCandidate as { entity_photo?: string }).entity_photo ? (
                                  <img
                                    src={(selectedCandidate as { entity_photo?: string }).entity_photo}
                                    alt={selectedCandidate.entity_name || ''}
                                    referrerPolicy="no-referrer"
                                    className="hf-profile-photo"
                                  />
                                ) : (
                                  <div className="hf-profile-photo hf-profile-photo-fallback">
                                    {getCandidateFallbackInitial(selectedCandidate.entity_name)}
                                  </div>
                                )}
                              </div>

                              {/* Current stage — Huntflow style block */}
                              <div className="hf-stage-card" style={stageCardStyle}>
                                <div className="hf-stage-card-head">
                                  <div className="hf-stage-card-head-row">
                                    <div>
                                      <div className="hf-stage-card-title">
                                        {getVacancyStageLabel(selectedCandidate.stage as string)}
                                      </div>
                                      <div className="hf-stage-card-subtitle">
                                        {selectedVacancy?.title || 'Вакансия'}
                                        {selectedVacancy?.department_name ? ` (${selectedVacancy.department_name})` : ''}
                                      </div>
                                    </div>
                                  <div className="flex items-center gap-2">
                                  <div className="relative" ref={stagePickerRef}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setStagePickerPending(selectedCandidate.stage as ApplicationStage);
                                        setStagePickerComment('');
                                        setStagePickerOpen((v) => !v);
                                      }}
                                      className="hf-stage-change-btn"
                                    >
                                      Сменить этап подбора
                                    </button>
                                    {stagePickerOpen && (
                                      <div className="hf-stage-picker">
                                        <div className="hf-stage-picker-list huntflow-scrollbar">
                                          {stagePickerOptions.map((option) => {
                                            const isSelected =
                                              (stagePickerPending ?? selectedCandidate.stage) === option.status;
                                            return (
                                              <button
                                                type="button"
                                                key={option.status}
                                                onClick={() => setStagePickerPending(option.status)}
                                                className={clsx(
                                                  'hf-stage-picker-option',
                                                  isSelected
                                                    ? 'hf-stage-picker-option-active'
                                                    : 'hf-stage-picker-option-idle',
                                                )}
                                              >
                                                <span className="truncate">{option.label}</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                        <div className="hf-stage-picker-editor-wrap">
                                          <div className="hf-stage-picker-editor">
                                            <div className="hf-stage-picker-toolbar">
                                              <button type="button" className="hf-editor-icon-btn"><HuntflowEditorIcon name="bold" /></button>
                                              <button type="button" className="hf-editor-icon-btn"><HuntflowEditorIcon name="italic" /></button>
                                              <button type="button" className="hf-editor-icon-btn"><HuntflowEditorIcon name="bullet-list" /></button>
                                              <button type="button" className="hf-editor-icon-btn"><HuntflowEditorIcon name="numbered-list" /></button>
                                              <button type="button" className="hf-editor-icon-btn"><HuntflowEditorIcon name="link" /></button>
                                              <button type="button" className="hf-editor-icon-btn"><HuntflowEditorIcon name="at" /></button>
                                            </div>
                                            <textarea
                                              value={stagePickerComment}
                                              onChange={(event) => setStagePickerComment(event.target.value)}
                                              placeholder="Записать комментарий"
                                              className="hf-stage-picker-textarea"
                                            />
                                            <div className="hf-stage-picker-actions">
                                              <HuntflowActionChip
                                                icon={Mail}
                                                label="Письмо"
                                                onClick={() => {
                                                  if (selectedCandidate.entity_email) {
                                                    window.open(`mailto:${selectedCandidate.entity_email}`);
                                                  } else {
                                                    toast.error('Email кандидата не указан');
                                                  }
                                                }}
                                              />
                                              <HuntflowActionChip
                                                icon={Calendar}
                                                label="Интервью"
                                                onClick={() => {
                                                  setInterviewForCandidate(selectedCandidate);
                                                  const cur = selectedCandidate.next_interview_at;
                                                  if (cur) {
                                                    const d = new Date(cur);
                                                    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                                                      .toISOString()
                                                      .slice(0, 16);
                                                    setInterviewDateTime(local);
                                                  } else {
                                                    setInterviewDateTime('');
                                                  }
                                                }}
                                              />
                                              <HuntflowActionChip
                                                icon={ThumbsUp}
                                                label="Оффер"
                                                onClick={() => handleStageChange(selectedCandidate.id, 'offer' as ApplicationStage)}
                                              />
                                              <HuntflowActionChip
                                                icon={Paperclip}
                                                label="Файл"
                                                onClick={() => candidateFileInputRef.current?.click()}
                                              />
                                            </div>
                                          </div>
                                          <div className="hf-stage-picker-footer">
                                            <button
                                              type="button"
                                              onClick={handleStagePickerSave}
                                              className="inline-flex h-[33px] min-w-[74px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-main-900)] bg-[var(--hf-main-900)] px-[11px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-secondary)] !text-[var(--hf-white)] transition-colors hover:bg-[var(--hf-main-800)]"
                                            >
                                              Сохранить
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setStagePickerComment('');
                                                setStagePickerOpen(false);
                                              }}
                                              className="inline-flex h-[33px] min-w-[65px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-alpha-200)] bg-[var(--hf-white)] px-[11px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-ui-hover)]"
                                            >
                                              Отмена
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="relative" ref={candidateMenuRef}>
                                    <button
                                      type="button"
                                      onClick={() => setCandidateMenuOpen((v) => !v)}
                                      title="Действия со статусом"
                                      className="inline-flex h-[33px] w-[33px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-alpha-200)] bg-[var(--hf-white)] text-[var(--hf-main-700)] transition-colors hover:bg-[var(--hf-ui-hover)]"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                    {candidateMenuOpen && (
                                      <div className="absolute right-0 top-full z-[260] mt-1 w-[240px] overflow-hidden rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-[var(--hf-white)] py-1 shadow-[0_2px_16px_var(--hf-alpha-300)]">
                                        {prevStage && prevStage !== selectedCandidate.stage && (
                                          <button
                                            type="button"
                                            onClick={handleRevertStage}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[length:var(--hf-fs-xs)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-bg-panel)]"
                                          >
                                            <RotateCcw className="h-4 w-4 flex-shrink-0" />
                                            <span className="truncate">Вернуть на «{getVacancyStageLabel(prevStage)}»</span>
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setCandidateMenuOpen(false);
                                            setRemoveConfirmOpen(true);
                                          }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[length:var(--hf-fs-xs)] text-[var(--hf-status-red)] transition-colors hover:bg-[var(--hf-bg-panel)]"
                                        >
                                          <Trash2 className="h-4 w-4 flex-shrink-0" />
                                          <span>Убрать из вакансии</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  </div>
                                  </div>
                                </div>

                              {/* Compatibility score */}
                              {selectedCandidate.compatibility_score != null && (
                                <div className="mx-[var(--hf-space-xxl)] mt-[var(--hf-space-l)] rounded-[var(--hf-radius-s)] border border-[color:var(--hf-black-alpha-08)] bg-[var(--hf-white-alpha-55)] p-[var(--hf-space-l)]">
                                  <div className="text-xs text-[var(--hf-dark-500)] mb-1">Совместимость</div>
                                  <div className="text-lg font-semibold text-[var(--hf-accent)]">{selectedCandidate.compatibility_score.overall_score}%</div>
                                </div>
                              )}

                              {/* Comment input — Huntflow style */}
                              <HuntflowComposer
                                wrapperClassName="px-[var(--hf-space-xxl)] pt-[var(--hf-space-xxl)] pb-[6px]"
                                value={stageCommentText}
                                onChange={setStageCommentText}
                                open={stageCommentComposerOpen}
                                onOpenChange={setStageCommentComposerOpen}
                                placeholder="Написать комментарий"
                                onSubmit={handleSaveStageComment}
                                onCancel={() => {
                                  setStageCommentText('');
                                  setStageCommentComposerOpen(false);
                                }}
                                saving={commentSaving}
                                disabled={commentSaving}
                                showMention
                                collapsedRows={2}
                                textareaRef={commentRef}
                                collapsedClassName="h-[58px] w-full resize-none rounded-[var(--hf-radius-s)] border border-[color:var(--hf-black-alpha-16)] bg-transparent px-[var(--hf-space-xxl)] py-[var(--hf-space-l)] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] placeholder:text-[var(--hf-main-600)] focus:border-[var(--hf-cyan-500)] focus:outline-none disabled:opacity-50"
                                actions={[
                                  {
                                    icon: Mail,
                                    label: 'Письмо',
                                    onClick: () => {
                                      if (selectedCandidate.entity_email) {
                                        window.open(`mailto:${selectedCandidate.entity_email}`);
                                      } else {
                                        toast.error('Email кандидата не указан');
                                      }
                                    },
                                  },
                                  {
                                    icon: Calendar,
                                    label: 'Интервью',
                                    onClick: () => {
                                      setInterviewForCandidate(selectedCandidate);
                                      const cur = selectedCandidate.next_interview_at;
                                      if (cur) {
                                        const d = new Date(cur);
                                        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                                          .toISOString().slice(0, 16);
                                        setInterviewDateTime(local);
                                      } else {
                                        setInterviewDateTime('');
                                      }
                                    },
                                  },
                                  {
                                    icon: ThumbsUp,
                                    label: 'Оффер',
                                    onClick: () => handleStageChange(selectedCandidate.id, 'offer' as ApplicationStage),
                                  },
                                  {
                                    icon: Paperclip,
                                    label: 'Файл',
                                    onClick: () => candidateFileInputRef.current?.click(),
                                    loading: candidateFileUploading,
                                    loadingLabel: 'Загрузка…',
                                  },
                                ]}
                              />

                              <input
                                type="file"
                                ref={candidateFileInputRef}
                                onChange={handleCandidateFileUpload}
                                className="hidden"
                              />

                              {/* Action chips — Huntflow outlined style */}
                              {!stageCommentComposerOpen && !stageCommentText.trim() && (
                                <div className="hf-vacancy-stage-action-row">
                                  <HuntflowActionChip
                                    icon={Mail}
                                    label="Письмо"
                                    onClick={() => {
                                      if (selectedCandidate.entity_email) {
                                        window.open(`mailto:${selectedCandidate.entity_email}`);
                                      } else {
                                        toast.error('Email кандидата не указан');
                                      }
                                    }}
                                  />
                                  <HuntflowActionChip
                                    icon={Calendar}
                                    label="Интервью"
                                    onClick={() => {
                                      setInterviewForCandidate(selectedCandidate);
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
                                  />
                                  <HuntflowActionChip
                                    icon={MessageSquare}
                                    label="Комментарий"
                                    onClick={() => {
                                      setStageCommentComposerOpen(true);
                                      requestAnimationFrame(() => commentRef.current?.focus());
                                    }}
                                  />
                                  <HuntflowActionChip
                                    icon={ThumbsUp}
                                    label="Оффер"
                                    onClick={() => handleStageChange(selectedCandidate.id, 'offer' as ApplicationStage)}
                                  />
                                  <HuntflowActionChip
                                    icon={Paperclip}
                                    label="Файл"
                                    onClick={() => candidateFileInputRef.current?.click()}
                                    disabled={candidateFileUploading}
                                    loading={candidateFileUploading}
                                    displayLabel={candidateFileUploading ? 'Загрузка…' : 'Файл'}
                                  />
                                  <HuntflowActionChip
                                    icon={XCircle}
                                    label="Отказ"
                                    danger
                                    onClick={() => handleStageChange(selectedCandidate.id, 'rejected' as ApplicationStage)}
                                  />
                                </div>
                              )}

                              {vacancyWorkflowComments.length > 0 && (
                                <div className="hf-vacancy-stage-comments">
                                  <div className="hf-vacancy-stage-comments-heading">
                                    Комментарии
                                  </div>
                                  <div className="hf-vacancy-stage-comments-list">
                                    {vacancyWorkflowComments.map(renderVacancyNoteCard)}
                                  </div>
                                </div>
                              )}

                              {/* History timeline — Huntflow style */}
                              <div className="hf-vacancy-stage-history">
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
                                      const changedById = Number(entry.changed_by);
                                      const changedByName =
                                        entry.changed_by_name ||
                                        (Number.isFinite(changedById) ? usersMap[changedById] : null) ||
                                        (changedById === user?.id ? user?.name : null) ||
                                        (!Number.isFinite(changedById) ? entry.changed_by : null);

                                      return (
                                        <div key={entry.id ?? i} className="relative pb-5 last:pb-0">
                                          {entry.id ? (
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteHistory(entry.id)}
                                              title="Удалить запись"
                                              className="absolute right-0 top-0 rounded p-1 text-[var(--hf-dark-500)] transition-colors hover:text-[var(--hf-status-red)]"
                                            >
                                              <Trash2 className="h-[14px] w-[14px]" />
                                            </button>
                                          ) : null}
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
                                                {getVacancyStageLabel(entry.from_stage)}
                                              </span>
                                              <span className="text-[var(--hf-dark-600)]">&rarr;</span>
                                              <span className={clsx('px-2 py-0.5 rounded-full', toColors.badge)}>
                                                {getVacancyStageLabel(entry.to_stage)}
                                              </span>
                                            </div>
                                          ) : (
                                            <div className="text-sm text-[var(--hf-dark-300)] mb-1">
                                              <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs', toColors.badge)}>
                                                {getVacancyStageLabel(entry.to_stage)}
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
                                          {changedByName && (
                                            <div className="text-xs text-[var(--hf-dark-600)] mt-1">{changedByName}</div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              </div>

                              <div className="hf-vacancy-detail-tabs">
                                <button
                                  type="button"
                                  onClick={() => setDetailTab('info')}
                                  className={clsx(
                                    'hf-vacancy-detail-tab',
                                    detailTab === 'info' && 'hf-vacancy-detail-tab-active',
                                  )}
                                >
                                  Личные заметки
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDetailTab('resume')}
                                  className="hf-vacancy-detail-tab"
                                >
                                  <FileText className="h-[14px] w-[14px]" />
                                  Резюме
                                  {hasResume && (
                                    <span className="hf-vacancy-detail-tab-count">
                                      {resumePages.length || 1}
                                    </span>
                                  )}
                                </button>
                              </div>

                              <div className="hf-vacancy-notes-panel">
                                <HuntflowComposer
                                  wrapperClassName="hf-vacancy-personal-composer"
                                  value={personalNoteText}
                                  onChange={setPersonalNoteText}
                                  open={personalNoteComposerOpen}
                                  onOpenChange={setPersonalNoteComposerOpen}
                                  placeholder="Написать заметку"
                                  onSubmit={handleSavePersonalNote}
                                  onCancel={() => {
                                    setPersonalNoteText('');
                                    setPersonalNoteComposerOpen(false);
                                  }}
                                  saving={commentSaving}
                                  actions={[
                                    // Убрали «Письмо» из личных заметок — заметки личные,
                                    // письмо кандидату отсюда не нужно (как в AllCandidatesPage).
                                    {
                                      icon: Paperclip,
                                      label: 'Файл',
                                      onClick: () => candidateFileInputRef.current?.click(),
                                      loading: candidateFileUploading,
                                      loadingLabel: 'Загрузка…',
                                    },
                                  ]}
                                />

                                <div className="hf-vacancy-notes-heading">Заметки</div>
                                {vacancyPersonalNotes.length > 0 ? (
                                  <div className="hf-vacancy-notes-list">
                                    {vacancyPersonalNotes.map(renderVacancyNoteCard)}
                                  </div>
                                ) : (
                                  <div className="hf-vacancy-notes-empty">
                                    Нет заметок
                                  </div>
                                )}

                                {selectedCandidate.notes && (
                                  <div className="hf-vacancy-legacy-note">
                                    <div className="hf-vacancy-notes-heading">Заметки вакансии</div>
                                    <div className="hf-vacancy-legacy-note-text">
                                      {selectedCandidate.notes}
                                    </div>
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

      {editingCandidateCard && (
        <EditCandidateModal
          card={editingCandidateCard}
          onClose={() => setEditingCandidateCard(null)}
          onSaved={handleCandidateSaved}
          onDeleted={() => {
            setCandidates((items) => items.filter((c) => c.entity_id !== editingCandidateCard?.id));
            setEditingCandidateCard(null);
          }}
        />
      )}

      {/* Confirm modal — close / delete vacancy */}
      {confirmDialog && (
        <div
          className="hf-confirm-modal-backdrop"
          onClick={() => !confirmBusy && setConfirmDialog(null)}
        >
          <div
            className={clsx(
              'hf-confirm-modal',
              confirmDialog.type === 'delete' && 'hf-confirm-modal-delete',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="hf-confirm-modal-title">
                {confirmDialog.type === 'close' ? 'Закрыть вакансию?' : 'Удалить вакансию?'}
              </h3>
              <p className="hf-confirm-modal-subtitle">
                «{confirmDialog.vacancy.title?.trim() || 'Без названия'}»
              </p>
              {confirmDialog.type === 'delete' && (
                <p className="hf-confirm-modal-danger-text">
                  Действие нельзя отменить. Кандидаты в воронке потеряют связь с этой вакансией.
                </p>
              )}
            </div>
            <div className="hf-confirm-modal-actions">
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={confirmBusy}
                className="hf-confirm-modal-cancel"
              >
                Отмена
              </button>
              <button
                onClick={runConfirmedAction}
                disabled={confirmBusy}
                className={clsx(
                  'hf-confirm-modal-submit',
                  confirmDialog.type === 'delete'
                    ? 'hf-confirm-modal-submit-danger'
                    : 'hf-confirm-modal-submit-warning',
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

      {removeConfirmOpen && selectedCandidate && (
        <div
          className="hf-confirm-modal-backdrop"
          onClick={() => !removeBusy && setRemoveConfirmOpen(false)}
        >
          <div
            className="hf-confirm-modal hf-confirm-modal-delete"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="hf-confirm-modal-title">Убрать из вакансии?</h3>
              <p className="hf-confirm-modal-subtitle">
                «{selectedCandidate.entity_name?.trim() || 'Кандидат'}»
              </p>
              <p className="hf-confirm-modal-danger-text">
                Кандидат пропадёт из этой воронки, но останется в общей базе («Все кандидаты»).
              </p>
            </div>
            <div className="hf-confirm-modal-actions">
              <button
                onClick={() => setRemoveConfirmOpen(false)}
                disabled={removeBusy}
                className="hf-confirm-modal-cancel"
              >
                Отмена
              </button>
              <button
                onClick={handleRemoveFromVacancy}
                disabled={removeBusy}
                className="hf-confirm-modal-submit hf-confirm-modal-submit-danger"
              >
                {removeBusy ? 'Убираем…' : 'Убрать'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* StageDropdown удалён — на воронке смена этапа теперь через богатый пикер
   (список этапов + «Записать комментарий») прямо в карточке кандидата. */
