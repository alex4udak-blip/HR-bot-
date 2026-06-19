import { useState, useEffect, useCallback, useRef, useMemo, memo, Fragment, lazy, Suspense } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Users,
  PlusCircle,
  Paperclip,
  Mail,
  Calendar,
  ThumbsUp,
  FileText,
  Eye,
  Printer,
  Download,
  Pencil,
  PenSquare,
  Archive,
  Phone,
  Send,
  Check,
  ExternalLink,
  MapPin,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Type,
  Upload,
  ClipboardList,
} from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { useHorizontalScroll } from "../hooks/useHorizontalScroll";
import {
  getCandidatesKanban,
  changeCandidateStatus,
  getCandidateStageHistory,
} from "@/services/api/candidates";
import type {
  KanbanBoardResponse,
  KanbanCard,
  KanbanColumn,
} from "@/services/api/candidates";
import {
  updateEntity,
  createEntity,
  uploadEntityFile,
  getEntityFiles,
  downloadEntityFile,
  deleteEntity,
  archiveEntity,
  getEntity,
  detectDuplicate,
  addEntityNote,
  updateEntityNote,
  deleteEntityNote,
} from "@/services/api/entities";
import SendEmailModal from "@/components/entities/SendEmailModal";
import type { EntityFile } from "@/services/api/entities";
import AddToVacancyModal from "@/components/entities/AddToVacancyModal";
import ShadowDuplicateBanner from "@/components/entities/ShadowDuplicateBanner";
import ParserModal from "@/components/parser/ParserModal";
import { useAuthStore } from "@/stores/authStore";
import { HuntflowComposer } from "@/components/hr/HuntflowComposer";
import {
  HuntflowActionChip as ActionChip,
  HuntflowEditorIcon,
  HuntflowInfoRow as InfoRow,
  HuntflowOptionsIcon,
} from "@/components/hr/HuntflowControls";
import { useFormBadgeStore } from "@/stores/formBadgeStore";
import { getEntityFormsUnreadCount, getEntityDispatches, markEntityDispatchesSeen, type FormDispatchInfo } from "@/services/api/forms";
import { AnketaResponses } from "@/features/forms/AnketaResponses";
const AnketaDrawer = lazy(() =>
  import("@/features/forms/AnketaDrawer").then((m) => ({ default: m.AnketaDrawer })),
);

// ---------- constants ----------

// STATUS_COLORS / FALLBACK_COLOR удалены — комментарии перешли на
// единый Huntflow-стиль (hf-vacancy-note-card) без цветных фонов.

// ---------- helpers ----------

const HUNTFLOW_STAGE_LAYOUT_TRANSITION = {
  duration: 0.42,
  ease: [0.22, 1, 0.36, 1] as const,
};

function HuntflowClose28Icon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 28"
      className={className}
      fill="none"
    >
      <path
        d="M19.833 8.167 8.167 19.833m0-11.666 11.666 11.666"
        stroke="var(--hf-ui-close-icon)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowRemoveIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className={className}
      fill="none"
    >
      <rect width="14" height="14" fill="currentColor" rx="7" />
      <path
        d="M9 5 5 9m0-4 4 4"
        stroke="var(--hf-white)"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowClip18Icon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      className={className}
      fill="none"
    >
      <path
        d="m15.866 8.173-6.761 6.762a3.938 3.938 0 0 1-5.569-5.569l6.762-6.761a2.625 2.625 0 0 1 3.712 3.712l-6.496 6.497a1.312 1.312 0 1 1-1.857-1.857l5.701-5.7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowXClose16Icon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill="none"
    >
      <path
        d="m12 4-8 8m0-8 8 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowChevronDown24Icon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
    >
      <path
        d="M7.5 10.5 12 15l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const normalizeStageLabel = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const TIMELINE_ACTION_FILTERS = [
  "Сопроводительное письмо",
  "Смена этапа подбора",
  "Комментарий",
  "Письмо кандидату",
  "Интервью",
  "Телефонный звонок",
  "Файл",
  "Оффер",
  "Отказ",
  "Оценка рекрутмента",
];

const getTimelineFilterAliases = (filter: string) => {
  const aliases: Record<string, string[]> = {
    "Смена этапа подбора": ["смен", "этап", "перенес", "новый", "отказ"],
    "Письмо кандидату": ["письм", "email", "почт"],
    "Телефонный звонок": ["телефон", "звон"],
    "Сопроводительное письмо": ["сопровод"],
  };
  return [filter, ...(aliases[filter] || [])].map((value) =>
    value.toLowerCase(),
  );
};

function TimelineUserGlyph({
  surface = "stage",
  align = "stage",
}: {
  surface?: "stage" | "white";
  align?: "stage" | "notes";
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "hf-timeline-user-glyph",
        align === "stage"
          ? "hf-timeline-user-glyph-stage"
          : "hf-timeline-user-glyph-notes",
        surface === "white"
          ? "hf-timeline-user-glyph-white-surface"
          : "hf-timeline-user-glyph-stage-surface",
      )}
    >
      <span className="hf-timeline-user-head" />
      <span className="hf-timeline-user-body" />
    </span>
  );
}

function TimelineDot({ align = "stage" }: { align?: "stage" | "notes" }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "hf-timeline-dot",
        align === "stage" ? "hf-timeline-dot-stage" : "hf-timeline-dot-notes",
      )}
    />
  );
}

function TimelineMetaIcon() {
  return (
    <span
      aria-hidden="true"
      className="hf-timeline-meta-icon"
    >
      <span className="hf-timeline-meta-eye-left" />
      <span className="hf-timeline-meta-eye-right" />
      <span className="hf-timeline-meta-mouth" />
    </span>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0]?.[0] || "?").toUpperCase();
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ru");
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleString("ru", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatInputDateRu(dateStr: string): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}.${month}.${year}`;
}

function parseRuDateInput(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatTimelineDate(dateStr: string): string {
  const date = new Date(dateStr);
  const months = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

function formatResumeSaved(dateStr: string): string {
  const date = new Date(dateStr);
  const months = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} в ${hours}:${minutes}`;
}

function formatPhoneDisplay(phone?: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const match = digits.match(/^7(\d{3})(\d{3})(\d{4})$/);
  if (match) return `+7 ${match[1]} ${match[2]} ${match[3]}`;
  return phone;
}

function formatPhoneForEdit(phone?: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  const match = digits.match(/^7(\d{3})(\d{3})(\d{4})$/);
  if (match) return `+7 (${match[1]}) ${match[2]}${match[3]}`;
  return phone;
}

function getVacancyStageLabel(card: KanbanCard): string | undefined {
  if (!card.vacancy_name) return undefined;
  const department =
    typeof card.extra_data?.vacancy_department === "string"
      ? card.extra_data.vacancy_department.trim()
      : "";
  return department
    ? `${card.vacancy_name} (${department})`
    : card.vacancy_name;
}

function getInterviewVacancyLabel(card: KanbanCard): string {
  const vacancyName = card.vacancy_name || card.position || "Вакансия";
  const department =
    typeof card.extra_data?.vacancy_department === "string"
      ? card.extra_data.vacancy_department.trim()
      : "";
  return department ? `${vacancyName} / ${department}` : vacancyName;
}

function HfLoadingSpinner({
  size,
  stroke,
  className,
}: {
  size?: number | string;
  stroke?: number | string;
  className?: string;
}) {
  return (
    <span
      className={clsx("hf-loading-spinner", className)}
      style={
        size || stroke
          ? {
              width: size,
              height: size,
              borderWidth: stroke,
            }
          : undefined
      }
      aria-hidden="true"
    />
  );
}

const TIMELINE_EXPAND_DELAY_MS = 420;

function HfSkeletonBlock({
  className,
}: {
  className: string;
}) {
  return <div className={clsx("hf-loading-skeleton", className)} />;
}

function HfCandidatesLoadingLayout() {
  return (
    <div className="flex-1 flex overflow-hidden pl-0 pr-hf-s pb-hf-s gap-hf-s">
      <div className="hf-candidates-loading-list">
        <div className="hf-candidates-loading-list-inner">
          {Array.from({ length: 9 }).map((_, index) => (
            <div
              key={index}
              className="hf-candidates-loading-row"
            >
              <HfSkeletonBlock className="hf-candidates-loading-avatar" />
              <div className="hf-candidates-loading-lines">
                <HfSkeletonBlock className="hf-candidates-loading-title" />
                <HfSkeletonBlock className="hf-candidates-loading-role" />
                <HfSkeletonBlock className="hf-candidates-loading-company" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hf-candidates-loading-detail">
        <div className="hf-candidates-loading-head">
          <div className="hf-candidates-loading-head-copy">
            <div className="hf-candidates-loading-actions">
              <HfSkeletonBlock className="hf-candidates-loading-action hf-candidates-loading-action-1" />
              <HfSkeletonBlock className="hf-candidates-loading-action hf-candidates-loading-action-2" />
              <HfSkeletonBlock className="hf-candidates-loading-action hf-candidates-loading-action-3" />
            </div>
            <HfSkeletonBlock className="hf-candidates-loading-name" />
            <HfSkeletonBlock className="hf-candidates-loading-subtitle" />
            <div className="hf-candidates-loading-meta">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="hf-candidates-loading-meta-row">
                  <HfSkeletonBlock className="hf-candidates-loading-meta-label" />
                  <HfSkeletonBlock className="hf-candidates-loading-meta-value" />
                </div>
              ))}
            </div>
          </div>
          <HfSkeletonBlock className="hf-candidates-loading-photo" />
        </div>
        <HfSkeletonBlock className="hf-candidates-loading-panel" />
      </div>
    </div>
  );
}

// ================================================================
// MAIN PAGE
// ================================================================

export default function AllCandidatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewCandidateModal, setShowNewCandidateModal] = useState(false);
  const [showParserModal, setShowParserModal] = useState(false);
  const { user } = useAuthStore();
  const [board, setBoard] = useState<KanbanBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebounce(searchText, 400);
  const [showTopSearch, setShowTopSearch] = useState(false);
  const topSearchRef = useRef<HTMLInputElement>(null);
  // Горизонтальный скролл табов этапов — единый хук useHorizontalScroll:
  // стрелки сами пересчитываются на скролл/ресайз/смену набора этапов.
  const {
    ref: topStageScrollRef,
    canScrollLeft: topStageCanScrollLeft,
    canScrollRight: topStageCanScrollRight,
    scrollLeft: scrollTopStagesLeft,
    scrollRight: scrollTopStagesRight,
  } = useHorizontalScroll<HTMLDivElement>({ step: 520 });
  const [activeTab, setActiveTab] = useState("all");

  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [detailTab, setDetailTab] = useState<DetailSection>("resume");
  const [showListSettings, setShowListSettings] = useState(false);
  // F7-fix: настройки списка (scope + видимые поля) — persist + применяются к карточкам.
  const [listSettings, setListSettings] = useState<CandidateListSettings>(
    loadCandidateListSettings,
  );
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddToVacancy, setShowAddToVacancy] = useState(false);
  const [addToVacancyAnchor, setAddToVacancyAnchor] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const VISIBLE_STEP = 50;
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);
  const isAdmin =
    user?.role === "superadmin" ||
    user?.org_role === "owner" ||
    user?.org_role === "admin";
  const anySelected = selectedIds.size > 0;

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCandidatesKanban({
        q: debouncedSearch || undefined,
      });
      setBoard(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  useEffect(() => {
    if (showTopSearch) {
      requestAnimationFrame(() => topSearchRef.current?.focus());
    }
  }, [showTopSearch]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(VISIBLE_STEP);
  }, [activeTab, debouncedSearch]);

  // useMemo чтобы фильтрация была реактивной и не пересчитывалась лишний раз
  // (без него были репорты что переключение таба не обновляет список).
  const filteredCards = useMemo(() => {
    if (!board) return [];
    // F7: scope «Только по моим вакансиям» — показываем кандидатов, где рекрутёр
    // = текущий пользователь. recruiter_name приходит из User.name (как и user.name),
    // поэтому сравнение точное и список не обнуляется из-за расхождения форматов.
    const myName = (user?.name || "").trim();
    const scopeMine = listSettings.scope === "mine" && myName.length > 0;
    const items: { card: KanbanCard; status: string; label: string }[] = [];
    for (const col of board.columns) {
      if (activeTab === "all" || col.status === activeTab) {
        for (const c of col.cards) {
          if (scopeMine && (c.recruiter_name || "").trim() !== myName) continue;
          items.push({ card: c, status: col.status, label: col.label });
        }
      }
    }
    if (activeTab === "all") {
      return items.sort(
        (a, b) =>
          new Date(b.card.created_at).getTime() -
          new Date(a.card.created_at).getTime(),
      );
    }
    return items;
  }, [board, activeTab, listSettings.scope, user?.name]);

  const displayedCards = filteredCards;

  const selectedBulkCards = useMemo(() => {
    if (!board) return [];
    const byId = new Map<number, KanbanCard>();
    for (const column of board.columns) {
      for (const card of column.cards) {
        byId.set(card.id, card);
      }
    }
    return Array.from(selectedIds)
      .reverse()
      .map((id) => byId.get(id))
      .filter((card): card is KanbanCard => Boolean(card));
  }, [board, selectedIds]);

  // Открыть форму добавления при ?add=resume в URL (триггер из FAB-кнопки)
  useEffect(() => {
    if (searchParams.get("add") === "resume") {
      setShowNewCandidateModal(true);
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Auto-select from URL ?entity=ID or first card
  const entityParam = searchParams.get("entity");
  const editParam = searchParams.get("edit");
  const archivedParam = searchParams.get("archived");
  const tabParam = searchParams.get("tab");
  const clearCandidateDeepLink = useCallback(() => {
    if (!searchParams.has("entity") && !searchParams.has("edit") && !searchParams.has("archived") && !searchParams.has("tab")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("entity");
    next.delete("edit");
    next.delete("archived");
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  // Чтобы не тянуть entity повторно после неудачной попытки селекта.
  const entityFetchTriedRef = useRef<number | null>(null);
  const detectTriedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!board) return;
    if (entityParam) {
      if (archivedParam === "1") return;  // архивного открывает отдельный эффект ниже
      const entityId = parseInt(entityParam);
      const match = filteredCards.find((fc) => fc.card.id === entityId);
      if (match) {
        setSelectedCard(match.card);
        setSelectedStatus(match.status);
        if (editParam === "1") {
          setShowEditModal(true);
        }
        if (tabParam === "anketa") setDetailTab("anketa");
        clearCandidateDeepLink();
        return;
      }
      // Кандидат пришёл из расширения / другой страницы и не виден на текущем фильтре —
      // подтягиваем по имени, чтобы доска подгрузила его и авто-селект сработал.
      if (entityFetchTriedRef.current !== entityId) {
        entityFetchTriedRef.current = entityId;
        getEntity(entityId)
          .then((entity) => {
            if (entity?.name) {
              setActiveTab("all");
              setSearchText(entity.name);
            } else {
              toast.error("Кандидат не найден");
              clearCandidateDeepLink();
            }
          })
          .catch(() => {
            toast.error("Не удалось открыть кандидата (нет доступа?)");
            clearCandidateDeepLink();
          });
        return;
      }
    }
    const selectedVisible = selectedCard
      ? filteredCards.some(({ card }) => card.id === selectedCard.id)
      : false;
    if (filteredCards.length === 0) {
      if (selectedCard) {
        setSelectedCard(null);
        setSelectedStatus("");
      }
      return;
    }
    // Fallback: auto-select first visible card for the current stage/search.
    if (!selectedVisible) {
      const initial = filteredCards[0];
      setSelectedCard(initial.card);
      setSelectedStatus(initial.status);
    }
  }, [filteredCards, entityParam, editParam, archivedParam, tabParam, board, selectedCard, clearCandidateDeepLink]);

  // Архивный кандидат (?archived=1): на доске его нет (отфильтрован is_archived),
  // поэтому грузим по id и открываем ту же стандартную карточку напрямую.
  // CSV-комментарий (extra_data.comment) показываем как личный коммент.
  useEffect(() => {
    if (!entityParam || archivedParam !== "1") return;
    const entityId = parseInt(entityParam);
    if (Number.isNaN(entityId) || entityFetchTriedRef.current === entityId) return;
    entityFetchTriedRef.current = entityId;
    getEntity(entityId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((e: any) => {
        if (!e?.id) {
          toast.error("Кандидат не найден");
          return;
        }
        const extra: Record<string, any> = { ...(e.extra_data || {}) };
        if ((!Array.isArray(extra.notes) || extra.notes.length === 0) && extra.comment) {
          extra.notes = [{ text: String(extra.comment), date: e.created_at, author_name: "Импорт" }];
        }
        extra.is_archived = true;
        setSelectedCard({
          id: e.id,
          name: e.name,
          email: e.email || undefined,
          phone: e.phone || undefined,
          telegram_username: (e.telegram_usernames && e.telegram_usernames[0]) || undefined,
          position: e.position || undefined,
          company: e.company || undefined,
          source: e.source || extra.source || undefined,
          created_at: e.created_at || "",
          tags: e.tags || [],
          photo_url: e.photo_url || undefined,
          extra_data: extra,
        } as KanbanCard);
        setSelectedStatus((e.status as string) || "");
      })
      .catch(() => toast.error("Не удалось открыть кандидата"));
  }, [entityParam, archivedParam]);

  // Живой детект дубля при ОТКРЫТИИ карточки. Если флаг ещё не стоит — спрашиваем
  // бэкенд: ловит уже существующих дублей (импорт/другой источник), созданных до
  // появления детекта, без ручного «Сверить». Нашёлся — ставим hidden_duplicate_id
  // локально, и баннер появляется сам (бэкенд помечает и вторую сторону).
  useEffect(() => {
    const card = selectedCard;
    if (!card) return;
    const extra = (card.extra_data || {}) as Record<string, unknown>;
    if (extra.hidden_duplicate_id) return; // флаг уже есть — баннер покажется и так
    if (detectTriedRef.current === card.id) return; // эту карточку уже проверяли
    detectTriedRef.current = card.id;
    let cancelled = false;
    detectDuplicate(card.id)
      .then((r) => {
        if (cancelled || !r?.duplicate_id) return;
        setSelectedCard((prev) =>
          prev && prev.id === card.id
            ? {
                ...prev,
                extra_data: {
                  ...(prev.extra_data || {}),
                  hidden_duplicate_id: r.duplicate_id,
                },
              }
            : prev
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard?.id]);

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedCard || newStatus === selectedStatus) return;
    const old = selectedStatus;
    const name = selectedCard.name;
    setBoard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => {
          if (col.status === old)
            return {
              ...col,
              cards: col.cards.filter((c) => c.id !== selectedCard.id),
              count: col.count - 1,
            };
          if (col.status === newStatus)
            return {
              ...col,
              cards: [selectedCard, ...col.cards],
              count: col.count + 1,
            };
          return col;
        }),
      };
    });
    setSelectedStatus(newStatus);
    try {
      await changeCandidateStatus(selectedCard.id, newStatus);
      toast.success(
        `${name} → ${board?.columns.find((c) => c.status === newStatus)?.label}`,
      );
    } catch {
      toast.error("Ошибка");
      fetchBoard();
    }
  };

  // After editing candidate, update the card in state
  const handleCardUpdated = (updated: Partial<KanbanCard>) => {
    if (!selectedCard) return;
    const newCard = { ...selectedCard, ...updated };
    setSelectedCard(newCard);
    // Also update in board
    setBoard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) => (c.id === newCard.id ? newCard : c)),
        })),
      };
    });
  };

  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [showBulkAddToVacancy, setShowBulkAddToVacancy] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    setShowBulkDeleteConfirm(false);
    try {
      for (const id of ids) {
        await deleteEntity(id);
      }
      toast.success(`${ids.length} кандидат(ов) удалено`);
      setSelectedIds(new Set());
      if (selectedCard && ids.includes(selectedCard.id)) {
        setSelectedCard(null);
      }
      fetchBoard();
    } catch {
      toast.error("Ошибка при удалении");
      fetchBoard();
    } finally {
      setBulkProcessing(false);
    }
  };

  const totalCandidateCount =
    board?.columns.reduce(
      (sum, column) => sum + (column.count ?? column.cards.length),
      0,
    ) ?? 0;
  const topStageItems = useMemo(() => {
    const columns = board?.columns || [];
    return columns.filter((column) => column.status !== "withdrawn");
  }, [board?.columns]);
  const [expandedEmptyStageGroups, setExpandedEmptyStageGroups] = useState<Set<string>>(
    () => new Set(),
  );
  type TopStageNavItem =
    | { type: "stage"; column: KanbanColumn }
    | { type: "empty-group"; id: string; columns: KanbanColumn[]; count: number };

  const topStageNavItems = useMemo<TopStageNavItem[]>(() => {
    const items: TopStageNavItem[] = [];
    let emptyRun: KanbanColumn[] = [];

    const flushEmptyRun = () => {
      if (!emptyRun.length) return;
      items.push({
        type: "empty-group",
        id: emptyRun.map((column) => column.status).join("-"),
        columns: [...emptyRun],
        count: emptyRun.length,
      });
      emptyRun = [];
    };

    topStageItems.forEach((column) => {
      const count = column.count ?? column.cards.length;
      if (count === 0) {
        emptyRun.push(column);
        return;
      }

      flushEmptyRun();
      items.push({ type: "stage", column });
    });

    flushEmptyRun();
    return items;
  }, [topStageItems]);

  const getEmptyStageGroupLabel = (count: number) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const noun =
      mod10 === 1 && mod100 !== 11
        ? "этап"
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
          ? "этапа"
          : "этапов";
    return `${count} ${noun} без кандидатов`;
  };

  const getTopStageLabel = (column: KanbanColumn) => {
    return column.label;
  };

  const getTopStageCount = (column: KanbanColumn) => {
    return String(column.count);
  };

  return (
    <div className="hf-all-candidates-page hf-all-candidates-page-root font-hf-body">
      {/* Stage tabs island — huntflow tabs pattern: white island radius 16 h52,
          inline stage labels + counter pills bg var(--hf-bg-panel) var(--hf-main-600) 12/16/500 radius 56 pad 2-6.
          Активная вкладка: cyan-500 underline. */}
      <div className="hf-top-stage-shell">
        {/* Stage tabs */}
        <div
          ref={topStageScrollRef}
          className={clsx(
            "hf-top-stage-tabs no-scrollbar",
            !showTopSearch && "hf-top-stage-tabs-padded",
          )}
        >
          <motion.button
            layout="position"
            transition={{ layout: HUNTFLOW_STAGE_LAYOUT_TRANSITION }}
            type="button"
            onClick={() => setShowTopSearch((value) => !value)}
            className={clsx(
              "hf-top-stage-search-toggle",
              (showTopSearch || searchText) && "hf-top-stage-search-toggle-active",
            )}
            title={showTopSearch ? "Скрыть поиск" : "Открыть поиск"}
            aria-pressed={showTopSearch}
          >
            <Search className="h-[var(--hf-candidates-search-icon)] w-[var(--hf-candidates-search-icon)]" />
          </motion.button>

          {showTopSearch ? (
            <div className="hf-top-stage-search">
              <input
                ref={topSearchRef}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (searchText) setSearchText("");
                    else setShowTopSearch(false);
                  }
                }}
                placeholder="Поиск по имени, должности..."
                className="hf-top-stage-search-input"
              />
              {searchText && loading ? (
                <span className="hf-top-stage-search-action">
                  <HfLoadingSpinner />
                </span>
              ) : searchText ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchText("");
                    topSearchRef.current?.focus();
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
              <motion.button
                layout="position"
                transition={{ layout: HUNTFLOW_STAGE_LAYOUT_TRANSITION }}
                onClick={() => {
                  setActiveTab("all");
                  setSelectedCard(null);
                }}
                className={clsx(
                  "hf-top-stage-item hf-top-stage-all",
                  activeTab === "all"
                    ? "hf-top-stage-item-active"
                    : "hf-top-stage-item-idle",
                )}
              >
                Все
                <span
                  className={clsx(
                    "hf-top-stage-badge",
                    activeTab === "all"
                      ? "hf-top-stage-badge-active"
                      : "",
                  )}
                >
                  {totalCandidateCount}
                </span>
                {activeTab === "all" && (
                  <span className="hf-top-stage-underline-all" />
                )}
              </motion.button>

              {topStageNavItems.map((item) => {
                if (item.type === "empty-group") {
                  const isExpanded = expandedEmptyStageGroups.has(item.id);
                  return (
                    <Fragment key={`empty-${item.id}`}>
                      <motion.button
                        layout="position"
                        transition={{ layout: HUNTFLOW_STAGE_LAYOUT_TRANSITION }}
                        type="button"
                        className={clsx(
                          "hf-top-stage-empty-group",
                          isExpanded && "hf-top-stage-empty-group-expanded",
                        )}
                        aria-expanded={isExpanded}
                        title={isExpanded ? "Свернуть пустые этапы" : "Показать пустые этапы"}
                        onClick={() => {
                          setExpandedEmptyStageGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                      >
                        <span>{getEmptyStageGroupLabel(item.count)}</span>
                        <ChevronDown className="hf-top-stage-empty-group-icon" />
                      </motion.button>
                      {isExpanded && item.columns.map((col) => {
                        const isActive = activeTab === col.status;
                        return (
                          <motion.button
                            key={col.status}
                            layout="position"
                            transition={{ layout: HUNTFLOW_STAGE_LAYOUT_TRANSITION }}
                            type="button"
                            onClick={() => {
                              setActiveTab(col.status);
                              setSelectedCard(null);
                            }}
                            className={clsx(
                              "hf-top-stage-item hf-top-stage-empty-stage",
                              isActive
                                ? "hf-top-stage-item-active"
                                : "hf-top-stage-item-idle",
                            )}
                          >
                            {getTopStageLabel(col)}
                            <span className="hf-top-stage-badge hf-top-stage-badge-muted">
                              {getTopStageCount(col)}
                            </span>
                            {isActive && (
                              <span className="hf-top-stage-underline" />
                            )}
                          </motion.button>
                        );
                      })}
                    </Fragment>
                  );
                }

                const col = item.column;
                const isActive = activeTab === col.status;
                const stageLabel = getTopStageLabel(col);
                return (
                  <motion.button
                    key={col.status}
                    layout="position"
                    transition={{ layout: HUNTFLOW_STAGE_LAYOUT_TRANSITION }}
                    type="button"
                    onClick={() => {
                      setActiveTab(col.status);
                      setSelectedCard(null);
                    }}
                    className={clsx(
                      "hf-top-stage-item",
                      isActive
                        ? "hf-top-stage-item-active"
                        : "hf-top-stage-item-idle",
                    )}
                  >
                    {stageLabel}
                    <span className="hf-top-stage-badge hf-top-stage-badge-muted">
                      {getTopStageCount(col)}
                    </span>
                    {isActive && (
                      <span className="hf-top-stage-underline" />
                    )}
                  </motion.button>
                );
              })}
            </>
          )}
        </div>
        <div className="hf-top-stage-action-cell">
          <button
            type="button"
            onClick={() => setShowListSettings(true)}
            className="hf-top-stage-action-btn"
            title="Настройки"
            aria-label="Настройки списков кандидатов"
            aria-expanded={showListSettings}
          >
            <HuntflowOptionsIcon className="hf-top-stage-options-icon" />
          </button>
        </div>
        {!showTopSearch && topStageCanScrollLeft ? (
          <button
            type="button"
            onClick={scrollTopStagesLeft}
            className="hf-top-stage-arrow hf-top-stage-arrow-left"
            title="Прокрутить этапы влево"
          >
            <ChevronLeft className="hf-top-stage-arrow-icon" />
          </button>
        ) : null}
        {!showTopSearch && topStageCanScrollRight ? (
          <button
            type="button"
            onClick={scrollTopStagesRight}
            className={clsx(
              "hf-top-stage-arrow",
              isAdmin ? "hf-top-stage-arrow-right-admin" : "hf-top-stage-arrow-right",
            )}
            title="Прокрутить этапы вправо"
          >
            <ChevronRight className="hf-top-stage-arrow-icon" />
          </button>
        ) : null}
      </div>

      {/* ===== MASTER-DETAIL (huntflow style) ===== */}
      {loading && !board ? (
        <HfCandidatesLoadingLayout />
      ) : (
        <div className="hf-candidates-master">
          {/* LEFT: Candidate list — white card */}
          <div className="hf-candidates-list-panel">
            {/* List */}
            <div className="hf-candidates-list-scroll">
              {displayedCards.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-hf-xxs text-[var(--hf-main-500)] hf-dark-disabled:text-[color:var(--hf-white-alpha-40)]">
                  Нет кандидатов
                </div>
              ) : (
                <>
                  {displayedCards
                    .slice(0, visibleCount)
                    .map(({ card, status }) => {
                      const isSelected = selectedCard?.id === card.id;
                      const isChecked = selectedIds.has(card.id);
                      const listMetaPrimary =
                        (listSettings.fields.lastCompany ? card.company : undefined) ||
                        card.vacancy_name;
                      const showListDate = !card.company;
                      return (
                        <div
                          key={card.id}
                          onClick={() => {
                            setSelectedCard(card);
                            setSelectedStatus(status);
                            setDetailTab("resume");
                            clearCandidateDeepLink();
                          }}
                          className={clsx(
                            "hf-candidate-row",
                            isChecked || isSelected
                              ? "hf-candidate-row-selected"
                              : "hf-candidate-row-idle",
                          )}
                        >
                          {/* Avatar / checkmark zone (LEFT) — hover ONLY on avatar shows checkmark and cancels card border */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelection(card.id);
                            }}
                            className="hf-candidate-avatar-zone"
                          >
                            {isChecked ? (
                              card.photo_url ? (
                                <div className="hf-candidate-avatar-check">
                                  <img
                                    src={card.photo_url}
                                    alt={card.name}
                                    referrerPolicy="no-referrer"
                                    className="hf-candidate-avatar-check-img"
                                    onError={(e) => {
                                      (
                                        e.currentTarget as HTMLImageElement
                                      ).style.display = "none";
                                    }}
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
                                {card.photo_url ? (
                                  <img
                                    src={card.photo_url}
                                    alt={card.name}
                                    referrerPolicy="no-referrer"
                                    className="hf-candidate-avatar"
                                    onError={(e) => {
                                      (
                                        e.currentTarget as HTMLImageElement
                                      ).style.display = "none";
                                    }}
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
                          {/* Text column (RIGHT) — name, position, company/date */}
                          <div className="hf-candidate-row-copy">
                            <div className="flex items-center min-w-0">
                              <div className="hf-candidate-row-name">
                                {card.name}
                              </div>
                            </div>
                            {listSettings.fields.lastPosition && card.position && (
                              <div className="hf-candidate-row-subtitle">
                                {card.position}
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
                              {listMetaPrimary &&
                                showListDate &&
                                card.created_at && (
                                  <span className="hf-candidate-row-meta-dot">
                                    ·
                                  </span>
                                )}
                              {showListDate && card.created_at && (
                                <span className="hf-candidate-row-date">
                                  {formatDateShort(card.created_at)}
                                </span>
                              )}
                            </div>
                            {/* F7: доп. поля списка по настройке (если есть в данных карточки) */}
                            {(() => {
                              const extras = [
                                listSettings.fields.desiredSalary && card.salary,
                                listSettings.fields.age && card.age,
                                listSettings.fields.experience && card.total_experience,
                                listSettings.fields.source && card.source,
                              ].filter(Boolean) as string[];
                              if (!extras.length) return null;
                              return (
                                <div className="hf-candidate-row-meta">
                                  {extras.map((t, ei) => (
                                    <span key={ei} className="hf-candidate-row-meta-text" title={t}>{t}</span>
                                  ))}
                                </div>
                              );
                            })()}
                            {listSettings.fields.tags && card.tags && card.tags.length > 0 && (
                              <div className="hf-candidate-row-meta" style={{ flexWrap: "wrap" }}>
                                {card.tags.slice(0, 6).map((tag, ti) => (
                                  <span key={ti} className="hf-candidate-row-meta-text">#{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  {displayedCards.length > visibleCount && (
                    <button
                      onClick={() =>
                        setVisibleCount((prev) => prev + VISIBLE_STEP)
                      }
                      className="w-full py-hf-m text-hf-xxs text-[var(--hf-cyan-700)] hf-dark-disabled:text-[var(--hf-cyan-400)] hover:bg-[var(--hf-main-50)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-05)] transition-colors border-b border-[var(--hf-main-100)] hf-dark-disabled:border-[color:var(--hf-white-alpha-05)]"
                    >
                      Показать ещё ({displayedCards.length - visibleCount})
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Detail panel */}
          <div className="hf-candidates-detail-panel flex-1 bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-bg-dark)] rounded-hf-l flex flex-col overflow-hidden">
            {selectedCard ? (
              <div className="flex-1 overflow-y-auto">
                <InfoTab
                  card={selectedCard}
                  status={selectedStatus}
                  statusLabel={
                    board?.columns.find((c) => c.status === selectedStatus)
                      ?.label || selectedStatus
                  }
                  columns={board?.columns || []}
                  detailSection={detailTab}
                  onDetailSectionChange={setDetailTab}
                  onStatusChange={handleStatusChange}
                onAddToVacancy={(rect) => {
                  setAddToVacancyAnchor(rect ?? null);
                  setShowAddToVacancy(true);
                }}
                  onEdit={() => setShowEditModal(true)}
                  onArchived={() => {
                    setSelectedCard(null);
                    fetchBoard();
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-[var(--hf-main-500)] hf-dark-disabled:text-[color:var(--hf-white-alpha-40)]">
                  <Users className="w-12 h-12 mx-auto mb-hf-m text-[var(--hf-main-400)] hf-dark-disabled:text-[color:var(--hf-white-alpha-30)]" />
                  <p className="text-hf-xxs">Выберите кандидата из списка</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== BULK ACTIONS DRAWER ===== */}
      <AnimatePresence>
        {anySelected && (
          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 28, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-0 left-[560px] right-[320px] z-[85] min-h-[198px] max-w-[1320px] overflow-hidden rounded-t-[12px] rounded-b-[8px] border border-[var(--hf-ui-divider-soft)] border-t-[3px] border-t-[var(--hf-main-900)] bg-[var(--hf-white)] px-[var(--hf-space-xxl)] py-[20px] shadow-[0_18px_60px_var(--hf-alpha-300)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:border-t-white hf-dark-disabled:bg-[var(--hf-bg-dark)]"
          >
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="absolute right-[22px] top-[20px] inline-flex h-[28px] w-[28px] items-center justify-center rounded-full text-[var(--hf-main-500)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)] hf-dark-disabled:hover:text-[var(--hf-white)]"
              title="Закрыть"
            >
              <X className="h-[20px] w-[20px]" strokeWidth={1.75} />
            </button>

            <div className="flex items-center gap-[10px] pr-[54px]">
              <span className="text-[length:var(--hf-fs-m)] leading-[26px] font-medium text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                Выбрано кандидатов: {selectedIds.size}
                <span className="ml-[2px] text-[var(--hf-main-500)]">/1000</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    new Set(
                      filteredCards.slice(0, 1000).map(({ card }) => card.id),
                    ),
                  )
                }
                className="inline-flex h-[28px] items-center rounded-full bg-[var(--hf-bg-panel)] px-[10px] text-[length:var(--hf-fs-2xs)] leading-[18px] font-medium text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-main-200)] active:bg-[var(--hf-ui-muted-8)]"
              >
                Выбрать всех
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="inline-flex h-[28px] items-center rounded-full bg-[var(--hf-bg-panel)] px-[10px] text-[length:var(--hf-fs-2xs)] leading-[18px] font-medium text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-main-200)] active:bg-[var(--hf-ui-muted-8)]"
              >
                Сбросить
              </button>
            </div>

            <div className="mt-[22px] flex h-[58px] items-center">
              <div className="flex items-center">
                <AnimatePresence initial={false}>
                  {selectedBulkCards.slice(0, 12).map((card, index) => (
                    <motion.div
                      key={card.id}
                      layout
                      transition={{
                        layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
                      }}
                      className={clsx(
                        "relative h-[56px] w-[56px] rounded-full",
                        index > 0 && "-ml-[15px]",
                      )}
                      style={{ zIndex: selectedBulkCards.length - index }}
                      title={card.name}
                    >
                      <motion.div
                        initial={{ opacity: 0, x: -22 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -16 }}
                        transition={{
                          duration: 0.26,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        className="relative h-full w-full overflow-hidden rounded-full border-[2px] border-[color:var(--hf-white)] bg-[var(--hf-ui-hover)] hf-dark-disabled:border-[var(--hf-bg-dark)] hf-dark-disabled:bg-[var(--hf-white-alpha-10)]"
                      >
                        {card.photo_url ? (
                          <img
                            src={card.photo_url}
                            alt={card.name}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (
                                e.currentTarget as HTMLImageElement
                              ).style.display = "none";
                            }}
                          />
                        ) : (
                          <>
                            <span className="absolute left-1/2 top-[13px] h-[14px] w-[14px] -translate-x-1/2 rounded-full bg-[var(--hf-ui-border)]" />
                            <span className="absolute left-1/2 top-[32px] h-[9px] w-[26px] -translate-x-1/2 rounded-[50%] bg-[var(--hf-ui-border)]" />
                          </>
                        )}
                      </motion.div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-[24px] flex items-center gap-[var(--hf-space-s)]">
              <button
                onClick={() => setShowBulkAddToVacancy(true)}
                disabled={bulkProcessing}
                className="inline-flex h-[40px] items-center gap-[var(--hf-space-s)] rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-card-border)] bg-[var(--hf-white)] px-[15px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-primary)] font-medium text-[var(--hf-main-900)] shadow-[0_1px_4px_var(--hf-alpha-150)] transition-colors hover:border-[var(--hf-ui-border)] hover:bg-[var(--hf-white)] active:bg-[var(--hf-bg-panel)] disabled:opacity-50 hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-white-alpha-10)] hf-dark-disabled:text-[var(--hf-white)]"
              >
                <PlusCircle className="h-[20px] w-[20px]" strokeWidth={1.8} />
                Взять на вакансию
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== BULK DELETE CONFIRMATION ===== */}
      <AnimatePresence>
        {showBulkDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--hf-black-alpha-30)]"
            onClick={() => setShowBulkDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] overflow-hidden rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-[var(--hf-bg-muted)] shadow-[0_18px_60px_var(--hf-black-alpha-30)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-bg-dark)]"
            >
              <div className="border-b border-[var(--hf-ui-border)] px-[var(--hf-space-xxl)] py-[18px] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
                <h3 className="text-[20px] font-semibold leading-[var(--hf-lh-h2)] text-[var(--hf-ui-text-strong)] hf-dark-disabled:text-[var(--hf-white)]">
                  Удалить кандидатов?
                </h3>
              </div>
              <div className="px-[var(--hf-space-xxl)] py-[18px]">
                <p className="text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-field)] text-[var(--hf-ui-text-muted)] hf-dark-disabled:text-[color:var(--hf-white-alpha-60)]">
                  Вы уверены, что хотите удалить {selectedIds.size}{" "}
                  кандидат(ов)? Это действие необратимо.
                </p>
              </div>
              <div className="flex h-[72px] items-center justify-end gap-[12px] border-t border-[var(--hf-ui-border)] px-[var(--hf-space-xxl)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
                <button
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  className="inline-flex h-[40px] items-center rounded-[var(--hf-radius-s)] px-[var(--hf-space-xxl)] text-[length:var(--hf-fs-xs)] font-medium text-[var(--hf-ui-text-soft)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-900)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)] hf-dark-disabled:hover:text-[var(--hf-white)]"
                >
                  Отмена
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="inline-flex h-[40px] items-center rounded-[var(--hf-radius-s)] bg-[var(--hf-red-500)] px-[18px] text-[length:var(--hf-fs-xs)] font-semibold text-[var(--hf-white)] transition-colors duration-[100ms] hover:bg-[var(--hf-red-600)] active:bg-[var(--hf-red-700)]"
                >
                  Удалить ({selectedIds.size})
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewCandidateModal && (
          <NewCandidateModal
            onClose={() => setShowNewCandidateModal(false)}
            onSaved={() => {
              setShowNewCandidateModal(false);
              fetchBoard();
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
              fetchBoard();
              toast.success("Кандидат добавлен");
            }}
            onAttachedToEntity={() => {
              setShowParserModal(false);
              fetchBoard();
            }}
          />
        )}
        {showListSettings && (
          <ListSettingsModal
            onClose={() => setShowListSettings(false)}
            initial={listSettings}
            onApply={setListSettings}
          />
        )}
        {showEditModal && selectedCard && (
          <EditCandidateModal
            card={selectedCard}
            onClose={() => setShowEditModal(false)}
            onSaved={(updated) => {
              handleCardUpdated(updated);
              setShowEditModal(false);
            }}
            onDeleted={() => {
              setShowEditModal(false);
              setSelectedCard(null);
              fetchBoard();
            }}
          />
        )}
        {showAddToVacancy && selectedCard && (
          <AddToVacancyModal
            entityId={selectedCard.id}
            entityName={selectedCard.name}
            onClose={() => setShowAddToVacancy(false)}
            onSuccess={() => {
              setShowAddToVacancy(false);
              fetchBoard();
              toast.success("Кандидат добавлен на вакансию");
            }}
            anchorRect={addToVacancyAnchor}
          />
        )}
        {showBulkAddToVacancy && (
          <AddToVacancyModal
            entityId={Array.from(selectedIds)[0]}
            entityName={`${selectedIds.size} кандидат(ов)`}
            onClose={() => setShowBulkAddToVacancy(false)}
            onSuccess={async () => {
              setShowBulkAddToVacancy(false);
              toast.success(
                `${selectedIds.size} кандидат(ов) добавлено на вакансию`,
              );
              setSelectedIds(new Set());
              fetchBoard();
            }}
            bulkEntityIds={Array.from(selectedIds)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ================================================================
// INFO TAB — Huntflow-style detail panel with working actions
// ================================================================

type DetailSection = "info" | "resume" | "anketa";

// Этапы, при которых карточка остаётся нейтрально-серой (не «в процессе»).
const NEUTRAL_STAGE_STATUSES = new Set(["rejected", "fired", "archived"]);

const InfoTab = memo(function InfoTab({
  card,
  status,
  statusLabel,
  columns,
  detailSection,
  onDetailSectionChange,
  onStatusChange,
  onAddToVacancy,
  onEdit,
  onArchived,
}: {
  card: KanbanCard;
  status: string;
  statusLabel: string;
  columns: KanbanColumn[];
  detailSection: DetailSection;
  onDetailSectionChange: (section: DetailSection) => void;
  onStatusChange: (s: string) => void;
  onAddToVacancy: (rect?: { left: number; bottom: number }) => void;
  onEdit: () => void;
  onArchived: () => void;
}) {
  const { user: currentUser } = useAuthStore();
  const isAdmin =
    currentUser?.role === "superadmin" ||
    currentUser?.org_role === "owner" ||
    currentUser?.org_role === "admin";
  const [archiving, setArchiving] = useState(false);
  const handleArchive = async () => {
    if (!window.confirm("Убрать кандидата в архив? Он скроется из активных списков.")) return;
    setArchiving(true);
    try {
      await archiveEntity(card.id);
      toast.success("Кандидат убран в архив");
      onArchived();
    } catch {
      toast.error("Не удалось архивировать");
    } finally {
      setArchiving(false);
    }
  };
  const [showStageDD, setShowStageDD] = useState(false);
  const [pendingStage, setPendingStage] = useState(status);
  const [stageChangeComment, setStageChangeComment] = useState("");
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [actionMenuPlacement, setActionMenuPlacement] = useState<
    "above" | "below"
  >("above");
  const [actionSearch, setActionSearch] = useState("");
  const [timelineActionFilter, setTimelineActionFilter] = useState<
    string | null
  >(null);
  const [comment, setComment] = useState("");
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [anketaOpen, setAnketaOpen] = useState(false);
  const anketaCount = useFormBadgeStore((s) => s.counts[card.id] ?? 0);
  const setAnketaCount = useFormBadgeStore((s) => s.setCount);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [localTags, setLocalTags] = useState<string[]>(card.tags || []);
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [timelineExpanding, setTimelineExpanding] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const actionSearchRef = useRef<HTMLInputElement>(null);
  const timelineExpandTimerRef = useRef<number | null>(null);
  const timelineEvents = Array.isArray(card.extra_data?.timeline_events)
    ? (card.extra_data.timeline_events as Array<{
        date?: string;
        title?: string;
        body?: string;
        author?: string;
      }>)
    : [];
  // Сквозная история смены этапов (реальные StageTransition по всем откликам
  // кандидата) — чтобы глобальная карточка показывала тот же лог, что и воронка.
  const [stageHistory, setStageHistory] = useState<any[]>([]);
  useEffect(() => {
    if (!card.id) {
      setStageHistory([]);
      return;
    }
    let cancelled = false;
    getCandidateStageHistory(card.id)
      .then((rows) => {
        if (!cancelled) setStageHistory(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setStageHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id]);
  useEffect(() => {
    if (!card.id) return;
    getEntityFormsUnreadCount(card.id)
      .then((r) => setAnketaCount(card.id, r.count))
      .catch(() => {});
  }, [card.id, setAnketaCount]);
  const stageHistoryTimelineItems = useMemo<
    Array<{ date?: string; title?: string; body?: string; author?: string }>
  >(() => {
    const LABELS: Record<string, string> = {
      applied: "Новый",
      screening: "Выполняет ТЗ",
      phone_screen: "Интервью с HR",
      interview: "Интервью с заказчиком",
      assessment: "Принятие решения",
      offer: "Выставлен оффер",
      hired: "Оффер принят",
      rejected: "Отказ",
      withdrawn: "Отозван",
    };
    return (stageHistory as any[]).map((t) => {
      const to = LABELS[t.to_stage] || t.to_stage;
      const from = t.from_stage ? LABELS[t.from_stage] || t.from_stage : null;
      return {
        date: t.created_at || undefined,
        title: from ? `${from} → ${to}` : `Этап: ${to}`,
        body: [t.vacancy_title, t.comment].filter(Boolean).join(" · ") || undefined,
        author: t.changed_by_name || undefined,
      };
    });
  }, [stageHistory]);
  const timelineItems =
    stageHistoryTimelineItems.length > 0 || timelineEvents.length > 0
      ? [...stageHistoryTimelineItems, ...timelineEvents].sort((a, b) => {
          const ta = a.date ? new Date(a.date).getTime() : 0;
          const tb = b.date ? new Date(b.date).getTime() : 0;
          return tb - ta;
        })
      : [{ date: card.created_at, title: "Кандидат добавлен", author: "Я" }];
  const normalizedTimelineItems = timelineItems
    .filter(
      (event) =>
        !String(event.title || "")
          .trim()
          .startsWith("Рекрутер:"),
    )
    .map((event) => ({
      ...event,
      author: event.author ? "Я" : event.author,
    }));
  const filteredTimelineItems = useMemo(() => {
    if (!timelineActionFilter) return normalizedTimelineItems;
    const aliases = getTimelineFilterAliases(timelineActionFilter);
    return normalizedTimelineItems.filter((event) => {
      const haystack = `${event.title || ""} ${event.body || ""}`.toLowerCase();
      return aliases.some((alias) => haystack.includes(alias));
    });
  }, [normalizedTimelineItems, timelineActionFilter]);
  const visibleTimelineItems = showAllTimeline
    ? filteredTimelineItems
    : filteredTimelineItems.slice(0, 5);
  const hasHiddenTimelineItems = filteredTimelineItems.length > 5;
  const visibleActionFilters = TIMELINE_ACTION_FILTERS.filter((item) =>
    item.toLowerCase().includes(actionSearch.trim().toLowerCase()),
  );
  const isCommentComposerOpen =
    commentComposerOpen || comment.trim().length > 0;
  const stageTitle =
    status === "rejected" && card.rejection_reason
      ? `Отказ. ${card.rejection_reason}`
      : statusLabel;
  // Карточка этапа — всего 2 цвета (по фидбэку): активный этап зелёный,
  // отказ/уволен/архив — серый.
  const stageCardStyle: CSSProperties | undefined = NEUTRAL_STAGE_STATUSES.has(status)
    ? undefined
    : ({
        "--hf-stage-accent": "#22c55e",
        "--hf-stage-card-bg": "rgba(34, 197, 94, 0.1)",
      } as CSSProperties);
  const stagePickerOptions = useMemo(() => {
    return columns.map((column) => ({
      label: column.label,
      status: column.status,
      isRealStage: true,
    }));
  }, [columns]);

  useEffect(() => {
    setTimelineExpanding(false);
    if (timelineExpandTimerRef.current) {
      window.clearTimeout(timelineExpandTimerRef.current);
      timelineExpandTimerRef.current = null;
    }
    return () => {
      if (timelineExpandTimerRef.current) {
        window.clearTimeout(timelineExpandTimerRef.current);
        timelineExpandTimerRef.current = null;
      }
    };
  }, [card.id, timelineActionFilter]);

  useEffect(() => {
    setLocalTags(card.tags || []);
    setShowTagInput(false);
    setTagInput("");
  }, [card.id, card.tags]);

  const handleTimelineMoreToggle = useCallback(() => {
    if (timelineExpanding) return;
    if (!hasHiddenTimelineItems) return;
    if (showAllTimeline) {
      setShowAllTimeline(false);
      return;
    }

    setTimelineExpanding(true);
    if (timelineExpandTimerRef.current) {
      window.clearTimeout(timelineExpandTimerRef.current);
    }
    timelineExpandTimerRef.current = window.setTimeout(() => {
      setShowAllTimeline(true);
      setTimelineExpanding(false);
      timelineExpandTimerRef.current = null;
    }, TIMELINE_EXPAND_DELAY_MS);
  }, [hasHiddenTimelineItems, showAllTimeline, timelineExpanding]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (stageRef.current && !stageRef.current.contains(e.target as Node))
        setShowStageDD(false);
      if (
        actionMenuRef.current &&
        !actionMenuRef.current.contains(e.target as Node)
      )
        setShowActionMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (showStageDD) {
      setPendingStage(status);
      setStageChangeComment("");
    }
  }, [showStageDD, status]);

  useEffect(() => {
    if (showActionMenu) {
      requestAnimationFrame(() => actionSearchRef.current?.focus());
    }
  }, [showActionMenu]);

  // --- Action handlers ---

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAnchorRect, setEmailAnchorRect] = useState<DOMRect | null>(null);

  // Inline interview-date picker
  const [showInterviewModal, setShowInterviewModal] = useState(false);
  const [interviewDateTime, setInterviewDateTime] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewStartTime, setInterviewStartTime] = useState("18:00");
  const [interviewEndTime, setInterviewEndTime] = useState("19:00");
  const [interviewComment, setInterviewComment] = useState("");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewPrivate, setInterviewPrivate] = useState(true);
  const [interviewSaving, setInterviewSaving] = useState(false);

  const handleEmail: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    setEmailAnchorRect(event.currentTarget.getBoundingClientRect());
    setShowInterviewModal(false);
    setShowActionMenu(false);
    setShowEmailModal(true);
  };

  const handleInterview = () => {
    setShowEmailModal(false);
    setShowActionMenu(false);
    const cur = (card.extra_data as Record<string, unknown> | undefined)
      ?.next_interview_at;
    if (typeof cur === "string" && cur) {
      const d = new Date(cur);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setInterviewDateTime(local);
      setInterviewDate(local.slice(0, 10));
      setInterviewStartTime(local.slice(11, 16));
      const end = new Date(d.getTime() + 60 * 60 * 1000);
      const localEnd = new Date(end.getTime() - end.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(11, 16);
      setInterviewEndTime(localEnd);
    } else {
      const base = new Date();
      const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
      setInterviewDate(local);
      setInterviewStartTime("18:00");
      setInterviewEndTime("19:00");
      setInterviewDateTime(`${local}T18:00`);
    }
    setShowInterviewModal(true);
  };

  const handleSaveInterview = async () => {
    const composedDateTime =
      interviewDate && interviewStartTime
        ? `${interviewDate}T${interviewStartTime}`
        : interviewDateTime;
    if (!composedDateTime) {
      toast.error("Выберите дату и время");
      return;
    }
    setInterviewSaving(true);
    try {
      const iso = new Date(composedDateTime).toISOString();
      await updateEntity(card.id, {
        extra_data: {
          ...(card.extra_data || {}),
          next_interview_at: iso,
          interview_end_time: interviewEndTime,
          interview_comment: interviewComment,
          interview_location: interviewLocation,
          interview_private: interviewPrivate,
        },
      });
      if (!card.extra_data) card.extra_data = {};
      card.extra_data.next_interview_at = iso;
      card.extra_data.interview_end_time = interviewEndTime;
      card.extra_data.interview_comment = interviewComment;
      card.extra_data.interview_location = interviewLocation;
      card.extra_data.interview_private = interviewPrivate;
      toast.success("Интервью назначено");
      setShowInterviewModal(false);
    } catch {
      toast.error("Не удалось назначить интервью");
    } finally {
      setInterviewSaving(false);
    }
  };

  const handleComment = async () => {
    if (!comment.trim()) {
      toast.error("Введите комментарий");
      return;
    }
    try {
      // Используем dedicated endpoint /entities/{id}/notes — он требует только
      // view-доступ (рекрутёр через вакансию имеет его), в отличие от PUT /entities,
      // который требует full edit-прав.
      const resp = await addEntityNote(card.id, {
        text: comment.trim(),
        stage: status,
        stage_label: statusLabel,
      });
      // Update card in-place so block обновляется immediately
      if (!card.extra_data) card.extra_data = {};
      const existingNotes: Array<Record<string, unknown>> = Array.isArray(
        card.extra_data.notes,
      )
        ? card.extra_data.notes
        : [];
      card.extra_data.notes = [...existingNotes, resp.note];
      toast.success("Комментарий сохранён");
      setComment("");
    } catch (err) {
      console.error("Failed to save comment:", err);
      toast.error("Ошибка сохранения комментария");
    }
  };

  // Комментарий из дропдауна смены этапа («Записать комментарий»). Раньше текст
  // из этого поля никуда не отправлялся — кнопка «Сохранить» меняла только этап.
  // Теперь шлём note так же, как обычный комментарий, независимо от смены этапа.
  const saveStageChangeComment = async () => {
    const text = stageChangeComment.trim();
    if (!text) return;
    try {
      // Привязываем комментарий к ВЫБРАННОМУ этапу (pendingStage) — тому, на
      // который переносим кандидата, а не к текущему. Дату ставит сервер,
      // поэтому в ленте «Действия» виден этап + период, когда коммент оставлен.
      const targetOption = stagePickerOptions.find(
        (option) => option.status === pendingStage,
      );
      const resp = await addEntityNote(card.id, {
        text,
        stage: pendingStage,
        stage_label: targetOption?.label || statusLabel,
      });
      if (!card.extra_data) card.extra_data = {};
      const existingNotes: Array<Record<string, unknown>> = Array.isArray(
        card.extra_data.notes,
      )
        ? card.extra_data.notes
        : [];
      card.extra_data.notes = [...existingNotes, resp.note];
      toast.success("Комментарий сохранён");
      setStageChangeComment("");
    } catch (err) {
      console.error("Failed to save stage-change comment:", err);
      toast.error("Ошибка сохранения комментария");
    }
  };

  const handleOffer = () => {
    onStatusChange("offer");
    toast.success(`${card.name} → Оффер`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadEntityFile(card.id, file, "resume");
      toast.success(`Файл "${file.name}" загружен`);
    } catch (err) {
      // B7-fix: показываем реальную причину с бэка (размер/тип/нет места и т.п.)
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Ошибка загрузки файла");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (localTags.includes(tag)) {
      toast.error("Метка уже существует");
      return;
    }
    const newTags = [...localTags, tag];
    try {
      await updateEntity(card.id, { tags: newTags });
      setLocalTags(newTags);
      setTagInput("");
      toast.success(`Метка "${tag}" добавлена`);
    } catch {
      toast.error("Ошибка добавления метки");
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const newTags = localTags.filter((t) => t !== tag);
    try {
      await updateEntity(card.id, { tags: newTags });
      setLocalTags(newTags);
      toast.success(`Метка "${tag}" удалена`);
    } catch {
      toast.error("Ошибка удаления метки");
    }
  };

  return (
    <div className="p-[24px] max-w-[1200px]">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileUpload}
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
      />

      {/* Send Email Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <SendEmailModal
            entityId={card.id}
            entityName={card.name}
            entityEmail={card.email}
            anchorRect={emailAnchorRect}
            onClose={() => setShowEmailModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Interview scheduling modal */}
      {showInterviewModal && (
        <div
          className="hf-interview-overlay"
          onClick={() => !interviewSaving && setShowInterviewModal(false)}
        >
          <div
            className="hf-interview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-interview-header">
              <div className="hf-interview-header-main">
                {card.photo_url && (
                  <img
                    src={card.photo_url}
                    alt={card.name}
                    className="hf-interview-avatar"
                  />
                )}
                <div>
                  <h3 className="hf-interview-title">
                    {card.name}
                  </h3>
                  <p className="hf-interview-subtitle">
                    По вакансии: {getInterviewVacancyLabel(card)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInterviewModal(false)}
                disabled={interviewSaving}
                className="hf-interview-close disabled:opacity-50"
                aria-label="Закрыть"
              >
                <X className="hf-interview-close-icon" />
              </button>
            </div>

            <div className="hf-interview-tabs">
              <button className="hf-interview-tab hf-interview-tab-active">
                Интервью
              </button>
            </div>

            <div className="hf-interview-body">
              <div className="hf-interview-main">
                <label className="block">
                  <span className="hf-interview-field-label">
                    Тип интервью
                  </span>
                  <span className="hf-interview-select-wrap">
                    <select
                      value="interview"
                      onChange={() => undefined}
                      className="hf-interview-control hf-interview-select"
                    >
                      <option value="interview">Интервью</option>
                    </select>
                    <ChevronDown className="hf-interview-chevron" />
                  </span>
                </label>

                <div>
                  <div className="hf-interview-date-grid">
                    <label className="block">
                      <span className="hf-interview-field-label">
                        Дата
                      </span>
                      <input
                        type="text"
                        value={formatInputDateRu(interviewDate)}
                        onChange={(e) => {
                          const value = parseRuDateInput(e.target.value);
                          setInterviewDate(value);
                          setInterviewDateTime(
                            `${value}T${interviewStartTime}`,
                          );
                        }}
                        className="hf-interview-control"
                        placeholder="дд.мм.гггг"
                      />
                    </label>
                    <div className="block">
                      <span className="hf-interview-field-label">
                        Время
                      </span>
                      <div className="hf-interview-time-row">
                        <input
                          type="text"
                          value={interviewStartTime}
                          onChange={(e) => {
                            setInterviewStartTime(e.target.value);
                            setInterviewDateTime(
                              `${interviewDate}T${e.target.value}`,
                            );
                          }}
                          className="hf-interview-control hf-interview-time-input"
                        />
                        <span className="hf-interview-time-dash">
                          –
                        </span>
                        <input
                          type="text"
                          value={interviewEndTime}
                          onChange={(e) => setInterviewEndTime(e.target.value)}
                          className="hf-interview-control hf-interview-time-input"
                        />
                      </div>
                    </div>
                    <span className="hf-interview-timezone">
                      GMT+03:00
                    </span>
                  </div>
                </div>

                <label className="block">
                  <span className="hf-interview-field-label">
                    Комментарий
                  </span>
                  <textarea
                    value={interviewComment}
                    onChange={(e) => setInterviewComment(e.target.value)}
                    className="hf-interview-control hf-interview-textarea"
                  />
                </label>

                <label className="block">
                  <span className="hf-interview-field-label">
                    Место
                  </span>
                  <input
                    value={interviewLocation}
                    onChange={(e) => setInterviewLocation(e.target.value)}
                    className="hf-interview-control"
                  />
                </label>

                <label className="hf-interview-checkbox">
                  <input
                    type="checkbox"
                    checked={interviewPrivate}
                    onChange={(e) => setInterviewPrivate(e.target.checked)}
                    className="hf-interview-checkbox-input"
                  />
                  Приватное событие
                </label>
              </div>

              <aside className="hf-interview-sidebar">
                <section>
                  <h4 className="hf-interview-side-title">
                    Участники
                  </h4>
                  <div className="hf-interview-participant">
                    <span className="hf-interview-participant-avatar">
                      {getInitials(currentUser?.email || "Я").slice(0, 1)}
                    </span>
                    <span className="hf-interview-participant-name">
                      {currentUser?.email || "tatsiana.kochubei@sol..."}
                    </span>
                  </div>
                </section>
              </aside>
            </div>

            <div className="hf-interview-footer">
              <button
                onClick={handleSaveInterview}
                disabled={
                  interviewSaving || !interviewDate || !interviewStartTime
                }
                className="hf-interview-btn hf-interview-btn-primary"
              >
                {interviewSaving ? "Сохраняем…" : "Сохранить"}
              </button>
              <button
                onClick={() => setShowInterviewModal(false)}
                disabled={interviewSaving}
                className="hf-interview-btn hf-interview-btn-secondary"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Теневой дубль: баннер «Похожий кандидат есть в базе» над action-баром */}
      <ShadowDuplicateBanner card={card} status={status} />

      {/* ---- Top action buttons (Huntflow: Взять на вакансию | Редактировать) ---- */}
      <div className="hf-profile-action-bar">
        <button
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setShowEmailModal(false);
            setShowInterviewModal(false);
            setShowActionMenu(false);
            onAddToVacancy({ left: rect.left, bottom: rect.bottom });
          }}
          className="hf-profile-action-btn"
        >
          <PlusCircle className="hf-profile-action-icon" /> Взять на вакансию
        </button>
        <button
          onClick={handleEmail}
          className="hf-profile-action-btn"
        >
          <Send className="hf-profile-action-icon" /> Отправить
        </button>
        <button
          onClick={onEdit}
          className="hf-profile-action-btn"
        >
          <PenSquare className="hf-profile-action-icon" /> Редактировать
        </button>
        <button
          onClick={handleArchive}
          disabled={archiving}
          className="hf-profile-action-btn"
        >
          <Archive className="hf-profile-action-icon" /> В архив
        </button>
      </div>

      {/* ---- Name + Contact info (left column) | Photo (right column) ---- */}
      <div className="hf-profile-summary">
        <div className="hf-profile-summary-copy">
          <h2 className="hf-profile-title">
            {card.name}
          </h2>
          {(card.position || card.company) && (
            <p className="hf-profile-subtitle">
              {card.position}
              {card.position && card.company && (
                <span className="mx-1.5 text-[color:var(--hf-alpha-400)] hf-dark-disabled:text-[color:var(--hf-white-alpha-30)]">
                  &bull;
                </span>
              )}
              {card.company}
            </p>
          )}
          {card.phone && (
            <InfoRow label="Телефон">
              <div className="flex items-center gap-2">
                <a
                  href={`tel:${card.phone}`}
                  className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)] hover:text-[var(--hf-cyan-700)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
                >
                  {formatPhoneDisplay(card.phone)}
                </a>
                {/* Messenger icons */}
                <a
                  href={`https://wa.me/${card.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-[22px] h-[22px] rounded-full bg-[var(--hf-ui-social-whatsapp)] flex items-center justify-center hover:opacity-80"
                  title="WhatsApp"
                >
                  <Phone className="w-[11px] h-[11px] text-[var(--hf-white)]" />
                </a>
                {/* Telegram-иконка — только при реальном username: по номеру
                    телефона валидной публичной t.me-ссылки не существует. */}
                {card.telegram_username && (
                  <a
                    href={`https://t.me/${card.telegram_username.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-[22px] h-[22px] rounded-full bg-[var(--hf-ui-social-telegram)] flex items-center justify-center hover:opacity-80"
                    title="Telegram"
                  >
                    <Send className="w-[11px] h-[11px] text-[var(--hf-white)]" />
                  </a>
                )}
              </div>
            </InfoRow>
          )}
          {card.email && (
            <InfoRow label="Эл. почта">
              <a
                href={`mailto:${card.email}`}
                className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)] hover:text-[var(--hf-cyan-700)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
              >
                {card.email}
              </a>
            </InfoRow>
          )}
          {card.telegram_username && (
            <InfoRow label="Telegram">
              <a
                href={`https://t.me/${card.telegram_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)] hover:text-[var(--hf-cyan-700)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
              >
                {card.telegram_username}
              </a>
            </InfoRow>
          )}
          {card.age && (
            <InfoRow label="Возраст">
              <span className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)]">
                {card.age}
              </span>
            </InfoRow>
          )}
          {card.city && (
            <InfoRow label="Город">
              <span className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)] inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-[var(--hf-main-500)] hf-dark-disabled:text-[var(--hf-dark-500)]" />
                {card.city}
              </span>
            </InfoRow>
          )}
          {card.salary && (
            <InfoRow label="Зарплата">
              <span className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)]">
                {card.salary}
              </span>
            </InfoRow>
          )}
          {card.total_experience && (
            <InfoRow label="Опыт">
              <span className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)]">
                {card.total_experience}
              </span>
            </InfoRow>
          )}
          {(card.source || card.source_url) && (
            <InfoRow label="Источник">
              {card.source_url ? (
                <a
                  href={card.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--hf-cyan-700)] hf-dark-disabled:text-[var(--hf-accent)] hover:text-[var(--hf-red-500)] hf-dark-disabled:hover:text-[var(--hf-accent-hover)] transition-colors inline-flex items-center gap-1"
                >
                  {card.source || "Ссылка"} <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)]">
                  {card.source}
                </span>
              )}
            </InfoRow>
          )}

          {/* Tags row */}
          <InfoRow label="Метки">
            <div className="flex flex-wrap items-center gap-1.5">
              {localTags.map((t) => (
                <span
                  key={t}
                  className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--hf-cyan-50)] hf-dark-disabled:bg-[var(--hf-accent-bg-15)] text-[var(--hf-cyan-700)] hf-dark-disabled:text-[var(--hf-accent)] border border-[var(--hf-cyan-200)] hf-dark-disabled:border-[color:var(--hf-accent-border-20)]"
                >
                  {t}
                  <button
                    onClick={() => handleRemoveTag(t)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--hf-status-red)]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {showTagInput ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddTag();
                  }}
                  className="inline-flex items-center gap-1"
                >
                  <input
                    ref={tagInputRef}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onBlur={() => {
                      if (!tagInput.trim()) setShowTagInput(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setShowTagInput(false);
                        setTagInput("");
                      }
                    }}
                    placeholder="Метка..."
                    autoFocus
                    className="w-24 px-2 py-0.5 rounded text-xs bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-white-alpha-05)] border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-dark-200)] placeholder:text-[var(--hf-main-500)] hf-dark-disabled:placeholder:text-[var(--hf-dark-500)] focus:outline-none focus:border-[var(--hf-cyan-500)]"
                  />
                </form>
              ) : (
                <button
                  onClick={() => setShowTagInput(true)}
                  className="inline-flex h-[20px] items-center rounded-[var(--hf-radius-xs)] bg-[var(--hf-bg-panel)] px-[var(--hf-space-s)] text-[length:var(--hf-fs-xxs)] font-normal leading-[var(--hf-lh-secondary)] text-[var(--hf-ui-text-soft)] transition-colors hover:bg-[var(--hf-main-200)] hover:text-[var(--hf-main-900)] hf-dark-disabled:bg-[var(--hf-white-alpha-06)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-10)] hf-dark-disabled:hover:text-[var(--hf-white)]"
                >
                  Добавить
                </button>
              )}
            </div>
          </InfoRow>
        </div>
        {/* Avatar photo (right column) */}
        {card.photo_url ? (
          <img
            src={card.photo_url}
            alt={card.name}
            referrerPolicy="no-referrer"
            className="hf-profile-photo"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              el.style.display = "none";
              el.nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <div
          className={clsx(
            "hf-profile-photo",
            !card.photo_url && "hf-profile-photo-fallback",
            card.photo_url && "hidden",
          )}
        >
          {getInitials(card.name)}
        </div>
      </div>

      <div className="hf-stage-card" style={stageCardStyle}>
        {/* ---- Stage block (Huntflow: colored bg + vacancy name + change button) ---- */}
        <div className="hf-stage-card-head">
          <div className="hf-stage-card-head-row">
            <div>
              <div className="hf-stage-card-title">
                {stageTitle}
              </div>
              {getVacancyStageLabel(card) && (
                <div className="hf-stage-card-subtitle">
                  {getVacancyStageLabel(card)}
                </div>
              )}
            </div>
            <div className="relative" ref={stageRef}>
              <button
                onClick={() => setShowStageDD(!showStageDD)}
                className="hf-stage-change-btn"
              >
                Сменить этап подбора
              </button>
              {showStageDD && (
                <div className="hf-stage-picker">
                  <div className="hf-stage-picker-list huntflow-scrollbar">
                    {stagePickerOptions.map((option) => {
                      const isSelected =
                        pendingStage === option.status ||
                        normalizeStageLabel(statusLabel) ===
                          normalizeStageLabel(option.label);
                      return (
                        <button
                          type="button"
                          key={`${option.status}-${option.label}`}
                          onClick={() => setPendingStage(option.status)}
                          className={clsx(
                            "hf-stage-picker-option",
                            isSelected
                              ? "hf-stage-picker-option-active"
                              : "hf-stage-picker-option-idle",
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
                        <button
                          type="button"
                          className="hf-editor-icon-btn"
                        >
                          <HuntflowEditorIcon name="bold" />
                        </button>
                        <button
                          type="button"
                          className="hf-editor-icon-btn"
                        >
                          <HuntflowEditorIcon name="italic" />
                        </button>
                        <button
                          type="button"
                          className="hf-editor-icon-btn"
                        >
                          <HuntflowEditorIcon name="bullet-list" />
                        </button>
                        <button
                          type="button"
                          className="hf-editor-icon-btn"
                        >
                          <HuntflowEditorIcon name="numbered-list" />
                        </button>
                        <button
                          type="button"
                          className="hf-editor-icon-btn"
                        >
                          <HuntflowEditorIcon name="link" />
                        </button>
                        <button
                          type="button"
                          className="hf-editor-icon-btn"
                        >
                          <HuntflowEditorIcon name="at" />
                        </button>
                      </div>
                      <textarea
                        value={stageChangeComment}
                        onChange={(event) =>
                          setStageChangeComment(event.target.value)
                        }
                        placeholder="Записать комментарий"
                        className="hf-stage-picker-textarea"
                      />
                      <div className="hf-stage-picker-actions">
                        <ActionChip
                          icon={Mail}
                          label="Письмо"
                          onClick={handleEmail}
                        />
                        <ActionChip
                          icon={Calendar}
                          label="Интервью"
                          onClick={handleInterview}
                        />
                        <ActionChip
                          icon={ThumbsUp}
                          label="Оффер"
                          onClick={handleOffer}
                        />
                        <ActionChip
                          icon={Paperclip}
                          label="Файл"
                          onClick={() => fileInputRef.current?.click()}
                          loading={uploading}
                        />
                      </div>
                    </div>
                    <div className="hf-stage-picker-footer">
                      <button
                        type="button"
                        onClick={async () => {
                          const selectedOption = stagePickerOptions.find(
                            (option) => option.status === pendingStage,
                          );
                          // Сначала сохраняем комментарий (если написан) —
                          // даже когда этап не меняется.
                          if (stageChangeComment.trim()) {
                            await saveStageChangeComment();
                          }
                          if (
                            pendingStage !== status &&
                            selectedOption?.isRealStage
                          )
                            onStatusChange(pendingStage);
                          setShowStageDD(false);
                        }}
                        className="inline-flex h-[33px] min-w-[74px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-main-900)] bg-[var(--hf-main-900)] px-[11px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-secondary)] !text-[var(--hf-white)] transition-colors hover:bg-[var(--hf-main-800)]"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowStageDD(false)}
                        className="inline-flex h-[33px] min-w-[65px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-alpha-200)] bg-[var(--hf-white)] px-[11px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-ui-hover)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-white-alpha-05)] hf-dark-disabled:text-[var(--hf-white)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-10)]"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---- Comment textarea (Huntflow: "Написать комментарий") ---- */}
        <HuntflowComposer
          wrapperClassName="px-[var(--hf-space-xxl)] pt-[var(--hf-space-xxl)] pb-[6px] relative"
          value={comment}
          onChange={setComment}
          open={commentComposerOpen}
          onOpenChange={setCommentComposerOpen}
          placeholder="Написать комментарий"
          onSubmit={handleComment}
          onCancel={() => {
            setComment("");
            setCommentComposerOpen(false);
          }}
          showMention
          collapsedClassName="h-[58px] w-full resize-none rounded-[var(--hf-radius-s)] border border-[color:var(--hf-black-alpha-16)] bg-transparent px-[var(--hf-space-xxl)] py-[var(--hf-space-l)] pr-20 text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] placeholder:text-[var(--hf-main-600)] focus:border-[var(--hf-cyan-500)] focus:outline-none hf-dark-disabled:border-[color:var(--hf-white-alpha-06)] hf-dark-disabled:text-[var(--hf-dark-200)] hf-dark-disabled:placeholder:text-[var(--hf-dark-500)] hf-dark-disabled:focus:border-[color:var(--hf-status-blue-badge)]"
          actions={[
            { icon: Mail, label: "Письмо", onClick: handleEmail },
            { icon: Calendar, label: "Интервью", onClick: handleInterview },
            { icon: ThumbsUp, label: "Оффер", onClick: handleOffer },
            {
              icon: Paperclip,
              label: "Файл",
              onClick: () => fileInputRef.current?.click(),
              loading: uploading,
            },
          ]}
        />

        {/* ---- Action chips (Huntflow: Письмо | Интервью | Комментарий | Оффер | Файл | Отказ) ---- */}
        <div className="px-[var(--hf-space-xxl)] pb-hf-l flex items-center gap-[var(--hf-space-s)] border-b border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)] flex-wrap">
          {!isCommentComposerOpen && (
            <>
              <ActionChip
                icon={Mail}
                label="Письмо"
                onClick={handleEmail}
              />
              <ActionChip
                icon={Calendar}
                label="Интервью"
                onClick={handleInterview}
              />
              <ActionChip icon={ThumbsUp} label="Оффер" onClick={handleOffer} />
              <ActionChip
                icon={ClipboardList}
                label="Анкета"
                notificationCount={anketaCount}
                onClick={() => setAnketaOpen(true)}
              />
              <ActionChip
                icon={Paperclip}
                label="Файл"
                onClick={() => fileInputRef.current?.click()}
                loading={uploading}
              />
            </>
          )}
        </div>
        {anketaOpen && (
          <Suspense fallback={null}>
            <AnketaDrawer
              open={anketaOpen}
              onOpenChange={setAnketaOpen}
              entityId={card.id}
              entityName={card.name}
            />
          </Suspense>
        )}

        {/* ---- Комментарии: отдельный блок, фон по стадии в момент комментария ---- */}
        {Array.isArray(card.extra_data?.notes) &&
          (card.extra_data.notes as NoteShape[]).some((note) => Boolean(note.stage)) && (
            <div className="hf-stage-comments-section">
              <div className="hf-stage-comments-heading">
                Комментарии
              </div>
              <div className="space-y-2">
                {(card.extra_data.notes as NoteShape[])
                  .filter((note) => Boolean(note.stage))
                  .slice()
                  .sort((a, b) => {
                    const ta = a?.date ? new Date(a.date).getTime() : 0;
                    const tb = b?.date ? new Date(b.date).getTime() : 0;
                    return tb - ta;
                  })
                  .map((note, i) => (
                    <CommentCard
                      key={note.id || `note-${note.date || i}`}
                      card={card}
                      note={note}
                      currentUserId={currentUser?.id}
                      isAdmin={isAdmin}
                    />
                  ))}
              </div>
            </div>
          )}

        {/* ---- История: только смена стадий, без комментариев ---- */}
        <div className="px-[var(--hf-space-xxl)] pt-[7px]">
          <div className="relative mb-hf-l inline-block" ref={actionMenuRef}>
            <button
              type="button"
              onClick={() => {
                setActionMenuPlacement("above");
                setShowActionMenu((value) => !value);
              }}
              className="inline-flex h-[32px] items-center rounded-hf-s border border-transparent bg-[var(--hf-black-alpha-10)] pl-hf-m pr-[6px] text-hf-xxs font-medium leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-black-alpha-10)] focus:outline-none focus-visible:outline-none active:bg-[var(--hf-black-alpha-14)] hf-dark-disabled:bg-[var(--hf-white-alpha-05)] hf-dark-disabled:text-[var(--hf-white)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-10)]"
              aria-expanded={showActionMenu}
            >
              Действия: {timelineActionFilter || "Все"}{" "}
              <ChevronDown
                className={clsx(
                  "ml-[4px] h-[20px] w-[20px] transition-transform",
                  showActionMenu && "rotate-180",
                )}
              />
            </button>
            {showActionMenu ? (
              <div
                className={clsx(
                  "absolute left-0 z-[220] w-[400px] overflow-hidden rounded-[var(--hf-radius-s)] bg-[var(--hf-white)] leading-[var(--hf-lh-field)] shadow-[0_0_40px_var(--hf-alpha-300)] hf-dark-disabled:bg-[var(--hf-bg-dark)]",
                  actionMenuPlacement === "below"
                    ? "top-full mt-[10px]"
                    : "bottom-full mb-[10px]",
                )}
              >
                <div className="p-[16px] pb-[8px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-[10px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[var(--hf-main-500)]" />
                    <input
                      ref={actionSearchRef}
                      value={actionSearch}
                      onChange={(event) => setActionSearch(event.target.value)}
                      placeholder="Поиск..."
                      className="h-[40px] w-full rounded-[var(--hf-radius-s)] border border-[var(--hf-cyan-500)] bg-[var(--hf-white)] pl-[32px] pr-[16px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] outline-none placeholder:text-[var(--hf-main-600)] hf-dark-disabled:bg-transparent hf-dark-disabled:text-[var(--hf-white)]"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTimelineActionFilter(null);
                    setActionSearch("");
                    setShowActionMenu(false);
                  }}
                  className="block h-[34px] w-full px-[var(--hf-space-xxl)] text-left text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-main-600)] transition-colors hover:bg-[var(--hf-bg-panel)] hover:text-[var(--hf-main-700)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-05)]"
                >
                  Сбросить выбор
                </button>
                <div className="h-[322px] overflow-y-auto border-t border-[var(--hf-main-200)] py-[6px] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)]">
                  {visibleActionFilters.length > 0 ? (
                    visibleActionFilters.map((item, index) => {
                      const isSelected = item === timelineActionFilter;
                      const isDefaultHighlighted =
                        !timelineActionFilter &&
                        actionSearch.trim().length === 0 &&
                        index === 0;
                      const iconClass = "h-[18px] w-[18px] shrink-0";
                      return (
                        <button
                          type="button"
                          key={item}
                          onClick={() => {
                            setTimelineActionFilter(item);
                            setActionSearch("");
                            setShowActionMenu(false);
                          }}
                          className="group flex h-[42px] w-full items-center px-[var(--hf-space-s)] text-left text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]"
                        >
                          <span
                            className={clsx(
                              "flex h-[41.333px] w-full items-center transition-colors group-hover:bg-[var(--hf-black-alpha-07)] hf-dark-disabled:group-hover:bg-[var(--hf-white-alpha-10)]",
                              (isSelected || isDefaultHighlighted) &&
                                "bg-[var(--hf-black-alpha-07)] hf-dark-disabled:bg-[var(--hf-white-alpha-10)]",
                            )}
                          >
                            <span className="flex h-full w-[32px] shrink-0 items-center justify-center">
                              {isSelected ? (
                                <Check className="h-[16px] w-[16px]" />
                              ) : null}
                            </span>
                            <span className="flex h-full min-w-0 flex-1 items-center gap-[4px] py-[var(--hf-space-s)] pr-[8px]">
                              {item === "Письмо кандидату" ? (
                                <Mail className={iconClass} />
                              ) : null}
                              {item === "Интервью" ? (
                                <Calendar className={iconClass} />
                              ) : null}
                              {item === "Телефонный звонок" ? (
                                <Phone className={iconClass} />
                              ) : null}
                              {item === "Оффер" ? (
                                <ThumbsUp className={iconClass} />
                              ) : null}
                              {item === "Файл" ? (
                                <Paperclip className={iconClass} />
                              ) : null}
                              <span>{item}</span>
                            </span>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-[var(--hf-space-xxl)] py-[10px] text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-main-600)]">
                      Ничего не найдено
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="relative ml-[17px] w-[calc(100%-11px)] border-l border-[var(--hf-main-300)] pl-[38.667px] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)]">
            {visibleTimelineItems.length > 0 ? (
              visibleTimelineItems.map((event, i) => (
                <div
                  key={`${event.date || card.created_at}-${i}`}
                  className="relative first:mt-0 mt-[20px]"
                >
                  {i === 0 ? <TimelineUserGlyph /> : <TimelineDot />}
                  <div className="flex items-center gap-0 text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-field)] font-normal text-[color:var(--hf-alpha-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
                    {event.author && (
                      <span className="mr-[8px] min-w-[10px] font-medium text-[color:var(--hf-alpha-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
                        {event.author}
                      </span>
                    )}
                    <span>
                      {formatTimelineDate(event.date || card.created_at)}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors hover:bg-[var(--hf-black-alpha-04)] focus:outline-none focus-visible:outline-none hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
                    >
                      <TimelineMetaIcon />
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors hover:bg-[var(--hf-black-alpha-04)] focus:outline-none focus-visible:outline-none hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
                    >
                      <ChevronDown className="h-[14px] w-[14px] text-[var(--hf-ui-icon-light)] hf-dark-disabled:text-[color:var(--hf-white-alpha-25)]" />
                    </button>
                  </div>
                  <div className="text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)] whitespace-pre-wrap">
                    {event.title || "Событие"}
                    {event.body && (
                      <div className="text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                        {event.body}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="relative text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-field)] text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
                <TimelineDot />
                Нет действий по выбранным фильтрам
              </div>
            )}
          </div>
        </div>
        {hasHiddenTimelineItems ? (
          <button
            type="button"
            onClick={handleTimelineMoreToggle}
            disabled={timelineExpanding}
            aria-busy={timelineExpanding}
            className="mt-[25px] flex h-[49.333px] w-full items-center justify-center border-t border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)] text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-field)] text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
          >
            {timelineExpanding ? (
              <HfLoadingSpinner
                className="hf-timeline-more-spinner"
                size="var(--hf-loading-spinner-size-sm)"
                stroke="var(--hf-loading-spinner-border)"
              />
            ) : (
              <>
                {showAllTimeline ? "Свернуть" : "Показать еще"}{" "}
                <ChevronDown
                  className={clsx(
                    "ml-hf-xs h-3.5 w-3.5 transition-transform",
                    showAllTimeline && "rotate-180",
                  )}
                />
              </>
            )}
          </button>
        ) : (
          <div className="mt-[25px] h-[49.333px] border-t border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)]" />
        )}
      </div>

      <div className="mt-[30px]">
        <div className="flex h-[49.333px] items-start gap-[var(--hf-space-xxl)] border-b border-[var(--hf-main-300)] pb-[20px] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)]">
          <button
            type="button"
            onClick={() => onDetailSectionChange("info")}
            className={clsx(
              "h-[24px] border-b-[2px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-primary)] font-medium transition-colors",
              detailSection === "info"
                ? "border-[var(--hf-main-900)] text-[var(--hf-main-900)] hf-dark-disabled:border-[color:var(--hf-white)] hf-dark-disabled:text-[var(--hf-white)]"
                : "border-transparent text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)]",
            )}
          >
            Личные заметки
          </button>
          <button
            type="button"
            onClick={() => onDetailSectionChange("resume")}
            className={clsx(
              "h-[24px] border-b-[2px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-primary)] font-medium transition-colors",
              detailSection === "resume"
                ? "border-[var(--hf-main-900)] text-[var(--hf-main-900)] hf-dark-disabled:border-[color:var(--hf-white)] hf-dark-disabled:text-[var(--hf-white)]"
                : "border-transparent text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)]",
            )}
          >
            Резюме
          </button>
          <button
            type="button"
            onClick={() => onDetailSectionChange("anketa")}
            className={clsx(
              "relative h-[24px] border-b-[2px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-primary)] font-medium transition-colors",
              detailSection === "anketa"
                ? "border-[var(--hf-main-900)] text-[var(--hf-main-900)] hf-dark-disabled:border-[color:var(--hf-white)] hf-dark-disabled:text-[var(--hf-white)]"
                : "border-transparent text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)]",
            )}
          >
            Анкеты
            {anketaCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-[#e11d48] text-white text-[11px] leading-none align-middle">
                {anketaCount > 9 ? "9+" : anketaCount}
              </span>
            )}
          </button>
        </div>
        {detailSection === "info" && (
          <PersonalNotesTab
            card={card}
            onFile={() => fileInputRef.current?.click()}
            uploading={uploading}
          />
        )}
        {detailSection === "resume" && <ResumeTab card={card} />}
        {detailSection === "anketa" && <AnketaTab card={card} />}
      </div>
    </div>
  );
});

function AnketaTab({ card }: { card: KanbanCard }) {
  const [dispatches, setDispatches] = useState<FormDispatchInfo[]>([]);
  const clearBadge = useFormBadgeStore((s) => s.clear);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await getEntityDispatches(card.id);
        if (alive) setDispatches(rows);
        await markEntityDispatchesSeen(card.id);
        clearBadge(card.id);
      } catch {
        /* пустой/ошибка — покажем пустое состояние */
      }
    })();
    return () => { alive = false; };
  }, [card.id, clearBadge]);
  return <AnketaResponses dispatches={dispatches} />;
}

const PersonalNotesTab = memo(function PersonalNotesTab({
  card,
  onFile,
  uploading,
}: {
  card: KanbanCard;
  onFile: () => void;
  uploading: boolean;
}) {
  const { user: currentUser } = useAuthStore();
  const [note, setNote] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localNotes, setLocalNotes] = useState<NoteShape[]>(() =>
    Array.isArray(card.extra_data?.notes)
      ? ([...(card.extra_data.notes as NoteShape[])] as NoteShape[])
      : [],
  );

  useEffect(() => {
    setNote("");
    setComposerOpen(false);
    setSaving(false);
    setLocalNotes(
      Array.isArray(card.extra_data?.notes)
        ? ([...(card.extra_data.notes as NoteShape[])] as NoteShape[])
        : [],
    );
  }, [card.id, card.extra_data?.notes]);

  const personalNotes = localNotes.filter((item) => !item.stage);

  const handleSavePersonalNote = async () => {
    const text = note.trim();
    if (!text) return;
    setSaving(true);
    try {
      const resp = await addEntityNote(card.id, {
        text,
        stage: null,
        stage_label: "Личная заметка",
      });
      if (!card.extra_data) card.extra_data = {};
      const existingNotes: NoteShape[] = Array.isArray(card.extra_data.notes)
        ? (card.extra_data.notes as NoteShape[])
        : [];
      const nextNotes = [...existingNotes, resp.note as NoteShape];
      card.extra_data.notes = nextNotes;
      setLocalNotes(nextNotes);
      setNote("");
      setComposerOpen(false);
      toast.success("Заметка сохранена");
    } catch (err) {
      console.error("Failed to save personal note:", err);
      toast.error("Не удалось сохранить заметку");
    } finally {
      setSaving(false);
    }
  };

  const renderNoteCard = (item: NoteShape, index: number) => {
    const authorName = item.author_name || currentUser?.name || "Я";
    const initials = authorName.trim()[0]?.toUpperCase() || "Я";
    return (
      <div
        key={item.id || `note-${item.date || index}`}
        className="hf-vacancy-note-card"
      >
        <div className="hf-vacancy-note-avatar">{initials}</div>
        <div className="hf-vacancy-note-body">
          <div className="hf-vacancy-note-meta">
            <span className="hf-vacancy-note-author">{authorName}</span>
            {item.stage && (
              <span className="hf-vacancy-note-stage">
                {item.stage_label || item.stage}
              </span>
            )}
            <span className="hf-vacancy-note-date">
              {item.date ? formatDateFull(item.date) : ""}
            </span>
          </div>
          <div className="hf-vacancy-note-text">{item.text}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="pt-[35px] pb-[28px]">
      <HuntflowComposer
        wrapperClassName="hf-vacancy-personal-composer"
        value={note}
        onChange={setNote}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        placeholder="Написать заметку"
        onSubmit={handleSavePersonalNote}
        onCancel={() => {
          setNote("");
          setComposerOpen(false);
        }}
        saving={saving}
        actions={[
          // F6-fix: убрали «Письмо» из личных заметок — там оно не нужно.
          {
            icon: Paperclip,
            label: "Файл",
            onClick: onFile,
            loading: uploading,
          },
        ]}
      />

      <div className="hf-vacancy-notes-heading">Заметки</div>
      {personalNotes.length > 0 ? (
        <div className="hf-vacancy-notes-list">
          {personalNotes.map(renderNoteCard)}
        </div>
      ) : (
        <div className="hf-vacancy-notes-empty">Нет заметок</div>
      )}

    </div>
  );
});

// ================================================================
// COMMENT CARD — отдельный коммент с edit/delete для автора/админа
// ================================================================

interface NoteShape {
  id?: string;
  text: string;
  date?: string;
  stage?: string;
  stage_label?: string;
  author_id?: number;
  author_name?: string;
  edited_at?: string;
}

const CommentCard = memo(function CommentCard({
  card,
  note,
  currentUserId,
  isAdmin,
}: {
  card: KanbanCard;
  note: NoteShape;
  currentUserId?: number;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const noteStage = note.stage;
  const initials = (note.author_name || "?")[0].toUpperCase();
  // Можно править/удалить если: я автор, либо админ. Legacy-комменты без
  // author_id трогать может только админ.
  const canModify =
    isAdmin ||
    (note.author_id !== undefined &&
      currentUserId !== undefined &&
      Number(note.author_id) === Number(currentUserId));
  // ID для API: новые имеют uuid, у legacy используем "date:<iso>" фолбэк
  // (бэкенд понимает оба).
  const noteId = note.id || (note.date ? `date:${note.date}` : null);

  const save = async () => {
    if (!noteId) {
      toast.error("Не удалось определить коммент");
      return;
    }
    const t = editText.trim();
    if (!t) {
      toast.error("Текст не может быть пустым");
      return;
    }
    setBusy(true);
    try {
      const resp = await updateEntityNote(card.id, noteId, t);
      // Обновляем in-place — заметка та же по reference, поправим её поля
      Object.assign(note, resp.note);
      setEditing(false);
      toast.success("Коммент обновлён");
    } catch (err) {
      console.error("Update note failed:", err);
      toast.error("Не удалось обновить коммент");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!noteId) {
      toast.error("Не удалось определить коммент");
      return;
    }
    setBusy(true);
    try {
      await deleteEntityNote(card.id, noteId);
      // Убираем из массива по ссылке
      if (Array.isArray(card.extra_data?.notes)) {
        const idx = card.extra_data.notes.findIndex(
          (n: NoteShape) => n === note,
        );
        if (idx >= 0) card.extra_data.notes.splice(idx, 1);
      }
      toast.success("Коммент удалён");
    } catch (err) {
      console.error("Delete note failed:", err);
      toast.error("Не удалось удалить коммент");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="hf-vacancy-note-card group">
      <div className="hf-vacancy-note-avatar">{initials}</div>
      <div className="hf-vacancy-note-body">
        <div className="hf-vacancy-note-meta">
          <span className="hf-vacancy-note-author">
            {note.author_name || "Аноним"}
          </span>
          {noteStage && (
            <span className="hf-vacancy-note-stage">
              {note.stage_label || noteStage}
            </span>
          )}
          <span className="hf-vacancy-note-date">
            {note.date ? formatDateFull(note.date) : ""}
            {note.edited_at && " · изм."}
          </span>
          {canModify && !editing && !confirmDelete && (
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => {
                  setEditText(note.text);
                  setEditing(true);
                }}
                className="rounded p-1 text-[var(--hf-main-600)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-ui-text-strong)]"
                title="Редактировать"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded p-1 text-[var(--hf-main-600)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-red-500)]"
                title="Удалить"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              disabled={busy}
              rows={3}
              className="w-full resize-y rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-transparent px-2 py-1.5 text-[length:var(--hf-fs-s)] text-[var(--hf-ui-text-strong)] focus:border-[var(--hf-ui-border-hover)] focus:outline-none disabled:opacity-50 hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:text-[var(--hf-white)]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                className="px-2 py-1 text-[length:var(--hf-fs-2xs)] text-[var(--hf-ui-text-soft)] transition-colors hover:text-[var(--hf-main-900)] disabled:opacity-50 hf-dark-disabled:hover:text-[var(--hf-white)]"
              >
                Отмена
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="inline-flex h-[28px] items-center rounded-[var(--hf-radius-s)] bg-[var(--hf-main-900)] px-[12px] text-[length:var(--hf-fs-3xs)] font-medium text-[var(--hf-white)] transition-colors hover:bg-[var(--hf-main-800)] disabled:cursor-not-allowed disabled:opacity-50 hf-dark-disabled:bg-[var(--hf-white)] hf-dark-disabled:text-[var(--hf-main-900)]"
              >
                {busy ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </div>
        ) : confirmDelete ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[length:var(--hf-fs-2xs)] text-[var(--hf-ui-text-soft)]">
              Удалить этот коммент?
            </span>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="px-2 py-1 text-[length:var(--hf-fs-2xs)] text-[var(--hf-ui-text-soft)] transition-colors hover:text-[var(--hf-main-900)] disabled:opacity-50 hf-dark-disabled:hover:text-[var(--hf-white)]"
              >
                Нет
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-[var(--hf-radius-s)] bg-[var(--hf-red-500)] px-2.5 py-1 text-[length:var(--hf-fs-2xs)] font-medium text-[var(--hf-white)] transition-colors hover:bg-[var(--hf-red-600)] disabled:opacity-50"
              >
                {busy ? "Удаляем…" : "Удалить"}
              </button>
            </div>
          </div>
        ) : (
          <div className="hf-vacancy-note-text">{note.text}</div>
        )}
      </div>
    </div>
  );
});

// ================================================================
// RESUME TAB
// ================================================================

// ---------- Imported (ClickUp) questionnaire ----------
// Кандидаты, импортированные из ClickUp, не имеют сгенерированного резюме.
// Вместо заглушки показываем их анкету: все cf:* поля (вопрос → ответ),
// местоположение и — свёрнуто — исходное описание задачи ClickUp.
// Данные приходят как есть в card.extra_data (бэк ничего не вырезает).
const IMPORT_QUESTIONNAIRE_EXTRA_LABELS: Record<string, string> = {
  location: "Местонахождение",
};

function linkifyText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-[var(--hf-cyan-700)] underline break-all hf-dark-disabled:text-[var(--hf-cyan-400)]"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function normalizeImportedValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return v.map((x) => normalizeImportedValue(x)).filter(Boolean).join(", ");
  return "";
}

// Разбор текста формы (ClickBot Form Submission) из extra_data.description:
// строки вида "Вопрос:" → ответ(ы) до следующего вопроса. Это ЕДИНСТВЕННЫЙ
// достоверный источник пар «вопрос-ответ»: кастомные поля ClickUp (cf:*)
// подписаны неверно из-за переиспользования слотов формы со временем,
// поэтому их пары вопрос↔ответ не совпадают (ответ про «финансовый результат»
// оказывается под колонкой «хачить» и т.п.).
type QaPair = { question: string; answer: string };

function parseFormSubmission(description: string): QaPair[] {
  if (!description) return [];
  const pairs: QaPair[] = [];
  let question: string | null = null;
  let answer: string[] = [];
  const flush = () => {
    if (question != null) {
      pairs.push({
        question: question.replace(/:+\s*$/, "").trim(),
        answer: answer.join("\n").trim(),
      });
    }
  };
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.endsWith(":")) {
      flush();
      question = line;
      answer = [];
    } else if (question != null) {
      answer.push(rawLine);
    }
  }
  flush();
  return pairs.filter((p) => p.question);
}

type MergedFrom = {
  entity_id: number;
  name: string | null;
  merged_at: string;
  merged_by: number;
  merged_by_name: string | null;
  extra_data: Record<string, unknown>;
};

function getImportedQuestionnaire(card: KanbanCard): {
  rows: Array<{ label: string; value: string }>;
  clickupUrl: string | null;
} {
  const ed = card.extra_data as Record<string, unknown> | undefined;
  let rows: Array<{ label: string; value: string }> = [];
  let clickupUrl: string | null = null;
  if (ed) {
    clickupUrl = typeof ed.clickup_url === "string" ? ed.clickup_url : null;

    // 1) Структурированные пары, если бэк их когда-нибудь положит сам.
    const formQa = ed.form_qa;
    if (Array.isArray(formQa) && formQa.length > 0) {
      rows = formQa
        .map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            label: normalizeImportedValue(o.question ?? o.q),
            value: normalizeImportedValue(o.answer ?? o.a),
          };
        })
        .filter((r) => r.label && r.value);
    }

    // 2) Иначе парсим текст формы из description — достоверные пары Q→A.
    if (rows.length === 0) {
      rows = parseFormSubmission(normalizeImportedValue(ed.description))
        .map((p) => ({ label: p.question, value: p.answer }))
        .filter((r) => r.label && r.value);
    }

    // 3) Фолбэк (списки без формы): сырые cf:* поля как есть.
    if (rows.length === 0) {
      for (const [k, raw] of Object.entries(ed)) {
        let label: string | null = null;
        if (k.startsWith("cf:")) label = k.slice(3).trim();
        else if (k in IMPORT_QUESTIONNAIRE_EXTRA_LABELS)
          label = IMPORT_QUESTIONNAIRE_EXTRA_LABELS[k];
        else continue;
        const value = normalizeImportedValue(raw);
        if (!value || value === "-" || value === "–") continue;
        rows.push({ label: label || k, value });
      }
    }
  }
  return { rows, clickupUrl };
}

// HR-рекрутёр кандидата. В ClickUp это assignee ("Инна HR") и/или папка
// воронки ("Sandbox - Инна"). Имена рекрутёров уникальны (подтверждено
// админом), поэтому матчим по имени и показываем полное ФИО. Маппинг ведём
// на всех известных HR, чтобы новые списки подхватывались автоматически.
const RECRUITER_FULL_NAMES: Record<string, string> = {
  анастасия: "Пивень Анастасия",
  инна: "Инна Кравчук",
  регина: "Регина Рахманкулова",
  мария: "Голикова Мария",
  яна: "Дудкина Яна",
  эльвира: "Ефименко Эльвира",
};

function resolveRecruiter(
  extra: Record<string, unknown> | undefined,
): string | null {
  if (!extra) return null;
  const explicit = normalizeImportedValue(extra.recruiter);
  if (explicit) return explicit;
  const haystacks = [extra.assignees, extra.funnel_folder, extra.funnel_list]
    .map((x) => (typeof x === "string" ? x.toLowerCase() : ""))
    .join(" | ");
  for (const [firstName, fullName] of Object.entries(RECRUITER_FULL_NAMES)) {
    if (haystacks.includes(firstName)) return fullName;
  }
  return null;
}

const ImportedQuestionnaire = memo(function ImportedQuestionnaire({
  card,
}: {
  card: KanbanCard;
}) {
  const { rows } = getImportedQuestionnaire(card);
  const recruiter = resolveRecruiter(
    card.extra_data as Record<string, unknown> | undefined,
  );
  if (rows.length === 0 && !recruiter) return null;
  return (
    <div className="p-5 max-w-3xl space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
          Анкета кандидата
        </h3>
        {recruiter && (
          <div className="text-xs text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
            Рекрутёр:{" "}
            <span className="font-medium text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
              {recruiter}
            </span>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="rounded-lg border border-[color:var(--hf-main-200)] overflow-hidden hf-dark-disabled:border-[color:var(--hf-white-alpha-06)]">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-1 border-b border-[color:var(--hf-main-100)] px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(150px,240px)_1fr] sm:gap-4 hf-dark-disabled:border-[color:var(--hf-white-alpha-05)]"
            >
              <div className="text-xs font-medium text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
                {r.label}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                {linkifyText(r.value)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const ResumeTab = memo(function ResumeTab({ card }: { card: KanbanCard }) {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [currentResumeIndex, setCurrentResumeIndex] = useState(0);

  useEffect(() => {
    setLoading(true);
    getEntityFiles(card.id)
      .then((data) => {
        setFiles(data);
        // Generate preview URLs for image files
        data
          .filter((f) => f.mime_type?.startsWith("image/"))
          .forEach(async (f) => {
            try {
              const blob = await downloadEntityFile(card.id, f.id);
              setPreviewUrls((prev) => ({
                ...prev,
                [f.id]: URL.createObjectURL(blob),
              }));
            } catch {
              /* ignore */
            }
          });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [card.id]);

  const resumeFiles = files.filter((f) => f.file_type === "resume");
  const pdfFile = resumeFiles.find((f) => f.mime_type === "application/pdf");
  const imageFiles = resumeFiles.filter((f) =>
    f.mime_type?.startsWith("image/"),
  );
  type ResumeDemoData = {
    title?: string;
    subtitle?: string;
    salary?: string;
    saved_at?: string;
    vacancy_title?: string;
    sections?: Array<{ title: string; lines: string[] }>;
  };
  const resumeDemo = card.extra_data?.resume_demo as ResumeDemoData | undefined;
  const resumeDemos = (
    Array.isArray(card.extra_data?.resume_demos)
      ? (card.extra_data.resume_demos as ResumeDemoData[])
      : resumeDemo
        ? [resumeDemo]
        : []
  ).filter(Boolean);
  const resumeCarouselLength = resumeDemos.length > 0 ? 3 : imageFiles.length || 1;
  const hasPreviousResume = currentResumeIndex > 0;
  const hasNextResume = currentResumeIndex < resumeCarouselLength - 1;

  const mergedFrom = (
    Array.isArray(
      (card.extra_data as Record<string, unknown> | undefined)?.merged_from,
    )
      ? ((card.extra_data as Record<string, unknown>).merged_from as MergedFrom[])
      : []
  );

  useEffect(() => {
    setCurrentResumeIndex(0);
  }, [card.id]);

  useEffect(() => {
    setCurrentResumeIndex((index) =>
      Math.min(index, Math.max(0, resumeCarouselLength - 1)),
    );
  }, [resumeCarouselLength]);

  const handleDownload = async (file: EntityFile) => {
    try {
      const blob = await downloadEntityFile(card.id, file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Освобождаем URL чуть позже, чтобы Safari/Firefox успели запустить загрузку.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("PDF download failed:", err);
      const e = err as Error & { code?: string };
      if (e.code === "file_content_lost") {
        toast.error("Файл утерян на сервере. Перезагрузите резюме кандидата.", {
          duration: 6000,
        });
      } else {
        toast.error("Не удалось скачать файл");
      }
    }
  };

  const handlePrint = () => {
    if (imageFiles.length > 0) {
      const urls = imageFiles.map((f) => previewUrls[f.id]).filter(Boolean);
      if (urls.length === 0) {
        toast.error("Загрузка...");
        return;
      }
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<html><body style="margin:0">${urls.map((u) => `<img src="${u}" style="width:100%;page-break-after:always"/>`).join("")}</body></html>`,
        );
        w.document.close();
        w.onload = () => w.print();
      }
    } else if (pdfFile) {
      handleDownload(pdfFile);
    } else {
      toast("Нет исходного файла для печати");
    }
  };

  const handleShowText = () => {
    toast("Текст резюме уже показан");
  };

  const handleDemoDownload = () => {
    if (pdfFile) {
      handleDownload(pdfFile);
      return;
    }
    toast("Нет исходного файла для скачивания");
  };

  if (loading) {
    return (
      <div className="space-y-[16px] px-[var(--hf-space-xxl)] py-[24px]">
        <HfSkeletonBlock className="h-[18px] w-[180px] rounded-[var(--hf-radius-xs)]" />
        <HfSkeletonBlock className="h-[720px] w-full rounded-[var(--hf-radius-s)]" />
      </div>
    );
  }

  if (resumeFiles.length === 0 && !resumeDemo) {
    const importedQuestionnaire = getImportedQuestionnaire(card);
    const qMainContent = importedQuestionnaire.rows.length > 0 ? (
      <ImportedQuestionnaire card={card} />
    ) : (
      <div className="p-5 max-w-3xl">
        <div className="bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)] rounded-lg p-8 text-center text-[var(--hf-dark-500)] text-sm min-h-[200px] flex flex-col items-center justify-center gap-2">
          <FileText className="w-8 h-8 opacity-30" />
          <p>Резюме ещё не сгенерировано</p>
          <p className="text-xs text-[var(--hf-dark-600)]">
            Резюме создаётся автоматически после добавления кандидата через
            Волшебную кнопку
          </p>
        </div>
      </div>
    );
    if (mergedFrom.length === 0) return qMainContent;
    return (
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">{qMainContent}</div>
        <div className="flex-1 min-w-0 lg:border-l lg:pl-4 border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)] space-y-4 p-5">
          {mergedFrom.map((m, i) => (
            <div key={m.entity_id ?? i}>
              <div className="mb-2 text-xs text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
                Объединено:{" "}
                <span className="font-medium text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                  {m.name || "Кандидат"}
                </span>
                {m.merged_by_name ? ` · ${m.merged_by_name}` : ""}
                {m.merged_at ? ` · ${new Date(m.merged_at).toLocaleString("ru")}` : ""}
              </div>
              <ImportedQuestionnaire
                card={{ ...card, name: m.name || card.name, extra_data: m.extra_data } as KanbanCard}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (resumeDemos.length > 0) {
    const currentDemo = resumeDemos[0];
    const currentResumePage = currentResumeIndex + 1;
    const savedAt = currentDemo.saved_at || card.created_at;
    const vacancyTitle = currentDemo.vacancy_title || card.vacancy_name || card.position || "Вакансия";
    const desiredTitle = currentDemo.title || card.position || "Кандидат";
    const salary = currentDemo.salary || card.salary || "";
    const birthDate = card.extra_data?.birth_date as string | undefined;
    const candidateDetails = [
      card.age,
      birthDate ? `родился(лась) ${birthDate}` : "",
    ].filter(Boolean).join(", ");
    const contactLines = [
      formatPhoneDisplay(card.phone),
      card.email,
      card.telegram_username
        ? `telegram: @${card.telegram_username.replace(/^@/, "")}`
        : "",
    ].filter(Boolean);
    const profileLines = [
      card.city ? `Проживает: ${card.city}` : "",
      card.source ? `Источник: ${card.source}` : "",
    ].filter(Boolean);
    const resumeSections = currentDemo.sections || [];
    const renderResumeSection = (
      section: { title: string; lines: string[] },
      index: number,
      className = index === 0 ? "mt-[40px]" : "mt-[34px]",
    ) => (
      <section key={`${section.title}-${index}`} className={className}>
        <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
          {section.title}
        </h4>
        <div className="mt-[10px] space-y-[4px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
          {(section.lines || []).map((line, lineIndex) => (
            <p key={`${section.title}-${lineIndex}`}>{line}</p>
          ))}
        </div>
      </section>
    );

    const mainContent = (
      <div className="pt-[var(--hf-space-xxl)] max-w-[1180px]">
        <div className="overflow-hidden rounded-[16px] border border-[color:var(--hf-black-alpha-10)] bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-white-alpha-04)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)]">
          <div className="rounded-t-[16px] bg-[var(--hf-main-50)] px-[var(--hf-space-xxl)] pt-[var(--hf-space-xxl)] pb-[27px] hf-dark-disabled:bg-[var(--hf-white-alpha-03)]">
            <p className="mb-[20px] text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
              Сохранено {formatResumeSaved(savedAt)}
            </p>
            <div className="flex items-center gap-[var(--hf-space-s)]">
              <button
                type="button"
                onClick={handleShowText}
                className="hf-resume-action-btn"
              >
                <Type className="hf-resume-action-icon" />
                <span className="hf-resume-action-label">Показать текст</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="hf-resume-action-btn"
              >
                <Printer className="hf-resume-action-icon" />
                <span className="hf-resume-action-label">Распечатать</span>
              </button>
              <button
                type="button"
                onClick={handleDemoDownload}
                className="hf-resume-action-btn"
              >
                <Download className="hf-resume-action-icon" />
                <span className="hf-resume-action-label">Скачать</span>
              </button>
            </div>
          </div>

          <div className="relative bg-transparent px-[100px] pt-[36px] pb-[58px] hf-dark-disabled:bg-[var(--hf-white-alpha-02)]">
            <button
              type="button"
              aria-label="Предыдущее резюме"
              onClick={() =>
                setCurrentResumeIndex((index) => Math.max(0, index - 1))
              }
              disabled={!hasPreviousResume}
              className={clsx(
                "absolute left-[36px] top-[52%] flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-full bg-[var(--hf-white-alpha-90)] shadow-[0_1px_2px_var(--hf-alpha-150)] transition-colors",
                hasPreviousResume
                  ? "text-[var(--hf-ui-resume-arrow)] hover:bg-[var(--hf-white)] hover:text-[var(--hf-main-900)] active:bg-[var(--hf-main-200)]"
                  : "cursor-default text-[var(--hf-ui-resume-arrow-off)] opacity-70",
              )}
            >
              <ChevronLeft className="h-[20px] w-[20px]" />
            </button>
            <button
              type="button"
              aria-label="Следующее резюме"
              onClick={() =>
                setCurrentResumeIndex((index) =>
                  Math.min(resumeCarouselLength - 1, index + 1),
                )
              }
              disabled={!hasNextResume}
              className={clsx(
                "absolute right-[36px] top-[52%] flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-full bg-[var(--hf-white-alpha-90)] shadow-[0_1px_2px_var(--hf-alpha-150)] transition-colors",
                hasNextResume
                  ? "text-[var(--hf-ui-resume-arrow)] hover:bg-[var(--hf-white)] hover:text-[var(--hf-main-900)] active:bg-[var(--hf-main-200)]"
                  : "cursor-default text-[var(--hf-ui-resume-arrow-off)] opacity-70",
              )}
            >
              <ChevronRight className="h-[20px] w-[20px]" />
            </button>
            <button
              type="button"
              aria-label="Развернуть"
              className="absolute right-[52px] top-[42px] rounded-[6px] p-[4px] text-[var(--hf-ui-expand-icon)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-900)] active:bg-[var(--hf-black-alpha-07)]"
            >
              <Maximize2 className="h-[21px] w-[21px]" />
            </button>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentResumePage}
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="mx-auto min-h-[880px] w-full max-w-[980px] bg-[var(--hf-white)] text-[var(--hf-main-900)] shadow-[0_12px_30px_var(--hf-alpha-200)]"
              >
              <div className="flex h-[66px] items-center justify-between bg-[var(--hf-ui-divider)] px-[66px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-ui-resume-text)]">
                <div>
                  <div>Отклик на вакансию: «{vacancyTitle}»</div>
                  <div className="mt-[4px] text-[length:var(--hf-fs-2xs)] text-[var(--hf-ui-resume-muted)]">
                    {formatResumeSaved(savedAt)}
                  </div>
                </div>
                <span className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[var(--hf-red-600)] text-[length:var(--hf-fs-xs)] font-bold text-[var(--hf-white)]">
                  hh
                </span>
              </div>

              <div className="px-[66px] pb-[64px] pt-[34px]">
                {currentResumePage === 1 ? (
                  <>
                <div className="flex gap-[var(--hf-space-xxl)]">
                  {card.photo_url ? (
                    <img
                      src={card.photo_url}
                      alt=""
                      className="mt-[2px] h-[92px] w-[92px] flex-shrink-0 rounded-[2px] object-cover"
                    />
                  ) : (
                    <div className="mt-[2px] flex h-[92px] w-[92px] flex-shrink-0 items-center justify-center rounded-[2px] bg-[var(--hf-ui-avatar-dark)] text-[24px] font-semibold text-[var(--hf-ui-text-avatar-blue)]">
                      {getInitials(card.name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-[40px] font-bold leading-[46px] tracking-normal">
                      {card.name}
                    </h3>
                    <p className="mt-[2px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)] text-[var(--hf-ui-resume-secondary)]">
                      {candidateDetails}
                    </p>
                    <div className="mt-[16px] space-y-[1px] text-[length:var(--hf-fs-s)] leading-[21px]">
                      {contactLines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                    <div className="mt-[18px] space-y-[1px] text-[length:var(--hf-fs-s)] leading-[21px]">
                      {profileLines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                </div>

                <section className="mt-[42px]">
                  <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
                    Желаемая должность и зарплата
                  </h4>
                  <div className="mt-[8px] flex items-start justify-between gap-[var(--hf-space-xxl)]">
                    <div className="text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
                      <p className="text-[20px] font-bold leading-[26px]">
                        {desiredTitle}
                      </p>
                      <p className="mt-[6px]">Специализации:</p>
                      <p className="pl-[30px]">— Тестировщик</p>
                      <p className="mt-[6px]">
                        Тип занятости: полная занятость
                      </p>
                      <p>Формат работы: на месте работодателя</p>
                      <p>
                        Желательное время в пути до работы: не имеет значения
                      </p>
                    </div>
                    <div className="flex-shrink-0 pt-[2px] text-right">
                      {salary ? (
                        <>
                          <span className="text-[24px] font-bold leading-[30px]">
                            {salary}
                          </span>
                          <span className="ml-[4px] text-[length:var(--hf-fs-xxs)] leading-[18px]">
                            на руки
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </section>

                {resumeSections
                  .slice(0, 2)
                  .map((section, index) => renderResumeSection(section, index))}

                  </>
                ) : currentResumePage === 2 ? (
                  <>
                    {resumeSections
                      .slice(2)
                      .map((section, index) =>
                        renderResumeSection(
                          section,
                          index + 2,
                          index === 0 ? "" : "mt-[34px]",
                        ),
                      )}
                  </>
                ) : (
                  <>
                    <section>
                      <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
                        Данные резюме
                      </h4>
                      <div className="mt-[16px] space-y-[8px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
                        <p>{card.name}</p>
                        {card.position ? <p>{card.position}</p> : null}
                        {card.company ? <p>{card.company}</p> : null}
                        {card.source ? <p>Источник: {card.source}</p> : null}
                      </div>
                    </section>
                    <section className="mt-[42px]">
                      <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
                        Резюме обновлено {formatResumeSaved(savedAt)}
                      </h4>
                      <div className="mt-[18px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
                        <p>{card.name} • Резюме обновлено {formatResumeSaved(savedAt)}</p>
                      </div>
                    </section>
                  </>
                )}
                <div className="mt-[36px] text-right text-[length:var(--hf-fs-2xs)] leading-[18px] text-[var(--hf-ui-resume-muted)]">
                  Страница {currentResumePage}/{resumeCarouselLength}
                </div>
              </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
    if (mergedFrom.length === 0) return mainContent;
    return (
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">{mainContent}</div>
        <div className="flex-1 min-w-0 lg:border-l lg:pl-4 border-[color:var(--hf-main-200)] space-y-4">
          {mergedFrom.map((m, i) => (
            <div key={m.entity_id ?? i}>
              <div className="text-xs text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] mb-2">
                Объединено:{" "}
                <span className="font-medium text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                  {m.name || "Кандидат"}
                </span>
                {m.merged_by_name ? ` · ${m.merged_by_name}` : ""}
                {m.merged_at
                  ? ` · ${new Date(m.merged_at).toLocaleString("ru")}`
                  : ""}
              </div>
              <ImportedQuestionnaire
                card={
                  {
                    ...card,
                    name: m.name || card.name,
                    extra_data: m.extra_data,
                  } as KanbanCard
                }
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const fileMainContent = (
    <div className="py-hf-l max-w-[1180px]">
      <p className="text-hf-3xs text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-40)] mb-hf-m">
        Сохранено{" "}
        {formatDateFull(resumeFiles[0]?.created_at || card.created_at)}
      </p>
      <div className="flex items-center gap-hf-s mb-hf-l">
        {card.source_url && (
          <button
            onClick={() => window.open(card.source_url!, "_blank")}
            className="inline-flex items-center gap-1.5 h-[30px] px-hf-m border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)] rounded-hf-s text-hf-3xs text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
          >
            <Eye className="w-3.5 h-3.5" /> Открыть источник
          </button>
        )}
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 h-[30px] px-hf-m border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)] rounded-hf-s text-hf-3xs text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
        >
          <Printer className="w-3.5 h-3.5" /> Распечатать
        </button>
        {pdfFile && (
          <button
            onClick={() => handleDownload(pdfFile)}
            className="inline-flex items-center gap-1.5 h-[30px] px-hf-m border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)] rounded-hf-s text-hf-3xs text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Скачать PDF
          </button>
        )}
      </div>
      {/* Resume preview — show JPEG pages */}
      {imageFiles.length > 0 ? (
        <div className="space-y-3">
          {imageFiles.map((f) => (
            <div
              key={f.id}
              className="bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)] rounded-lg overflow-hidden"
            >
              {previewUrls[f.id] ? (
                <img
                  src={previewUrls[f.id]}
                  alt={f.file_name}
                  className="w-full"
                />
              ) : (
                <div className="p-8 text-center text-[var(--hf-dark-500)] text-sm">
                  Загрузка...
                </div>
              )}
            </div>
          ))}
        </div>
      ) : pdfFile ? (
        <div className="bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)] rounded-lg p-6 text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 text-[var(--hf-dark-400)]" />
          <p className="text-sm text-[var(--hf-dark-300)] mb-2">{pdfFile.file_name}</p>
          <p className="text-xs text-[var(--hf-dark-500)] mb-3">
            {(pdfFile.file_size / 1024).toFixed(0)} КБ
          </p>
          <button
            onClick={() => handleDownload(pdfFile)}
            className="px-4 py-2 bg-[var(--hf-accent-bg-20)] text-[var(--hf-accent)] rounded-lg text-sm hover:bg-[var(--hf-accent-bg-30)] transition-colors"
          >
            <Download className="w-4 h-4 inline mr-1.5" /> Скачать
          </button>
        </div>
      ) : (
        <div className="bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)] rounded-lg p-8 text-center text-[var(--hf-dark-500)] text-sm">
          {resumeFiles.map((f) => (
            <p key={f.id}>{f.file_name}</p>
          ))}
        </div>
      )}
    </div>
  );
  if (mergedFrom.length === 0) return fileMainContent;
  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">{fileMainContent}</div>
      <div className="flex-1 min-w-0 lg:border-l lg:pl-4 border-[color:var(--hf-main-200)] space-y-4">
        {mergedFrom.map((m, i) => (
          <div key={m.entity_id ?? i}>
            <div className="text-xs text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] mb-2">
              Объединено:{" "}
              <span className="font-medium text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                {m.name || "Кандидат"}
              </span>
              {m.merged_by_name ? ` · ${m.merged_by_name}` : ""}
              {m.merged_at
                ? ` · ${new Date(m.merged_at).toLocaleString("ru")}`
                : ""}
            </div>
            <ImportedQuestionnaire
              card={
                {
                  ...card,
                  name: m.name || card.name,
                  extra_data: m.extra_data,
                } as KanbanCard
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
});

// ================================================================
// SUB-COMPONENTS
// ================================================================

// ================================================================
// NEW / EDIT CANDIDATE MODALS
// ================================================================

// ФИО — минимум 2 слова, буквы/дефисы/апострофы, допускаем кириллицу и латиницу
const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\- ]{1,}$/;
// E.164: опциональный +, затем 7–15 цифр (после удаления пробелов/дефисов/скобок)
const PHONE_DIGITS_REGEX = /^\+?\d{7,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Telegram: 5–32 символа, буквы/цифры/подчёркивания, не может начинаться с цифры или подчёркивания
const TELEGRAM_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "");
}

function validateName(value: string): string | null {
  const v = value.trim();
  if (!v) return "Обязательное поле";
  if (v.length < 2) return "Минимум 2 символа";
  if (v.length > 200) return "Максимум 200 символов";
  if (!NAME_REGEX.test(v)) return "Только буквы, пробелы, дефис и апостроф";
  return null;
}

function validatePhone(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const normalized = normalizePhone(v);
  if (!PHONE_DIGITS_REGEX.test(normalized)) {
    return "Формат: +7 999 123 4567 (7–15 цифр)";
  }
  return null;
}

function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 254) return "Слишком длинный email";
  if (!EMAIL_REGEX.test(v)) return "Некорректный email";
  return null;
}

function validateTelegram(value: string): string | null {
  const v = value.trim().replace(/^@/, "");
  if (!v) return null;
  if (!TELEGRAM_REGEX.test(v)) {
    return "5–32 символа, буквы/цифры/_, начинается с буквы";
  }
  return null;
}

function validateFreeText(value: string, maxLen = 200): string | null {
  const v = value.trim();
  if (v.length > maxLen) return `Максимум ${maxLen} символов`;
  return null;
}

const CANDIDATE_SOURCE_OPTIONS = [
  "Агентство",
  "Зарплата.ру",
  "Отклик с Хабр Карьеры",
  "Отклик с Avito",
  "Отклик с Farpost.ru",
  "Отклик с HeadHunter",
  "Отклик с Rabota.by",
  "Отклик с Rabota.ru",
  "Отклик с SuperJob",
  "Рекомендация",
  "Хабр Карьера",
  "AmazingHiring",
  "Artstation",
  "Avito",
  "Другой источник",
];

export function NewCandidateModal({
  onClose,
  onSaved,
  onOpenParser,
}: {
  onClose: () => void;
  onSaved: () => void;
  onOpenParser: () => void;
}) {
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [position, setPosition] = useState("");
  const [company, setCompany] = useState("");
  const [salary, setSalary] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [source, setSource] = useState("Другой источник");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fullName = [lastName, firstName, middleName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  const errors = {
    name: validateName(fullName),
    phone: validatePhone(phone),
    email: validateEmail(email),
    telegram: validateTelegram(telegram),
    position: validateFreeText(position, 200),
    company: validateFreeText(company, 200),
  };
  const hasErrors = Object.values(errors).some((e) => e !== null);
  const filteredSources = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase();
    if (!needle) return CANDIDATE_SOURCE_OPTIONS;
    return CANDIDATE_SOURCE_OPTIONS.filter((option) =>
      option.toLowerCase().includes(needle),
    );
  }, [sourceSearch]);

  const markTouched = (_field: string) => undefined;

  const handleSave = async () => {
    setTouched({
      name: true,
      phone: true,
      email: true,
      telegram: true,
      position: true,
      company: true,
    });
    if (hasErrors) {
      toast.error("Исправьте ошибки в форме");
      return;
    }

    setSaving(true);
    try {
      const normalizedPhone = phone.trim() ? normalizePhone(phone) : undefined;
      const cleanTelegram = telegram.trim().replace(/^@/, "");
      await createEntity({
        type: "candidate",
        name: fullName,
        status: "new",
        phone: normalizedPhone,
        email: email.trim() || undefined,
        telegram_usernames: cleanTelegram ? [cleanTelegram] : undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
        extra_data: {
          birth_date: birthDate.trim() || undefined,
          resume_text: resumeText.trim() || undefined,
          source: source.trim() || undefined,
        },
      });
      toast.success("Кандидат добавлен");
      onSaved();
    } catch {
      toast.error("Ошибка создания кандидата");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="hf-candidate-modal-overlay font-hf-body"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-candidate-modal-title"
    >
      <motion.div
        initial={{ scale: 0.985, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.985, opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="hf-candidate-modal"
      >
        <div className="hf-candidate-modal-header">
          <div className="hf-candidate-header-content">
            <div className="hf-candidate-avatar">
              <span className="hf-candidate-avatar-head" />
              <span className="hf-candidate-avatar-body" />
            </div>
            <div className="hf-candidate-title-stack">
              <h3 id="new-candidate-modal-title" className="hf-candidate-title">
                Новый кандидат
              </h3>
              <div className="hf-candidate-import-row">
                <button
                  type="button"
                  className="hf-candidate-import-btn"
                  onClick={() =>
                    toast("Импорт из почты пока недоступен в HR-bot")
                  }
                >
                  <Mail className="hf-candidate-import-icon" />
                  Импорт из почты
                </button>
                <div className="hf-candidate-upload-wrap">
                  <button
                    type="button"
                    className="hf-candidate-import-btn"
                    onClick={() => {
                      setSourceMenuOpen(false);
                      setUploadMenuOpen((value) => !value);
                    }}
                    aria-expanded={uploadMenuOpen}
                  >
                    <Upload className="hf-candidate-import-icon" />
                    Загрузка из файла
                    <HuntflowChevronDown24Icon className="hf-candidate-import-chevron" />
                  </button>
                  {uploadMenuOpen && (
                    <div className="hf-candidate-upload-menu">
                      <button
                        type="button"
                        className="hf-candidate-upload-option"
                        onClick={onOpenParser}
                      >
                        Из pdf, docx, rtf и др.
                      </button>
                      <button
                        type="button"
                        className="hf-candidate-upload-option"
                        onClick={() =>
                          toast("Импорт кандидатов из xlsx пока недоступен в HR-bot")
                        }
                      >
                        Из xlsx
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="hf-candidate-close-btn"
            aria-label="Закрыть"
          >
            <HuntflowClose28Icon className="hf-candidate-close-icon" />
          </button>
        </div>

        <div className="hf-candidate-modal-body">
          <div className="hf-candidate-left-col">
            <CandidateField
              label="Фамилия"
              value={lastName}
              onChange={setLastName}
              required
              error={touched.name ? errors.name : null}
              onBlur={() => markTouched("name")}
              autoFocus
            />
            <CandidateField
              label="Имя"
              value={firstName}
              onChange={setFirstName}
              error={touched.name ? errors.name : null}
              onBlur={() => markTouched("name")}
            />
            <CandidateField
              label="Отчество"
              value={middleName}
              onChange={setMiddleName}
              error={touched.name ? errors.name : null}
              onBlur={() => markTouched("name")}
            />
            <CandidateField
              label="Телефон"
              value={phone}
              onChange={setPhone}
              type="tel"
              error={touched.phone ? errors.phone : null}
              onBlur={() => markTouched("phone")}
            />
            <CandidateField
              label="Электронная почта"
              value={email}
              onChange={setEmail}
              type="email"
              error={touched.email ? errors.email : null}
              onBlur={() => markTouched("email")}
            />
            <CandidateField
              label="Telegram"
              value={telegram}
              onChange={setTelegram}
              error={touched.telegram ? errors.telegram : null}
              onBlur={() => markTouched("telegram")}
            />
            <CandidateField
              label="Кем и где работает"
              value={position}
              onChange={setPosition}
              placeholder="Должность"
              error={touched.position ? errors.position : null}
              onBlur={() => markTouched("position")}
              compactGap
            />
            <CandidateField
              label="Компания"
              value={company}
              onChange={setCompany}
              placeholder="Компания"
              error={touched.company ? errors.company : null}
              hideLabel
            />
            <CandidateField
              label="Зарплатные ожидания"
              value={salary}
              onChange={setSalary}
            />
            <CandidateField
              label="Дата рождения"
              value={birthDate}
              onChange={setBirthDate}
            />
          </div>

          <div className="hf-candidate-right-col">
            <div className="hf-candidate-source-block">
              <label className="hf-candidate-label">Источник</label>
              <button
                type="button"
                className="hf-candidate-select-btn"
                onClick={() => {
                  setUploadMenuOpen(false);
                  setSourceMenuOpen((value) => !value);
                }}
                aria-expanded={sourceMenuOpen}
              >
                <span
                  className={clsx(
                    "truncate",
                    !source && "hf-candidate-select-placeholder",
                  )}
                >
                  {source || "Источник"}
                </span>
                <HuntflowChevronDown24Icon className="hf-candidate-select-chevron" />
              </button>
              {sourceMenuOpen && (
                <div className="hf-candidate-source-menu">
                  <div className="hf-candidate-source-search">
                    <Search className="hf-candidate-source-search-icon" />
                    <input
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                      className="hf-candidate-source-search-input"
                      placeholder="Поиск..."
                      autoFocus
                    />
                  </div>
                  <div className="hf-candidate-source-list">
                    {filteredSources.length > 0 ? (
                      filteredSources.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="hf-candidate-source-option"
                          onClick={() => {
                            setSource(option);
                            setSourceSearch("");
                            setSourceMenuOpen(false);
                          }}
                        >
                          {option}
                        </button>
                      ))
                    ) : (
                      <div className="hf-candidate-source-empty">Ничего не найдено</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="hf-candidate-label">Текст резюме</label>
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                className="hf-candidate-resume-textarea"
              />
            </div>
          </div>
        </div>

        <div className="hf-candidate-modal-footer">
          <button
            onClick={handleSave}
            disabled={saving}
            className="hf-candidate-primary-btn"
          >
            {saving ? (
              <HfLoadingSpinner
                size="var(--hf-loading-spinner-size-sm)"
                stroke="var(--hf-loading-spinner-border)"
              />
            ) : "Сохранить"}
          </button>
          <button onClick={onClose} className="hf-candidate-secondary-btn">
            Отмена
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CandidateField({
  label,
  value,
  onChange,
  placeholder,
  type,
  required,
  error,
  onBlur,
  hideLabel,
  compactGap,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  error?: string | null;
  onBlur?: () => void;
  hideLabel?: boolean;
  compactGap?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className={clsx("hf-candidate-field", compactGap && "hf-candidate-field-compact")}>
      {!hideLabel && (
        <label className="hf-candidate-label">
          {label}
          {required && <span className="sr-only"> *</span>}
        </label>
      )}
      <input
        type={type || "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={!!error}
        className={clsx("hf-candidate-input", error && "hf-candidate-input-error")}
      />
      {error && <p className="hf-candidate-error">{error}</p>}
    </div>
  );
}

type EditResumeDemoData = {
  saved_at?: string;
  vacancy_title?: string;
  sections?: Array<{ title: string; lines?: string[] }>;
};

function buildEditResumeText(
  card: KanbanCard,
  resumeDemo?: EditResumeDemoData,
): string {
  if (!resumeDemo) return "";

  return [
    `Отклик на вакансию: «${resumeDemo.vacancy_title || card.vacancy_name || card.position || "Вакансия"}»`,
    resumeDemo.saved_at ? formatResumeSaved(resumeDemo.saved_at) : "",
    card.name,
    card.position,
    card.company,
    formatPhoneForEdit(card.phone),
    card.email,
    card.telegram_username ? `telegram: @${card.telegram_username.replace(/^@/, "")}` : "",
    card.city ? `Проживает: ${card.city}` : "",
    card.salary ? `Зарплатные ожидания: ${card.salary}` : "",
    ...(resumeDemo.sections || []).map(
      (section) => `${section.title}\n${(section.lines || []).join("\n")}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function EditCandidateModal({
  card,
  onClose,
  onSaved,
  onDeleted,
}: {
  card: KanbanCard;
  onClose: () => void;
  onSaved: (updated: Partial<KanbanCard>) => void;
  onDeleted: () => void;
}) {
  const initialNameParts = card.name.trim().split(/\s+/);
  const [lastName, setLastName] = useState(initialNameParts[0] || "");
  const [firstName, setFirstName] = useState(initialNameParts[1] || "");
  const [middleName, setMiddleName] = useState(
    initialNameParts.slice(2).join(" "),
  );
  const [phone, setPhone] = useState(formatPhoneForEdit(card.phone));
  const [email, setEmail] = useState(card.email || "");
  const [telegram, setTelegram] = useState(card.telegram_username || "");
  const [position, setPosition] = useState(card.position || "");
  const [company, setCompany] = useState(card.company || "");
  const [salary, setSalary] = useState(card.salary || "");
  const [birthDate, setBirthDate] = useState(
    (card.extra_data?.birth_date as string | undefined) || "",
  );
  const resumeDemo = card.extra_data?.resume_demo as
    | EditResumeDemoData
    | undefined;
  const [resumeText, setResumeText] = useState(
    buildEditResumeText(card, resumeDemo),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fullName = [lastName, firstName, middleName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  const errors = {
    name: validateName(fullName),
    phone: validatePhone(phone),
    email: validateEmail(email),
    telegram: validateTelegram(telegram),
    position: validateFreeText(position, 200),
    company: validateFreeText(company, 200),
  };
  const hasErrors = Object.values(errors).some((e) => e !== null);

  const markTouched = (field: string) =>
    setTouched((t) => ({ ...t, [field]: true }));

  const handleSave = async () => {
    setTouched({
      name: true,
      phone: true,
      email: true,
      telegram: true,
      position: true,
      company: true,
    });
    if (hasErrors) {
      toast.error("Исправьте ошибки в форме");
      return;
    }
    setSaving(true);
    try {
      const normalizedPhone = phone.trim() ? normalizePhone(phone) : undefined;
      const cleanTelegram = telegram.trim().replace(/^@/, "");
      await updateEntity(card.id, {
        name: fullName,
        phone: normalizedPhone,
        email: email.trim() || undefined,
        telegram_usernames: cleanTelegram ? [cleanTelegram] : undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
      });
      toast.success("Кандидат обновлён");
      onSaved({
        name: fullName,
        phone: normalizedPhone,
        email: email.trim() || undefined,
        telegram_username: cleanTelegram || undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
      });
    } catch {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!window.confirm(`Удалить кандидата «${card.name || "без имени"}»? Действие необратимо.`)) {
      return;
    }
    setDeleting(true);
    try {
      await deleteEntity(card.id);
      toast.success("Кандидат удалён");
      onDeleted();
    } catch {
      toast.error("Ошибка при удалении");
    } finally {
      setDeleting(false);
    }
  };

  const resumeFileName =
    (card.extra_data?.resume_file_name as string | undefined) ||
    `${card.name}.pdf`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[var(--hf-edit-overlay-z)] flex items-start justify-center overflow-auto bg-[var(--hf-black-alpha-30)] pt-[var(--hf-edit-overlay-top)] font-hf-body"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.985, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.985, opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="mb-[var(--hf-space-xxl)] flex h-[var(--hf-edit-modal-h)] w-[var(--hf-edit-modal-w)] max-w-[var(--hf-edit-modal-max-w)] flex-col overflow-hidden rounded-[var(--hf-edit-modal-radius)] bg-transparent text-[length:var(--hf-fs-s)] leading-[var(--hf-edit-modal-lh)] text-[var(--hf-main-900)] shadow-none hf-dark-disabled:text-[var(--hf-white)]"
      >
        <div className="relative flex h-[var(--hf-edit-header-h)] flex-shrink-0 items-start justify-between rounded-t-[var(--hf-edit-modal-radius)] border-b-[length:var(--hf-edit-header-border)] border-[var(--hf-ui-divider)] bg-[var(--hf-white)] px-[var(--hf-space-xxl)] py-[var(--hf-space-xl)] pr-[var(--hf-edit-header-pr)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-bg-dark)]">
          <div className="flex min-w-0 items-center gap-[var(--hf-space-l)]">
            <div className="h-[var(--hf-edit-avatar)] w-[var(--hf-edit-avatar)] flex-shrink-0 overflow-hidden rounded-full bg-[var(--hf-bg-muted)]">
              {card.photo_url ? (
                <img
                  src={card.photo_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[length:var(--hf-fs-xxs)] font-medium text-[var(--hf-main-600)]">
                  {getInitials(card.name)}
                </div>
              )}
            </div>
            <h3 className="truncate text-[length:var(--hf-edit-title-fs)] font-medium leading-[var(--hf-edit-title-lh)] tracking-normal text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
              {card.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="absolute right-[var(--hf-edit-close-right)] top-[var(--hf-edit-close-top)] inline-flex h-[var(--hf-edit-close-h)] w-[var(--hf-edit-close-w)] flex-shrink-0 items-center justify-center rounded-[var(--hf-radius-s)] text-[var(--hf-ui-close)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-70)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
            aria-label="Закрыть"
          >
            <HuntflowClose28Icon className="h-[var(--hf-edit-close-icon)] w-[var(--hf-edit-close-icon)]" />
          </button>
        </div>

        <div className="flex h-[var(--hf-edit-body-h)] flex-shrink-0 overflow-hidden bg-[var(--hf-white)] px-[var(--hf-space-xxl)] hf-dark-disabled:bg-[var(--hf-bg-dark)]">
          <div className="w-[var(--hf-edit-left-w)] flex-shrink-0 overflow-visible py-[var(--hf-edit-column-py)] pr-[var(--hf-space-xxl)]">
            <EditField
              label="Фамилия"
              value={lastName}
              onChange={setLastName}
              required
              error={touched.name ? errors.name : null}
              onBlur={() => markTouched("name")}
              autoFocus
            />
            <EditField
              label="Имя"
              value={firstName}
              onChange={setFirstName}
              error={touched.name ? errors.name : null}
              onBlur={() => markTouched("name")}
            />
            <EditField
              label="Отчество"
              value={middleName}
              onChange={setMiddleName}
              error={touched.name ? errors.name : null}
              onBlur={() => markTouched("name")}
            />
            <EditField
              label="Телефон"
              value={phone}
              onChange={setPhone}
              placeholder="+7 999 123 4567"
              type="tel"
              error={touched.phone ? errors.phone : null}
              onBlur={() => markTouched("phone")}
            />
            <EditField
              label="Электронная почта"
              value={email}
              onChange={setEmail}
              placeholder="email@example.com"
              type="email"
              error={touched.email ? errors.email : null}
              onBlur={() => markTouched("email")}
            />
            <EditField
              label="Telegram"
              value={telegram}
              onChange={setTelegram}
              placeholder="@username"
              error={touched.telegram ? errors.telegram : null}
              onBlur={() => markTouched("telegram")}
            />
            <EditField
              label="Кем и где работает"
              value={position}
              onChange={setPosition}
              placeholder="QA engineer"
              error={touched.position ? errors.position : null}
              onBlur={() => markTouched("position")}
              compactGap
            />
            <EditField
              label="Компания"
              value={company}
              onChange={setCompany}
              placeholder="ООО"
              error={touched.company ? errors.company : null}
              onBlur={() => markTouched("company")}
              hideLabel
            />
            <EditField
              label="Зарплатные ожидания"
              value={salary}
              onChange={setSalary}
              placeholder=""
            />
            <EditField
              label="Дата рождения"
              value={birthDate}
              onChange={setBirthDate}
              placeholder="17.12.1995"
              clearable
            />
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--hf-ui-divider)] py-[var(--hf-edit-column-py)] pl-[var(--hf-space-xxl)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
            <div className="mb-[var(--hf-space-l)]">
              <label className="mb-[var(--hf-edit-label-mb)] block text-[length:var(--hf-edit-label-fs)] font-semibold leading-[var(--hf-edit-label-lh)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                Источник
              </label>
              <button
                type="button"
                className="flex h-[var(--hf-edit-field-h)] w-full items-center justify-between rounded-[var(--hf-edit-field-radius)] border border-[color:var(--hf-black-alpha-16)] bg-[var(--hf-white)] px-[var(--hf-edit-field-px)] pr-[var(--hf-space-s)] text-left text-[length:var(--hf-edit-field-fs)] font-normal leading-[var(--hf-edit-field-lh)] text-[var(--hf-main-900)] transition-colors hover:border-[var(--hf-ui-border-strong)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-transparent hf-dark-disabled:text-[var(--hf-white)]"
              >
                <span className="truncate">
                  {card.source || "Другой источник"}
                </span>
                <HuntflowChevronDown24Icon className="h-[var(--hf-edit-source-icon)] w-[var(--hf-edit-source-icon)] flex-shrink-0 text-[var(--hf-main-900)]" />
              </button>
            </div>
            <div>
              <label className="mb-[var(--hf-edit-label-mb)] block text-[length:var(--hf-edit-label-fs)] font-semibold leading-[var(--hf-edit-label-lh)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                Текст резюме
              </label>
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                className="h-[var(--hf-edit-resume-h)] w-full resize-none rounded-[var(--hf-edit-field-radius)] border border-[color:var(--hf-black-alpha-16)] bg-transparent p-[var(--hf-space-l)] text-[length:var(--hf-edit-field-fs)] font-normal leading-[var(--hf-edit-field-lh)] tracking-normal text-[var(--hf-main-900)] outline-none placeholder:text-[var(--hf-main-500)] focus:border-[var(--hf-cyan-500)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:text-[var(--hf-white)]"
                placeholder="Текст резюме"
              />
              <div className="mt-[var(--hf-edit-file-mt)] flex">
                <button
                  type="button"
                  className="inline-flex h-[var(--hf-edit-file-h)] max-w-full items-center gap-[var(--hf-space-s)] rounded-full border border-[color:var(--hf-black-alpha-08)] bg-[var(--hf-white)] px-[var(--hf-space-s)] py-[var(--hf-space-xxs)] text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] shadow-[0_1px_1px_var(--hf-alpha-100)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-transparent hf-dark-disabled:text-[var(--hf-white)]"
                >
                  <HuntflowClip18Icon className="h-[var(--hf-edit-file-icon)] w-[var(--hf-edit-file-icon)] flex-shrink-0" />
                  <span className="min-w-[var(--hf-edit-file-name-min-w)] truncate font-medium">
                    {resumeFileName}
                  </span>
                  <HuntflowXClose16Icon className="h-[var(--hf-edit-file-close-icon)] w-[var(--hf-edit-file-close-icon)] flex-shrink-0 text-[var(--hf-ui-muted-2)]" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex h-[var(--hf-edit-footer-h)] flex-shrink-0 items-center justify-between rounded-b-[var(--hf-edit-modal-radius)] border-t-[length:var(--hf-edit-footer-border)] border-[var(--hf-ui-divider)] bg-[var(--hf-white)] px-[var(--hf-space-xxl)] py-[var(--hf-edit-footer-py)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-bg-dark)]">
          <div className="flex items-center gap-[var(--hf-space-s)]">
            <button
              onClick={handleSave}
              disabled={saving || hasErrors}
              className="inline-flex h-[var(--hf-edit-btn-h)] min-w-[var(--hf-edit-save-min-w)] items-center justify-center rounded-[var(--hf-edit-btn-radius)] border-[length:var(--hf-edit-btn-border)] border-[var(--hf-main-900)] bg-[var(--hf-main-900)] px-[var(--hf-edit-btn-px)] text-[length:var(--hf-edit-btn-fs)] font-semibold leading-[var(--hf-edit-btn-lh)] text-[var(--hf-white)] transition-colors duration-[100ms] hover:bg-[var(--hf-main-800)] disabled:cursor-not-allowed disabled:border-[var(--hf-btn-disabled-bg)] disabled:bg-[var(--hf-btn-disabled-bg)] disabled:text-[var(--hf-main-600)] disabled:opacity-100 disabled:hover:bg-[var(--hf-btn-disabled-bg)] hf-dark-disabled:bg-[var(--hf-white)] hf-dark-disabled:text-[var(--hf-main-900)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-90)] hf-dark-disabled:disabled:bg-[var(--hf-white-alpha-08)] hf-dark-disabled:disabled:text-[color:var(--hf-white-alpha-35)]"
            >
              {saving ? (
                <HfLoadingSpinner
                  size="var(--hf-loading-spinner-size-sm)"
                  stroke="var(--hf-loading-spinner-border)"
                />
              ) : "Сохранить"}
            </button>
            <button
              onClick={onClose}
              className="inline-flex h-[var(--hf-edit-btn-h)] min-w-[var(--hf-edit-cancel-min-w)] items-center rounded-[var(--hf-edit-btn-radius)] border border-[var(--hf-ui-divider)] bg-[var(--hf-white)] px-[var(--hf-edit-btn-px)] text-[length:var(--hf-edit-btn-fs)] font-medium leading-[var(--hf-edit-btn-lh)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-transparent hf-dark-disabled:text-[color:var(--hf-white-alpha-80)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
            >
              Отмена
            </button>
          </div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || saving}
            className="inline-flex h-[var(--hf-edit-btn-h)] min-w-[var(--hf-edit-delete-min-w)] items-center rounded-[var(--hf-edit-btn-radius)] px-[var(--hf-edit-btn-px)] text-[length:var(--hf-edit-btn-fs)] font-medium leading-[var(--hf-edit-btn-lh)] text-[var(--hf-ui-delete)] transition-colors hover:text-[var(--hf-red-500)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? "Удаление…" : "Удалить"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  type,
  required,
  error,
  onBlur,
  className,
  hideLabel,
  clearable,
  compactGap,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  error?: string | null;
  onBlur?: () => void;
  className?: string;
  hideLabel?: boolean;
  clearable?: boolean;
  compactGap?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className={clsx(compactGap ? "mb-[var(--hf-space-s)]" : "mb-[var(--hf-space-l)]", className)}>
      {!hideLabel && (
        <label className="mb-[var(--hf-edit-label-mb)] block text-[length:var(--hf-edit-label-fs)] font-medium leading-[var(--hf-edit-label-lh)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
          {label}
          {required && <span className="sr-only"> *</span>}
        </label>
      )}
      <div className="relative">
        <input
          type={type || "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          className={clsx(
            "h-[var(--hf-edit-field-h)] w-full rounded-[var(--hf-edit-field-radius)] border bg-[var(--hf-white)] px-[var(--hf-edit-field-px)] pb-[var(--hf-border-xs)] text-[length:var(--hf-edit-field-fs)] font-normal leading-[var(--hf-edit-field-lh)] tracking-normal text-[var(--hf-main-900)] [align-items:center] placeholder:text-[var(--hf-main-500)] focus:outline-none hf-dark-disabled:bg-transparent hf-dark-disabled:text-[var(--hf-white)]",
            clearable && value ? "pr-[var(--hf-edit-field-pr-clear)]" : "",
            error
              ? "border-[color:var(--hf-red-500)] focus:border-[var(--hf-red-500)]"
              : "border-[color:var(--hf-black-alpha-16)] focus:border-[var(--hf-cyan-500)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:focus:border-[var(--hf-cyan-500)]",
          )}
        />
        {clearable && value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-[var(--hf-edit-clear-offset)] top-[var(--hf-edit-clear-offset)] inline-flex h-[var(--hf-edit-clear-h)] w-[var(--hf-edit-clear-w)] items-center justify-center bg-transparent text-[var(--hf-ui-muted-1)]"
            aria-label={`Очистить ${label}`}
          >
            <HuntflowRemoveIcon className="h-[var(--hf-edit-clear-icon)] w-[var(--hf-edit-clear-icon)] text-[var(--hf-ui-muted-7)]" />
          </button>
        )}
      </div>
      {error && (
        <p className="mt-[var(--hf-space-xs)] text-[length:var(--hf-edit-error-fs)] leading-[var(--hf-edit-error-lh)] text-[var(--hf-red-500)]">
          {error}
        </p>
      )}
    </div>
  );
}

// ================================================================
// LIST SETTINGS MODAL (Huntflow user settings)
// ================================================================

// F7-fix: настройки списка кандидатов теперь СОХРАНЯЮТСЯ (localStorage) и
// применяются к карточкам. В компактном списке реально выводятся только
// «должность» (lastPosition) и «компания» (lastCompany) — их тумблеры влияют
// на отображение. Остальные поля и scope в этом списке пока не выводятся.
type CandidateListFields = {
  name: boolean;
  desiredPosition: boolean;
  desiredSalary: boolean;
  age: boolean;
  experience: boolean;
  lastPosition: boolean;
  lastCompany: boolean;
  source: boolean;
  vacanciesCount: boolean;
  tags: boolean;
};
type CandidateListSettings = {
  scope: "mine" | "all";
  fields: CandidateListFields;
};
// v2: дефолт scope = "all" — все рекрутёры видят ВСЕХ кандидатов орги (требование).
// Ключ обновлён на .v2, чтобы у существующих юзеров слетел старый сохранённый
// "mine" (иначе он продолжал бы прятать чужих кандидатов из localStorage).
const CANDIDATE_LIST_SETTINGS_KEY = "hf.candidateListSettings.v2";
const LEGACY_CANDIDATE_LIST_SETTINGS_KEY = "hf.candidateListSettings";
const DEFAULT_CANDIDATE_LIST_SETTINGS: CandidateListSettings = {
  scope: "all",
  fields: {
    name: true,
    desiredPosition: false,
    desiredSalary: false,
    age: false,
    experience: false,
    lastPosition: true,
    lastCompany: true,
    source: false,
    vacanciesCount: false,
    tags: false,
  },
};
function loadCandidateListSettings(): CandidateListSettings {
  try {
    const raw = localStorage.getItem(CANDIDATE_LIST_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        // в v2 дефолт — "all"; "mine" остаётся, только если юзер ЯВНО его выбрал
        scope: parsed?.scope === "mine" ? "mine" : "all",
        fields: { ...DEFAULT_CANDIDATE_LIST_SETTINGS.fields, ...(parsed?.fields || {}) },
      };
    }
    // Миграция со старого ключа: переносим настройки полей, а scope сбрасываем
    // на новый дефолт "all" (старый сохранённый "mine" больше не прячет чужих).
    const legacy = localStorage.getItem(LEGACY_CANDIDATE_LIST_SETTINGS_KEY);
    if (legacy) {
      const old = JSON.parse(legacy);
      return {
        scope: "all",
        fields: { ...DEFAULT_CANDIDATE_LIST_SETTINGS.fields, ...(old?.fields || {}) },
      };
    }
    return DEFAULT_CANDIDATE_LIST_SETTINGS;
  } catch {
    return DEFAULT_CANDIDATE_LIST_SETTINGS;
  }
}
function saveCandidateListSettings(settings: CandidateListSettings) {
  try {
    localStorage.setItem(CANDIDATE_LIST_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function ListSettingsModal({
  onClose,
  initial,
  onApply,
}: {
  onClose: () => void;
  initial: CandidateListSettings;
  onApply: (settings: CandidateListSettings) => void;
}) {
  const [scope, setScope] = useState<"mine" | "all">(initial.scope);
  const [fields, setFields] = useState<CandidateListFields>(initial.fields);

  const setField = (key: keyof CandidateListFields, checked: boolean) => {
    if (key === "name") return;
    setFields((prev) => ({ ...prev, [key]: checked }));
  };

  const handleSave = () => {
    const next: CandidateListSettings = { scope, fields };
    saveCandidateListSettings(next);
    onApply(next);
    toast.success("Настройки списка сохранены");
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[var(--hf-list-settings-z)] flex items-start justify-center bg-transparent pt-[var(--hf-list-settings-top)]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.985 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-[var(--hf-list-settings-w)] overflow-hidden rounded-[var(--hf-list-settings-radius)] bg-[var(--hf-white)] text-[var(--hf-main-900)] leading-[var(--hf-list-settings-lh)] hf-dark-disabled:bg-[var(--hf-bg-dark)] hf-dark-disabled:text-[var(--hf-white)]"
      >
        <div className="flex h-[var(--hf-list-settings-header-h)] items-center justify-between border-b border-[var(--hf-ui-divider)] px-[var(--hf-list-settings-x)] pr-[var(--hf-list-settings-x)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
          <h3 className="text-[length:var(--hf-list-settings-title-fs)] font-medium leading-[var(--hf-list-settings-title-lh)] tracking-normal">
            Настройка списков кандидатов
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--hf-list-settings-close)] w-[var(--hf-list-settings-close)] items-center justify-center rounded-[var(--hf-list-settings-close-radius)] text-[var(--hf-main-600)] transition-colors hover:bg-[var(--hf-bg-panel)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-10)] hf-dark-disabled:hover:text-[var(--hf-white)]"
            aria-label="Закрыть"
          >
            <X className="h-[var(--hf-list-settings-close-icon)] w-[var(--hf-list-settings-close-icon)]" />
          </button>
        </div>

        <div className="px-[var(--hf-list-settings-x)] py-[var(--hf-space-xxl)] leading-[var(--hf-list-settings-lh)]">
          <section className="pb-[var(--hf-space-xxl)]">
            <h4 className="mb-[var(--hf-list-settings-heading-mb)] text-[length:var(--hf-list-settings-heading-fs)] font-normal leading-[var(--hf-list-settings-heading-lh)] tracking-normal">
              Показывать всех кандидатов на этапах
            </h4>
            <ListSettingRadio
              label="Только по моим вакансиям"
              checked={scope === "mine"}
              onChange={() => setScope("mine")}
            />
            <ListSettingRadio
              label="По всем открытым вакансиям"
              checked={scope === "all"}
              onChange={() => setScope("all")}
              className="mt-[var(--hf-space-xs)]"
            />
          </section>

          <section className="border-t border-[var(--hf-ui-divider)] pt-[var(--hf-space-xxl)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
            <h4 className="mb-[var(--hf-list-settings-heading-mb-sm)] text-[length:var(--hf-list-settings-heading-fs)] font-normal leading-[var(--hf-list-settings-heading-lh)] tracking-normal">
              Отображать в списках кандидатов
            </h4>
            <ListSettingCheckbox
              label="ФИО кандидата"
              checked={fields.name}
              disabled
              onChange={(value) => setField("name", value)}
            />
            <ListSettingCheckbox
              label="Желаемая должность"
              checked={fields.desiredPosition}
              onChange={(value) => setField("desiredPosition", value)}
            />
            <ListSettingCheckbox
              label="Желаемая зарплата"
              checked={fields.desiredSalary}
              onChange={(value) => setField("desiredSalary", value)}
            />
            <ListSettingCheckbox
              label="Возраст и дата рождения"
              checked={fields.age}
              onChange={(value) => setField("age", value)}
            />
            <ListSettingCheckbox
              label="Общий стаж"
              checked={fields.experience}
              onChange={(value) => setField("experience", value)}
            />
            <ListSettingCheckbox
              label="Должность на последнем месте работы"
              checked={fields.lastPosition}
              onChange={(value) => setField("lastPosition", value)}
            />
            <ListSettingCheckbox
              label="Последнее место работы"
              checked={fields.lastCompany}
              onChange={(value) => setField("lastCompany", value)}
            />
            <ListSettingCheckbox
              label="Источник"
              checked={fields.source}
              onChange={(value) => setField("source", value)}
            />
            <ListSettingCheckbox
              label="Число вакансий, на которых кандидат в работе"
              checked={fields.vacanciesCount}
              onChange={(value) => setField("vacanciesCount", value)}
            />
            <ListSettingCheckbox
              label="Метки"
              checked={fields.tags}
              onChange={(value) => setField("tags", value)}
            />
          </section>
        </div>

        <div className="flex h-[var(--hf-list-settings-footer-h)] items-center gap-[var(--hf-space-s)] border-t border-[var(--hf-ui-divider)] px-[var(--hf-list-settings-x)] py-[var(--hf-edit-footer-py)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex h-[var(--hf-edit-btn-h)] items-center justify-center rounded-[var(--hf-edit-btn-radius)] border border-[var(--hf-main-900)] bg-[var(--hf-main-900)] px-[var(--hf-edit-btn-px)] text-[length:var(--hf-edit-btn-fs)] font-medium leading-[var(--hf-edit-btn-lh)] !text-[var(--hf-white)] transition-colors hover:bg-[var(--hf-main-800)] active:bg-[var(--hf-black)] disabled:cursor-not-allowed disabled:!bg-[var(--hf-btn-disabled-bg)] disabled:!text-[var(--hf-main-600)] disabled:opacity-100 disabled:hover:!bg-[var(--hf-btn-disabled-bg)] hf-dark-disabled:disabled:!bg-[var(--hf-white-alpha-08)] hf-dark-disabled:disabled:!text-[color:var(--hf-white-alpha-35)]"
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--hf-edit-btn-h)] min-w-[var(--hf-edit-cancel-min-w)] items-center justify-center rounded-[var(--hf-edit-btn-radius)] border border-[var(--hf-ui-card-border)] bg-[var(--hf-white)] px-[var(--hf-edit-btn-px)] text-[length:var(--hf-edit-btn-fs)] font-medium leading-[var(--hf-edit-btn-lh)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-ui-hover)] active:bg-[var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-white-alpha-05)] hf-dark-disabled:text-[var(--hf-white)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-10)]"
          >
            Отмена
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ListSettingCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={clsx(
        "mb-[var(--hf-space-s)] flex h-[var(--hf-list-settings-option-h)] w-max items-center gap-[var(--hf-list-settings-option-gap)] text-[length:var(--hf-list-settings-option-fs)] font-normal leading-[var(--hf-list-settings-option-lh)] last:mb-0",
        disabled
          ? "cursor-default text-[var(--hf-main-600)]"
          : "cursor-pointer text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={clsx(
          "relative inline-flex h-[var(--hf-list-settings-check)] w-[var(--hf-list-settings-check)] flex-shrink-0 items-center justify-center rounded-[var(--hf-list-settings-check-radius)] border",
          disabled && checked
            ? "border-[var(--hf-main-400)] bg-[var(--hf-main-400)]"
            : checked
              ? "border-[var(--hf-cyan-600)] bg-[var(--hf-cyan-600)]"
              : "border-[var(--hf-main-300)] bg-[var(--hf-white)]",
        )}
        aria-hidden="true"
      >
        {checked ? (
          <svg
            viewBox="0 0 12 12"
            className="h-[var(--hf-list-settings-check-icon)] w-[var(--hf-list-settings-check-icon)] text-[var(--hf-white)]"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.4 6.2 4.8 8.5 9.7 3.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      {label}
    </label>
  );
}

function ListSettingRadio({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <label
      className={clsx(
        "flex h-[var(--hf-list-settings-option-h)] w-max cursor-pointer items-center gap-[var(--hf-list-settings-option-gap)] text-[length:var(--hf-list-settings-option-fs)] leading-[var(--hf-list-settings-option-lh)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]",
        className,
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        className="relative inline-flex h-[var(--hf-list-settings-check)] w-[var(--hf-list-settings-check)] flex-shrink-0 items-center justify-center rounded-full border border-[var(--hf-main-300)] bg-[var(--hf-white)] peer-checked:border-[var(--hf-cyan-600)]"
        aria-hidden="true"
      >
        {checked ? (
          <span className="h-[var(--hf-list-settings-dot)] w-[var(--hf-list-settings-dot)] rounded-full bg-[var(--hf-cyan-600)]" />
        ) : null}
      </span>
      {label}
    </label>
  );
}
