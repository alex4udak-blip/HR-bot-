import { useState } from "react";
import { AlertTriangle, X, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import { getEntity, mergeShadowDuplicate, dismissDuplicate } from "@/services/api/entities";

/**
 * Баннер «Похожий кандидат есть в базе» + центрированная модалка сравнения
 * нового активного кандидата с его теневым (архивным) дубликатом.
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
  telegram: string;
  position: string;
  company: string;
  phone: string;
  email: string;
  salary: string;
  photo: string;
};

type FieldKey = Exclude<keyof CompareSide, "photo">;

const norm = (v: string) => (v || "").trim().toLowerCase();
const normPhone = (v: string) => (v || "").replace(/\D/g, "").slice(-10);
const normTg = (v: string) => (v || "").trim().replace(/^@/, "").toLowerCase();

const LABELS: Record<FieldKey, string> = {
  name: "Имя",
  telegram: "Telegram",
  position: "Должность",
  company: "Компания",
  phone: "Телефон",
  email: "Email",
  salary: "Зарплата",
};

// Строки таблицы сравнения (имя выводится отдельно в шапке колонки)
const ROWS: FieldKey[] = ["position", "company", "phone", "email", "telegram", "salary"];

function fromCard(card: KanbanCard): CompareSide {
  return {
    name: card.name || "",
    telegram: card.telegram_username || "",
    position: card.position || "",
    company: card.company || "",
    phone: card.phone || "",
    email: card.email || "",
    salary: card.salary || "",
    photo: card.photo_url || ((card.extra_data?.photo_url as string) || ""),
  };
}

function fromEntity(e: EntityWithRelations): CompareSide {
  const cur = e.expected_salary_currency || "";
  const lo = e.expected_salary_min;
  const hi = e.expected_salary_max;
  let salary = "";
  if (lo && hi) salary = `${lo.toLocaleString()}–${hi.toLocaleString()} ${cur}`.trim();
  else if (lo) salary = `от ${lo.toLocaleString()} ${cur}`.trim();
  else if (hi) salary = `до ${hi.toLocaleString()} ${cur}`.trim();
  return {
    name: e.name || "",
    telegram: (e.telegram_usernames && e.telegram_usernames[0]) || "",
    position: e.position || "",
    company: e.company || "",
    phone: e.phone || "",
    email: e.email || "",
    salary,
    photo: (e.extra_data?.photo_url as string) || "",
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

function ColumnView({
  title,
  side,
  rows,
  matched,
}: {
  title: string;
  side: CompareSide | null;
  rows: FieldKey[];
  matched: (key: FieldKey) => boolean;
}) {
  if (!side) {
    return (
      <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-4 text-white/40 text-sm">
        —
      </div>
    );
  }
  const hl = "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30";
  return (
    <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-[11px] uppercase tracking-wide text-white/40 mb-3">{title}</div>
      <div className="flex items-center gap-3 mb-4">
        {side.photo ? (
          <img src={side.photo} alt={side.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/80 text-sm font-semibold shrink-0">
            {initialsOf(side.name) || "?"}
          </div>
        )}
        <span
          className={`text-base font-semibold rounded px-1.5 py-0.5 ${
            matched("name") ? hl : "text-white"
          }`}
        >
          {side.name || "—"}
        </span>
      </div>
      <div className="space-y-2.5">
        {rows.map((key) => (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/40">{LABELS[key]}</span>
            <span
              className={`text-sm rounded px-1.5 py-0.5 self-start ${
                matched(key) ? hl : "text-white/85"
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

  const left = fromCard(card);
  const right = archived ? fromEntity(archived) : null;

  const matched = (key: FieldKey): boolean => {
    if (!right) return false;
    const a = left[key];
    const b = right[key];
    if (!a || !b) return false;
    if (key === "phone") return normPhone(a).length > 0 && normPhone(a) === normPhone(b);
    if (key === "telegram") return normTg(a) === normTg(b);
    return norm(a) === norm(b);
  };

  // Какие поля совпали — для строки «Совпадение по: …»
  const matchedKeys: FieldKey[] = right
    ? (["name", ...ROWS] as FieldKey[]).filter((k) => matched(k))
    : [];
  // Показываем строку, только если хоть у одной стороны есть значение (или совпадение) —
  // чтобы не было «простыни» из «—».
  const visibleRows = ROWS.filter((key) => left[key] || (right && right[key]) || matched(key));

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

      {/* Центрированная модалка сравнения */}
      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-slate-800 text-white shadow-2xl ring-1 ring-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold">Похожий кандидат в архиве</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-white/50 hover:text-white transition-colors"
                aria-label="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-white/50">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  {matchedKeys.length > 0 && (
                    <div className="mb-4 text-sm text-amber-300/90">
                      Совпадение по:{" "}
                      <span className="font-medium">
                        {matchedKeys.map((k) => LABELS[k]).join(", ")}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <ColumnView title="Новый (активный)" side={left} rows={visibleRows} matched={matched} />
                    <ColumnView title="В архиве" side={right} rows={visibleRows} matched={matched} />
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-white/10 px-5 py-4">
              <p className="text-xs text-white/40 mb-3">
                «Объединить» перенесёт историю архивного профиля в этого кандидата и уберёт дубль из архива.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm text-white/60 hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  Закрыть
                </button>
                <button
                  disabled={busy}
                  onClick={handleDismiss}
                  className="rounded-lg border border-red-400/40 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  Нет, это разные люди
                </button>
                <button
                  disabled={busy}
                  onClick={handleMerge}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Объединить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
