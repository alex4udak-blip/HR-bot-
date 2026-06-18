import { useState } from "react";
import { AlertTriangle, X, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import { getEntity, mergeShadowDuplicate, dismissDuplicate } from "@/services/api/entities";

/**
 * Баннер «Похожий кандидат есть в базе» + полноэкранный экран сравнения
 * «Проверка похожих кандидатов»: новый активный кандидат vs его теневой
 * (архивный) дубль — две колонки с фото и полями, совпадения подсвечены жёлтым.
 *
 * Показывается, когда у карточки есть extra_data.hidden_duplicate_id.
 * Три действия: Объединить (merge) / Нет, это разные люди (dismiss) / Закрыть.
 */

interface ShadowDuplicateBannerProps {
  card: KanbanCard;
  onResolved?: () => void;
}

type CompareSide = {
  name: string;
  position: string;
  company: string;
  salary: string;
  phone: string;
  email: string;
  skype: string;
  telegram: string;
  age: string;
  photo: string;
};

type FieldKey = "salary" | "phone" | "email" | "skype" | "telegram" | "age";

const norm = (v: string) => (v || "").trim().toLowerCase();
const normPhone = (v: string) => (v || "").replace(/\D/g, "").slice(-10);
const normTg = (v: string) => (v || "").trim().replace(/^@/, "").toLowerCase();

const ROWS: { key: FieldKey; label: string }[] = [
  { key: "salary", label: "Зарплата" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Эл. почта" },
  { key: "skype", label: "Скайп" },
  { key: "telegram", label: "Telegram" },
  { key: "age", label: "Возраст" },
];

function computeAge(birthDate?: string): string {
  if (!birthDate) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return "";
  const birthYear = parseInt(m[1], 10);
  const today = new Date();
  let age = today.getFullYear() - birthYear;
  const md = (today.getMonth() + 1) * 100 + today.getDate();
  const bmd = parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
  if (md < bmd) age -= 1;
  if (age < 14 || age > 100) return "";
  return `${age} лет`;
}

function salaryFromEntity(e: EntityWithRelations): string {
  const cur = e.expected_salary_currency || "";
  const lo = e.expected_salary_min;
  const hi = e.expected_salary_max;
  if (lo && hi) return `${lo.toLocaleString()}–${hi.toLocaleString()} ${cur}`.trim();
  if (lo) return `от ${lo.toLocaleString()} ${cur}`.trim();
  if (hi) return `до ${hi.toLocaleString()} ${cur}`.trim();
  return "";
}

function fromCard(card: KanbanCard): CompareSide {
  const extra = (card.extra_data || {}) as Record<string, unknown>;
  return {
    name: card.name || "",
    position: card.position || "",
    company: card.company || "",
    salary: card.salary || "",
    phone: card.phone || "",
    email: card.email || "",
    skype: (extra.skype as string) || "",
    telegram: card.telegram_username || "",
    age: card.age || computeAge(extra.birth_date as string | undefined),
    photo: card.photo_url || ((extra.photo_url as string) || ""),
  };
}

function fromEntity(e: EntityWithRelations): CompareSide {
  const extra = (e.extra_data || {}) as Record<string, unknown>;
  return {
    name: e.name || "",
    position: e.position || "",
    company: e.company || "",
    salary: salaryFromEntity(e),
    phone: e.phone || "",
    email: e.email || "",
    skype: (extra.skype as string) || "",
    telegram: (e.telegram_usernames && e.telegram_usernames[0]) || "",
    age: (extra.age as string) || computeAge(extra.birth_date as string | undefined),
    photo: (extra.photo_url as string) || "",
  };
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}

const HL = "bg-yellow-200 text-slate-900";

function ColumnView({
  title,
  side,
  matched,
}: {
  title: string;
  side: CompareSide | null;
  matched: (key: FieldKey | "name") => boolean;
}) {
  if (!side) {
    return <div className="rounded-2xl bg-white/[0.03] p-6 text-white/40">—</div>;
  }
  const subtitle = [side.position, side.company].filter(Boolean).join(" • ");
  return (
    <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-6">
      <div className="text-[11px] uppercase tracking-wide text-white/30 mb-4">{title}</div>

      <div className="flex items-start gap-4 mb-4">
        {side.photo ? (
          <img src={side.photo} alt={side.name} className="w-24 h-24 rounded-2xl object-cover shrink-0" />
        ) : (
          <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center text-white/70 text-xl font-semibold shrink-0">
            {initialsOf(side.name) || "?"}
          </div>
        )}
        <div className="min-w-0 pt-1">
          <span
            className={`inline-block text-xl font-bold leading-snug rounded px-1.5 py-0.5 ${
              matched("name") ? HL : "text-white"
            }`}
          >
            {side.name || "—"}
          </span>
          {subtitle && <div className="mt-2 text-sm text-white/50 leading-snug">{subtitle}</div>}
        </div>
      </div>

      <div className="space-y-3">
        {ROWS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-xs text-white/40">{label}</span>
            <span
              className={`text-[15px] rounded px-1.5 py-0.5 self-start ${
                matched(key) ? HL : "text-white/90"
              }`}
            >
              {side[key] || "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ShadowDuplicateBanner({ card, onResolved }: ShadowDuplicateBannerProps) {
  const hiddenId = (card.extra_data?.hidden_duplicate_id as number | undefined) ?? null;
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState(false);
  const [archived, setArchived] = useState<EntityWithRelations | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!hiddenId || resolved) return null;

  const openModal = async () => {
    setOpen(true);
    if (!archived) {
      setLoading(true);
      try {
        setArchived(await getEntity(hiddenId));
      } catch {
        toast.error("Не удалось загрузить архивный профиль");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleMerge = async () => {
    setBusy(true);
    try {
      await mergeShadowDuplicate(card.id, hiddenId);
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
    setBusy(true);
    try {
      await dismissDuplicate(card.id, hiddenId);
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

  const cardArchived = !!(card.extra_data?.is_archived as boolean | undefined);
  const left = fromCard(card);
  const right = archived ? fromEntity(archived) : null;

  const matched = (key: FieldKey | "name"): boolean => {
    if (!right) return false;
    const a = left[key];
    const b = right[key];
    if (!a || !b) return false;
    if (key === "phone") return normPhone(a).length > 0 && normPhone(a) === normPhone(b);
    if (key === "telegram") return normTg(a) === normTg(b);
    return norm(a) === norm(b);
  };

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

      {/* Полноэкранный экран сравнения */}
      {open && (
        <div className="fixed inset-0 z-[1000] flex flex-col bg-slate-900/95 backdrop-blur-sm">
          <div className="relative flex items-center justify-center px-6 py-4 border-b border-white/10 shrink-0">
            <h2 className="text-base font-medium text-white/90">Проверка похожих кандидатов</h2>
            <button
              onClick={() => setOpen(false)}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="relative flex-1 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-full text-white/50">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
            ) : (
              <>
                <div className="h-full overflow-auto px-6 py-6">
                  <div className="mx-auto max-w-5xl grid grid-cols-2 gap-6">
                    <ColumnView title={cardArchived ? "Этот кандидат (в архиве)" : "Этот кандидат"} side={left} matched={matched} />
                    <ColumnView title="Найденный дубликат" side={right} matched={matched} />
                  </div>
                </div>

                {/* Кнопки действий — плавающей стопкой по центру */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-full max-w-sm px-4 flex flex-col gap-3">
                  <button
                    disabled={busy}
                    onClick={handleMerge}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-white shadow-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    Объединить
                  </button>
                  <button
                    disabled={busy}
                    onClick={handleDismiss}
                    className="rounded-xl bg-red-500 px-4 py-3 font-semibold text-white shadow-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    Нет, это разные люди
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-white px-4 py-3 font-semibold text-slate-700 shadow-lg hover:bg-slate-100 disabled:opacity-50 transition-colors"
                  >
                    Закрыть
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
