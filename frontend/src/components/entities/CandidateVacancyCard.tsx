import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
} from "react";
import type { CSSProperties } from "react";
import {
  Search,
  Paperclip,
  Mail,
  Calendar,
  ThumbsUp,
  Phone,
  Check,
  Trash2,
  ChevronDown,
  ClipboardList,
  X,
} from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { HuntflowComposer } from "@/components/hr/HuntflowComposer";
import { HuntflowRichInput } from "@/components/hr/HuntflowRichInput";
import { HuntflowActionChip as ActionChip } from "@/components/hr/HuntflowControls";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import { parseServerDate } from "@/utils/date";
import { useAuthStore } from "@/stores/authStore";
import { downloadEntityFile } from "@/services/api/entities";
import type { ActivityEvent, EntityFile } from "@/services/api/entities";
import type { KanbanCard } from "@/services/api/candidates";
import {
  matchesTimelineFilter,
  TIMELINE_ACTION_FILTERS,
  isRejectedStage,
  type ContainerNote,
  type EntryReaction,
} from "@/components/entities/candidateDetail/model";
import { HfLoadingSpinner } from "@/components/ui/HfLoadingSpinner";

// ── Module-scope helpers/constants moved verbatim from AllCandidatesPage
//    (used only by CandidateVacancyCard). ──

const normalizeStageLabel = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

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

function formatTimelineDate(dateStr: string): string {
  const date = parseServerDate(dateStr);
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

const TIMELINE_EXPAND_DELAY_MS = 420;

// ── Цвет карточки этапа: ровно 2 варианта (по фидбэку Маши). ЗЕЛЁНАЯ для
// активного этапа одиночной карточки; СЕРАЯ для отказа ИЛИ для любой карточки
// объединённого кандидата (≥2 карточек = историческая/смёрдженная лента).
// Переопределяем CSS-переменные, которые читает .hf-stage-card.
const GREEN_STAGE_CARD_STYLE: CSSProperties = {
  "--hf-stage-accent": "#22c55e",
  "--hf-stage-card-bg": "rgba(34, 197, 94, 0.1)",
} as CSSProperties;
const GRAY_STAGE_CARD_STYLE: CSSProperties = {
  "--hf-stage-accent": "var(--hf-main-300)",
  "--hf-stage-card-bg": "var(--hf-bg-panel)",
} as CSSProperties;

// Набор эмодзи для пикера реакций.
const REACTION_EMOJIS = ["👍", "❤️", "🔥", "🎉", "👀", "✅", "😂", "🙏"];

// ================================================================
// CANDIDATE VACANCY CARD — одна интерактивная карточка этапа на ОДНУ вакансию.
// Извлечена из singleton-карточки InfoTab; вся state — ПЕР-ИНСТАНС, поэтому
// N карточек (смёрдженный кандидат) работают независимо. Рендерит СВОИ events
// (история переходов именно этой заявки) в той же avatar/«Действия»-таймлайн-
// разметке, что и исходная карточка.
// ================================================================
const CandidateVacancyCard = memo(function CandidateVacancyCard({
  card,
  applicationId,
  vacancyTitle,
  currentStage,
  notes,
  events,
  addedAt,
  readonly,
  stageOptions,
  getStageLabel,
  onChangeStage,
  onComment,
  onDeleteHistory,
  onDeleteNote,
  onUploadFile,
  onAnketa,
  anketaCount,
  onReact,
  files,
  onDeleteFile,
  onRemoveFromVacancy,
}: {
  card: KanbanCard;
  applicationId: number;
  // vacancy_id может отсутствовать у контейнера → vacancyTitle nullable.
  vacancyTitle: string | null;
  currentStage: string;
  // Лог контейнера: его собственные комментарии (notes) → строки таймлайна.
  notes: ContainerNote[];
  // Только для живого контейнера: история переходов (StageTransition).
  events?: ActivityEvent[];
  // Дата добавления контейнера (live: card.created_at; merged: m.added_at).
  addedAt?: string;
  // READ-ONLY (merged-контейнеры): без композера/чипов/смены этапа/удаления.
  readonly: boolean;
  stageOptions: Array<{ status: string; label: string }>;
  getStageLabel: (stage: string) => string;
  onChangeStage: (
    applicationId: number,
    stage: string,
    comment?: string,
  ) => Promise<void> | void;
  onComment: (
    applicationId: number,
    stage: string,
    stageLabel: string,
    text: string,
  ) => Promise<void> | void;
  onDeleteHistory: (
    applicationId: number,
    historyId: number,
  ) => Promise<void> | void;
  // Удаление комментария (extra_data.notes) — отдельно от истории переходов,
  // т.к. это не StageTransition, а запись в JSON-поле кандидата.
  onDeleteNote?: (
    entityId: number,
    noteId: string,
  ) => Promise<void> | void;
  onUploadFile: (entityId: number, file: File) => Promise<void> | void;
  // Только живой контейнер: открыть анкеты (чип в ряду действий) + бейдж кол-ва.
  onAnketa?: () => void;
  anketaCount?: number;
  // Тоггл эмодзи-реакции записи таймлайна (entry_key, emoji) → новый список.
  onReact?: (entryKey: string, emoji: string) => Promise<EntryReaction[] | null>;
  // Файлы, прикреплённые к этому контейнеру (показываются под логом, скачиваемы).
  files?: EntityFile[];
  // Удалить файл (с подтверждением) — обновляет список после удаления.
  onDeleteFile?: (fileId: number) => void;
  // Убрать кандидата из воронки (снять заявку). Только живой контейнер.
  onRemoveFromVacancy?: (applicationId: number) => void;
}) {
  // --- per-instance UI state (раньше было singleton в InfoTab) ---
  const [showStageDD, setShowStageDD] = useState(false);
  const [pendingStage, setPendingStage] = useState(currentStage);
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
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [timelineExpanding, setTimelineExpanding] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionSearchRef = useRef<HTMLInputElement>(null);
  const timelineExpandTimerRef = useRef<number | null>(null);

  const statusLabel = getStageLabel(currentStage);
  const stageTitle = statusLabel;

  // Цвет карточки СТРОГО по СВОЕМУ статусу контейнера: серая если этап
  // отклонён (rejected/fired/archived), иначе зелёная. Слияние НЕ
  // перекрашивает живую карточку — каждый контейнер изолирован.
  const grayed = isRejectedStage(currentStage);
  const stageCardStyle: CSSProperties = grayed
    ? GRAY_STAGE_CARD_STYLE
    : GREEN_STAGE_CARD_STYLE;

  // Таймлайн контейнера = его СОБСТВЕННЫЕ notes (комментарии) как строки лога,
  // плюс — только для живого контейнера — реальная история переходов (events).
  // Merged-контейнеры показывают строго свои notes (read-only).
  const timelineItems = useMemo<
    Array<{
      date?: string;
      title?: string;
      body?: string;
      author?: string;
      historyId?: number;
      // Заметки (extra_data.notes) удаляются НЕ через историю переходов
      // (StageTransition), а отдельным DELETE /entities/{id}/notes/{note_id}.
      noteId?: string;
      reactionKey: string;
      // Тип записи для фильтра «Действия»: смена этапа vs свободный комментарий.
      kind: "stage" | "comment";
    }>
  >(() => {
    const noteRows = (Array.isArray(notes) ? notes : [])
      .filter((note) => note && (note.text || note.stage_label))
      .map((note) => ({
        date: note.date || undefined,
        title: note.stage_label
          ? `Этап: ${note.stage_label}`
          : note.text || "Комментарий",
        body: note.stage_label ? note.text || undefined : undefined,
        author: note.author_name || undefined,
        noteId: note.id ? String(note.id) : undefined,
        reactionKey: note.id ? `n:${note.id}` : `nd:${note.date || ""}`,
        // Заметки (extra_data.notes) — это КОММЕНТАРИИ (даже если несут stage_label
        // текущего этапа). Смена этапа — отдельные события (eventRows, kind=stage).
        kind: "comment" as const,
      }));

    const eventRows = (!readonly && Array.isArray(events) ? events : []).map(
      (ev) => {
        const to = getStageLabel(ev.to_stage);
        const from = ev.from_stage ? getStageLabel(ev.from_stage) : null;
        return {
          date: ev.created_at || undefined,
          title: from ? `${from} → ${to}` : `Этап: ${to}`,
          body: ev.comment || undefined,
          author: ev.changed_by_name || undefined,
          historyId: ev.id as number | undefined,
          reactionKey: `e:${ev.id}`,
          kind: "stage" as const,
        };
      },
    );

    const merged = [...eventRows, ...noteRows];
    if (merged.length === 0) {
      // Влитые (read-only) контейнеры без заметок/событий НЕ показывают
      // синтетическое «Кандидат добавлен»: иначе каждый объединённый дубль
      // плодит свой зелёный «new», и лента засоряется N одинаковыми записями
      // (видно после объединения; на F5 они возвращались из merged_from).
      // Заглушку оставляем только живому контейнеру.
      if (readonly) return [];
      return [
        {
          date: addedAt || card.created_at,
          title: "Кандидат добавлен",
          author: card.recruiter_name || undefined,
          reactionKey: "created",
          kind: "stage" as const,
        },
      ];
    }
    return merged.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
  }, [notes, events, readonly, getStageLabel, addedAt, card.created_at, card.recruiter_name]);

  const filteredTimelineItems = useMemo(() => {
    if (!timelineActionFilter) return timelineItems;
    return timelineItems.filter((event) =>
      matchesTimelineFilter(event, timelineActionFilter),
    );
  }, [timelineItems, timelineActionFilter]);
  const visibleTimelineItems = showAllTimeline
    ? filteredTimelineItems
    : filteredTimelineItems.slice(0, 5);
  const hasHiddenTimelineItems = filteredTimelineItems.length > 5;
  // Показываем только фильтры, по которым в таймлайне реально ЕСТЬ записи (+ поиск).
  // Пустые (письмо/интервью/звонок/файл/оффер и пр.) скрыты.
  const visibleActionFilters = TIMELINE_ACTION_FILTERS.filter(
    (item) =>
      item.toLowerCase().includes(actionSearch.trim().toLowerCase()) &&
      timelineItems.some((it) => matchesTimelineFilter(it, item)),
  );
  const isCommentComposerOpen =
    commentComposerOpen || comment.trim().length > 0;

  // --- Эмодзи-реакции на записи таймлайна ---
  const { user: reactionUser } = useAuthStore();
  const [reactionPickerKey, setReactionPickerKey] = useState<string | null>(null);
  const [localReactions, setLocalReactions] = useState<
    Record<string, EntryReaction[]>
  >(
    () =>
      (card.extra_data?.timeline_reactions as
        | Record<string, EntryReaction[]>
        | undefined) || {},
  );
  const handleReact = useCallback(
    async (entryKey: string, emoji: string) => {
      setReactionPickerKey(null);
      if (!onReact) return;
      const updated = await onReact(entryKey, emoji);
      if (updated === null) return;
      setLocalReactions((prev) => {
        const next = { ...prev };
        if (updated.length) next[entryKey] = updated;
        else delete next[entryKey];
        return next;
      });
    },
    [onReact],
  );

  const stagePickerOptions = useMemo(
    () =>
      stageOptions.map((option) => ({
        label: option.label,
        status: option.status,
        isRealStage: true,
      })),
    [stageOptions],
  );

  // currentStage (сырой ключ этапа) не всегда дословно совпадает с каким-то
  // option.status (кастомные/устаревшие ключи) — тогда сверяем по лейблу.
  // Резолвим ОДИН РАЗ здесь и используем как единственный источник правды для
  // pendingStage, чтобы при рендере подсвечивался только реальный текущий/
  // выбранный вариант, а не оба сразу (баг «выбор не отлипает»).
  const resolvedCurrentStageStatus = useMemo(() => {
    const exact = stagePickerOptions.find((o) => o.status === currentStage);
    if (exact) return exact.status;
    const byLabel = stagePickerOptions.find(
      (o) => normalizeStageLabel(o.label) === normalizeStageLabel(statusLabel),
    );
    return byLabel ? byLabel.status : currentStage;
  }, [stagePickerOptions, currentStage, statusLabel]);

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
  }, [applicationId, timelineActionFilter]);

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
      setPendingStage(resolvedCurrentStageStatus);
      setStageChangeComment("");
    }
  }, [showStageDD, resolvedCurrentStageStatus]);

  useEffect(() => {
    if (showActionMenu) {
      requestAnimationFrame(() => actionSearchRef.current?.focus());
    }
  }, [showActionMenu]);

  // --- per-instance action handlers ---
  const handleComment = async () => {
    if (!comment.trim()) {
      toast.error("Введите комментарий");
      return;
    }
    await onComment(applicationId, currentStage, statusLabel, comment.trim());
    setComment("");
  };

  const saveStageChangeComment = async () => {
    const text = stageChangeComment.trim();
    if (!text) return;
    const targetOption = stagePickerOptions.find(
      (option) => option.status === pendingStage,
    );
    await onComment(
      applicationId,
      pendingStage,
      targetOption?.label || statusLabel,
      text,
    );
    setStageChangeComment("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await onUploadFile(card.id, file);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Скачать прикреплённый к контейнеру файл (работает и на read-only merged).
  const handleDownloadFile = async (fileId: number, fileName: string) => {
    try {
      const blob = await downloadEntityFile(card.id, fileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Ошибка при скачивании");
    }
  };

  return (
    <div className="hf-stage-card" style={stageCardStyle}>
      {/* Hidden file input (только живой контейнер — у merged нет действий) */}
      {!readonly && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileUpload}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        />
      )}

      {/* ---- Stage block (Huntflow: colored bg + vacancy name + change button) ---- */}
      <div className="hf-stage-card-head">
        <div className="hf-stage-card-head-row">
          <div>
            <div className="hf-stage-card-title">{stageTitle}</div>
            {vacancyTitle && (
              <div className="hf-stage-card-subtitle">{vacancyTitle}</div>
            )}
          </div>
          {/* «Сменить этап подбора» + пикер — только живой контейнер. */}
          {!readonly && (
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
                    const isSelected = pendingStage === option.status;
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
                    <HuntflowRichInput
                      value={stageChangeComment}
                      onChange={setStageChangeComment}
                      placeholder="Записать комментарий"
                      showMention
                      toolbarClassName="hf-stage-picker-toolbar"
                      editableClassName="hf-stage-picker-textarea overflow-y-auto"
                    />
                  </div>
                  <div className="hf-stage-picker-footer">
                    <button
                      type="button"
                      onClick={async () => {
                        const selectedOption = stagePickerOptions.find(
                          (option) => option.status === pendingStage,
                        );
                        if (stageChangeComment.trim()) {
                          await saveStageChangeComment();
                        }
                        if (
                          pendingStage !== currentStage &&
                          selectedOption?.isRealStage
                        )
                          await onChangeStage(applicationId, pendingStage);
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
          )}
        </div>
      </div>

      {/* ---- Comment textarea (Huntflow: "Написать комментарий") — только живой контейнер ---- */}
      {!readonly && (
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
          {
            icon: Paperclip,
            label: "Файл",
            onClick: () => fileInputRef.current?.click(),
            loading: uploading,
          },
        ]}
      />
      )}

      {/* ---- Action chips (Huntflow: Письмо | Интервью | Комментарий | Оффер | Файл) — только живой контейнер ---- */}
      {!readonly && (
      <div className="px-[var(--hf-space-xxl)] pb-hf-l flex items-center gap-[var(--hf-space-s)] border-b border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-06)] flex-wrap">
        {!isCommentComposerOpen && (
          <>
            <ActionChip
              icon={Paperclip}
              label="Файл"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
            />
            {onAnketa && (
              <ActionChip
                icon={ClipboardList}
                label="Анкета"
                notificationCount={anketaCount}
                onClick={onAnketa}
              />
            )}
            {onRemoveFromVacancy && (
              <ActionChip
                icon={X}
                label="Удалить с воронки"
                onClick={() => onRemoveFromVacancy(applicationId)}
              />
            )}
          </>
        )}
      </div>
      )}

      {/* ---- История: лог контейнера (notes + переходы для живого) ---- */}
      <div className="px-[var(--hf-space-xxl)] pt-[7px]">
        {/* Фильтр «Действия» — интерактивный, только живой контейнер. */}
        {!readonly && (
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
        )}
        <div className="relative ml-[17px] w-[calc(100%-11px)] border-l border-[var(--hf-main-300)] pl-[38.667px] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)]">
          {visibleTimelineItems.length > 0 ? (
            visibleTimelineItems.map((event, i) => (
              <div
                key={`${event.historyId ?? event.date ?? card.created_at}-${i}`}
                className="relative first:mt-0 mt-[20px] group/timeline"
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
                    onClick={
                      !readonly && onReact
                        ? () =>
                            setReactionPickerKey((k) =>
                              k === event.reactionKey ? null : event.reactionKey,
                            )
                        : undefined
                    }
                    title={
                      !readonly && onReact ? "Поставить реакцию" : undefined
                    }
                    className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors hover:bg-[var(--hf-black-alpha-04)] focus:outline-none focus-visible:outline-none hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
                  >
                    <TimelineMetaIcon />
                  </button>
                  {reactionPickerKey === event.reactionKey && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setReactionPickerKey(null)}
                      />
                      <div className="absolute left-[38px] top-[16px] z-20 flex items-center gap-[2px] rounded-[var(--hf-radius-s)] border border-[var(--hf-main-200)] bg-[var(--hf-white)] px-[6px] py-[3px] shadow-md hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-bg-dark)]">
                        {REACTION_EMOJIS.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => handleReact(event.reactionKey, em)}
                            className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-full text-[16px] leading-none transition-transform hover:scale-125"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors hover:bg-[var(--hf-black-alpha-04)] focus:outline-none focus-visible:outline-none hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
                  >
                    <ChevronDown className="h-[14px] w-[14px] text-[var(--hf-ui-icon-light)] hf-dark-disabled:text-[color:var(--hf-white-alpha-25)]" />
                  </button>
                  {!readonly && event.historyId ? (
                    <button
                      type="button"
                      onClick={() =>
                        onDeleteHistory(applicationId, event.historyId as number)
                      }
                      title="Удалить запись"
                      className="ml-auto inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[var(--hf-main-500)] opacity-0 transition-opacity hover:text-[var(--hf-status-red)] group-hover/timeline:opacity-100 focus:outline-none focus-visible:outline-none"
                    >
                      <Trash2 className="h-[14px] w-[14px]" />
                    </button>
                  ) : !readonly && event.noteId && onDeleteNote ? (
                    // F-fix: комментарии (extra_data.notes, в т.ч. с @-упоминанием)
                    // раньше вообще не имели кнопки удаления — historyId у них
                    // никогда не бывает (это не StageTransition).
                    <button
                      type="button"
                      onClick={() =>
                        onDeleteNote(card.id, event.noteId as string)
                      }
                      title="Удалить комментарий"
                      className="ml-auto inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[var(--hf-main-500)] opacity-0 transition-opacity hover:text-[var(--hf-status-red)] group-hover/timeline:opacity-100 focus:outline-none focus-visible:outline-none"
                    >
                      <Trash2 className="h-[14px] w-[14px]" />
                    </button>
                  ) : null}
                </div>
                <div className="text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)] whitespace-pre-wrap hf-rich-content">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(event.title || "Событие"),
                    }}
                  />
                  {event.body && (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(event.body),
                      }}
                    />
                  )}
                </div>
                {(() => {
                  const rs = localReactions[event.reactionKey] || [];
                  if (rs.length === 0) return null;
                  const byEmoji: Record<string, string[]> = {};
                  for (const r of rs)
                    (byEmoji[r.emoji] ||= []).push(r.user_name || "—");
                  return (
                    <div className="mt-[5px] flex flex-wrap gap-[4px]">
                      {Object.entries(byEmoji).map(([em, names]) => {
                        const mine = rs.some(
                          (r) =>
                            r.emoji === em && r.user_id === reactionUser?.id,
                        );
                        return (
                          <button
                            key={em}
                            type="button"
                            onClick={
                              !readonly && onReact
                                ? () => handleReact(event.reactionKey, em)
                                : undefined
                            }
                            title={names.join(", ")}
                            className={clsx(
                              "inline-flex items-center gap-[3px] rounded-full border px-[7px] py-[1px] text-[12px] leading-[18px] transition-colors",
                              mine
                                ? "border-[var(--hf-cyan-500)] bg-[var(--hf-black-alpha-04)] text-[var(--hf-main-900)]"
                                : "border-[var(--hf-main-200)] text-[var(--hf-main-700)] hover:bg-[var(--hf-black-alpha-04)]",
                            )}
                          >
                            <span>{em}</span>
                            <span>{names.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
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
      {/* ── Файлы контейнера: под логом, скачиваемы. live — собственные файлы;
          merged — снапшот его file_ids. Скачивание работает и read-only. ── */}
      {files && files.length > 0 ? (
        <div className="px-[var(--hf-space-xxl)] pt-[14px]">
          <div className="mb-[8px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-field)] text-[color:var(--hf-alpha-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
            Файлы
          </div>
          <div className="flex flex-col gap-[4px]">
            {files.map((f) => (
              <div
                key={f.id}
                className="group flex items-center gap-[2px] rounded-[var(--hf-radius-s)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
              >
                <button
                  type="button"
                  onClick={() => handleDownloadFile(f.id, f.file_name)}
                  title="Скачать"
                  className="flex min-w-0 flex-1 items-center gap-[6px] px-[6px] py-[4px] text-left text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)] text-[var(--hf-main-700)] transition-colors hover:text-[var(--hf-main-900)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hf-dark-disabled:hover:text-[var(--hf-white)]"
                >
                  <Paperclip className="h-[13px] w-[13px] shrink-0 text-[var(--hf-ui-icon-light)] hf-dark-disabled:text-[color:var(--hf-white-alpha-25)]" />
                  <span className="truncate">{f.file_name}</span>
                </button>
                {onDeleteFile ? (
                  <button
                    type="button"
                    onClick={() => onDeleteFile(f.id)}
                    title="Удалить файл"
                    className="mr-[4px] inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--hf-main-500)] opacity-0 transition-opacity hover:text-[var(--hf-status-red)] group-hover:opacity-100 focus:outline-none focus-visible:outline-none"
                  >
                    <Trash2 className="h-[13px] w-[13px]" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
  );
});

export default CandidateVacancyCard;
