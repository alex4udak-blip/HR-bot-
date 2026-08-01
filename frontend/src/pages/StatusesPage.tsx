import { useEffect, useMemo, useState, useCallback } from "react";
import { Users, Search, Loader2, UserCheck, UserX } from "lucide-react";
import toast from "react-hot-toast";
import {
  getEmployees,
  updateEmployee,
  type EmployeeData,
} from "@/services/api/employees";

/**
 * Страница «Статусы» — все, кто прошёл в штат (действующие + уволенные).
 * Слева 3 папки-направления (трафик / rnd / разработка) + «Не назначено».
 * Направление проставляется вручную дропдауном и хранится в
 * Employee.extra_data.direction (без миграций — PUT /employees мёржит extra_data).
 */

const DIRECTIONS = [
  { key: "traffic", label: "Трафик" },
  { key: "rnd", label: "RnD" },
  { key: "development", label: "Разработка" },
] as const;

type DirKey = (typeof DIRECTIONS)[number]["key"];
type Folder = "all" | DirKey | "none";

const DIR_LABEL: Record<string, string> = Object.fromEntries(
  DIRECTIONS.map((d) => [d.key, d.label])
);

function empDirection(e: EmployeeData): DirKey | null {
  const raw = (e.extra_data as Record<string, unknown> | null)?.direction;
  return typeof raw === "string" && raw in DIR_LABEL ? (raw as DirKey) : null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU");
}

export default function StatusesPage() {
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<Folder>("all");
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // false → действующие + уволенные
      const data = await getEmployees(false);
      setEmployees(data);
    } catch {
      toast.error("Не удалось загрузить штат");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Поиск по имени/должности/отделу
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter((e) =>
      [e.user_name, e.position, e.department_name, e.telegram_username]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [employees, q]);

  // Счётчики по папкам (по результату поиска)
  const counts = useMemo(() => {
    const c: Record<Folder, number> = {
      all: searched.length,
      traffic: 0,
      rnd: 0,
      development: 0,
      none: 0,
    };
    for (const e of searched) {
      const d = empDirection(e);
      if (d) c[d] += 1;
      else c.none += 1;
    }
    return c;
  }, [searched]);

  const visible = useMemo(() => {
    if (folder === "all") return searched;
    if (folder === "none") return searched.filter((e) => !empDirection(e));
    return searched.filter((e) => empDirection(e) === folder);
  }, [searched, folder]);

  const active = visible.filter((e) => e.is_active);
  const dismissed = visible.filter((e) => !e.is_active);

  const changeDirection = async (e: EmployeeData, value: string) => {
    const next = value || null;
    setSavingId(e.id);
    // оптимистично
    setEmployees((prev) =>
      prev.map((x) =>
        x.id === e.id
          ? { ...x, extra_data: { ...(x.extra_data || {}), direction: next } }
          : x
      )
    );
    try {
      await updateEmployee(e.id, { extra_data: { direction: next } });
    } catch {
      toast.error("Не удалось сохранить направление");
      load(); // откат к серверному состоянию
    } finally {
      setSavingId(null);
    }
  };

  const FOLDERS: { key: Folder; label: string }[] = [
    { key: "all", label: "Все" },
    ...DIRECTIONS.map((d) => ({ key: d.key as Folder, label: d.label })),
    { key: "none", label: "Не назначено" },
  ];

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Users className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-white">Статусы</h1>
          <p className="text-[11px] text-white/30">
            Все, кто прошёл в штат — по направлениям
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по имени, должности, отделу…"
            className="w-72 bg-white/[0.04] border border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
        </div>
      ) : (
        <div className="flex gap-5">
          {/* Left folders */}
          <div className="w-52 shrink-0 space-y-1">
            {FOLDERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFolder(f.key)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors border ${
                  folder === f.key
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                    : "bg-white/[0.02] border-white/[0.06] text-white/60 hover:bg-white/[0.05]"
                }`}
              >
                <span>{f.label}</span>
                <span className="text-[11px] text-white/30">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 min-w-0 space-y-6">
            {visible.length === 0 && (
              <div className="flex flex-col items-center py-16 text-center">
                <Users className="w-10 h-10 text-white/10 mb-3" />
                <p className="text-sm text-white/30">Нет сотрудников в этой папке</p>
              </div>
            )}

            {active.length > 0 && (
              <EmployeeTable
                title="Действующие"
                icon={<UserCheck className="w-4 h-4 text-emerald-400" />}
                rows={active}
                savingId={savingId}
                onDirection={changeDirection}
              />
            )}

            {dismissed.length > 0 && (
              <EmployeeTable
                title="Уволенные / ушли"
                icon={<UserX className="w-4 h-4 text-white/40" />}
                rows={dismissed}
                savingId={savingId}
                onDirection={changeDirection}
                muted
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeTable({
  title,
  icon,
  rows,
  savingId,
  onDirection,
  muted = false,
}: {
  title: string;
  icon: React.ReactNode;
  rows: EmployeeData[];
  savingId: number | null;
  onDirection: (e: EmployeeData, value: string) => void;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-semibold text-white/80">{title}</h2>
        <span className="text-[11px] text-white/30">{rows.length}</span>
      </div>
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_0.9fr_0.8fr_1fr] gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/20 border-b border-white/5">
          <span>Сотрудник</span>
          <span>Должность</span>
          <span>Отдел</span>
          <span>Telegram</span>
          <span>Выход</span>
          <span>Направление</span>
        </div>
        {rows.map((e) => (
          <div
            key={e.id}
            className={`grid grid-cols-[1.4fr_1fr_1fr_0.9fr_0.8fr_1fr] gap-2 px-4 py-2.5 items-center border-t border-white/[0.03] ${
              muted ? "opacity-60" : ""
            }`}
          >
            <span className="text-sm text-white truncate">{e.user_name || "—"}</span>
            <span className="text-xs text-white/50 truncate">{e.position || "—"}</span>
            <span className="text-xs text-white/50 truncate">{e.department_name || "—"}</span>
            <span className="text-xs text-white/50 truncate">
              {e.telegram_username ? `@${e.telegram_username.replace(/^@/, "")}` : "—"}
            </span>
            <span className="text-xs text-white/40">{fmtDate(e.department_start_date)}</span>
            <div className="flex items-center gap-1.5">
              <select
                value={empDirection(e) ?? ""}
                onChange={(ev) => onDirection(e, ev.target.value)}
                disabled={savingId === e.id}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50"
              >
                <option value="" className="bg-[#0c0c10]">— не назначено —</option>
                {DIRECTIONS.map((d) => (
                  <option key={d.key} value={d.key} className="bg-[#0c0c10]">
                    {d.label}
                  </option>
                ))}
              </select>
              {savingId === e.id && (
                <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
