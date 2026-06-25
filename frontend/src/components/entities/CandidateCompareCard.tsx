import { useState } from "react";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import { STATUS_LABELS } from "@/types";
import { sanitizeHtml } from "@/utils/sanitizeHtml";

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

export type FieldKey = "phone" | "email" | "telegram" | "age" | "city" | "salary" | "experience" | "source" | "tags";

// String() coercion: значения полей (age/salary/experience) из API могут прийти
// числом, а не строкой — без приведения .trim() падает «(e||"").trim is not a function».
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const normPhone = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const normTg = (v: unknown) => String(v ?? "").trim().replace(/^@/, "").toLowerCase();
const HL = "bg-amber-100 text-amber-900 rounded px-1.5 py-0.5";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "salary", label: "Зарплата" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Эл. почта" },
  { key: "telegram", label: "Telegram" },
  { key: "age", label: "Возраст" },
  { key: "city", label: "Город" },
  { key: "experience", label: "Опыт" },
  { key: "source", label: "Источник" },
  { key: "tags", label: "Метки" },
];

// Поле → RU-метка для чипов «совпало по …» на карточке дубликата.
const DUP_FIELD_LABEL: Record<string, string> = {
  phone: "Телефон",
  email: "Эл. почта",
  telegram: "Telegram",
  name: "Имя",
  full_name: "Имя",
  position: "Должность",
  company: "Компания",
  city: "Город",
  age: "Возраст",
  salary: "Зарплата",
  experience: "Опыт",
  source: "Источник",
  tags: "Метки",
};

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
  matchedFields,
  entityId,
  vacancies,
}: {
  title: string;
  side: Side | null;
  matched: (key: FieldKey | "name") => boolean;
  confidence?: number;
  matchedFields?: string[];
  entityId?: number;
  vacancies?: SystemHrTag[];
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
          <span className={`text-2xl font-bold leading-tight ${matched("name") ? HL : "text-slate-900"}`}>
            {side.name || "—"}
          </span>
          {subtitle && <div className="text-sm text-slate-500 mt-1.5">{subtitle}</div>}
          {matchedFields && matchedFields.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {matchedFields.map((f) => (
                <span
                  key={f}
                  className="text-[10px] font-medium rounded bg-amber-50 text-amber-700 px-1.5 py-0.5"
                >
                  {DUP_FIELD_LABEL[f] || f}
                </span>
              ))}
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
              <span className={matched(key) ? HL : side[key] ? "text-slate-800" : "text-slate-300"}>
                {side[key] || "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      <ResumeBlock resumes={side.resumes} text={side.resumeText} extra={side.resumeExtra} />
      <NotesBlock notes={side.notes} />
    </div>
  );
}
