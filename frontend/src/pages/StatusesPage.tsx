import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Loader2, Plus, Pencil, Trash2, Check, X,
  ChevronRight, ChevronDown, Paperclip, Upload, SlidersHorizontal,
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
 * автоматически (авто-значение показано курсивом), но их можно перебить.
 *
 * Оформление — семейство .hf-statuses-* в index.css (HR-дизайн-система).
 */

const STATUSES = [
  { key: "probation",   label: "ПРАКТИКА"  },
  { key: "transferred", label: "ПЕРЕВЁЛСЯ" },
  { key: "dismissed",   label: "УВОЛЕН"    },
  { key: "quit",        label: "УВОЛИЛСЯ"  },
] as const;

const UNASSIGNED = "__none__";

type FilterKey =
  | "name" | "position" | "department" | "telegram"
  | "practice_start_date" | "department_start_date" | "manager"
  | "w2" | "m1" | "m3" | "y1";

const COLUMNS: { key: FilterKey | "offer"; label: string; filter: boolean }[] = [
  { key: "name",                  label: "Сотрудник",         filter: true },
  { key: "position",              label: "Должность",         filter: true },
  { key: "department",            label: "Отдел",             filter: true },
  { key: "telegram",              label: "Telegram",          filter: true },
  { key: "practice_start_date",   label: "Выход на практику", filter: true },
  { key: "department_start_date", label: "Выход в отдел",     filter: true },
  { key: "manager",               label: "Рук-ль",            filter: true },
  { key: "offer",                 label: "Оффер",             filter: false },
  { key: "w2",                    label: "2 недели",          filter: true },
  { key: "m1",                    label: "1 мес",             filter: true },
  { key: "m3",                    label: "3 мес",             filter: true },
  { key: "y1",                    label: "1 год",             filter: true },
];

/** Колонки, по которым вообще можно фильтровать. */
const FILTERABLE = COLUMNS.filter((c) => c.filter) as { key: FilterKey; label: string }[];

/** По умолчанию — самое ходовое, остальное включается по кнопке «Фильтры». */
const DEFAULT_FILTERS: FilterKey[] = ["name", "position", "department"];

const FILTERS_STORAGE_KEY = "hf-statuses-filters";

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
  // Папка живёт в URL (?folder=) — работают браузерные «Назад/Вперёд».
  const [folder, setFolder] = useUrlTab<string>("folder", "all");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});

  // Какие фильтры показаны. Раньше поле висело у каждой колонки — на широкой
  // таблице это одиннадцать пустых полей, среди которых не видно, по чему
  // реально идёт отбор. Набор запоминаем: у каждого HR свой рабочий срез.
  const [shownFilters, setShownFilters] = useState<Set<FilterKey>>(() => {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) {
        const keys = (JSON.parse(raw) as string[]).filter(
          (k): k is FilterKey => FILTERABLE.some((c) => c.key === k)
        );
        return new Set(keys);
      }
    } catch { /* повреждённое значение — просто берём набор по умолчанию */ }
    return new Set(DEFAULT_FILTERS);
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify([...shownFilters]));
    } catch { /* приватный режим — переживём без сохранения */ }
  }, [shownFilters]);

  /** Скрытый фильтр не должен продолжать отбирать втихую — гасим его значение. */
  const toggleFilter = (key: FilterKey) => {
    setShownFilters((cur) => {
      const next = new Set(cur);
      if (next.has(key)) {
        next.delete(key);
        setFilters((f) => ({ ...f, [key]: "" }));
      } else {
        next.add(key);
      }
      return next;
    });
  };
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

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows;
    if (needle) {
      out = out.filter((r) =>
        [r.name, r.position, r.department_name, r.telegram, r.manager]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle))
      );
    }
    // Несколько фильтров сужают выборку вместе (И), один работает сам по себе.
    for (const [key, val] of Object.entries(filters)) {
      const k = key as FilterKey;
      if (!shownFilters.has(k)) continue;
      const v = (val || "").trim().toLowerCase();
      if (!v) continue;
      out = out.filter((r) => cellText(r, k).toLowerCase().includes(v));
    }
    return out;
  }, [rows, q, filters, shownFilters]);

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

  /** Считаем именно ЗАПОЛНЕННЫЕ фильтры: показанное, но пустое поле ничего
   *  не отбирает, и badge на кнопке не должен вводить в заблуждение. */
  const activeCount = useMemo(
    () => [...shownFilters].filter((k) => (filters[k] || "").trim()).length,
    [shownFilters, filters]
  );

  const grouped = useMemo(
    () => STATUSES.map((s) => ({ ...s, items: visible.filter((r) => r.status === s.key) })),
    [visible]
  );

  return (
    <div className="hf-statuses-page">
      <div className="hf-statuses-header">
        <div>
          <h1 className="hf-statuses-title">Статусы</h1>
          <p className="hf-statuses-subtitle">Жизненный цикл сотрудника по направлениям</p>
        </div>
        <div className="hf-statuses-tools">
          <div className="hf-statuses-search">
            <Search className="hf-statuses-search-icon" size={15} />
            <input
              className="hf-statuses-search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по имени, должности, отделу…"
            />
          </div>

          <div className="hf-statuses-filters-picker">
            <button
              className={clsx(
                "hf-statuses-filters-btn",
                activeCount > 0 && "hf-statuses-filters-btn-on"
              )}
              onClick={() => setPickerOpen((v) => !v)}
            >
              <SlidersHorizontal size={15} />
              Фильтры
              {activeCount > 0 && (
                <span className="hf-statuses-filters-badge">{activeCount}</span>
              )}
            </button>

            {pickerOpen && (
              <>
                <div className="hf-statuses-picker-backdrop" onClick={() => setPickerOpen(false)} />
                <div className="hf-statuses-picker">
                  <div className="hf-statuses-picker-head">
                    <span>Показывать фильтры</span>
                    <div className="hf-statuses-picker-actions">
                      <button onClick={() => setShownFilters(new Set(FILTERABLE.map((c) => c.key)))}>
                        все
                      </button>
                      <button
                        onClick={() => { setShownFilters(new Set()); setFilters({}); }}
                      >
                        ни одного
                      </button>
                    </div>
                  </div>
                  {FILTERABLE.map((c) => (
                    <label key={c.key} className="hf-statuses-picker-item">
                      <input
                        type="checkbox"
                        checked={shownFilters.has(c.key)}
                        onChange={() => toggleFilter(c.key)}
                      />
                      <span>{c.label}</span>
                      {(filters[c.key] || "").trim() && (
                        <span className="hf-statuses-picker-dot" title="фильтр заполнен" />
                      )}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="hf-statuses-loading">
          <Loader2 className="animate-spin" size={26} />
        </div>
      ) : (
        <div className="hf-statuses-body">
          <FolderSidebar
            folders={folders}
            counts={counts}
            active={folder}
            onSelect={setFolder}
            onChanged={load}
            setFolders={setFolders}
          />

          <div className="hf-statuses-table-wrap">
            <table className="hf-statuses-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="hf-statuses-th">{c.label}</th>
                  ))}
                </tr>
                {shownFilters.size > 0 && (
                  <tr>
                    {COLUMNS.map((c) => {
                      const k = c.key as FilterKey;
                      const on = c.filter && shownFilters.has(k);
                      return (
                        <th key={c.key} className="hf-statuses-th-filter">
                          {on && (
                            <input
                              className="hf-statuses-filter-input"
                              value={filters[k] || ""}
                              onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
                              placeholder="фильтр"
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                )}
              </thead>

              <tbody>
                {grouped.map((g) => {
                  const isCollapsed = collapsed[g.key];
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className="hf-statuses-group"
                        onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                      >
                        <td className="hf-statuses-group-cell" colSpan={COLUMNS.length}>
                          <div className="hf-statuses-group-inner">
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            <span className={clsx("hf-statuses-chip", `hf-statuses-chip-${g.key}`)}>
                              {g.label}
                            </span>
                            <span className="hf-statuses-group-count">{g.items.length}</span>
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
                          <td className="hf-statuses-empty" colSpan={COLUMNS.length}>Пусто</td>
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
      if (active === f.id) onSelect("all");
      onChanged();
    } catch {
      toast.error("Не удалось удалить папку");
    } finally {
      setBusy(false);
    }
  };

  const plain = (id: string, label: string) => (
    <button
      key={id}
      onClick={() => onSelect(id)}
      className={clsx("hf-statuses-folder", active === id && "hf-statuses-folder-active")}
    >
      <span className="hf-statuses-folder-name">{label}</span>
      <span className="hf-statuses-folder-count">{counts[id] ?? 0}</span>
    </button>
  );

  return (
    <div className="hf-statuses-sidebar">
      {plain("all", "Все")}

      {folders.map((f) =>
        editing === f.id ? (
          <div key={f.id} className="hf-statuses-folder-edit">
            <input
              autoFocus
              className="hf-statuses-folder-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(f.id);
                if (e.key === "Escape") setEditing(null);
              }}
            />
            <button className="hf-statuses-folder-action" onClick={() => rename(f.id)}>
              <Check size={14} />
            </button>
            <button className="hf-statuses-folder-action" onClick={() => setEditing(null)}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div key={f.id} className="hf-statuses-folder-row">
            {plain(f.id, f.name)}
            <div className="hf-statuses-folder-actions">
              <button
                className="hf-statuses-folder-action"
                title="Переименовать"
                onClick={(e) => { e.stopPropagation(); setEditing(f.id); setEditName(f.name); }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="hf-statuses-folder-action hf-statuses-folder-action-danger"
                title="Удалить"
                onClick={(e) => { e.stopPropagation(); remove(f); }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )
      )}

      {plain(UNASSIGNED, "Без направления")}

      {adding ? (
        <div className="hf-statuses-folder-edit">
          <input
            autoFocus
            className="hf-statuses-folder-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") { setAdding(false); setNewName(""); }
            }}
            placeholder="Название"
          />
          <button className="hf-statuses-folder-action" onClick={create}>
            <Check size={14} />
          </button>
        </div>
      ) : (
        <button className="hf-statuses-folder-add" onClick={() => setAdding(true)}>
          <Plus size={14} /> Папка
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
  return (
    <tr className={clsx("hf-statuses-row", saving && "hf-statuses-row-saving")}>
      <td className="hf-statuses-td">
        <div className="hf-statuses-name">{row.name}</div>
        <select
          className="hf-statuses-select hf-statuses-select-sub"
          value={row.direction || ""}
          onChange={(e) => onPatch(row, { direction: e.target.value || null })}
        >
          <option value="">— без направления —</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </td>

      <td className="hf-statuses-td">
        <TextCell value={row.position} onSave={(v) => onPatch(row, { position: v })} />
      </td>

      <td className="hf-statuses-td">
        <select
          className="hf-statuses-select"
          value={row.department_id ?? ""}
          onChange={(e) => onPatch(row, { department_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">—</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </td>

      <td className="hf-statuses-td">
        <TextCell value={row.telegram} prefix="@" onSave={(v) => onPatch(row, { telegram: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.practice_start_date} onSave={(v) => onPatch(row, { practice_start_date: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.department_start_date} onSave={(v) => onPatch(row, { department_start_date: v })} />
      </td>

      <td className="hf-statuses-td">
        <TextCell value={row.manager} onSave={(v) => onPatch(row, { manager: v })} />
      </td>

      <td className="hf-statuses-td">
        <OfferCell row={row} onReload={onReload} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.w2} auto={row.w2_auto} onSave={(v) => onPatch(row, { w2: v })} />
      </td>
      <td className="hf-statuses-td">
        <DateCell value={row.m1} auto={row.m1_auto} onSave={(v) => onPatch(row, { m1: v })} />
      </td>
      <td className="hf-statuses-td">
        <DateCell value={row.m3} auto={row.m3_auto} onSave={(v) => onPatch(row, { m3: v })} />
      </td>
      <td className="hf-statuses-td">
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
        className="hf-statuses-cell-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
        }}
      />
    );
  }

  return (
    <button className="hf-statuses-cell-btn" onClick={() => setEditing(true)} title={value || ""}>
      {value
        ? `${prefix || ""}${value}`
        : <span className="hf-statuses-cell-placeholder">—</span>}
    </button>
  );
}

function DateCell({
  value, onSave, auto,
}: { value: string | null; onSave: (v: string | null) => void; auto?: boolean }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        className="hf-statuses-cell-input"
        defaultValue={value || ""}
        onBlur={(e) => {
          setEditing(false);
          const next = e.target.value || null;
          if (next !== value) onSave(next);
        }}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  return (
    <button
      className={clsx("hf-statuses-cell-btn", auto && value && "hf-statuses-cell-auto")}
      onClick={() => setEditing(true)}
      title={auto && value ? "Посчитано от даты выхода в отдел — нажми, чтобы задать вручную" : ""}
    >
      {value ? fmt(value) : <span className="hf-statuses-cell-placeholder">—</span>}
    </button>
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

  if (busy) return <Loader2 className="animate-spin" size={14} />;

  return (
    <div className="hf-statuses-offer">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
      />
      {row.offer_file_id ? (
        <>
          <button className="hf-statuses-offer-link" onClick={download} title={row.offer_file_name || ""}>
            <Paperclip size={12} />
            <span className="hf-statuses-offer-name">{row.offer_file_name || "файл"}</span>
          </button>
          <button className="hf-statuses-offer-remove" onClick={remove} title="Удалить">
            <X size={12} />
          </button>
        </>
      ) : (
        <button className="hf-statuses-offer-upload" onClick={() => inputRef.current?.click()}>
          <Upload size={12} /> файл
        </button>
      )}
    </div>
  );
}
