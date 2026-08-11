import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users, Search, Loader2, Plus, Pencil, Trash2, Check, X,
  ChevronRight, ChevronDown, Paperclip, Upload,
} from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import {
  getBoardFolders, createBoardFolder, renameBoardFolder, deleteBoardFolder,
  getBoardRows, updateBoardRow,
  type BoardFolder, type BoardRow, type BoardRowUpdate,
} from "@/services/api/staffBoard";
import { uploadEntityFile, deleteEntityFile, downloadEntityFile } from "@/services/api/entities";
import { getDepartments, type Department } from "@/services/api/auth";
import { useUrlTab } from "@/hooks/useUrlTab";

/**
 * Страница «Статусы» — доска жизненного цикла сотрудника внутри направления.
 *
 * Слева — папки-направления (свой список организации, создаются прямо здесь).
 * Справа — таблица, сгруппированная в сворачиваемые секции по статусам
 * ПРАКТИКА / ПЕРЕВЁЛСЯ / УВОЛЕН / УВОЛИЛСЯ. Все колонки редактируются инлайн,
 * у каждой — свой фильтр. Вехи 1/3/12 мес считаются от «выход в отдел»
 * автоматически (авто-значение показано приглушённым), но их можно перебить.
 */

const STATUSES = [
  { key: "probation",   label: "ПРАКТИКА",  chip: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  { key: "transferred", label: "ПЕРЕВЁЛСЯ", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { key: "dismissed",   label: "УВОЛЕН",    chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
  { key: "quit",        label: "УВОЛИЛСЯ",  chip: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
] as const;

const UNASSIGNED = "__none__";

type FilterKey =
  | "name" | "position" | "department" | "telegram"
  | "practice_start_date" | "department_start_date" | "manager"
  | "m1" | "m3" | "y1";

const COLUMNS: { key: FilterKey | "offer"; label: string; w: string; filter: boolean }[] = [
  { key: "name",                   label: "Сотрудник",         w: "min-w-[190px]", filter: true },
  { key: "position",               label: "Должность",         w: "min-w-[150px]", filter: true },
  { key: "department",             label: "Отдел",             w: "min-w-[150px]", filter: true },
  { key: "telegram",               label: "Telegram",          w: "min-w-[130px]", filter: true },
  { key: "practice_start_date",    label: "Выход на практику", w: "min-w-[150px]", filter: true },
  { key: "department_start_date",  label: "Выход в отдел",     w: "min-w-[145px]", filter: true },
  { key: "manager",                label: "Рук-ль",            w: "min-w-[130px]", filter: true },
  { key: "offer",                  label: "Оффер",             w: "min-w-[110px]", filter: false },
  { key: "m1",                     label: "1 мес",             w: "min-w-[125px]", filter: true },
  { key: "m3",                     label: "3 мес",             w: "min-w-[125px]", filter: true },
  { key: "y1",                     label: "1 год",             w: "min-w-[125px]", filter: true },
];

const fmt = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU");
};

const cellText = (r: BoardRow, key: FilterKey): string => {
  switch (key) {
    case "name": return r.name || "";
    case "position": return r.position || "";
    case "department": return r.department_name || "";
    case "telegram": return r.telegram || "";
    case "manager": return r.manager || "";
    default: return fmt(r[key] as string | null);
  }
};

export default function StatusesPage() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [folders, setFolders] = useState<BoardFolder[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  // Папка живёт в URL (?folder=) — чтобы работали браузерные «Назад/Вперёд»
  // между направлениями (единый паттерн HR-раздела, см. useUrlTab).
  const [folder, setFolder] = useUrlTab<string>("folder", "all");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, f] = await Promise.all([getBoardRows(), getBoardFolders()]);
      setRows(r);
      setFolders(f);
    } catch {
      toast.error("Не удалось загрузить доску");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    getDepartments(-1).then((d) => setDepartments(d as Department[])).catch(() => setDepartments([]));
  }, []);

  /** Патч строки: оптимистично + откат при ошибке. */
  const patch = async (row: BoardRow, body: BoardRowUpdate) => {
    const prev = rows;
    setSavingId(row.entity_id);
    setRows((cur) => cur.map((x) => (x.entity_id === row.entity_id ? { ...x, ...body } as BoardRow : x)));
    try {
      const fresh = await updateBoardRow(row.entity_id, body);
      setRows((cur) => cur.map((x) => (x.entity_id === fresh.entity_id ? fresh : x)));
    } catch (e: any) {
      setRows(prev);
      toast.error(e?.response?.data?.detail || "Не удалось сохранить");
    } finally {
      setSavingId(null);
    }
  };

  // ── фильтрация ───────────────────────────────────────────
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows;
    if (needle) {
      out = out.filter((r) =>
        [r.name, r.position, r.department_name, r.telegram, r.manager]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle))
      );
    }
    for (const [key, val] of Object.entries(filters)) {
      const v = (val || "").trim().toLowerCase();
      if (!v) continue;
      out = out.filter((r) => cellText(r, key as FilterKey).toLowerCase().includes(v));
    }
    return out;
  }, [rows, q, filters]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: searched.length, [UNASSIGNED]: 0 };
    for (const f of folders) c[f.id] = 0;
    for (const r of searched) {
      const key = r.direction && c[r.direction] !== undefined ? r.direction : UNASSIGNED;
      c[key] = (c[key] || 0) + 1;
    }
    return c;
  }, [searched, folders]);

  const visible = useMemo(() => {
    if (folder === "all") return searched;
    if (folder === UNASSIGNED) {
      const known = new Set(folders.map((f) => f.id));
      return searched.filter((r) => !r.direction || !known.has(r.direction));
    }
    return searched.filter((r) => r.direction === folder);
  }, [searched, folder, folders]);

  const grouped = useMemo(
    () => STATUSES.map((s) => ({ ...s, items: visible.filter((r) => r.status === s.key) })),
    [visible]
  );

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Users className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Статусы</h1>
          <p className="text-[11px] text-gray-500 dark:text-white/30">
            Жизненный цикл сотрудника по направлениям
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 dark:text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск…"
            className="w-64 bg-gray-50 dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          <FolderSidebar
            folders={folders}
            counts={counts}
            active={folder}
            onSelect={setFolder}
            onChanged={load}
            setFolders={setFolders}
          />

          <div className="flex-1 min-w-0 overflow-x-auto rounded-2xl border border-black/10 dark:border-white/[0.08]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.03]">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={clsx(
                        "text-left font-medium text-[10px] uppercase tracking-wider px-3 py-2",
                        "text-gray-500 dark:text-white/30 border-b border-black/5 dark:border-white/5",
                        c.w
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50/60 dark:bg-white/[0.015]">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 pb-2 border-b border-black/5 dark:border-white/5">
                      {c.filter ? (
                        <input
                          value={filters[c.key as FilterKey] || ""}
                          onChange={(e) =>
                            setFilters((f) => ({ ...f, [c.key]: e.target.value }))
                          }
                          placeholder="фильтр"
                          className="w-full bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] rounded px-2 py-1 text-xs font-normal text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-white/15 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {grouped.map((g) => {
                  const isCollapsed = collapsed[g.key];
                  return (
                    <Fragment key={g.key}>
                      <tr
                        onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                        className="cursor-pointer bg-gray-100/70 dark:bg-white/[0.04] hover:bg-gray-100 dark:hover:bg-white/[0.06]"
                      >
                        <td colSpan={COLUMNS.length} className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            {isCollapsed
                              ? <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-white/30" />
                              : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-white/30" />}
                            <span className={clsx("px-2 py-0.5 rounded text-[11px] font-semibold", g.chip)}>
                              {g.label}
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-white/25">{g.items.length}</span>
                          </div>
                        </td>
                      </tr>

                      {!isCollapsed && g.items.map((r) => (
                        <Row
                          key={r.entity_id}
                          row={r}
                          folders={folders}
                          departments={departments}
                          saving={savingId === r.entity_id}
                          onPatch={patch}
                          onReload={load}
                        />
                      ))}

                      {!isCollapsed && g.items.length === 0 && (
                        <tr>
                          <td colSpan={COLUMNS.length} className="px-3 py-3 text-xs text-gray-400 dark:text-white/20">
                            Пусто
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SIDEBAR
// ============================================================

function FolderSidebar({
  folders, counts, active, onSelect, onChanged, setFolders,
}: {
  folders: BoardFolder[];
  counts: Record<string, number>;
  active: string;
  onSelect: (id: string) => void;
  onChanged: () => void;
  setFolders: (f: BoardFolder[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const f = await createBoardFolder(name);
      setFolders([...folders, f]);
      setNewName("");
      setAdding(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Не удалось создать папку");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    const name = editName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const f = await renameBoardFolder(id, name);
      setFolders(folders.map((x) => (x.id === id ? f : x)));
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Не удалось переименовать");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f: BoardFolder) => {
    if (!confirm(`Удалить папку «${f.name}»? Сотрудники останутся, но без направления.`)) return;
    setBusy(true);
    try {
      await deleteBoardFolder(f.id);
      onChanged();
      if (active === f.id) onSelect("all");
    } catch {
      toast.error("Не удалось удалить папку");
    } finally {
      setBusy(false);
    }
  };

  const item = (id: string, label: string, extra?: React.ReactNode) => (
    <button
      key={id}
      onClick={() => onSelect(id)}
      className={clsx(
        "w-full group flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors",
        active === id
          ? "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/40 dark:text-emerald-300"
          : "bg-white border-black/[0.06] text-gray-600 hover:bg-gray-50 dark:bg-white/[0.02] dark:border-white/[0.06] dark:text-white/60 dark:hover:bg-white/[0.05]"
      )}
    >
      <span className="flex-1 text-left truncate">{label}</span>
      <span className="text-[11px] text-gray-400 dark:text-white/25">{counts[id] ?? 0}</span>
      {extra}
    </button>
  );

  return (
    <div className="w-56 shrink-0 space-y-1">
      {item("all", "Все")}

      {folders.map((f) =>
        editing === f.id ? (
          <div key={f.id} className="flex items-center gap-1">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(f.id);
                if (e.key === "Escape") setEditing(null);
              }}
              className="flex-1 min-w-0 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] rounded px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
            <button onClick={() => rename(f.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-white/5 rounded">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setEditing(null)} className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 rounded">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div key={f.id} className="relative group/row">
            {item(f.id, f.name)}
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover/row:flex items-center gap-0.5 bg-inherit">
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(f.id); setEditName(f.name); }}
                className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-white"
                title="Переименовать"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); remove(f); }}
                className="p-1 rounded text-gray-400 hover:text-rose-500"
                title="Удалить"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )
      )}

      {item(UNASSIGNED, "Без направления")}

      {adding ? (
        <div className="flex items-center gap-1 pt-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") { setAdding(false); setNewName(""); }
            }}
            placeholder="Название"
            className="flex-1 min-w-0 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] rounded px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
          <button onClick={create} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-white/5 rounded">
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 border border-dashed border-black/10 dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-white/[0.03] mt-1"
        >
          <Plus className="w-3.5 h-3.5" /> Папка
        </button>
      )}
    </div>
  );
}

// ============================================================
// ROW
// ============================================================

function Row({
  row, folders, departments, saving, onPatch, onReload,
}: {
  row: BoardRow;
  folders: BoardFolder[];
  departments: Department[];
  saving: boolean;
  onPatch: (row: BoardRow, body: BoardRowUpdate) => Promise<void>;
  onReload: () => void;
}) {
  const td = "px-3 py-1.5 border-b border-black/[0.04] dark:border-white/[0.03] align-middle";

  return (
    <tr className={clsx("hover:bg-gray-50/70 dark:hover:bg-white/[0.02]", saving && "opacity-60")}>
      {/* Сотрудник + направление под именем */}
      <td className={td}>
        <div className="text-gray-900 dark:text-white truncate">{row.name}</div>
        <select
          value={row.direction || ""}
          onChange={(e) => onPatch(row, { direction: e.target.value || null })}
          className="mt-0.5 max-w-full bg-transparent text-[11px] text-gray-400 dark:text-white/30 focus:outline-none cursor-pointer hover:text-gray-600 dark:hover:text-white/60"
        >
          <option value="">— без направления —</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </td>

      <td className={td}>
        <TextCell value={row.position} onSave={(v) => onPatch(row, { position: v })} />
      </td>

      <td className={td}>
        <select
          value={row.department_id ?? ""}
          onChange={(e) => onPatch(row, { department_id: e.target.value ? Number(e.target.value) : null })}
          className="w-full bg-transparent text-sm text-gray-700 dark:text-white/70 focus:outline-none cursor-pointer rounded px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-white/5"
        >
          <option value="">—</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </td>

      <td className={td}>
        <TextCell
          value={row.telegram}
          prefix="@"
          onSave={(v) => onPatch(row, { telegram: v })}
        />
      </td>

      <td className={td}>
        <DateCell value={row.practice_start_date} onSave={(v) => onPatch(row, { practice_start_date: v })} />
      </td>

      <td className={td}>
        <DateCell value={row.department_start_date} onSave={(v) => onPatch(row, { department_start_date: v })} />
      </td>

      <td className={td}>
        <TextCell value={row.manager} onSave={(v) => onPatch(row, { manager: v })} />
      </td>

      <td className={td}>
        <OfferCell row={row} onReload={onReload} />
      </td>

      <td className={td}>
        <DateCell value={row.m1} auto={row.m1_auto} onSave={(v) => onPatch(row, { m1: v })} />
      </td>
      <td className={td}>
        <DateCell value={row.m3} auto={row.m3_auto} onSave={(v) => onPatch(row, { m3: v })} />
      </td>
      <td className={td}>
        <DateCell value={row.y1} auto={row.y1_auto} onSave={(v) => onPatch(row, { y1: v })} />
      </td>
    </tr>
  );
}

// ============================================================
// CELLS
// ============================================================

function TextCell({
  value, onSave, prefix,
}: { value: string | null; onSave: (v: string | null) => void; prefix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => { setDraft(value || ""); }, [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value || "")) onSave(next || null);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
        }}
        className="w-full bg-white dark:bg-white/[0.06] border border-emerald-400/60 rounded px-1.5 py-0.5 text-sm text-gray-900 dark:text-white focus:outline-none"
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="cursor-text rounded px-1.5 py-0.5 -mx-1.5 hover:bg-gray-100 dark:hover:bg-white/5 truncate text-gray-700 dark:text-white/70"
      title={value || ""}
    >
      {value ? `${prefix || ""}${value}` : <span className="text-gray-300 dark:text-white/15">—</span>}
    </div>
  );
}

function DateCell({
  value, onSave, auto,
}: { value: string | null; onSave: (v: string | null) => void; auto?: boolean }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  if (editing) {
    return (
      <input
        ref={ref}
        autoFocus
        type="date"
        defaultValue={value || ""}
        onBlur={(e) => {
          setEditing(false);
          const next = e.target.value || null;
          if (next !== value) onSave(next);
        }}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        className="w-full bg-white dark:bg-white/[0.06] border border-emerald-400/60 rounded px-1.5 py-0.5 text-xs text-gray-900 dark:text-white focus:outline-none"
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={clsx(
        "cursor-pointer rounded px-1.5 py-0.5 -mx-1.5 hover:bg-gray-100 dark:hover:bg-white/5 text-sm",
        auto && value
          ? "text-gray-400 dark:text-white/30 italic"
          : "text-gray-700 dark:text-white/70"
      )}
      title={auto && value ? "Посчитано от даты выхода в отдел — нажми, чтобы задать вручную" : ""}
    >
      {value ? fmt(value) : <span className="text-gray-300 dark:text-white/15">—</span>}
    </div>
  );
}

function OfferCell({ row, onReload }: { row: BoardRow; onReload: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await uploadEntityFile(row.entity_id, file, "offer");
      toast.success("Оффер загружен");
      onReload();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Не удалось загрузить");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!row.offer_file_id) return;
    try {
      const blob = await downloadEntityFile(row.entity_id, row.offer_file_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.offer_file_name || "offer";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Не удалось скачать");
    }
  };

  const remove = async () => {
    if (!row.offer_file_id) return;
    if (!confirm("Удалить файл оффера?")) return;
    setBusy(true);
    try {
      await deleteEntityFile(row.entity_id, row.offer_file_id);
      onReload();
    } catch {
      toast.error("Не удалось удалить");
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />;

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
      />
      {row.offer_file_id ? (
        <>
          <button
            onClick={download}
            className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline max-w-[80px] truncate"
            title={row.offer_file_name || ""}
          >
            <Paperclip className="w-3 h-3 shrink-0" />
            <span className="truncate">{row.offer_file_name || "файл"}</span>
          </button>
          <button onClick={remove} className="p-0.5 text-gray-300 hover:text-rose-500" title="Удалить">
            <X className="w-3 h-3" />
          </button>
        </>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 text-xs text-gray-400 dark:text-white/25 hover:text-emerald-600 dark:hover:text-emerald-400"
        >
          <Upload className="w-3 h-3" /> файл
        </button>
      )}
    </div>
  );
}
