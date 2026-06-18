import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import toast from "react-hot-toast";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import { getEntity, mergeShadowDuplicate, dismissDuplicate } from "@/services/api/entities";

/**
 * Баннер «Похожий кандидат есть в базе» + полноэкранная сплит-модалка сравнения
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
  position: string;
  company: string;
  phone: string;
  email: string;
  salary: string;
  photo: string;
};

const norm = (v: string) => (v || "").trim().toLowerCase();
const normPhone = (v: string) => (v || "").replace(/\D/g, "").slice(-10);

function fromCard(card: KanbanCard): CompareSide {
  return {
    name: card.name || "",
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
    position: e.position || "",
    company: e.company || "",
    phone: e.phone || "",
    email: e.email || "",
    salary,
    photo: (e.extra_data?.photo_url as string) || "",
  };
}

const ROWS: { key: keyof CompareSide; label: string }[] = [
  { key: "position", label: "Должность" },
  { key: "company", label: "Компания" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Email" },
  { key: "salary", label: "Зарплата" },
];

function ColumnView({
  title,
  side,
  matched,
}: {
  title: string;
  side: CompareSide | null;
  matched: (key: keyof CompareSide) => boolean;
}) {
  if (!side) {
    return <div className="rounded-xl bg-white/5 p-5 text-white/50">—</div>;
  }
  const initials = side.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <div className="rounded-xl bg-white/5 p-5">
      <div className="text-xs uppercase tracking-wide text-white/40 mb-3">{title}</div>
      <div className="flex items-center gap-3 mb-4">
        {side.photo ? (
          <img src={side.photo} alt={side.name} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-white font-semibold">
            {initials || "?"}
          </div>
        )}
        <div
          className={`text-lg font-semibold px-2 py-0.5 rounded ${
            matched("name") ? "bg-yellow-200 text-slate-900" : "text-white"
          }`}
        >
          {side.name || "—"}
        </div>
      </div>
      <div className="space-y-2">
        {ROWS.map(({ key, label }) => (
          <div key={key} className="flex flex-col">
            <span className="text-xs text-white/40">{label}</span>
            <span
              className={`text-sm px-2 py-0.5 rounded ${
                matched(key) ? "bg-yellow-200 text-slate-900" : "text-white/90"
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

  const matched = (key: keyof CompareSide): boolean => {
    if (!right) return false;
    const a = left[key];
    const b = right[key];
    if (!a || !b) return false;
    if (key === "phone") {
      return normPhone(a).length > 0 && normPhone(a) === normPhone(b);
    }
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

      {/* Полноэкранная модалка сравнения */}
      {open && (
        <div className="fixed inset-0 z-[1000] flex flex-col bg-slate-900/95 backdrop-blur-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-semibold text-white">Проверка похожих кандидатов</h2>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="text-center text-white/70 py-20">Загрузка…</div>
            ) : (
              <div className="mx-auto max-w-4xl grid grid-cols-2 gap-6">
                <ColumnView title="Новый кандидат" side={left} matched={matched} />
                <ColumnView title="В базе (архив)" side={right} matched={matched} />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-3 px-6 py-5 border-t border-white/10">
            <button
              disabled={busy}
              onClick={handleMerge}
              className="w-full max-w-xs rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              Объединить
            </button>
            <button
              disabled={busy}
              onClick={handleDismiss}
              className="w-full max-w-xs rounded-lg bg-red-500 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              Нет, это разные люди
            </button>
            <button
              disabled={busy}
              onClick={() => setOpen(false)}
              className="w-full max-w-xs rounded-lg border border-white/30 px-4 py-2.5 font-semibold text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </>
  );
}
