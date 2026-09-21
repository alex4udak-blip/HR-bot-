import { useState } from "react";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import { STATUS_LABELS } from "@/types";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import { CompareResumePreview } from "./CompareResumePreview";
import type { MergeFieldKey, MergeSide } from "@/services/api/entities";

/**
 * Презентационная «карточка сравнения кандидата» + её типы, билдеры данных и
 * хелперы. ОДИН компонент рендерит и левую «Новый кандидат», и каждую правую
 * «Старую анкету (дубликат)». Для дубликатов опционально показывает бейдж
 * уверенности (%) и чипы совпавших полей. Markup и Tailwind-классы намеренно
 * сохранены байт-в-байт, чтобы рендер карточки не изменился.
 */

export interface ResumeDemo {
  title?: string;
  subtitle?: string;
  salary?: string;
  vacancy_title?: string;
  sections?: Array<{ title?: string; lines?: string[] }>;
}

export interface TimelineEvent {
  date?: string;
  title?: string;
}

// Резюме-текста часто нет (анонимные hh-анкеты из расширения), но есть
// структурные поля — показываем их как резюме, чтобы блок не был пустым.
export type ResumeExtra = {
  experience: string;
  skills: string;
  languages: string;
  education: string;
};

export type Side = {
  name: string;
  photo: string;
  position: string;
  company: string;
  phone: string;
  email: string;
  telegram: string;
  age: string;
  birthDate: string;
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

export type FieldKey =
  | "phone" | "email" | "telegram" | "birthDate" | "age" | "city"
  | "salary" | "experience" | "source" | "tags";

/** Насколько совпало поле: точно (идентификатор) или частично (мягкий сигнал). */
export type MatchKind = "exact" | "partial" | null;

// String() coercion: значения полей (age/salary/experience) из API могут прийти
// числом, а не строкой — без приведения .trim() падает «(e||"").trim is not a function».
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const normPhone = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const normTg = (v: unknown) => String(v ?? "").trim().replace(/^@/, "").toLowerCase();
const HL = "bg-amber-100 text-amber-900 rounded px-1.5 py-0.5";
// Частичное совпадение (мягкий сигнал: 7 цифр телефона, возраст ±1) НЕ должно
// выглядеть как точное — иначе разные номера подсвечены одинаково и кажется,
// что система ошиблась.
const HL_PARTIAL =
  "rounded px-1.5 py-0.5 text-amber-900 underline decoration-dashed decoration-amber-400 underline-offset-4";

function hlClass(kind: MatchKind): string {
  if (kind === "exact") return HL;
  if (kind === "partial") return HL_PARTIAL;
  return "";
}

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "salary", label: "Зарплата" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Эл. почта" },
  { key: "telegram", label: "Telegram" },
  // Дата рождения — видимое поле: мягкий тир часто держится ИМЕННО на ней, а
  // проверить её в карточке было негде (владелец 17.09.2026: «справа нет никакой
  // инфы, но всё равно есть совпадение»).
  { key: "birthDate", label: "Дата рождения" },
  { key: "age", label: "Возраст" },
  { key: "city", label: "Город" },
  { key: "experience", label: "Опыт" },
  { key: "source", label: "Источник" },
  { key: "tags", label: "Метки" },
];

/** Дата рождения из extra_data в едином виде ДД.ММ.ГГГГ (источники пишут
 *  и «1990-05-14», и «14.05.1990»). */
function birthParts(birthDate?: string): { y: number; m: number; d: number } | null {
  if (!birthDate) return null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
  const ru = /(\d{2})[.\/](\d{2})[.\/](\d{4})/.exec(birthDate);
  if (ru) return { y: +ru[3], m: +ru[2], d: +ru[1] };
  return null;
}

function formatBirth(birthDate?: string): string {
  const p = birthParts(birthDate);
  if (!p) return "";
  return `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}`;
}

function computeAge(birthDate?: string): string {
  const p = birthParts(birthDate);
  if (!p) return "";
  const today = new Date();
  let age = today.getFullYear() - p.y;
  if ((today.getMonth() + 1) * 100 + today.getDate() < p.m * 100 + p.d) age -= 1;
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

// Текст резюме для сравнения. Импортированные (архивные) кандидаты из CSV/ClickUp
// не имеют resume_text — их резюме лежит в description (текст формы ClickUp) и в
// cf:* полях (как читает собственная карточка, ResumeTab). Без этого фолбэка
// правая (архивная) анкета в сравнении показывала «—», хотя данные есть.
function resumeTextFrom(extra: Record<string, unknown> | undefined): string {
  const e = extra || {};
  if (typeof e.resume_text === "string" && e.resume_text.trim()) return e.resume_text;
  if (typeof e.description === "string" && e.description.trim()) return e.description;
  const cf = Object.entries(e)
    .filter(([k, v]) => k.startsWith("cf:") && typeof v === "string" && (v as string).trim())
    .map(([k, v]) => `${k.slice(3).trim()}: ${v}`);
  return cf.join("\n");
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
    .map((n) => {
      let date = (n.date as string) || "";
      // Убираем timezone offset: "2026-06-24T22:18:32.047491+00:00" → "2026-06-24T22:18:32"
      date = date.replace(/\.\d+[+-]\d{2}:\d{2}$/, "");
      return { text: n.text as string, author: n.author_name as string, date };
    });
}

export function sideFromCard(card: KanbanCard, statusKey?: string): Side {
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
    birthDate: formatBirth(extra.birth_date as string | undefined),
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
    resumeText: resumeTextFrom(extra),
    resumeExtra: resumeExtraFrom(extra),
    notes: notesFrom(extra),
  };
}

export function sideFromEntity(e: EntityWithRelations): Side {
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
    phone: e.phone || (e.phones && e.phones[0]) || "",
    email: e.email || (e.emails && e.emails[0]) || "",
    telegram: (e.telegram_usernames && e.telegram_usernames[0]) || "",
    age: (extra.age as string) || computeAge(extra.birth_date as string | undefined),
    birthDate: formatBirth(extra.birth_date as string | undefined),
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
    resumeText: resumeTextFrom(extra),
    resumeExtra: resumeExtraFrom(extra),
    notes: notesFrom(extra),
  };
}

// Поле сигнала с бэка (duplicate_matcher.DupSignal.field) → поле карточки.
const SIGNAL_FIELD_TO_SIDE: Record<string, FieldKey | "name"> = {
  name: "name",
  email: "email",
  phone: "phone",
  telegram: "telegram",
  birth_date: "birthDate",
  age: "age",
  city: "city",
  source: "source",
};

export type DupSignalLike = { field: string; label: string; identity: boolean };

/**
 * Насколько совпало поле — по сигналам БЭКА, а не по сравнению строк на фронте.
 *
 * ВИД подсветки отвечает на вопрос «значения одинаковые?», а не «насколько
 * сильный это признак»: у пары на 83% сигнал «совпал телефон» означал совпадение
 * последних 7 цифр при РАЗНЫХ номерах (+7 495… и +7 916…) — такое поле красим
 * пунктиром, а одинаковые дату рождения и город — сплошной заливкой, как раньше.
 * Силу признака (идентификатор / косвенный) показывает блок «почему считаем
 * дублем», а не подсветка. Фолбэк на matchSide работает, пока сигналов нет.
 */
export function matchKindOf(
  signals: DupSignalLike[] | undefined,
  key: FieldKey | "name",
  sameValue: () => boolean,
): MatchKind {
  if (signals && signals.length > 0) {
    const hit = signals.find((s) => SIGNAL_FIELD_TO_SIDE[s.field] === key);
    if (!hit) return null;
    return sameValue() ? "exact" : "partial";
  }
  return sameValue() ? "exact" : null;
}

// Совпадение поля между двумя сторонами: телефон через normPhone, telegram через
// normTg, остальное — равенство norm. false, если любая из сторон отсутствует.
export function matchSide(left: Side, right: Side | null, key: FieldKey | "name"): boolean {
  if (!right) return false;
  const a = (left as unknown as Record<string, string>)[key];
  const b = (right as unknown as Record<string, string>)[key];
  if (!a || !b) return false;
  if (key === "phone") return normPhone(a).length > 0 && normPhone(a) === normPhone(b);
  if (key === "telegram") return normTg(a) === normTg(b);
  return norm(a) === norm(b);
}

function initialsOf(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
}

function StatusBlock({ side, vacancies }: { side: Side; vacancies?: SystemHrTag[] }) {
  if (!side.statusLabel && side.history.length === 0 && (!vacancies || vacancies.length === 0)) return null;
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
        {vacancies && vacancies.length > 0 && (
          <span className="text-xs text-slate-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            {vacancies.map((v) => v.vacancy_title || "Без вакансии").join(", ")}
          </span>
        )}
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

function NotesBlock({ notes }: { notes: Array<{ text?: string; author?: string; date?: string }> }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Заметки</div>
      <div className="space-y-1.5">
        {notes.map((n, i) => (
          <div key={i} className="rounded-lg bg-slate-50 p-2 text-xs">
            <div
              className="text-slate-800 whitespace-pre-wrap hf-rich-content"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.text) }}
            />
            <div className="text-slate-400 mt-1">{[n.author, n.date].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Фото из hh — временные ссылки, протухают. На ошибку загрузки показываем
// инициалы вместо «битой картинки». Крупный портрет (как на эталоне сравнения).
function Avatar({ photo, name }: { photo: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt={name}
        className="w-28 h-32 rounded-xl object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-28 h-32 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-3xl font-semibold shrink-0">
      {initialsOf(name) || "?"}
    </div>
  );
}

// Цветовые тиры бейджа уверенности дубликата.
function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 80) return "bg-red-100 text-red-700";
  if (confidence >= 60) return "bg-orange-100 text-orange-700";
  return "bg-amber-100 text-amber-700";
}

export type SystemHrTag = {
  hr_id: number;
  name: string;
  vacancy_id?: number;
  vacancy_title?: string;
};

export function CandidateCompareCard({
  title,
  side,
  matched,
  confidence,
  signals,
  entityId,
  vacancies,
  extraData,
}: {
  title: string;
  side: Side | null;
  matched: (key: FieldKey | "name") => MatchKind;
  confidence?: number;
  /** Сигналы пары с бэка: из них строится блок «почему совпало». */
  signals?: DupSignalLike[];
  entityId?: number;
  vacancies?: SystemHrTag[];
  /** extra_data анкеты — из неё берутся распарсенные версии резюме. */
  extraData?: Record<string, unknown>;
}) {
  if (!side) {
    return <div className="rounded-xl border border-slate-200 p-4 text-slate-400">—</div>;
  }
  const subtitle = [side.position, side.company].filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border border-slate-200 p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">{title}</span>
        {entityId && (
          <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
            ID: {entityId}
          </span>
        )}
        {confidence != null && (
          <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${confidenceBadgeClass(confidence)}`}>
            {confidence}%
          </span>
        )}
      </div>
      {/* Шапка: крупное портретное фото сверху, под ним — большое имя и
          должность·компания (как на эталоне сравнения). */}
      <div className="mb-4">
        <Avatar photo={side.photo} name={side.name} />
        <div className="min-w-0 mt-3">
          <span className={`text-2xl font-bold leading-tight ${hlClass(matched("name")) || "text-slate-900"}`}>
            {side.name || "—"}
          </span>
          {subtitle && <div className="text-sm text-slate-500 mt-1.5">{subtitle}</div>}
          {signals && signals.length > 0 && (
            /* Почему пара считается дублем — с конкретными значениями обеих
               сторон. Раньше тут были чипы с одним лишь названием поля, и по
               ним нельзя было понять, что «Телефон» — это совпавшие последние
               7 цифр у РАЗНЫХ номеров, а «Дата рождения» вообще не показана. */
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2">
              <div className="text-[10px] uppercase tracking-wide text-amber-700/80 mb-1">
                Почему считаем дублем
              </div>
              <div className="space-y-1">
                {signals.map((sig) => (
                  <div key={`${sig.field}-${sig.label}`} className="flex items-start gap-1.5 text-[11px]">
                    <span
                      className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        sig.identity ? "bg-red-500" : "bg-amber-400"
                      }`}
                    />
                    <span className="text-slate-700">{sig.label}</span>
                  </div>
                ))}
              </div>
              {signals.some((sig) => !sig.identity) && (
                <div className="mt-1.5 text-[10px] leading-snug text-amber-700/70">
                  Оранжевым — косвенные признаки: сами по себе они не доказывают,
                  что это один человек.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <StatusBlock side={side} vacancies={vacancies} />

      {/* Поля: лейбл над значением, слева — как на эталоне сравнения. Совпавшие
          значения подсвечены янтарём (HL); незаполненные — серый прочерк. */}
      <div className="space-y-3">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="text-[13px] text-slate-400 mb-0.5">{label}</div>
            <div className="text-[15px] leading-snug">
              <span
                className={hlClass(matched(key)) || (side[key] ? "text-slate-800" : "text-slate-300")}
                title={matched(key) === "partial" ? "Совпало частично — сверьте значения" : undefined}
              >
                {side[key] || "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Само загруженное резюме (PDF/сканы), с откатом на текстовую версию. */}
      <CompareResumePreview
        entityId={entityId}
        extraData={extraData}
        parts={{ resumes: side.resumes, text: side.resumeText, extra: side.resumeExtra }}
      />
      <NotesBlock notes={side.notes} />
    </div>
  );
}

// ── Пополевое слияние: план «что оставить» ──

/**
 * Поле плана слияния.
 * - conflict — заполнено с обеих сторон и различается: выбирает рекрутёр;
 * - fill     — слева пусто, справа есть: по умолчанию берём справа;
 * - keep     — справа пусто или совпадает: остаётся как слева, выбирать нечего.
 */
export type MergeRowKind = "conflict" | "fill" | "keep";

export type MergeRow = {
  key: MergeFieldKey;
  label: string;
  left: string;
  right: string;
  kind: MergeRowKind;
};

// Поле карточки сравнения → поле бэка (MERGE_FIELD_KEYS) и подпись.
const MERGE_FIELDS: { side: keyof Side; key: MergeFieldKey; label: string }[] = [
  { side: "name", key: "name", label: "ФИО" },
  { side: "position", key: "position", label: "Должность" },
  { side: "company", key: "company", label: "Компания" },
  { side: "phone", key: "phone", label: "Основной телефон" },
  { side: "email", key: "email", label: "Основная почта" },
  { side: "telegram", key: "telegram", label: "Основной Telegram" },
  { side: "city", key: "city", label: "Город" },
  { side: "birthDate", key: "birth_date", label: "Дата рождения" },
  { side: "salary", key: "salary", label: "Зарплата" },
  { side: "experience", key: "total_experience", label: "Опыт" },
  { side: "source", key: "source", label: "Источник" },
];

function sameValue(key: MergeFieldKey, a: string, b: string): boolean {
  if (key === "phone") return normPhone(a) === normPhone(b);
  if (key === "telegram") return normTg(a) === normTg(b);
  return norm(a) === norm(b);
}

/**
 * Что будет с каждым полем при слиянии правой анкеты в левую (левая — выжившая).
 * Раньше «Объединить» молча оставлял всё слева, и значения справа терялись;
 * теперь по конфликтам решает рекрутёр.
 */
export function buildMergePlan(left: Side, right: Side): MergeRow[] {
  const rows: MergeRow[] = [];
  for (const f of MERGE_FIELDS) {
    const l = String(left[f.side] ?? "").trim();
    const r = String(right[f.side] ?? "").trim();
    if (!l && !r) continue;
    let kind: MergeRowKind = "keep";
    if (!l && r) kind = "fill";
    else if (l && r && !sameValue(f.key, l, r)) kind = "conflict";
    rows.push({ key: f.key, label: f.label, left: l, right: r, kind });
  }
  return rows;
}

/** Выбор по умолчанию: при конфликте — как слева (прежнее поведение), пустое — заполнить справа. */
export function defaultMergeChoices(plan: MergeRow[]): Partial<Record<MergeFieldKey, MergeSide>> {
  const out: Partial<Record<MergeFieldKey, MergeSide>> = {};
  for (const row of plan) {
    if (row.kind === "conflict") out[row.key] = "target";
    else if (row.kind === "fill") out[row.key] = "source";
  }
  return out;
}
