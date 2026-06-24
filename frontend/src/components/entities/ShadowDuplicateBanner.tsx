import { useState, useEffect, useRef } from "react";
import { AlertTriangle, X, Loader2, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import toast from "react-hot-toast";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import { STATUS_LABELS } from "@/types";
import {
  getEntity,
  mergeShadowDuplicate,
  dismissDuplicate,
  getDuplicateCandidates,
  type DuplicateCandidateResult,
} from "@/services/api/entities";

/**
 * Баннер «Похожий кандидат есть в базе» + БЕЛЫЙ экран сравнения двух анкет
 * целиком: шапка, блок статуса (этап + причина/дата отказа + история этапов),
 * поля профиля и резюме. Совпадения подсвечены. Объединить / Разные / Закрыть.
 */

interface ShadowDuplicateBannerProps {
  card: KanbanCard;
  status?: string; // текущий этап открытой карточки (ключ EntityStatus)
  onResolved?: () => void;
}

interface ResumeDemo {
  title?: string;
  subtitle?: string;
  salary?: string;
  vacancy_title?: string;
  sections?: Array<{ title?: string; lines?: string[] }>;
}

interface TimelineEvent {
  date?: string;
  title?: string;
}

// Резюме-текста часто нет (анонимные hh-анкеты из расширения), но есть
// структурные поля — показываем их как резюме, чтобы блок не был пустым.
type ResumeExtra = {
  experience: string;
  skills: string;
  languages: string;
  education: string;
};

type Side = {
  name: string;
  photo: string;
  position: string;
  company: string;
  phone: string;
  email: string;
  telegram: string;
  age: string;
  city: string;
  salary: string;
  experience: string;
  source: string;
  tags: string;
  statusLabel: string;
  isRejected: boolean;
  rejectReason: string;
  rejectedAt: string;
  history: TimelineEvent[];
  resumes: ResumeDemo[];
  resumeText: string;
  resumeExtra: ResumeExtra;
  notes: Array<{ text?: string; author?: string; date?: string }>;
};

type FieldKey = "phone" | "email" | "telegram" | "age" | "city" | "salary" | "experience" | "source" | "tags";

// String() coercion: значения полей (age/salary/experience) из API могут прийти
// числом, а не строкой — без приведения .trim() падает «(e||"").trim is not a function».
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const normPhone = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const normTg = (v: unknown) => String(v ?? "").trim().replace(/^@/, "").toLowerCase();
const HL = "bg-amber-100 text-amber-900 rounded px-1.5 py-0.5";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Эл. почта" },
  { key: "telegram", label: "Telegram" },
  { key: "age", label: "Возраст" },
  { key: "city", label: "Город" },
  { key: "salary", label: "Зарплата" },
  { key: "experience", label: "Опыт" },
  { key: "source", label: "Источник" },
  { key: "tags", label: "Метки" },
];

function computeAge(birthDate?: string): string {
  if (!birthDate) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return "";
  const today = new Date();
  let age = today.getFullYear() - parseInt(m[1], 10);
  if ((today.getMonth() + 1) * 100 + today.getDate() < parseInt(m[2], 10) * 100 + parseInt(m[3], 10)) age -= 1;
  return age >= 14 && age <= 100 ? `${age} лет` : "";
}

function statusLabelOf(key?: string): string {
  if (!key) return "";
  const map = STATUS_LABELS as Record<string, string>;
  return map[key] || key;
}

function timelineFrom(extra: Record<string, unknown> | undefined): TimelineEvent[] {
  const ev = extra?.timeline_events;
  return Array.isArray(ev) ? (ev as TimelineEvent[]) : [];
}

function rejectedDate(history: TimelineEvent[]): string {
  const ev = history.find((e) => (e.title || "").toLowerCase().includes("отказ"));
  return ev?.date || "";
}

function resumesFrom(extra: Record<string, unknown> | undefined): ResumeDemo[] {
  if (!extra) return [];
  if (Array.isArray(extra.resume_demos)) return (extra.resume_demos as ResumeDemo[]).filter(Boolean);
  if (extra.resume_demo) return [extra.resume_demo as ResumeDemo];
  return [];
}

function joinStrs(v: unknown, sep = ", "): string {
  if (Array.isArray(v)) return (v as unknown[]).filter((x) => typeof x === "string" && x.trim()).join(sep);
  return typeof v === "string" ? v : "";
}

// Собираем «резюме из структурных полей» (опыт/навыки/языки/образование) —
// fallback, когда полноценного resume_text/resume_demos нет.
function resumeExtraFrom(extra: Record<string, unknown> | undefined): ResumeExtra {
  const e = extra || {};
  const exp = [
    typeof e.experience_summary === "string" ? e.experience_summary : "",
    joinStrs(e.experience_descriptions, "\n\n"),
  ].filter(Boolean).join("\n\n");
  return {
    experience: exp,
    skills: joinStrs(e.skills),
    languages: joinStrs(e.languages),
    education: joinStrs(e.education, "; "),
  };
}

function notesFrom(extra: Record<string, unknown> | undefined): Array<{ text?: string; author?: string; date?: string }> {
  const ns = extra?.notes;
  if (!Array.isArray(ns)) return [];
  return (ns as Array<Record<string, unknown>>)
    .filter((n) => n && n.text)
    .map((n) => ({ text: n.text as string, author: n.author_name as string, date: n.date as string }));
}

function fromCard(card: KanbanCard, statusKey?: string): Side {
  const extra = (card.extra_data || {}) as Record<string, unknown>;
  const history = timelineFrom(extra);
  const isRejected = statusKey === "rejected";
  return {
    name: card.name || "",
    photo: card.photo_url || ((extra.photo_url as string) || ""),
    position: card.position || "",
    company: card.company || "",
    phone: card.phone || "",
    email: card.email || "",
    telegram: card.telegram_username || "",
    age: card.age ? String(card.age) : computeAge(extra.birth_date as string | undefined),
    city: card.city || ((extra.city as string) || ""),
    salary: card.salary ? String(card.salary) : "",
    experience: card.total_experience ? String(card.total_experience) : ((extra.total_experience as string) || ""),
    source: card.source || ((extra.source as string) || ""),
    tags: ((card.tags as string[] | undefined) || []).join(", "),
    statusLabel: statusLabelOf(statusKey),
    isRejected,
    rejectReason: (card.rejection_reason as string) || ((extra.rejection_reason as string) || ""),
    rejectedAt: isRejected ? rejectedDate(history) : "",
    history,
    resumes: resumesFrom(extra),
    resumeText: (extra.resume_text as string) || "",
    resumeExtra: resumeExtraFrom(extra),
    notes: notesFrom(extra),
  };
}

function fromEntity(e: EntityWithRelations): Side {
  const ent = e as unknown as Record<string, unknown>;
  const extra = (e.extra_data || {}) as Record<string, unknown>;
  const history = timelineFrom(extra);
  const statusKey = (ent.status as string) || "";
  const isRejected = statusKey === "rejected";
  const lo = e.expected_salary_min;
  const hi = e.expected_salary_max;
  const cur = e.expected_salary_currency || "";
  let salary = "";
  if (lo && hi) salary = `${lo.toLocaleString()}–${hi.toLocaleString()} ${cur}`.trim();
  else if (lo) salary = `от ${lo.toLocaleString()} ${cur}`.trim();
  else if (hi) salary = `до ${hi.toLocaleString()} ${cur}`.trim();
  return {
    name: e.name || "",
    photo: (extra.photo_url as string) || "",
    position: e.position || "",
    company: e.company || "",
    phone: e.phone || "",
    email: e.email || "",
    telegram: (e.telegram_usernames && e.telegram_usernames[0]) || "",
    age: (extra.age as string) || computeAge(extra.birth_date as string | undefined),
    city: (ent.city as string) || ((extra.city as string) || ""),
    salary,
    experience: ((ent.total_experience as string) || (extra.total_experience as string) || ""),
    source: (ent.source as string) || ((extra.source as string) || ""),
    tags: ((ent.tags as string[] | undefined) || []).join(", "),
    statusLabel: statusLabelOf(statusKey),
    isRejected,
    rejectReason: (ent.rejection_reason as string) || ((extra.rejection_reason as string) || ""),
    rejectedAt: isRejected ? rejectedDate(history) : "",
    history,
    resumes: resumesFrom(extra),
    resumeText: (extra.resume_text as string) || "",
    resumeExtra: resumeExtraFrom(extra),
    notes: notesFrom(extra),
  };
}

function initialsOf(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
}

// Лейблы совпавших полей в карточке-миниатюре карусели дубликатов.
const DUP_FIELD_LABEL: Record<string, string> = {
  name: "Имя",
  email: "Эл. почта",
  phone: "Телефон",
  telegram: "Telegram",
  company: "Компания",
};
function dupFieldLabel(field: string): string {
  return DUP_FIELD_LABEL[field] || field;
}

function confidenceClasses(confidence: number): string {
  if (confidence >= 80) return "bg-red-100 text-red-700";
  if (confidence >= 60) return "bg-orange-100 text-orange-700";
  return "bg-amber-100 text-amber-700";
}

/**
 * Горизонтальная карусель миниатюр всех похожих кандидатов (scroll-snap).
 * Клик по карточке выбирает дубликат для подробного сравнения справа.
 */
function DuplicateCarousel({
  duplicates,
  selectedId,
  onSelect,
}: {
  duplicates: DuplicateCandidateResult[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollByCard = (dir: number) => {
    carouselRef.current?.scrollBy({ left: dir * 248, behavior: "smooth" });
  };
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="mr-auto text-[11px] uppercase tracking-wide text-slate-400">
          {duplicates.length > 1 ? `Похожие кандидаты (${duplicates.length})` : "Похожий кандидат"}
        </span>
        {duplicates.length > 1 && (
          <>
            <button
              onClick={() => scrollByCard(-1)}
              className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 transition-colors"
              aria-label="Предыдущий"
            >
              <ChevronLeft size={14} className="text-slate-500" />
            </button>
            <button
              onClick={() => scrollByCard(1)}
              className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 transition-colors"
              aria-label="Следующий"
            >
              <ChevronRight size={14} className="text-slate-500" />
            </button>
          </>
        )}
      </div>
      <div
        ref={carouselRef}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-thin pb-1 px-0.5 -mx-0.5"
      >
        {duplicates.map((dup) => {
          const selected = dup.entity_id === selectedId;
          return (
            <button
              key={dup.entity_id}
              onClick={() => onSelect(dup.entity_id)}
              className={`snap-start shrink-0 w-[220px] p-3 rounded-lg flex flex-col gap-2 text-left transition-colors border ${
                selected
                  ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${confidenceClasses(
                    dup.confidence
                  )}`}
                >
                  <Copy size={11} />
                  {dup.confidence}%
                </span>
                {selected && (
                  <span className="text-[10px] font-medium text-emerald-600">выбрано</span>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Avatar photo="" name={dup.entity_name} />
                <span className="font-medium text-slate-800 truncate">{dup.entity_name || "—"}</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap min-h-[18px]">
                {Object.keys(dup.matched_fields).map((field) => (
                  <span
                    key={field}
                    className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] text-slate-500"
                    title={`Совпадение: ${dupFieldLabel(field)}`}
                  >
                    {dupFieldLabel(field)}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusBlock({ side }: { side: Side }) {
  if (!side.statusLabel && side.history.length === 0) return null;
  return (
    <div className={`rounded-lg p-2.5 mb-3 ${side.isRejected ? "bg-red-50" : "bg-slate-50"}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Статус</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-xs font-medium rounded px-2 py-0.5 ${
            side.isRejected ? "bg-red-200 text-red-800" : "bg-blue-100 text-blue-800"
          }`}
        >
          {side.statusLabel || "—"}
        </span>
        {side.isRejected && side.rejectedAt && (
          <span className="text-xs text-red-600">отклонён {side.rejectedAt}</span>
        )}
      </div>
      {side.isRejected && side.rejectReason && (
        <div className="text-xs text-slate-700 mt-1.5">
          <span className="text-slate-400">Причина:</span> {side.rejectReason}
        </div>
      )}
      {side.history.length > 0 && (
        <div className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
          {side.history
            .slice(-4)
            .map((h) => [h.date, h.title].filter(Boolean).join(" "))
            .filter(Boolean)
            .join(" → ")}
        </div>
      )}
    </div>
  );
}

function ResumeFallbackRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
      <div className="text-slate-500 mb-0.5">{label}</div>
      <div className="text-slate-800 leading-relaxed whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function ResumeBlock({ resumes, text, extra }: { resumes: ResumeDemo[]; text: string; extra: ResumeExtra }) {
  const hasResume = resumes.length > 0 || !!text;
  const hasExtra = !!(extra.experience || extra.skills || extra.languages || extra.education);
  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
        Резюме{resumes.length > 1 ? ` (${resumes.length})` : ""}
      </div>
      {hasResume ? (
        <div className="space-y-2">
          {resumes.map((r, i) => (
            <div key={i} className="rounded-lg bg-slate-50 p-2.5 text-xs">
              {r.title && <div className="font-medium text-slate-800">{r.title}</div>}
              {r.subtitle && <div className="text-slate-500">{r.subtitle}</div>}
              {(r.sections || []).map((s, j) => (
                <div key={j} className="mt-1.5">
                  {s.title && <div className="text-slate-500">{s.title}</div>}
                  {(s.lines || []).length > 0 && (
                    <div className="text-slate-800 leading-relaxed whitespace-pre-wrap">
                      {(s.lines || []).join("\n")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {text && (
            <div className="rounded-lg bg-slate-50 p-2.5 text-xs whitespace-pre-wrap text-slate-800">
              {text}
            </div>
          )}
        </div>
      ) : hasExtra ? (
        // Полного резюме нет — показываем структурные поля (анкеты из расширения)
        <div className="space-y-2">
          <ResumeFallbackRow label="Опыт" value={extra.experience} />
          <ResumeFallbackRow label="Навыки" value={extra.skills} />
          <ResumeFallbackRow label="Языки" value={extra.languages} />
          <ResumeFallbackRow label="Образование" value={extra.education} />
        </div>
      ) : (
        <div className="text-sm text-slate-400">—</div>
      )}
    </div>
  );
}

function NotesBlock({ notes }: { notes: Array<{ text?: string; author?: string; date?: string }> }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Заметки</div>
      <div className="space-y-1.5">
        {notes.map((n, i) => (
          <div key={i} className="rounded-lg bg-slate-50 p-2 text-xs">
            <div className="text-slate-800 whitespace-pre-wrap">{n.text}</div>
            <div className="text-slate-400 mt-1">{[n.author, n.date].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Фото из hh — временные ссылки, протухают. На ошибку загрузки показываем
// инициалы вместо «битой картинки».
function Avatar({ photo, name }: { photo: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt={name}
        className="w-12 h-12 rounded-xl object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 text-sm font-semibold shrink-0">
      {initialsOf(name) || "?"}
    </div>
  );
}

function Column({
  title,
  side,
  matched,
}: {
  title: string;
  side: Side | null;
  matched: (key: FieldKey | "name") => boolean;
}) {
  if (!side) {
    return <div className="rounded-xl border border-slate-200 p-4 text-slate-400">—</div>;
  }
  const subtitle = [side.position, side.company].filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border border-slate-200 p-4 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-3">{title}</div>
      <div className="flex items-start gap-3 mb-3">
        <Avatar photo={side.photo} name={side.name} />
        <div className="min-w-0">
          <span className={`text-[15px] font-semibold ${matched("name") ? HL : "text-slate-900"}`}>
            {side.name || "—"}
          </span>
          {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
        </div>
      </div>

      <StatusBlock side={side} />

      <table className="w-full text-[13px]">
        <tbody>
          {FIELDS.map(({ key, label }) => (
            <tr key={key}>
              <td className="text-slate-400 py-0.5 align-top w-[90px]">{label}</td>
              <td className="py-0.5 text-right">
                <span className={matched(key) ? HL : "text-slate-700"}>{side[key] || "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ResumeBlock resumes={side.resumes} text={side.resumeText} extra={side.resumeExtra} />
      <NotesBlock notes={side.notes} />
    </div>
  );
}

export default function ShadowDuplicateBanner({ card, status, onResolved }: ShadowDuplicateBannerProps) {
  const hiddenId = (card.extra_data?.hidden_duplicate_id as number | undefined) ?? null;
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState(false);
  // triggerEntity — профиль hiddenId, по которому решается ПОКАЗ баннера (стабилен,
  // не зависит от выбора в карусели). archived — профиль ВЫБРАННОГО в модалке дубликата
  // (правая колонка сравнения), он меняется при клике по миниатюре.
  const [triggerEntity, setTriggerEntity] = useState<EntityWithRelations | null>(null);
  const [archived, setArchived] = useState<EntityWithRelations | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Полный список похожих кандидатов (карусель) + выбранный для сравнения справа.
  const [duplicates, setDuplicates] = useState<DuplicateCandidateResult[]>([]);
  const [selectedDupId, setSelectedDupId] = useState<number | null>(hiddenId);
  const [rightLoading, setRightLoading] = useState(false);

  // Подгружаем профиль дубля сразу (не только по клику «Проверить»), чтобы заранее
  // понять — это реальное совпадение или мусорный/устаревший флаг. Баннер по-прежнему
  // триггерится по hiddenId, поэтому грузим именно его для предпросмотра.
  useEffect(() => {
    if (hiddenId && !triggerEntity) {
      getEntity(hiddenId)
        .then((e) => {
          setTriggerEntity(e);
          // Изначально правая колонка = hiddenId (до открытия модалки/карусели).
          setArchived((prev) => prev ?? e);
        })
        .catch(() => {});
    }
  }, [hiddenId, triggerEntity]);

  if (!hiddenId || resolved) return null;

  // Загружает полный профиль выбранного дубликата в правую колонку сравнения.
  const loadSelected = async (id: number) => {
    setSelectedDupId(id);
    // Уже загруженный hiddenId переиспользуем без повторного запроса.
    if (archived && archived.id === id) return;
    setRightLoading(true);
    try {
      setArchived(await getEntity(id));
    } catch {
      toast.error("Не удалось загрузить профиль дубликата");
    } finally {
      setRightLoading(false);
    }
  };

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      // Тянем ВСЕХ похожих кандидатов (включая архив) для карусели.
      const list = await getDuplicateCandidates(card.id, true);
      setDuplicates(list);
      // Предвыбор: существующий hiddenId, если он в списке; иначе — самый
      // вероятный (список отсортирован по убыванию confidence на бэке).
      const preset =
        list.find((d) => d.entity_id === hiddenId)?.entity_id ?? list[0]?.entity_id ?? hiddenId;
      if (preset != null) {
        await loadSelected(preset);
      } else if (!archived) {
        // Список пуст — fallback на одиночное поведение по hiddenId.
        setArchived(triggerEntity ?? (await getEntity(hiddenId)));
      }
    } catch {
      // Если список не получили — не регрессируем: показываем одиночный hiddenId.
      if (!archived) {
        try {
          setArchived(triggerEntity ?? (await getEntity(hiddenId)));
        } catch {
          toast.error("Не удалось загрузить профиль дубликата");
        }
      }
      setSelectedDupId(hiddenId);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    const targetId = selectedDupId ?? hiddenId;
    if (targetId == null) return;
    setBusy(true);
    try {
      await mergeShadowDuplicate(card.id, targetId);
      toast.success("Профили объединены");
      setOpen(false);
      setResolved(true);
      onResolved?.();
    } catch {
      toast.error("Не удалось объединить профили");
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    const targetId = selectedDupId ?? hiddenId;
    if (targetId == null) return;
    setBusy(true);
    try {
      await dismissDuplicate(card.id, targetId);
      toast.success("Отмечено: это разные люди");
      setOpen(false);
      setResolved(true);
      onResolved?.();
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const left = fromCard(card, status);
  const right = archived ? fromEntity(archived) : null;
  const cardArchived = !!(card.extra_data?.is_archived as boolean | undefined);

  const matched = (key: FieldKey | "name"): boolean => {
    if (!right) return false;
    const a = (left as unknown as Record<string, string>)[key];
    const b = (right as unknown as Record<string, string>)[key];
    if (!a || !b) return false;
    if (key === "phone") return normPhone(a).length > 0 && normPhone(a) === normPhone(b);
    if (key === "telegram") return normTg(a) === normTg(b);
    return norm(a) === norm(b);
  };

  // Только реальные идентификаторы — по ним и матчит дедуп. Источник (hh.ru), город,
  // возраст, зарплата, опыт, метки совпадают у РАЗНЫХ людей и не являются причиной
  // слияния — не показываем их как «совпадение», иначе «Совпадение по: Источник» врёт.
  const IDENTITY_KEYS: (FieldKey | "name")[] = ["name", "phone", "email", "telegram"];
  const matchedKeys = right ? IDENTITY_KEYS.filter((k) => matched(k)) : [];
  const LBL: Record<string, string> = { name: "Имя", ...Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) };

  // Триггер баннера — отдельный матчинг ИМЕННО против hiddenId (triggerEntity),
  // не против выбранного в карусели дубликата. Иначе выбор «непохожего» кандидата
  // в открытой модалке обнулил бы matchedKeys и схлопнул бы весь баннер+модалку.
  const triggerSide = triggerEntity ? fromEntity(triggerEntity) : null;
  const triggerMatch = (key: FieldKey | "name"): boolean => {
    if (!triggerSide) return false;
    const a = (left as unknown as Record<string, string>)[key];
    const b = (triggerSide as unknown as Record<string, string>)[key];
    if (!a || !b) return false;
    if (key === "phone") return normPhone(a).length > 0 && normPhone(a) === normPhone(b);
    if (key === "telegram") return normTg(a) === normTg(b);
    return norm(a) === norm(b);
  };
  const triggerMatchedKeys = triggerSide ? IDENTITY_KEYS.filter((k) => triggerMatch(k)) : [];

  // Баннер показываем ТОЛЬКО при реальном совпадении по контактам
  // (имя/телефон/почта/telegram) С hiddenId. Дубль не загрузился или совпадений нет —
  // это ложный/устаревший флаг, баннер не мозолит глаза.
  if (!triggerEntity || triggerMatchedKeys.length === 0) return null;

  return (
    <>
      {/* Баннер над action-баром карточки */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-500 px-5 py-3 mb-4 shadow-sm">
        <div className="flex items-center gap-3 text-white">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="font-medium">Похожий кандидат есть в базе</span>
        </div>
        <button
          onClick={openModal}
          className="shrink-0 rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
        >
          Проверить
        </button>
      </div>

      {/* Белый экран сравнения */}
      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-semibold text-slate-900">Проверка похожих кандидатов</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Закрыть">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Карусель всех похожих кандидатов — выбор дубликата для сравнения */}
                  {duplicates.length > 0 && (
                    <DuplicateCarousel
                      duplicates={duplicates}
                      selectedId={selectedDupId}
                      onSelect={loadSelected}
                    />
                  )}

                  {matchedKeys.length > 0 ? (
                    <div className="mb-4 text-sm text-amber-700">
                      Совпадение по:{" "}
                      <span className="font-semibold text-amber-800">
                        {matchedKeys.map((k) => LBL[k]).join(", ")}
                      </span>
                    </div>
                  ) : (
                    <div className="mb-4 text-sm text-rose-600">
                      Нет совпадений по контактам (имя / телефон / почта / telegram) — вероятно, это разные люди.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Column title={cardArchived ? "Эта анкета (в архиве)" : "Новый кандидат"} side={left} matched={matched} />
                    {rightLoading ? (
                      <div className="rounded-xl border border-slate-200 p-4 flex items-center justify-center text-slate-400">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                    ) : (
                      <Column title="Старая анкета (дубликат)" side={right} matched={matched} />
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-slate-200 px-5 py-4 shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                После объединения у кандидата сохранятся оба резюме и история статусов.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  Закрыть
                </button>
                <button
                  disabled={busy}
                  onClick={handleDismiss}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Нет, это разные люди
                </button>
                <button
                  disabled={busy}
                  onClick={handleMerge}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Завершить объединение
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
