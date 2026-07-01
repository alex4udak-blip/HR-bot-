import { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy, startTransition } from 'react';
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
  Copy,
  Check,
  Tag,
  Pencil,
  Archive,
  Trash2,
  Inbox,
  Lock,
  MapPin,
  ExternalLink,
  Phone,
  Send,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import { getUsers, getApplications, updateApplication, deleteApplication, deleteApplicationHistory, getEntityFiles, getEntity, uploadEntityFile, applyEntityToVacancy } from '@/services/api';
import { getOrgStages } from '@/services/api/auth';
import { addEntityNote, deleteEntityNote } from '@/services/api/entities';
import { getTags, getEntityTags, addTagToEntity, removeTagFromEntity, createTag } from '@/services/api/tags';
import type { Tag as TagType } from '@/services/api/tags';
import type { EntityFile } from '@/services/api/entities';
import type { Vacancy, VacancyStatus, VacancyApplication, ApplicationStage } from '@/types';
import { VacancyStatusBadge, VacancyForm } from '@/components/vacancies';
import { getVacancies } from '@/services/api/vacancies';
import type { StageColumn } from '@/components/vacancies/StagesConfigModal';
import type { KanbanCard } from '@/services/api/candidates';
import ShadowDuplicateBanner from '@/components/entities/ShadowDuplicateBanner';
import CandidateVacancyCard from '@/components/entities/CandidateVacancyCard';
import { BulkSelectionBar } from '@/components/entities/BulkSelectionBar';
import AddToVacancyModal from '@/components/entities/AddToVacancyModal';
import ResumeTab from '@/components/entities/candidateDetail/ResumeTab';
import { buildStageContainers, buildResumeSources, readSystemHrTags, type StageContainer, type EntryReaction } from '@/components/entities/candidateDetail/model';
import { getEntityActivity, toggleTimelineReaction, deleteEntityFile, type VacancyActivityBlock as ActivityBlockData } from '@/services/api/entities';
import { EditCandidateModal } from './AllCandidatesPage';
import {
  HuntflowInfoRow,
  HuntflowOptionsIcon,
} from '@/components/hr/HuntflowControls';
import {
  HUNTFLOW_VACANCY_STATUS_FILTERS,
  getHuntflowVacancyStatusFilterLabel,
} from '@/components/hr/huntflowVacancyStatus';
import { computeEntityParamUpdate, shouldAdoptUrlEntity } from '@/utils/candidateUrl';
import { useFormBadgeStore } from '@/stores/formBadgeStore';
import { getEntityFormsUnreadCount, getEntityDispatches, markEntityDispatchesSeen, type FormDispatchInfo } from '@/services/api/forms';
import { AnketaResponses } from '@/features/forms/AnketaResponses';
const AnketaDrawer = lazy(() =>
  import('@/features/forms/AnketaDrawer').then((m) => ({ default: m.AnketaDrawer })),
);

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
  'assessment', 'offer', 'hired', 'probation', 'transferred', 'rejected', 'reserve',
] as const;

// Единые лейблы стадий — синхронизированы с backend KANBAN_STATUS_LABELS
// (отображаются на /all-candidates). Не разводить разные наборы по страницам.
const STAGE_LABELS: Record<string, string> = {
  new: 'Новый',
  applied: 'Новый',
  screening: 'Выполняет ТЗ',
  phone_screen: 'Интервью с HR',
  interview: 'Интервью с заказчиком',
  assessment: 'Принятие решения',
  offer: 'Выставлен оффер',
  hired: 'Оффер принят',
  probation: 'Практика',
  transferred: 'Перешёл в отдел',
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
  probation:    { bg: 'bg-[var(--hf-status-teal-bg)]',    text: 'text-[var(--hf-status-teal)]',    dot: 'bg-[var(--hf-status-teal)]',    badge: 'bg-[var(--hf-status-teal-badge)] text-[var(--hf-status-teal)]' },
  transferred:  { bg: 'bg-[var(--hf-status-lime-bg)]',    text: 'text-[var(--hf-status-lime)]',    dot: 'bg-[var(--hf-status-lime)]',    badge: 'bg-[var(--hf-status-lime-badge)] text-[var(--hf-status-lime)]' },
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
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all' | 'deleted'>('all');
  const [selectedRecruiterFilter, setSelectedRecruiterFilter] = useState<number | null>(null);
  // «Удалённые»: мягко-удалённые вакансии тянем отдельным запросом (deleted=true).
  const [deletedVacancies, setDeletedVacancies] = useState<Vacancy[]>([]);
  useEffect(() => {
    if (statusFilter === 'deleted') {
      getVacancies({ deleted: true }).then(setDeletedVacancies).catch(() => setDeletedVacancies([]));
    }
  }, [statusFilter]);
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
  // Модалка массового перемещения в другую воронку.
  const [showBulkMove, setShowBulkMove] = useState(false);


  // Master-detail state
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [entityActivity, setEntityActivity] = useState<ActivityBlockData[]>([]);
  const [dupCard, setDupCard] = useState<KanbanCard | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'resume' | 'anketa'>('info');
  const [editingCandidateCard, setEditingCandidateCard] = useState<KanbanCard | null>(null);
  const [anketaOpen, setAnketaOpen] = useState(false);
  const [entityFiles, setEntityFiles] = useState<EntityFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
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
    probation: 'probation',
    transferred: 'transferred',
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
        ? (urlStatus as VacancyStatus | 'all' | 'deleted')
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
    if (statusFilter === 'deleted') {
      return (!isHrAdmin && user)
        ? deletedVacancies.filter((v) => v.created_by === user.id)
        : deletedVacancies;
    }
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
    // Модель «только свои»: рекрутёр в списке воронок видит лишь СВОИ (созданные/
    // взятые им) — как и в «Переместить»/создании/расширении. Чужие visible_to_all
    // он не ведёт (увидит их в «Заявки», если назначены, чтобы сначала взять).
    if (!isHrAdmin && user) {
      result = result.filter((v) => v.created_by === user.id);
    }
    if (statusFilter !== 'all') {
      result = result.filter((v) => v.status === statusFilter);
    } else {
      // Заявки (pending_review/draft) живут в разделе «Заявки», а НЕ в активных
      // воронках «Мои вакансии». Иначе только что созданная заявка сразу висела
      // как «в работе» под создателем, будто он её уже взял. Принятой (взятой в
      // работу) она становится через «Взять в работу» → клон со статусом open.
      result = result.filter(
        (v) => v.status !== 'pending_review' && v.status !== 'draft',
      );
    }
    return result;
  }, [vacancies, deletedVacancies, user, isHrAdmin, statusFilter]);

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
    setDetailTab('info');
    setSelectedIds(new Set());
  }, [selectedVacancyId]);

  // Счётчик-версия загрузок. Тихий focus-refresh (alt-tab) или гонка запросов
  // могли прилететь со СТАРЫМ списком и перезаписать свежее состояние — напр.
  // вернуть только что снятого кандидата («удаляй дважды»). Применяем результат
  // загрузки ТОЛЬКО если это последний запрос; любая мутация бампает счётчик.
  const loadSeqRef = useRef(0);
  const loadCandidates = useCallback(async (vacancyId: number, silent = false) => {
    const seq = ++loadSeqRef.current;
    if (!silent) setCandidatesLoading(true);
    try {
      const apps = await getApplications(vacancyId);
      if (seq === loadSeqRef.current) setCandidates(apps);
    } catch {
      if (!silent && seq === loadSeqRef.current) setCandidates([]);
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

  // Поллинг воронки каждые 15с (только когда вкладка видима): на проде WS
  // ненадёжен, поэтому тихо подтягиваем кандидатов и вакансии — иначе рекрутёр,
  // сидя на странице воронки, не видел изменений без F5 (доска «Все кандидаты»
  // уже так поллится). Тихий refresh, без скелетонов.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (selectedVacancyId) loadCandidates(selectedVacancyId, true);
      fetchVacancies(true);
    }, 15000);
    return () => clearInterval(id);
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

  // Durable per-candidate deep-link (?entity=ID), как в «Все кандидаты».
  // ВАЖНО: в воронке state хранит id ЗАЯВКИ (selectedCandidateId === VacancyApplication.id),
  // а в URL пишем entity_id (id человека) — для кросс-страничной совместимости. Поэтому
  // через помощники candidateUrl мы прогоняем именно entity_id выбранного кандидата.
  const urlEntity = searchParams.get('entity');
  // Предыдущий entity_id для ЗЕРКАЛА (selection -> URL): отличает настоящее закрытие
  // (entity был -> стал null) от ещё не доехавшего диплинка (null -> null) → не стираем ?entity=.
  const prevMirrorEntityIdRef = useRef<number | null>(null);
  // Предыдущий entity_id для АДОПТА (URL -> selection): отличает смену выбора (клик) от
  // смены URL, чтобы не «бодаться» за фокус на свежем клике (см. shouldAdoptUrlEntity).
  const prevAdoptEntityIdRef = useRef<number | null>(null);
  // Чтобы не дёргать адопт повторно, когда entity из URL не найден в текущем списке
  // (кандидат ещё не загружен / другая вакансия) — пробуем один раз на каждый id.
  const adoptTriedEntityRef = useRef<number | null>(null);

  // Диплинк из URL «в процессе»: ?entity= указывает на загруженного кандидата, который
  // ещё НЕ выбран. Пока это так — эффекты авто-первого должны уступить, чтобы диплинк
  // победил на загрузке. Если entity из URL не найден (устаревшая ссылка) — null, и
  // авто-первый работает как обычно (фолбэк).
  const pendingDeepLinkEntity = useMemo(() => {
    if (!urlEntity) return null;
    const entityId = Number(urlEntity);
    if (Number.isNaN(entityId)) return null;
    if (selectedCandidate?.entity_id === entityId) return null; // уже выбран — не ждём
    return candidates.some((c) => c.entity_id === entityId) ? entityId : null;
  }, [urlEntity, candidates, selectedCandidate?.entity_id]);

  // Адопт из URL: на маунте и при РЕАЛЬНОЙ смене ?entity= (не при смене выбора) находим
  // заявку по entity_id и выбираем её. Диплинк ПОБЕЖДАЕТ авто-селект первого (см. ниже —
  // эффекты авто-первого ждут, пока есть подходящий незанятый entity из URL).
  useEffect(() => {
    if (!urlEntity) { adoptTriedEntityRef.current = null; return; }
    const entityId = Number(urlEntity);
    if (Number.isNaN(entityId)) return;

    // Гонка «клик vs URL»: клик ставит selectedCandidateId мгновенно, зеркало пишет
    // ?entity= на тик позже. selChanged=true → менялся ВЫБОР (клик), а URL отстал → НЕ
    // адоптим (иначе вернём фокус назад). Сравниваем по entity_id выбранного кандидата.
    const curEntityId = selectedCandidate?.entity_id ?? null;
    const selChanged = curEntityId !== prevAdoptEntityIdRef.current;
    prevAdoptEntityIdRef.current = curEntityId;

    if (curEntityId === entityId) { adoptTriedEntityRef.current = null; return; } // уже синхронно
    if (!shouldAdoptUrlEntity(curEntityId, entityId, selChanged)) return;

    const match = candidates.find((c) => c.entity_id === entityId);
    if (match) {
      adoptTriedEntityRef.current = null;
      // Делаем кандидата гарантированно видимым: вкладка «Все» показывает всех, поэтому
      // эффект авто-первого (фильтрует по вкладке) не перебьёт наш выбор.
      setSelectedTab('all');
      setSelectedCandidateId(match.id);
      setDetailTab('info');
      return;
    }
    // entity из URL ещё не загружен в этом списке (другая вакансия / не подгрузился) —
    // отмечаем попытку, чтобы не крутиться; адоптим, когда candidates приедут (deps).
    adoptTriedEntityRef.current = entityId;
  }, [urlEntity, candidates, selectedCandidate?.entity_id]);

  // Зеркалим выбранного кандидата в URL (?entity=<entity_id>) — ссылка шарящаяся.
  // Функциональная форма setSearchParams(prev => …) ПРЕСЕРВИТ v/status; чистая функция
  // вернёт null, когда менять нечего — это защита от бесконечного цикла. startTransition,
  // чтобы ререндер от смены URL не блокировал мгновенный отклик на клик.
  useEffect(() => {
    const curEntityId = selectedCandidate?.entity_id ?? null;
    // Пока есть неразрешённый диплинк из URL — НЕ стираем entity (адопт ещё не доехал).
    if (curEntityId == null && urlEntity && adoptTriedEntityRef.current != null) {
      prevMirrorEntityIdRef.current = curEntityId;
      return;
    }
    const prevId = prevMirrorEntityIdRef.current;
    prevMirrorEntityIdRef.current = curEntityId;
    // Считаем по СВЕЖИМ searchParams в функциональной форме (колбэк стабилен → эффект
    // авто-селекта не пересоздаётся на каждой смене URL); null от помощника = менять
    // нечего → возвращаем prev БЕЗ изменений, чтобы не плодить лишнюю запись в историю.
    startTransition(() => {
      setSearchParams((prev) => computeEntityParamUpdate(prev, curEntityId, prevId) ?? prev, { replace: true });
    });
  }, [selectedCandidate?.entity_id, urlEntity, setSearchParams]);

  // Бейдж непрочитанных анкет (entity-уровень) — как в «Все кандидаты».
  const anketaCount = useFormBadgeStore((s) => s.counts[selectedCandidate?.entity_id ?? 0] ?? 0);
  const setAnketaCount = useFormBadgeStore((s) => s.setCount);
  useEffect(() => {
    const eid = selectedCandidate?.entity_id;
    if (!eid) return;
    getEntityFormsUnreadCount(eid)
      .then((r) => setAnketaCount(eid, r.count))
      .catch(() => {});
  }, [selectedCandidate?.entity_id, setAnketaCount]);

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
    // Диплинк из URL побеждает авто-первого: пока ?entity= указывает на загруженного,
    // но ещё не выбранного кандидата, не перехватываем выбор (адопт-эффект его поставит).
    if (pendingDeepLinkEntity != null) return;
    if (!selectedCandidateId || !tabFilteredCandidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(tabFilteredCandidates[0].id);
      setDetailTab('info');
    }
  }, [selectedCandidateId, tabFilteredCandidates, pendingDeepLinkEntity]);


  // Load cross-vacancy activity feed when entity changes
  useEffect(() => {
    const eid = selectedCandidate?.entity_id;
    if (!eid) { setEntityActivity([]); return; }
    getEntityActivity(eid)
      .then((blocks) => setEntityActivity(Array.isArray(blocks) ? blocks : []))
      .catch(() => setEntityActivity([]));
  }, [selectedCandidate?.entity_id]);

  // Перезагрузка ленты активности после мутации в карточке вакансии +
  // обновление счётчиков досок.
  const refreshActivity = useCallback(async () => {
    const eid = selectedCandidate?.entity_id;
    if (eid) {
      try {
        const blocks = await getEntityActivity(eid);
        setEntityActivity(Array.isArray(blocks) ? blocks : []);
      } catch {
        /* ignore — оставляем прежнюю ленту */
      }
    }
    fetchVacancies();
  }, [selectedCandidate?.entity_id, fetchVacancies]);

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

  // Load entity extra_data for resume text view + дедуп-баннер в воронке
  useEffect(() => {
    setEntityExtraData(null);
    setDupCard(null);
    if (!selectedCandidate?.entity_id) return;
    getEntity(selectedCandidate.entity_id)
      .then(entity => {
        setEntityExtraData(entity.extra_data || null);
        // Карточка для ShadowDuplicateBanner — чтобы баннер «Похожий кандидат»
        // работал и в воронке, а не только в «Все кандидаты».
        const ed = (entity.extra_data || {}) as Record<string, any>;
        setDupCard({
          id: entity.id,
          name: entity.name || '',
          email: entity.email || undefined,
          phone: entity.phone || undefined,
          telegram_username: entity.telegram_usernames?.[0],
          position: entity.position || undefined,
          company: entity.company || undefined,
          created_at: entity.created_at || '',
          tags: (entity.tags as string[]) || [],
          city: ed.city,
          age: ed.age != null ? String(ed.age) : undefined,
          salary: ed.salary != null ? String(ed.salary) : undefined,
          total_experience: ed.total_experience != null ? String(ed.total_experience) : undefined,
          source: ed.source,
          source_url: ed.source_url,
          extra_data: entity.extra_data || undefined,
        });
      })
      .catch(() => { setEntityExtraData(null); setDupCard(null); });
  }, [selectedCandidate?.entity_id]);

  // Resume: original document (PDF or DOC/DOCX) + page images (JPEG renders from backend)
  const resumeOriginal = useMemo(
    () => entityFiles.find(f => f.file_type === 'resume' && f.mime_type !== 'image/jpeg') || null,
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

  // Источники резюме (по одному на влитый профиль/PDF) — та же чистая модель,
  // что и «Все кандидаты». Вкладки «Резюме» рисуем на верхнем уровне (паритет),
  // а ResumeViewer переключаем по resumeIndex в управляемом режиме.
  const resumeSources = useMemo(
    () => buildResumeSources(entityFiles, entityExtraData ?? undefined),
    [entityFiles, entityExtraData],
  );
  const [resumeIndex, setResumeIndex] = useState(0);
  // Сброс активной вкладки резюме при переключении кандидата.
  useEffect(() => { setResumeIndex(0); }, [selectedCandidate?.entity_id]);

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
    // Диплинк из URL побеждает авто-первого (см. выше) — пока он не разрешён, ждём.
    if (pendingDeepLinkEntity != null) return;
    if (tabFilteredCandidates.length > 0 && !selectedCandidateId) {
      setSelectedCandidateId(tabFilteredCandidates[0].id);
    }
  }, [tabFilteredCandidates, pendingDeepLinkEntity]);

  // Handlers
  const toggleGroup = (userId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleStatusFilterChange = (nextStatus: VacancyStatus | 'all' | 'deleted') => {
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
  // Значение больше не читается (личных-заметок панели нет — карточка ведёт
  // своё состояние сохранения сама), но сеттер всё ещё гейтит saveEntityNote.
  const [, setCommentSaving] = useState(false);

  // ─── Меню действий со статусом («⋯»): убрать из вакансии / откатить этап ───
  const [candidateMenuOpen, setCandidateMenuOpen] = useState(false);
  const candidateMenuRef = useRef<HTMLDivElement>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  // Какую заявку убираем (для карточек разных вакансий — не всегда selectedCandidate).
  const [removeTargetAppId, setRemoveTargetAppId] = useState<number | null>(null);
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
  const handleRemoveFromVacancy = useCallback(async () => {
    const targetAppId = removeTargetAppId ?? selectedCandidate?.id;
    if (!targetAppId) return;
    // entity_id целевого кандидата (по отклику в списке или по выбранному).
    const targetEntityId =
      candidates.find((c) => c.id === targetAppId)?.entity_id
      ?? selectedCandidate?.entity_id;
    if (!targetEntityId) return;
    // Снимаем ВСЕ отклики этого кандидата на текущую вакансию (а не один по id):
    // дубли откликов (из мержа/импорта) показываются отдельными карточками, и
    // удаление по одному id заставляло «снимать одного и того же дважды».
    const appIds = candidates
      .filter((c) => c.entity_id === targetEntityId)
      .map((c) => c.id);
    if (appIds.length === 0) return;
    setRemoveBusy(true);
    try {
      for (const id of appIds) {
        await deleteApplication(id);
      }
      const idsSet = new Set(appIds);
      setCandidates((prev) => prev.filter((c) => !idsSet.has(c.id)));
      loadSeqRef.current++; // инвалидируем in-flight загрузки — иначе focus-refresh вернёт снятого
      toast.success('Кандидат убран из вакансии');
      setRemoveConfirmOpen(false);
      setRemoveTargetAppId(null);
      setCandidateMenuOpen(false);
      await refreshActivity();
    } catch {
      toast.error('Не удалось убрать из вакансии');
    } finally {
      setRemoveBusy(false);
    }
  }, [removeTargetAppId, selectedCandidate, candidates, refreshActivity]);

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
      // ВСЕГДА синхронизируем авторитетное состояние с сервера — даже если
      // запрос отвалился (таймаут/сеть), но бэкенд успел закоммитить коммент
      // (с @-тэгом бэкенд делает доп. работу — уведомления — и ответ мог не
      // дойти), он появится СРАЗУ, а не после F5. getEntity не кэшируется.
      const eid = selectedCandidate?.entity_id;
      if (eid) {
        try {
          const fresh = await getEntity(eid);
          setEntityExtraData(fresh.extra_data || null);
        } catch {
          /* ignore — оптимистичного мерджа достаточно */
        }
      }
      setCommentSaving(false);
    }
  }, [selectedCandidate?.entity_id]);

  // Этапы для пикера — тот же список и лейблы, что были в StageDropdown.
  const stagePickerOptions = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        status: stage as ApplicationStage,
        label: vacancyStageDropdownLabels[stage] || STAGE_LABELS[stage] || stage,
      })),
    [vacancyStageDropdownLabels],
  );

  // ─── Тонкие обёртки для CandidateVacancyCard: переиспользуем существующие
  // обработчики (по applicationId) и докидываем refreshActivity после мутации,
  // чтобы лента карточек и счётчики досок обновились. ───
  const cardChangeStage = useCallback(
    async (appId: number, stage: string, comment?: string) => {
      await handleStageChange(appId, stage as ApplicationStage, comment);
      await refreshActivity();
    },
    [handleStageChange, refreshActivity],
  );

  const cardComment = useCallback(
    async (_appId: number, stage: string, stageLabel: string, text: string) => {
      // saveEntityNote привязан к selectedCandidate.entity_id — это ТОТ ЖЕ
      // кандидат во всех его заявках, поэтому подходит для любой карточки.
      await saveEntityNote(text, stage, stageLabel);
      await refreshActivity();
    },
    [saveEntityNote, refreshActivity],
  );

  // F-fix: комментарии (extra_data.notes, включая с @-упоминанием) раньше
  // вообще не имели кнопки удаления — historyId у них не бывает, это не
  // StageTransition. DELETE /entities/{id}/notes/{note_id} уже был на бэке,
  // просто не был подключён на фронте.
  const cardDeleteNote = useCallback(
    async (entityId: number, noteId: string) => {
      try {
        await deleteEntityNote(entityId, noteId);
        setEntityExtraData((prev) => {
          const existing = Array.isArray(prev?.notes)
            ? (prev!.notes as Array<Record<string, unknown>>)
            : [];
          return {
            ...(prev || {}),
            notes: existing.filter((n) => String(n.id) !== noteId),
          };
        });
        toast.success('Комментарий удалён');
      } catch {
        toast.error('Не удалось удалить комментарий');
      }
      const eid = selectedCandidate?.entity_id;
      if (eid) {
        try {
          const fresh = await getEntity(eid);
          setEntityExtraData(fresh.extra_data || null);
        } catch {
          /* ignore */
        }
      }
    },
    [selectedCandidate?.entity_id],
  );

  const cardDeleteHistory = useCallback(
    async (appId: number, historyId: number) => {
      await deleteApplicationHistory(appId, historyId);
      await refreshActivity();
    },
    [refreshActivity],
  );

  const cardUploadFile = useCallback(
    async (entityId: number, file: File) => {
      try {
        await uploadEntityFile(entityId, file, 'other');
        toast.success(`Файл "${file.name}" загружен`);
        const fresh = await getEntityFiles(entityId);
        setEntityFiles(fresh);
      } catch (err) {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        toast.error(detail || 'Ошибка загрузки файла');
      }
      await refreshActivity();
    },
    [refreshActivity],
  );

  // ─── Общая богатая карточка «Все кандидаты» (CandidateVacancyCard) в детали
  // воронки. Строим KanbanCard-форму из selectedCandidate + entityExtraData и
  // стек контейнеров через ту же чистую модель buildStageContainers, что и
  // AllCandidatesPage — без форка поведения. ───
  const funnelCard = useMemo<KanbanCard | null>(() => {
    if (!selectedCandidate) return null;
    return {
      // dupCard уже несёт полный набор полей кандидата (email/phone/telegram_
      // username/position/company/city/age/salary/total_experience/source/
      // source_url) — тот же getEntity(), что грузится для баннера дублей.
      // Раньше funnelCard собирался «голым» (только id/name/created_at/tags),
      // из-за чего карточка в воронке была заметно беднее, чем в «Все
      // кандидаты» (не было возраста/города/опыта/компании/телеграма,
      // источник не был кликабельной ссылкой).
      ...dupCard,
      id: selectedCandidate.entity_id,
      name: selectedCandidate.entity_name || '',
      created_at: selectedCandidate.applied_at,
      tags: dupCard?.tags || [],
      extra_data: entityExtraData || {},
    };
  }, [selectedCandidate, entityExtraData, dupCard]);

  // «Первичный» блок = заявка на текущую вакансию воронки (если определима),
  // иначе первый блок активности. Его applicationId/events/vacancyTitle уходят в
  // живой контейнер; статус живого = статус самого кандидата (его текущий этап).
  const primaryBlock = useMemo(() => {
    if (entityActivity.length === 0) return undefined;
    return (
      entityActivity.find((b) => b.vacancy_id === selectedVacancyId)
      || entityActivity[0]
    );
  }, [entityActivity, selectedVacancyId]);

  const containers = useMemo<StageContainer[]>(() => {
    if (!funnelCard) return [];
    return buildStageContainers({
      card: funnelCard,
      status: selectedCandidate?.stage || primaryBlock?.current_stage || 'applied',
      liveApplicationId: primaryBlock?.application_id ?? 0,
      liveEvents: primaryBlock?.events,
      liveVacancyTitle: primaryBlock?.vacancy_title ?? null,
      allEntityFiles: entityFiles,
    });
  }, [funnelCard, selectedCandidate?.stage, primaryBlock, entityFiles]);

  const cardReact = useCallback(
    async (entryKey: string, emoji: string): Promise<EntryReaction[] | null> => {
      const eid = selectedCandidate?.entity_id;
      if (!eid) return null;
      try {
        const resp = await toggleTimelineReaction(eid, entryKey, emoji);
        // Зеркалим реакцию в локальный extra_data, чтобы карточка обновилась
        // мгновенно (без ожидания reload entity), как делает AllCandidatesPage.
        setEntityExtraData((prev) => {
          const tr = {
            ...((prev?.timeline_reactions as Record<string, unknown> | undefined) || {}),
          };
          if (resp.reactions?.length) tr[entryKey] = resp.reactions;
          else delete tr[entryKey];
          return { ...(prev || {}), timeline_reactions: tr };
        });
        return (resp.reactions as EntryReaction[]) || [];
      } catch {
        toast.error('Не удалось поставить реакцию');
        return null;
      }
    },
    [selectedCandidate?.entity_id],
  );

  const cardDeleteFile = useCallback(
    async (fileId: number) => {
      const eid = selectedCandidate?.entity_id;
      if (!eid) return;
      if (!window.confirm('Удалить этот файл?')) return;
      try {
        await deleteEntityFile(eid, fileId);
        toast.success('Файл удалён');
        const fresh = await getEntityFiles(eid);
        setEntityFiles(fresh);
      } catch {
        toast.error('Не удалось удалить файл');
      }
    },
    [selectedCandidate?.entity_id],
  );

  // Toggle checkbox selection for a candidate
  const toggleCandidateSelection = useCallback((candidateId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }, []);

  // Bulk «Удалить с воронки» — удаляет выбранных кандидатов из текущей вакансии.
  const handleBulkRemoveFromVacancy = useCallback(async () => {
    if (selectedIds.size === 0) return;
    // entity_id выбранных карточек → затем ВСЕ их отклики на этой вакансии (на
    // случай дублей из мержа), иначе дубль остался бы после снятия.
    const selectedEntityIds = new Set(
      candidates.filter((c) => selectedIds.has(c.id)).map((c) => c.entity_id),
    );
    if (!window.confirm(`Удалить ${selectedEntityIds.size} кандидат(ов) с воронки?`)) return;
    setBulkMoving(true);
    try {
      const ids = candidates
        .filter((c) => selectedEntityIds.has(c.entity_id))
        .map((c) => c.id);
      for (const id of ids) {
        await deleteApplication(id);
      }
      const idsSet = new Set(ids);
      setCandidates((prev) => prev.filter((c) => !idsSet.has(c.id)));
      loadSeqRef.current++; // инвалидируем in-flight загрузки
      setSelectedIds(new Set());
      toast.success(`${selectedEntityIds.size} кандидат(ов) удалено с воронки`);
      fetchVacancies();
    } catch (err) {
      // Показываем реальную причину с бэкенда (например, недостаточно прав).
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Ошибка при удалении с воронки');
    } finally {
      setBulkMoving(false);
    }
  }, [selectedIds, candidates, fetchVacancies]);

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
    // Заявка-оригинал после «Взять в работу» переходит в open и висит рядом со
    // своим клоном (рабочей вакансией) → дубль («Трафик» ×2). Прячем оригиналы,
    // у которых уже есть клон — как это делает сайдбар и AddToVacancyModal.
    const clonedSourceIds = new Set<number>();
    vacancies.forEach((v) => {
      const src = (v.extra_data as Record<string, unknown> | undefined)
        ?.cloned_from_request_id;
      if (typeof src === 'number') clonedSourceIds.add(src);
    });
    return vacancies.filter(v =>
      v.id !== selectedVacancyId &&
      v.status === 'open' &&
      !clonedSourceIds.has(v.id) &&
      // Только СВОИ воронки: рекрутёр перемещает кандидата лишь во взятые/созданные
      // им (created_by). Чужие / visible_to_all / невзятые заявки — НЕ цель.
      (isHrAdmin || (!!user && v.created_by === user.id))
    );
  }, [vacancies, selectedVacancyId, selectedCandidate?.entity_id, isHrAdmin, user]);

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
      // MOVE: apply-to-vacancy переносит кандидата (снимает с текущей воронки),
      // а не дублирует — один кандидат = одна воронка.
      await applyEntityToVacancy(selectedCandidate.entity_id, targetVacancyId, 'manual_add');
      const targetVacancy = vacancies.find(v => v.id === targetVacancyId);
      toast.success(`Кандидат перемещён в «${targetVacancy?.title || targetVacancyId}»`);
      setShowAddToVacancy(false);
      setSelectedCandidateId(null); // ушёл из текущей воронки
      if (selectedVacancyId) loadCandidates(selectedVacancyId);
      fetchVacancies();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Ошибка перемещения';
      toast.error(detail);
    } finally {
      setAddingToVacancy(false);
    }
  }, [selectedCandidate?.entity_id, vacancies, fetchVacancies, selectedVacancyId, loadCandidates]);

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
            {isHrAdmin && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="hf-recruiter-sidebar-icon-btn"
                title="Новая вакансия"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
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

                {isHrAdmin && (
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
                )}
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
                      {!search && isHrAdmin && (
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
                  {/* Открывает полную форму редактирования (в т.ч. закрыть/
                      удалить вакансию) — только HR-админ. Рекрутёр не должен
                      редактировать условия найма, даже уже взяв заявку в работу. */}
                  {isHrAdmin && (
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
                  )}
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

                    {/* Bulk actions floating bar — единая плашка (как «Все кандидаты»).
                        Прячем, пока открыта модалка перемещения, иначе плашка
                        перекрывает её футер с кнопкой «Добавить». */}
                    <BulkSelectionBar
                      open={anySelected && !showBulkMove}
                      count={selectedIds.size}
                      avatars={candidates
                        .filter((c) => selectedIds.has(c.id))
                        .map((c) => ({
                          id: c.id,
                          name: c.entity_name || 'Без имени',
                          photo_url: (c as { entity_photo?: string }).entity_photo,
                        }))}
                      onSelectAll={() =>
                        setSelectedIds(
                          new Set(tabFilteredCandidates.slice(0, 1000).map((c) => c.id)),
                        )
                      }
                      onClear={() => setSelectedIds(new Set())}
                      onClose={() => setSelectedIds(new Set())}
                      actions={[
                        {
                          label: 'Переместить в воронку',
                          icon: Plus,
                          variant: 'neutral',
                          onClick: () => setShowBulkMove(true),
                          disabled: bulkMoving,
                        },
                        {
                          label: 'Удалить с воронки',
                          icon: X,
                          variant: 'danger',
                          onClick: handleBulkRemoveFromVacancy,
                          disabled: bulkMoving,
                        },
                      ]}
                    />
                    {showBulkMove && (
                      <AddToVacancyModal
                        entityId={
                          candidates.find((c) => selectedIds.has(c.id))?.entity_id ?? 0
                        }
                        entityName={`${selectedIds.size} кандидат(ов)`}
                        bulkEntityIds={candidates
                          .filter((c) => selectedIds.has(c.id))
                          .map((c) => c.entity_id)}
                        bulkEntities={candidates
                          .filter((c) => selectedIds.has(c.id))
                          .map((c) => ({
                            id: c.entity_id,
                            name: c.entity_name || 'Без имени',
                          }))}
                        // Прячем текущую воронку из назначений — перемещаем ИЗ неё.
                        excludeVacancyIds={selectedVacancyId ? [selectedVacancyId] : undefined}
                        onClose={() => setShowBulkMove(false)}
                        onSuccess={() => {
                          setShowBulkMove(false);
                          setSelectedIds(new Set());
                          if (selectedVacancyId) loadCandidates(selectedVacancyId);
                          fetchVacancies();
                        }}
                      />
                    )}
                  </div>

                  {/* Right: detail panel */}
                  <div className="hf-candidates-detail-panel hf-vacancy-detail flex-1 bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-bg-dark)] rounded-hf-l flex flex-col overflow-hidden">
                    {selectedCandidate ? (
                      <>
                        {/* Tab content — единый профиль (как «Все кандидаты»):
                            инфо + история + нижний ряд вкладок Анкеты/Резюме. */}
                        <div className="flex-1 overflow-y-auto">
                          <div className="p-[var(--hf-space-xxl)] max-w-[1220px]">
                              {dupCard && (
                                <ShadowDuplicateBanner
                                  card={dupCard}
                                  status={selectedCandidate.stage as string}
                                  onResolved={() => setDupCard(null)}
                                />
                              )}
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
                                <button
                                  onClick={handleRemoveFromVacancy}
                                  className="hf-profile-action-btn"
                                >
                                  <X className="hf-profile-action-icon" /> Удалить с воронки
                                </button>
                              </div>

                              {/* Name + large photo (Huntflow / AllCandidatesPage style) */}
                              <div className="hf-profile-summary">
                                <div className="hf-profile-summary-copy">
                                  <h2 className="hf-profile-title">
                                    {selectedCandidate.entity_name || 'Без имени'}
                                  </h2>
                                  {(() => {
                                    // funnelCard обогащён полным Entity (dupCard) — берём оттуда с
                                    // fallback на «снэпшот»-поля заявки, пока dupCard ещё грузится.
                                    const position = funnelCard?.position || selectedCandidate.entity_position;
                                    const company = funnelCard?.company || selectedCandidate.entity_company;
                                    return (position || company) && (
                                      <p className="hf-profile-subtitle">
                                        {[position, company].filter(Boolean).join(' · ')}
                                      </p>
                                    );
                                  })()}

                              {/* Contact info — Huntflow dotted-line rows */}
                              <div className="mb-[var(--hf-space-xl)]">
                                {selectedCandidate.entity_phone && (
                                  <HuntflowInfoRow label="Телефон">
                                    <div className="flex items-center gap-2">
                                      <a href={`tel:${selectedCandidate.entity_phone}`} className="text-[var(--hf-main-900)] hover:text-[var(--hf-cyan-700)] transition-colors">
                                        {selectedCandidate.entity_phone}
                                      </a>
                                      <CopyButton value={selectedCandidate.entity_phone} />
                                      {/* Мессенджер-иконки — были в «Все кандидаты», но отсутствовали здесь. */}
                                      <a
                                        href={`https://wa.me/${selectedCandidate.entity_phone.replace(/\D/g, '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-[22px] h-[22px] rounded-full bg-[var(--hf-ui-social-whatsapp)] flex items-center justify-center hover:opacity-80"
                                        title="WhatsApp"
                                      >
                                        <Phone className="w-[11px] h-[11px] text-[var(--hf-white)]" />
                                      </a>
                                      {(funnelCard?.telegram_username || selectedCandidate.entity_telegram) && (
                                        <a
                                          href={`https://t.me/${(funnelCard?.telegram_username || selectedCandidate.entity_telegram || '').replace(/^@/, '')}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="w-[22px] h-[22px] rounded-full bg-[var(--hf-ui-social-telegram)] flex items-center justify-center hover:opacity-80"
                                          title="Telegram"
                                        >
                                          <Send className="w-[11px] h-[11px] text-[var(--hf-white)]" />
                                        </a>
                                      )}
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
                                {(() => {
                                  const telegram = funnelCard?.telegram_username || selectedCandidate.entity_telegram;
                                  return telegram && (
                                    <HuntflowInfoRow label="Telegram">
                                      <div className="flex items-center gap-2">
                                        <a href={`https://t.me/${telegram}`} target="_blank" rel="noopener noreferrer" className="text-[var(--hf-main-900)] hover:text-[var(--hf-cyan-700)] transition-colors">
                                          @{telegram}
                                        </a>
                                        <CopyButton value={`@${telegram}`} />
                                      </div>
                                    </HuntflowInfoRow>
                                  );
                                })()}
                                {funnelCard?.age && (
                                  <HuntflowInfoRow label="Возраст">
                                    <span className="text-[var(--hf-main-900)]">{funnelCard.age}</span>
                                  </HuntflowInfoRow>
                                )}
                                {funnelCard?.city && (
                                  <HuntflowInfoRow label="Город">
                                    <span className="text-[var(--hf-main-900)] inline-flex items-center gap-1">
                                      <MapPin className="w-3.5 h-3.5 text-[var(--hf-main-500)]" />
                                      {funnelCard.city}
                                    </span>
                                  </HuntflowInfoRow>
                                )}
                                {funnelCard?.salary && (
                                  <HuntflowInfoRow label="Зарплата">
                                    <span className="text-[var(--hf-main-900)]">{funnelCard.salary}</span>
                                  </HuntflowInfoRow>
                                )}
                                {funnelCard?.total_experience && (
                                  <HuntflowInfoRow label="Опыт">
                                    <span className="text-[var(--hf-main-900)]">{funnelCard.total_experience}</span>
                                  </HuntflowInfoRow>
                                )}
                                {(() => {
                                  const source = funnelCard?.source || selectedCandidate.source;
                                  const sourceUrl = funnelCard?.source_url;
                                  if (!source && !sourceUrl) return null;
                                  return (
                                    <HuntflowInfoRow label="Источник">
                                      {sourceUrl ? (
                                        <a
                                          href={sourceUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[var(--hf-cyan-700)] hover:text-[var(--hf-red-500)] transition-colors inline-flex items-center gap-1"
                                        >
                                          {source || 'Ссылка'} <ExternalLink className="w-3 h-3" />
                                        </a>
                                      ) : (
                                        <span className="text-[var(--hf-main-900)]">{source}</span>
                                      )}
                                    </HuntflowInfoRow>
                                  );
                                })()}
                              </div>


                              {/* Tags / Metki */}
                              <div className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                  <Tag className="w-3.5 h-3.5 text-[var(--hf-dark-500)]" />
                                  <span className="text-xs font-medium text-[var(--hf-dark-500)] uppercase tracking-wider">Метки</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {/* Авто-метки HR (read-only): кто забрал кандидата в воронку
                                      (extra_data.system_hr_tags). Без крестика — каталожные
                                      метки ниже остаются полностью редактируемыми. */}
                                  {readSystemHrTags(entityExtraData).map((hr) => (
                                    <span
                                      key={`hr-${hr.hr_id}`}
                                      title="Закреплённый HR — проставляется автоматически по воронке"
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--hf-ui-hover)] text-[var(--hf-main-800)] border border-[color:var(--hf-ui-border)]"
                                    >
                                      <Lock className="w-3 h-3 opacity-50" />
                                      HR: {hr.name}{hr.vacancy_title ? ` · ${hr.vacancy_title}` : ""}
                                    </span>
                                  ))}
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

                              {/* Вакансии и история — та же богатая карточка, что и в
                                  «Все кандидаты» (CandidateVacancyCard), по контейнеру
                                  стека (живой + merged_from) через buildStageContainers. */}
                              <div className="px-5 pt-4 flex flex-col gap-3">
                                <div className="text-sm font-medium text-[var(--hf-dark-400)] mb-1">Вакансии и история</div>
                                {entityActivity.length === 0 || !funnelCard ? (
                                  <div className="text-sm text-[var(--hf-dark-600)]">Нет участий в вакансиях</div>
                                ) : (
                                  containers.map((c) => (
                                    <CandidateVacancyCard
                                      key={`${c.origin}-${c.applicationId}`}
                                      card={funnelCard}
                                      applicationId={c.applicationId}
                                      vacancyTitle={c.vacancyTitle}
                                      currentStage={c.status}
                                      notes={c.notes}
                                      events={c.events}
                                      addedAt={c.addedAt}
                                      readonly={c.origin === 'merged'}
                                      stageOptions={stagePickerOptions}
                                      getStageLabel={getVacancyStageLabel}
                                      onChangeStage={cardChangeStage}
                                      onComment={cardComment}
                                      onDeleteHistory={cardDeleteHistory}
                                      onDeleteNote={cardDeleteNote}
                                      onUploadFile={cardUploadFile}
                                      onAnketa={c.origin === 'live' ? () => setAnketaOpen(true) : undefined}
                                      anketaCount={anketaCount}
                                      onReact={c.origin === 'live' ? cardReact : undefined}
                                      files={c.files}
                                      onDeleteFile={c.origin === 'live' ? cardDeleteFile : undefined}
                                    />
                                  ))
                                )}
                              </div>

                              {/* Ряд вкладок под карточкой — паритет с «Все
                                  кандидаты»: «Анкеты» (с бейджем непрочитанных) +
                                  «Резюме». Вкладки «Личные заметки» больше нет —
                                  заметки пишутся в композере карточки (cardComment)
                                  и показываются в её ленте. */}
                              <div className="hf-vacancy-detail-tabs">
                                <button
                                  type="button"
                                  onClick={() => setDetailTab('anketa')}
                                  className={clsx(
                                    'hf-vacancy-detail-tab',
                                    detailTab === 'anketa' && 'hf-vacancy-detail-tab-active',
                                  )}
                                >
                                  Анкеты
                                  {anketaCount > 0 && (
                                    <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-[#e11d48] text-white text-[11px] leading-none align-middle">
                                      {anketaCount > 9 ? '9+' : anketaCount}
                                    </span>
                                  )}
                                </button>
                                {/* По одной вкладке «Резюме» на источник (паритет с
                                    «Все кандидаты»). */}
                                {(resumeSources.length > 0 ? resumeSources : [null]).map((_s, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => { setDetailTab('resume'); setResumeIndex(i); }}
                                    className="hf-vacancy-detail-tab"
                                  >
                                    <FileText className="h-[14px] w-[14px]" />
                                    Резюме
                                  </button>
                                ))}
                              </div>

                              {detailTab === 'anketa' && selectedCandidate.entity_id && (
                                <div className="hf-vacancy-notes-panel">
                                  <FunnelAnketaTab entityId={selectedCandidate.entity_id} />
                                </div>
                              )}
                              {/* Резюме — нижняя секция профиля (паритет с «Все
                                  кандидаты»): инфо и история остаются выше, резюме
                                  показывается под ними, а не отдельной страницей. */}
                              {detailTab === 'resume' && (
                                <div className="mt-4">
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
                                    </div>
                                  ) : funnelCard ? (
                                    <ResumeTab card={funnelCard} activeIndex={resumeIndex} />
                                  ) : null}
                                </div>
                              )}
                            </div>
                        </div>

                        {/* Дровер «Анкета» — отправка/привязка анкеты живому
                            контейнеру (открывается чипом на карточке). */}
                        {anketaOpen && selectedCandidate.entity_id && (
                          <Suspense fallback={null}>
                            <AnketaDrawer
                              open={anketaOpen}
                              onOpenChange={setAnketaOpen}
                              entityId={selectedCandidate.entity_id}
                              entityName={selectedCandidate.entity_name || ''}
                              vacancyId={selectedVacancyId ?? undefined}
                              vacancyTitle={selectedVacancy?.title}
                            />
                          </Suspense>
                        )}
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

// Вкладка «Анкеты» (копия AnketaTab из AllCandidatesPage, параметризованная
// entityId): тянет диспатчи анкет по кандидату, разово помечает прочитанными +
// гасит бейдж, поллит раз в 15с (на проде realtime по WS может не доходить).
function FunnelAnketaTab({ entityId }: { entityId: number }) {
  const [dispatches, setDispatches] = useState<FormDispatchInfo[]>([]);
  const clearBadge = useFormBadgeStore((s) => s.clear);
  useEffect(() => {
    let alive = true;
    const fetchRows = async () => {
      try {
        const rows = await getEntityDispatches(entityId);
        if (alive) setDispatches(rows);
      } catch {
        /* пустой/ошибка — покажем пустое состояние */
      }
    };
    (async () => {
      await fetchRows();
      try { await markEntityDispatchesSeen(entityId); clearBadge(entityId); } catch { /* ignore */ }
    })();
    const t = setInterval(fetchRows, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [entityId, clearBadge]);
  return <AnketaResponses dispatches={dispatches} />;
}
