import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Search, RotateCcw, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  listArchivedCandidates,
  unarchiveEntity,
  type ArchivedCandidate,
} from "@/services/api/entities";

/**
 * Суперадминская страница «Архив кандидатов» (теневая база).
 * Доступна через шестерёнку (HR_SETTINGS_ORG_ITEMS) рядом с «Факториалом»,
 * маршрут /candidate-archive под RoleRoute allow={['superadmin']}.
 */
export default function CandidateArchivePage() {
  const [items, setItems] = useState<ArchivedCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const res = await listArchivedCandidates({ q: query, page: 1, per_page: 100 });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      toast.error("Не удалось загрузить архив");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const handleRestore = async (id: number) => {
    setRestoring(id);
    try {
      await unarchiveEntity(id);
      toast.success("Кандидат возвращён в активную базу");
      setItems((prev) => prev.filter((x) => x.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      toast.error("Не удалось вернуть из архива");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Archive className="w-6 h-6 text-amber-600" />
        <h1 className="text-2xl font-semibold">Архив кандидатов</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Теневая база — кандидаты из массового импорта (CSV/парсер) и вручную
        архивированные. Скрыты из активных списков, канбана и поиска; видны только
        суперадмину.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по имени, email, телефону, должности…"
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      <div className="text-xs text-gray-400 mb-2">Всего в архиве: {total}</div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Архив пуст</div>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/all-candidates?entity=${c.id}&archived=1`)}
              title="Открыть карточку кандидата"
              className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 cursor-pointer hover:border-amber-300 hover:bg-amber-50/40 transition-colors"
            >
              {c.photo_url ? (
                <img
                  src={c.photo_url}
                  alt={c.name}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-sm font-medium">
                  {c.name?.[0]?.toUpperCase() || "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {[c.position, c.company].filter(Boolean).join(" · ")}
                  {(c.phone || c.email) && (c.position || c.company) ? " · " : ""}
                  {[c.phone, c.email].filter(Boolean).join(" · ")}
                </div>
              </div>
              {c.source && (
                <span className="text-xs text-gray-400 shrink-0">{c.source}</span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRestore(c.id);
                }}
                disabled={restoring === c.id}
                className="shrink-0 flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" /> Вернуть
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
