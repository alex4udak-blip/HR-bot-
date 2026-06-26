import { useState, useEffect, useCallback, useRef, useMemo, memo, Fragment, lazy, Suspense, startTransition } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Users,
  PlusCircle,
  Paperclip,
  Mail,
  PenSquare,
  Phone,
  Send,
  Check,
  ExternalLink,
  MapPin,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  Upload,
} from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { useHorizontalScroll } from "../hooks/useHorizontalScroll";
import { computeEntityParamUpdate, shouldAdoptUrlEntity } from "@/utils/candidateUrl";
import { HfLoadingSpinner } from "@/components/ui/HfLoadingSpinner";
import { buildStageContainers, readSystemHrTags, type EntryReaction } from "@/components/entities/candidateDetail/model";
import {
  getCandidatesKanban,
  changeCandidateStatus,
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
  deleteEntityFile,
  getEntityFiles,
  downloadEntityFile,
  deleteEntity,
  getEntity,
  detectDuplicate,
  addEntityNote,
  toggleTimelineReaction,
  getEntityActivity,
} from "@/services/api/entities";
import type { VacancyActivityBlock, ActivityEvent } from "@/services/api/entities";
import type { ApplicationStage } from "@/types";
import { STATUS_LABELS } from "@/types";
import { getVacancies, createApplication, updateApplication, deleteApplication, deleteApplicationHistory } from "@/services/api/vacancies";
import SendEmailModal from "@/components/entities/SendEmailModal";
import DatePickerFactorial from "@/factorial/components/DatePickerFactorial";
import type { EntityFile } from "@/services/api/entities";
import AddToVacancyModal from "@/components/entities/AddToVacancyModal";
import ShadowDuplicateBanner from "@/components/entities/ShadowDuplicateBanner";
import ParserModal from "@/components/parser/ParserModal";
import { useAuthStore } from "@/stores/authStore";
import { HuntflowComposer } from "@/components/hr/HuntflowComposer";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import {
  HuntflowInfoRow as InfoRow,
  HuntflowOptionsIcon,
} from "@/components/hr/HuntflowControls";
import { useFormBadgeStore } from "@/stores/formBadgeStore";
import { getEntityFormsUnreadCount, getEntityAllDispatches, markEntityDispatchesSeen, type FormDispatchInfo } from "@/services/api/forms";
import { AnketaResponses } from "@/features/forms/AnketaResponses";
import CandidateVacancyCard from "@/components/entities/CandidateVacancyCard";
import ResumeTab, { useResumeSources } from "@/components/entities/candidateDetail/ResumeTab";
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

// TIMELINE_ACTION_FILTERS + matchesTimelineFilter вынесены в
// candidateDetail/model (с unit-тестами) — импортируются выше.

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

// HfLoadingSpinner вынесён в components/ui/HfLoadingSpinner (общий — и страница,
// и CandidateVacancyCard импортируют его оттуда, без цикла page↔card).

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
  // Бамп → форс-ремоунт детали (InfoTab) после слияния: useResumeSources и
  // loadActivity кэшируют по card.id, который у выжившего НЕ меняется, поэтому
  // сами не перечитают файлы/резюме/активность. Ремоунт заставляет перечитать.
  const [detailReloadKey, setDetailReloadKey] = useState(0);
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

  const fetchBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getCandidatesKanban({
        q: debouncedSearch || undefined,
      });
      setBoard(data);
    } catch {
      /* ignore */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  // Лёгкий поллинг доски: WebSocket на проде НЕ доставляет события надёжно
  // (см. WebSocketProvider — там по той же причине поллятся уведомления). Поэтому
  // новые кандидаты (парсинг резюме / бот / импорт) и внешние смены статуса
  // появляются сами в течение ~15с, без ручного F5. silent=true → без спиннера,
  // выделение и скролл сохраняются. Пауза, когда вкладка скрыта.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchBoard(true);
    }, 15000);
    return () => clearInterval(id);
  }, [fetchBoard]);

  // Мгновенный рефреш при возврате на вкладку/в окно: кандидат, добавленный
  // через расширение (с другой вкладки, напр. HH.ru) или ботом, появляется
  // сразу, как только смотришь на HR-bot — не дожидаясь следующего тика поллинга
  // (который к тому же на СКРЫТОЙ вкладке стоит на паузе). Это и есть причина
  // «добавил через расширение → появился только после F5».
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchBoard(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
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
  // Функциональная форма setSearchParams → колбэк СТАБИЛЕН (зависит только от
  // setSearchParams). Иначе он пересоздаётся на каждой смене URL, а эффект авто-селекта
  // (где он в deps) из-за этого перезапускается — лишний «churn» при каждом клике.
  const clearCandidateDeepLink = useCallback(() => {
    setSearchParams((prev) => {
      if (!prev.has("entity") && !prev.has("edit") && !prev.has("archived") && !prev.has("tab")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("entity");
      next.delete("edit");
      next.delete("archived");
      next.delete("tab");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // Как clearCandidateDeepLink, но СОХРАНЯЕТ entity (ссылка на профиль остаётся в
  // адресной строке) — гасим только разовые триггеры edit/tab/archived.
  const consumeOneShotParams = useCallback(() => {
    setSearchParams((prev) => {
      if (!prev.has("edit") && !prev.has("tab") && !prev.has("archived")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("edit");
      next.delete("tab");
      next.delete("archived");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // Чтобы не тянуть entity повторно после неудачной попытки селекта.
  const entityFetchTriedRef = useRef<number | null>(null);
  const detectTriedRef = useRef<number | null>(null);
  // Предыдущий выбранный id — чтобы зеркало URL отличало настоящее закрытие
  // (selected->null) от ещё не завершённого диплинка (null->null) и не стирало ?entity=.
  const prevSelectedIdRef = useRef<number | null>(null);
  // Предыдущий выбранный id ДЛЯ эффекта авто-селекта (отдельно от зеркала) — чтобы
  // отличать смену выбора (клик) от смены URL и не «бодаться» за фокус.
  const prevAutoSelIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!board) return;
    // Гонка «клик vs URL»: клик ставит selectedCard напрямую (мгновенный UI), зеркало
    // дописывает ?entity= на тик позже. selChanged=true → менялся ВЫБОР (клик), а URL ещё
    // старый → НЕ возвращаем фокус на прошлую карточку; адоптим entity из URL только при
    // реальной смене URL (диплинк / назад-вперёд / переход из тоста).
    const selId = selectedCard?.id ?? null;
    const selChanged = selId !== prevAutoSelIdRef.current;
    prevAutoSelIdRef.current = selId;
    if (entityParam) {
      if (archivedParam === "1") return;  // архивного открывает отдельный эффект ниже
      const entityId = parseInt(entityParam);
      if (Number.isNaN(entityId)) return;
      // Уже показываем этого кандидата — URL синхронен: доводим разовые edit/tab и выходим.
      if (selectedCard?.id === entityId) {
        if (editParam === "1") setShowEditModal(true);
        if (tabParam === "anketa") setDetailTab("anketa");
        // Чистим только если есть что чистить — иначе лишняя навигация на каждый клик.
        if (editParam === "1" || tabParam === "anketa" || archivedParam === "1") consumeOneShotParams();
        return;
      }
      // Guard Clause: не «бодаемся» с кликом — на свежем клике URL временно отстаёт.
      if (!shouldAdoptUrlEntity(selId, entityId, selChanged)) return;
      const match = filteredCards.find((fc) => fc.card.id === entityId);
      if (match) {
        setSelectedCard(match.card);
        setSelectedStatus(match.status);
        if (editParam === "1") {
          setShowEditModal(true);
        }
        if (tabParam === "anketa") setDetailTab("anketa");
        // entity СОХРАНЯЕМ (шарящаяся ссылка); гасим только разовые edit/tab/archived.
        consumeOneShotParams();
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
  }, [filteredCards, entityParam, editParam, archivedParam, tabParam, board, selectedCard, clearCandidateDeepLink, consumeOneShotParams]);

  // Зеркалим открытый профиль в URL (?entity=ID) — ссылка на кандидата становится
  // шарящейся. replace:true → без спама истории (рекрутер открывает десятки за сессию;
  // профиль закрывается через UI, не кнопкой «Назад»). Чистая функция вернёт null,
  // когда менять нечего — это и есть защита от бесконечного цикла.
  useEffect(() => {
    const curId = selectedCard?.id ?? null;
    const next = computeEntityParamUpdate(searchParams, curId, prevSelectedIdRef.current);
    prevSelectedIdRef.current = curId;
    // URL-запись — НЕ срочная: startTransition, чтобы ререндер от смены searchParams не
    // блокировал мгновенный отклик на клик (selectedCard уже обновлён синхронно).
    if (next) startTransition(() => setSearchParams(next, { replace: true }));
  }, [selectedCard, searchParams, setSearchParams]);

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
                            // URL дописывает зеркало (в startTransition) — клик мгновенный,
                            // без лишнего clear→re-add ?entity= на каждый выбор.
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
                  key={`detail-${selectedCard.id}-${detailReloadKey}`}
                  card={selectedCard}
                  status={selectedStatus}
                  columns={board?.columns || []}
                  detailSection={detailTab}
                  onDetailSectionChange={setDetailTab}
                  onStatusChange={handleStatusChange}
                onAddToVacancy={(rect) => {
                  setAddToVacancyAnchor(rect ?? null);
                  setShowAddToVacancy(true);
                }}
                  onEdit={() => setShowEditModal(true)}
                  onMerged={async () => {
                    // Слияние завершено в баннере: перечитываем доску (исчезает
                    // влитый источник), выжившего (merged_from + статус) и
                    // форс-ремоунтим деталь, чтобы перечитались файлы/резюме/
                    // активность — всё без ручного F5.
                    const id = selectedCard?.id;
                    fetchBoard();
                    if (id) {
                      try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const e: any = await getEntity(id);
                        setSelectedCard((prev) =>
                          prev && prev.id === id
                            ? ({
                                ...prev,
                                extra_data: { ...(e.extra_data || {}) },
                                tags: e.tags || prev.tags,
                              } as KanbanCard)
                            : prev,
                        );
                        if (e.status) setSelectedStatus(e.status as string);
                      } catch {
                        /* профиль всё равно перечитается ремоунтом ниже */
                      }
                    }
                    // Ремоунт InfoTab → useResumeSources/loadActivity перечитают
                    // файлы/резюме/активность выжившего (включая влитые).
                    setDetailReloadKey((k) => k + 1);
                  }}
                  onRemovedFromVacancy={() => {
                    // Кандидата сняли с воронки → сбрасываем карточку + доску.
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
        {anySelected && createPortal(
          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 28, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-[16px] inset-x-[16px] mx-auto z-[85] min-h-[198px] max-w-[680px] overflow-hidden rounded-t-[12px] rounded-b-[8px] border border-[var(--hf-ui-divider-soft)] border-t-[3px] border-t-[var(--hf-main-900)] bg-[var(--hf-white)] px-[var(--hf-space-xxl)] py-[20px] shadow-[0_18px_60px_var(--hf-alpha-300)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:border-t-white hf-dark-disabled:bg-[var(--hf-bg-dark)]"
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
          </motion.div>,
          document.body,
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

// Единые лейблы стадий для карточки вакансии (совпадают с воронкой/бэкендом).
const CANDIDATE_VACANCY_STAGE_LABELS: Record<string, string> = {
  new: "Новый",
  applied: "Новый",
  screening: "Выполняет ТЗ",
  phone_screen: "Интервью с HR",
  interview: "Интервью с заказчиком",
  assessment: "Принятие решения",
  offer: "Выставлен оффер",
  hired: "Оффер принят",
  probation: "Практика",
  transferred: "Перешёл в отдел",
  rejected: "Отказ",
  withdrawn: "Отозван",
  reserve: "Резерв",
};

// Комментарий (лог) одного контейнера. Совпадает по форме с NoteShape, но
// объявлен здесь, до CandidateVacancyCard, чтобы карточка могла его принять.
type ContainerNote = {
  id?: string;
  text?: string;
  date?: string;
  stage?: string;
  stage_label?: string;
  author_id?: number;
  author_name?: string;
  edited_at?: string;
};

// EntryReaction вынесён в candidateDetail/model (импортируется выше).

// Резюме-демо одного контейнера (минимально нужные поля).
type ContainerResumeDemo = {
  title?: string;
  subtitle?: string;
  saved_at?: string;
  vacancy_title?: string;
};

// «Контейнер» = исторический блок-статус с собственным логом. Стек кандидата =
// [ собственный живой контейнер ] + card.extra_data.merged_from[]. Это НЕ
// вакансии: каждый контейнер изолирован своим status (цвет/лейбл) и notes (лог).
type StageContainer = {
  origin: "live" | "merged";
  // Для живого контейнера — applicationId первичной заявки (для смены этапа/
  // удаления истории). Для merged — фиктивный ключ (read-only, действий нет).
  applicationId: number;
  status: string;
  name: string | null;
  notes: ContainerNote[];
  resumeDemos: ContainerResumeDemo[];
  vacancyTitle: string | null;
  addedAt?: string;
  // Только живой контейнер: реальные StageTransition (история переходов) для
  // таймлайна. У merged-контейнеров таймлайн строится только из notes.
  events?: ActivityEvent[];
  // id файлов, прикреплённых к ЭТОМУ контейнеру: live — собственные файлы
  // (минус смёрдженные), merged — из снапшота extra_data.merged_from[].file_ids.
  fileIds?: number[];
  // Реальные EntityFile для этого контейнера (резолв по fileIds, см. useMemo).
  files?: EntityFile[];
};

// Лейбл статуса контейнера (EntityStatus → русский). Сначала org-override из
// колонок доски (если есть), затем канон STATUS_LABELS, затем локальный
// CANDIDATE_VACANCY_STAGE_LABELS, затем сам ключ.
function resolveContainerStatusLabel(
  status: string,
  columns: KanbanColumn[],
): string {
  const col = columns.find((c) => c.status === status);
  return (
    col?.label ||
    (STATUS_LABELS as Record<string, string>)[status] ||
    CANDIDATE_VACANCY_STAGE_LABELS[status] ||
    status
  );
}

const InfoTab = memo(function InfoTab({
  card,
  status,
  columns,
  detailSection,
  onDetailSectionChange,
  onStatusChange,
  onAddToVacancy,
  onEdit,
  onMerged,
  onRemovedFromVacancy,
}: {
  card: KanbanCard;
  status: string;
  columns: KanbanColumn[];
  detailSection: DetailSection;
  onDetailSectionChange: (section: DetailSection) => void;
  onStatusChange: (s: string) => void;
  onAddToVacancy: (rect?: { left: number; bottom: number }) => void;
  onEdit: () => void;
  // Слияние дубля разрешено в баннере → родитель перечитывает выжившего и доску
  // (иначе объединённый профиль виден только после ручного обновления).
  onMerged?: () => void;
  // Снятие кандидата с воронки → родитель обновляет доску и сбрасывает выбор.
  onRemovedFromVacancy?: () => void;
}) {
  const { user: currentUser } = useAuthStore();
  // Сохранён только сеттер: action-бар сбрасывает (закрывает) меню действий.
  const [, setShowActionMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [anketaOpen, setAnketaOpen] = useState(false);
  const anketaCount = useFormBadgeStore((s) => s.counts[card.id] ?? 0);
  const setAnketaCount = useFormBadgeStore((s) => s.setCount);
  // Источники резюме: каждое резюме — отдельная вкладка верхнего уровня рядом
  // с «Личные заметки». resumeIndex — какая из них активна.
  // Бамп после загрузки файла → useResumeSources перечитывает файлы (вкладка
  // «Резюме» кэширует по card.id, который не меняется → иначе файл не виден).
  const [filesNonce, setFilesNonce] = useState(0);
  const { sources: resumeSources, files: allEntityFiles } = useResumeSources(
    card,
    filesNonce,
  );
  const [resumeIndex, setResumeIndex] = useState(0);
  useEffect(() => {
    setResumeIndex(0);
  }, [card.id]);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [localTags, setLocalTags] = useState<string[]>(card.tags || []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  // Бейдж непрочитанных анкет (entity-уровень).
  useEffect(() => {
    if (!card.id) return;
    getEntityFormsUnreadCount(card.id)
      .then((r) => setAnketaCount(card.id, r.count))
      .catch(() => {});
  }, [card.id, setAnketaCount]);
  const stagePickerOptions = useMemo(() => {
    return columns.map((column) => ({
      label: column.label,
      status: column.status,
      isRealStage: true,
    }));
  }, [columns]);

  // ── Стек карточек по вакансиям: после слияния дубля у выжившего несколько
  // заявок. Тянем сквозную ленту активности (по заявке) и рендерим ОТДЕЛЬНУЮ
  // интерактивную карточку на каждую вакансию. Если заявок нет —
  // activityBlocks пуст и ниже рендерится одиночная карточка как раньше.
  const [activityBlocks, setActivityBlocks] = useState<VacancyActivityBlock[]>(
    [],
  );
  const loadActivity = useCallback(async () => {
    if (!card.id) {
      setActivityBlocks([]);
      return;
    }
    try {
      const blocks = await getEntityActivity(card.id);
      setActivityBlocks(Array.isArray(blocks) ? blocks : []);
    } catch {
      setActivityBlocks([]);
    }
  }, [card.id]);
  useEffect(() => {
    let cancelled = false;
    if (!card.id) {
      setActivityBlocks([]);
      return;
    }
    getEntityActivity(card.id)
      .then((blocks) => {
        if (!cancelled) setActivityBlocks(Array.isArray(blocks) ? blocks : []);
      })
      .catch(() => {
        if (!cancelled) setActivityBlocks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id]);

  // Лейбл статуса контейнера: сперва колонки доски (org-override), затем канон
  // STATUS_LABELS (EntityStatus), затем локальный CANDIDATE_VACANCY_STAGE_LABELS,
  // затем сам ключ. Resolve'ит и column-override'ы, и сырые EntityStatus.
  const getStackStageLabel = useCallback(
    (stage: string) => resolveContainerStatusLabel(stage, columns),
    [columns],
  );

  // Первичная заявка (та, что соответствует текущей вакансии кандидата) —
  // источник events (история переходов) и applicationId для ЖИВОГО контейнера.
  const primaryBlock = useMemo(() => {
    const primaryTitle = (card.vacancy_name || "").trim().toLowerCase();
    if (primaryTitle) {
      const match = activityBlocks.find(
        (b) => (b.vacancy_title || "").trim().toLowerCase() === primaryTitle,
      );
      if (match) return match;
    }
    return activityBlocks[0];
  }, [activityBlocks, card.vacancy_name]);

  // ── НОВАЯ МОДЕЛЬ СТЕКА: контейнеры = [ собственный живой ] + merged_from[].
  // Это НЕ вакансии. Живой контейнер — из самого кандидата (card); merged —
  // плоский массив смёрдженных дублей (транзитивные слияния уже подняты в корень
  // бэкендом, поэтому просто .map()). Порядок: живой первым, затем merged.
  // Стек контейнеров (живой + merged_from) — чистая логика вынесена в
  // candidateDetail/model.buildStageContainers (21 unit-тест). Здесь только
  // прокидываем вычисляемые поля живого контейнера (primaryBlock, лейбл вакансии).
  const containers = useMemo<StageContainer[]>(
    () =>
      buildStageContainers({
        card,
        status,
        liveApplicationId: primaryBlock?.application_id ?? 0,
        liveEvents: primaryBlock?.events,
        liveVacancyTitle: getVacancyStageLabel(card) ?? null,
        allEntityFiles: allEntityFiles || [],
      }),
    [primaryBlock, status, card, allEntityFiles],
  );

  // ── Тонкие обёртки для CandidateVacancyCard. Смену этапа делает ТОЛЬКО живой
  // (интерактивный) контейнер — его status это статус самого кандидата (entity),
  // поэтому меняем entity-статус через onStatusChange. Если у кандидата есть
  // реальная первичная заявка (appId>0) — синхронизируем и её стадию (воронка).
  const cardChangeStage = useCallback(
    async (appId: number, stage: string, comment?: string) => {
      onStatusChange(stage);
      if (appId > 0) {
        try {
          await updateApplication(appId, {
            stage: stage as ApplicationStage,
            ...(comment ? { comment } : {}),
          });
        } catch {
          /* стадия заявки не критична — entity-статус уже обновлён */
        }
      }
      await loadActivity();
    },
    [onStatusChange, loadActivity],
  );

  const cardComment = useCallback(
    async (_appId: number, stage: string, stageLabel: string, text: string) => {
      // Комментарий пишем на entity (тот же кандидат во всех заявках) через
      // POST /entities/{id}/notes — рекрутёру достаточно view-доступа.
      try {
        const resp = await addEntityNote(card.id, {
          text: text.trim(),
          stage,
          stage_label: stageLabel,
        });
        if (!card.extra_data) card.extra_data = {};
        const existing: Array<Record<string, unknown>> = Array.isArray(
          card.extra_data.notes,
        )
          ? card.extra_data.notes
          : [];
        card.extra_data.notes = [...existing, resp.note];
        toast.success("Комментарий сохранён");
      } catch (err) {
        console.error("Failed to save comment:", err);
        toast.error("Ошибка сохранения комментария");
      }
      // ВСЕГДА синхронизируем с сервера — даже если запрос отвалился, но бэкенд
      // закоммитил коммент (с @-тэгом), он появится сразу. getEntity не кэшируется.
      try {
        const fresh = await getEntity(card.id);
        if (fresh.extra_data) card.extra_data = fresh.extra_data;
      } catch {
        /* ignore */
      }
      await loadActivity();
    },
    [card, loadActivity],
  );

  const cardReact = useCallback(
    async (
      entryKey: string,
      emoji: string,
    ): Promise<EntryReaction[] | null> => {
      try {
        const resp = await toggleTimelineReaction(card.id, entryKey, emoji);
        if (!card.extra_data) card.extra_data = {};
        const tr = {
          ...((card.extra_data.timeline_reactions as
            | Record<string, unknown>
            | undefined) || {}),
        };
        if (resp.reactions?.length) tr[entryKey] = resp.reactions;
        else delete tr[entryKey];
        card.extra_data.timeline_reactions = tr;
        return (resp.reactions as EntryReaction[]) || [];
      } catch {
        toast.error("Не удалось поставить реакцию");
        return null;
      }
    },
    [card],
  );

  const cardDeleteHistory = useCallback(
    async (appId: number, historyId: number) => {
      try {
        await deleteApplicationHistory(appId, historyId);
        toast.success("Запись удалена");
      } catch {
        toast.error("Не удалось удалить запись");
      }
      await loadActivity();
    },
    [loadActivity],
  );

  const cardRemoveFromVacancy = useCallback(
    async (appId: number) => {
      try {
        await deleteApplication(appId);
        toast.success("Кандидат снят с воронки");
        // Перечитываем историю + уведомляем родителя обновить доску.
        await loadActivity();
        onRemovedFromVacancy?.();
      } catch {
        toast.error("Не удалось снять кандидата с воронки");
      }
    },
    [loadActivity, onRemovedFromVacancy],
  );

  const cardUploadFile = useCallback(
    async (entityId: number, file: File) => {
      try {
        await uploadEntityFile(entityId, file, "resume");
        toast.success(`Файл "${file.name}" загружен`);
        // Перечитать файлы → обновится блок «Файлы» в плашке и вкладка «Резюме».
        setFilesNonce((n) => n + 1);
      } catch (err) {
        const detail = (err as { response?: { data?: { detail?: string } } })
          ?.response?.data?.detail;
        toast.error(detail || "Ошибка загрузки файла");
      }
      await loadActivity();
    },
    [loadActivity],
  );

  const cardDeleteFile = useCallback(
    async (fileId: number) => {
      if (!window.confirm("Удалить этот файл?")) return;
      try {
        await deleteEntityFile(card.id, fileId);
        toast.success("Файл удалён");
        setFilesNonce((n) => n + 1);
      } catch {
        toast.error("Не удалось удалить файл");
      }
    },
    [card.id],
  );

  useEffect(() => {
    setLocalTags(card.tags || []);
    setShowTagInput(false);
    setTagInput("");
  }, [card.id, card.tags]);

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
      <ShadowDuplicateBanner card={card} status={status} onResolved={onMerged} />

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
              {/* Авто-метки HR (read-only): кто забрал кандидата в воронку.
                  Проставляются бэкендом (extra_data.system_hr_tags), без крестика
                  — ручные метки ниже остаются полностью редактируемыми. */}
              {readSystemHrTags(card.extra_data).map((hr) => (
                <span
                  key={`hr-${hr.hr_id}`}
                  title="Закреплённый HR — проставляется автоматически по воронке"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--hf-bg-panel)] text-[var(--hf-main-900)] border border-[color:var(--hf-main-200)] hf-dark-disabled:bg-[var(--hf-white-alpha-06)] hf-dark-disabled:text-[var(--hf-dark-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]"
                >
                  <Lock className="w-3 h-3 opacity-50" />
                  HR: {hr.name}{hr.vacancy_title ? ` · ${hr.vacancy_title}` : ""}
                </span>
              ))}
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

      {/* Анкета теперь — чип в ряду действий живого контейнера (ниже), отдельной
          кнопки над стеком больше нет. Дровер остаётся здесь. */}
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

      {/* ── СТЕК ИСТОРИЧЕСКИХ КОНТЕЙНЕРОВ (новая модель): не вакансии, а
          [ собственный живой контейнер ] + extra_data.merged_from[]. Живой —
          первым, интерактивный (композер/чипы/смена этапа/«...»); merged —
          READ-ONLY (только статус + сабтайтл вакансии + лог из notes). Цвет
          каждого контейнера — СТРОГО по его собственному status (без правила
          «≥2 ⇒ серый»). vacancy_id nullable → сабтайтл только если есть. ── */}
      {containers.map((c) => (
        <CandidateVacancyCard
          key={`${c.origin}-${c.applicationId}`}
          card={card}
          applicationId={c.applicationId}
          vacancyTitle={c.vacancyTitle}
          currentStage={c.status}
          notes={c.notes}
          events={c.events}
          addedAt={c.addedAt}
          readonly={c.origin === "merged"}
          stageOptions={stagePickerOptions}
          getStageLabel={getStackStageLabel}
          onChangeStage={cardChangeStage}
          onComment={cardComment}
          onDeleteHistory={cardDeleteHistory}
          onUploadFile={cardUploadFile}
          onAnketa={c.origin === "live" ? () => setAnketaOpen(true) : undefined}
          anketaCount={anketaCount}
          onReact={c.origin === "live" ? cardReact : undefined}
          files={c.files}
          onDeleteFile={c.origin === "live" ? cardDeleteFile : undefined}
          onRemoveFromVacancy={c.origin === "live" ? cardRemoveFromVacancy : undefined}
        />
      ))}

      {/* Блок «Комментарии» (entity-уровень) убран: каждый контейнер показывает
          свой лог сам, а влитые заметки задваивались здесь (на «Новом» висела
          отказная заметка источника). Если нужен entity-уровень комментариев —
          они во вкладке «Личные заметки». */}

      <div className="mt-[30px]">
        <div className="flex h-[49.333px] items-start gap-[var(--hf-space-xxl)] border-b border-[var(--hf-main-300)] pb-[20px] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)]">
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
          {/* По одной вкладке «Резюме» на каждый источник резюме. Если у
              кандидата резюме нет вовсе — одна вкладка-заглушка ([null]),
              чтобы показать пустое состояние. Вкладка «Личные заметки» убрана —
              заметки больше не используются. */}
          {(resumeSources.length > 0 ? resumeSources : [null]).map((_s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onDetailSectionChange("resume");
                setResumeIndex(i);
              }}
              className={clsx(
                "h-[24px] border-b-[2px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-primary)] font-medium transition-colors",
                detailSection === "resume" && resumeIndex === i
                  ? "border-[var(--hf-main-900)] text-[var(--hf-main-900)] hf-dark-disabled:border-[color:var(--hf-white)] hf-dark-disabled:text-[var(--hf-white)]"
                  : "border-transparent text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)]",
              )}
            >
              Резюме
            </button>
          ))}
        </div>
        {detailSection === "info" && (
          <PersonalNotesTab
            card={card}
            onFile={() => fileInputRef.current?.click()}
            uploading={uploading}
          />
        )}
        {detailSection === "resume" && (
          <ResumeTab
            key={`resume-${filesNonce}`}
            card={card}
            activeIndex={Math.min(
              resumeIndex,
              Math.max(0, resumeSources.length - 1),
            )}
          />
        )}
        {detailSection === "anketa" && <AnketaTab card={card} />}
      </div>
    </div>
  );
});

function AnketaTab({ card }: { card: KanbanCard }) {
  const [dispatches, setDispatches] = useState<(FormDispatchInfo & { source_entity_id?: number; source_name?: string | null })[]>([]);
  const clearBadge = useFormBadgeStore((s) => s.clear);
  useEffect(() => {
    let alive = true;
    const fetchRows = async () => {
      try {
        // Получаем анкеты из текущего профиля + всех merged контейнеров
        const rows = await getEntityAllDispatches(card.id);
        if (alive) setDispatches(rows);
      } catch {
        /* пустой/ошибка — покажем пустое состояние */
      }
    };
    (async () => {
      await fetchRows();
      try { await markEntityDispatchesSeen(card.id); clearBadge(card.id); } catch { /* ignore */ }
    })();
    // Поллинг: realtime по WebSocket на проде может не доходить (прокси/доставка),
    // поэтому раз в 15с подтягиваем ответы — заполненная анкета появляется без
    // перезагрузки страницы.
    const t = setInterval(fetchRows, 15000);
    return () => { alive = false; clearInterval(t); };
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
          <div
            className="hf-vacancy-note-text hf-rich-content"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.text) }}
          />
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
  const [city, setCity] = useState("");
  const [skills, setSkills] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [source, setSource] = useState("Другой источник");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [vacancyOptions, setVacancyOptions] = useState<Array<{ id: number; title: string }>>([]);
  const [selectedVacancyId, setSelectedVacancyId] = useState<number | ''>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getVacancies({ status: 'open' });
        if (cancelled) return;
        const myOpen = all
          .filter(v => v.status === 'open' || v.status === 'pending_review')
          .map(v => ({ id: v.id, title: v.title }));
        setVacancyOptions(myOpen);
      } catch (e) {
        console.warn('Failed to load vacancies:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);
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
      const created = await createEntity({
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
          salary: salary.trim() || undefined,
          city: city.trim() || undefined,
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });

      if (selectedVacancyId) {
        try {
          await createApplication(Number(selectedVacancyId), {
            vacancy_id: Number(selectedVacancyId),
            entity_id: created.id,
            source: 'manual_add',
          });
          const vacancyTitle = vacancyOptions.find(v => v.id === selectedVacancyId)?.title;
          toast.success(`Кандидат добавлен на воронку «${vacancyTitle ?? '...'}»`);
        } catch (e) {
          console.error('Attach to vacancy failed:', e);
          toast.error('Кандидат создан, но не удалось добавить на воронку');
        }
      } else {
        toast.success("Кандидат добавлен");
      }
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
      style={{ background: 'rgba(0, 0, 0, 0.7)' }}
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
              label="Город"
              value={city}
              onChange={setCity}
            />
            <CandidateField
              label="Навыки"
              value={skills}
              onChange={setSkills}
              placeholder="через запятую"
            />
            <CandidateField
              label="Дата рождения"
              type="date"
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
            <div className="hf-candidate-source-block">
              <label className="hf-candidate-label">Отправить в воронку (опционально)</label>
              <select
                value={selectedVacancyId}
                onChange={(e) => setSelectedVacancyId(e.target.value ? Number(e.target.value) : '')}
                className="hf-candidate-select-btn"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  backgroundColor: '#f5f5f5',
                  cursor: 'pointer',
                }}
              >
                <option value="">— без воронки —</option>
                {vacancyOptions.map(v => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
              {vacancyOptions.length === 0 && (
                <p className="hf-candidate-error" style={{ marginTop: '6px' }}>У вас нет открытых воронок</p>
              )}
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
      {type === "date" ? (
        // В формах кандидата единственное date-поле — дата рождения → будущее запрещаем.
        <DatePickerFactorial
          value={value}
          onChange={onChange}
          placeholder={placeholder || "дд.мм.гггг"}
          disableFuture
        />
      ) : (
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
      )}
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
  const [city, setCity] = useState((card.extra_data?.city as string) || "");
  const [skills, setSkills] = useState(
    Array.isArray(card.extra_data?.skills)
      ? (card.extra_data?.skills as string[]).join(", ")
      : "",
  );
  const [source, setSource] = useState(
    card.source || (card.extra_data?.source as string) || "",
  );
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
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

  const filteredSources = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase();
    if (!needle) return CANDIDATE_SOURCE_OPTIONS;
    return CANDIDATE_SOURCE_OPTIONS.filter((option) =>
      option.toLowerCase().includes(needle),
    );
  }, [sourceSearch]);

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
      const extraData = {
        salary: salary.trim() || undefined,
        birth_date: birthDate.trim() || undefined,
        resume_text: resumeText.trim() || undefined,
        source: source.trim() || undefined,
        city: city.trim() || undefined,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      };
      await updateEntity(card.id, {
        name: fullName,
        phone: normalizedPhone,
        email: email.trim() || undefined,
        telegram_usernames: cleanTelegram ? [cleanTelegram] : undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
        extra_data: extraData,
      });
      toast.success("Кандидат обновлён");
      onSaved({
        name: fullName,
        phone: normalizedPhone,
        email: email.trim() || undefined,
        telegram_username: cleanTelegram || undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
        extra_data: extraData,
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

  const [downloadingResume, setDownloadingResume] = useState(false);
  const handleDownloadResume = async () => {
    if (downloadingResume) return;
    setDownloadingResume(true);
    try {
      const files = await getEntityFiles(card.id);
      const resumeFile =
        files.find((f) => f.file_type === "resume") || files[0];
      if (!resumeFile) {
        toast.error("Файл резюме не найден");
        return;
      }
      const blob = await downloadEntityFile(card.id, resumeFile.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resumeFile.file_name || resumeFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Ошибка при скачивании резюме");
    } finally {
      setDownloadingResume(false);
    }
  };

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
              label="Город"
              value={city}
              onChange={setCity}
              placeholder="Москва"
            />
            <EditField
              label="Навыки"
              value={skills}
              onChange={setSkills}
              placeholder="через запятую"
            />
            <EditField
              label="Дата рождения"
              type="date"
              value={birthDate}
              onChange={setBirthDate}
              clearable
            />
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--hf-ui-divider)] py-[var(--hf-edit-column-py)] pl-[var(--hf-space-xxl)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
            <div className="hf-candidate-source-block mb-[var(--hf-space-l)]">
              <label className="mb-[var(--hf-edit-label-mb)] block text-[length:var(--hf-edit-label-fs)] font-semibold leading-[var(--hf-edit-label-lh)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)]">
                Источник
              </label>
              <button
                type="button"
                className="hf-candidate-select-btn"
                onClick={() => setSourceMenuOpen((value) => !value)}
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
                  onClick={handleDownloadResume}
                  disabled={downloadingResume}
                  title="Скачать резюме"
                  className="inline-flex h-[var(--hf-edit-file-h)] max-w-full items-center gap-[var(--hf-space-s)] rounded-full border border-[color:var(--hf-black-alpha-08)] bg-[var(--hf-white)] px-[var(--hf-space-s)] py-[var(--hf-space-xxs)] text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] shadow-[0_1px_1px_var(--hf-alpha-100)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-transparent hf-dark-disabled:text-[var(--hf-white)]"
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
        {type === "date" ? (
          // В формах кандидата единственное date-поле — дата рождения → будущее запрещаем.
          <DatePickerFactorial
            value={value}
            onChange={onChange}
            placeholder={placeholder || "дд.мм.гггг"}
            disableFuture
          />
        ) : (
          <>
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
          </>
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
