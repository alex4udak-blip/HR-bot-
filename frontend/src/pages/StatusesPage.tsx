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
import { getBoardPositions, getBoardManagers } from "@/services/api/staffBoard";
import { getOrgMembers } from "@/services/api/accessHub";
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
  | "name" | "assignee" | "position" | "department" | "telegram"
  | "practice_start_date" | "manager" | "department_start_date"
  | "dept_done" | "w2" | "w2_done" | "m1" | "m1_done"
  | "m3" | "m3_done" | "y1" | "y1_done" | "dismissal_date";

/** Порядок и состав повторяют доску «Сотрудники» в ClickUp: после каждой
 *  вехи идёт колонка-отметка «пройдено» (в ClickUp она называлась так же,
 *  но в скобках). «2 недели» — наша дополнительная веха, в ClickUp её нет. */
const COLUMNS: { key: FilterKey | "offer"; label: string; filter: boolean; narrow?: boolean }[] = [
  { key: "name",                  label: "Сотрудник",         filter: true },
  { key: "assignee",              label: "HR",                filter: true },
  { key: "position",              label: "Должность",         filter: true },
  { key: "department",            label: "Отдел",             filter: true },
  { key: "telegram",              label: "Telegram",          filter: true },
  { key: "practice_start_date",   label: "Выход на практику", filter: true },
  { key: "manager",               label: "Рук-ль",            filter: true },
  { key: "offer",                 label: "Оффер",             filter: false, narrow: true },
  { key: "department_start_date", label: "Выход в отдел",     filter: true },
  { key: "dept_done",             label: "✓",                 filter: true, narrow: true },
  { key: "w2",                    label: "2 недели",          filter: true },
  { key: "w2_done",               label: "✓",                 filter: true, narrow: true },
  { key: "m1",                    label: "1 мес",             filter: true },
  { key: "m1_done",               label: "✓",                 filter: true, narrow: true },
  { key: "m3",                    label: "3 мес",             filter: true },
  { key: "m3_done",               label: "✓",                 filter: true, narrow: true },
  { key: "y1",                    label: "1 год",             filter: true },
  { key: "y1_done",               label: "✓",                 filter: true, narrow: true },
  { key: "dismissal_date",        label: "Дата увольнения",   filter: true },
];

/** Подписи для списка «Фильтры»: там «✓» ничего не сказало бы. */
const FILTER_LABELS: Partial<Record<FilterKey, string>> = {
  dept_done: "Выход в отдел ✓",
  w2_done: "2 недели ✓",
  m1_done: "1 мес ✓",
  m3_done: "3 мес ✓",
  y1_done: "1 год ✓",
};

const fmt = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU");
};

/** Колонки, по которым можно фильтровать. */
const FILTERABLE = COLUMNS.filter((c) => c.filter) as { key: FilterKey; label: string }[];

/** Изначально не отмечено ничего: таблица показывает всех. */
const DEFAULT_FILTERS: FilterKey[] = [];

const FILTERS_STORAGE_KEY = "hf-statuses-filters";

/** Пустая ячейка рисуется как «—», поэтому прочерк тоже считаем пустотой. */
const isBlank = (v: string) => !v.trim() || v.trim() === "—";

const cellText = (r: BoardRow, key: FilterKey): string => {
  switch (key) {
    case "name": return r.name || "";
    case "assignee": return r.assignee_name || "";
    case "position": return r.position || "";
    case "department": return r.department_name || "";
    case "telegram": return r.telegram || "";
    case "manager": return r.manager || "";
    // Отметки — «заполнено» значит «отмечено», чтобы фильтр по колонке
    // отвечал на вопрос «у кого веха пройдена».
    case "dept_done": return r.dept_done ? "✓" : "";
    case "w2_done": return r.w2_done ? "✓" : "";
    case "m1_done": return r.m1_done ? "✓" : "";
    case "m3_done": return r.m3_done ? "✓" : "";
    case "y1_done": return r.y1_done ? "✓" : "";
    default: return fmt(r[key] as string | null);
  }
};

export default function StatusesPage() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [folders, setFolders] = useState<BoardFolder[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // Справочники для выпадающих списков: должности и руководители собираются
  // из уже существующих значений, HR — из участников организации.
  const [positions, setPositions] = useState<string[]>([]);
  const [managers, setManagers] = useState<string[]>([]);
  const [people, setPeople] = useState<{ user_id: number; user_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  // Папка живёт в URL (?folder=) — работают браузерные «Назад/Вперёд».
  const [folder, setFolder] = useUrlTab<string>("folder", "all");
  const [q, setQ] = useState("");

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

  /** Отметить колонку — показать только тех, у кого она заполнена. */
  const toggleFilter = (key: FilterKey) => {
    setShownFilters((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
    getBoardPositions().then(setPositions).catch(() => setPositions([]));
    getBoardManagers().then(setManagers).catch(() => setManagers([]));
    getOrgMembers()
      .then((m) => setPeople(m.map((x) => ({ user_id: x.user_id, user_name: x.user_name }))))
      .catch(() => setPeople([]));
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
    // Отмеченная колонка = условие «у человека она заполнена». Несколько
    // отмеченных требуют заполненности КАЖДОЙ.
    for (const key of shownFilters) {
      out = out.filter((r) => !isBlank(cellText(r, key)));
    }
    return out;
  }, [rows, q, shownFilters]);

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

  const activeCount = shownFilters.size;

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
                    <span>Фильтровать по колонкам</span>
                    <div className="hf-statuses-picker-actions">
                      <button onClick={() => setShownFilters(new Set(FILTERABLE.map((c) => c.key)))}>
                        все
                      </button>
                      <button
                        onClick={() => setShownFilters(new Set())}
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
                      <span>{FILTER_LABELS[c.key] || c.label}</span>
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
                          positions={positions}
                          managers={managers}
                          people={people}
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
  row, folders, departments, positions, managers, people, saving, onPatch, onReload,
}: {
  row: BoardRow;
  folders: BoardFolder[];
  departments: Department[];
  positions: string[];
  managers: string[];
  people: { user_id: number; user_name: string | null }[];
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

      <td className="hf-statuses-td hf-statuses-td-narrow">
        <AssigneeCell
          row={row}
          people={people}
          onSave={(v) => onPatch(row, { assignee_user_id: v })}
        />
      </td>

      <td className="hf-statuses-td">
        <PillCell
          value={row.position}
          options={positions}
          onSave={(v) => onPatch(row, { position: v })}
        />
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
        <PillCell
          value={row.manager}
          options={managers}
          onSave={(v) => onPatch(row, { manager: v })}
        />
      </td>

      <td className="hf-statuses-td hf-statuses-td-narrow">
        <OfferCell row={row} onReload={onReload} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.department_start_date} onSave={(v) => onPatch(row, { department_start_date: v })} />
      </td>
      <td className="hf-statuses-td hf-statuses-td-narrow">
        <DoneCell on={row.dept_done} onToggle={(v) => onPatch(row, { dept_done: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.w2} auto={row.w2_auto} onSave={(v) => onPatch(row, { w2: v })} />
      </td>
      <td className="hf-statuses-td hf-statuses-td-narrow">
        <DoneCell on={row.w2_done} onToggle={(v) => onPatch(row, { w2_done: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.m1} auto={row.m1_auto} onSave={(v) => onPatch(row, { m1: v })} />
      </td>
      <td className="hf-statuses-td hf-statuses-td-narrow">
        <DoneCell on={row.m1_done} onToggle={(v) => onPatch(row, { m1_done: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.m3} auto={row.m3_auto} onSave={(v) => onPatch(row, { m3: v })} />
      </td>
      <td className="hf-statuses-td hf-statuses-td-narrow">
        <DoneCell on={row.m3_done} onToggle={(v) => onPatch(row, { m3_done: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.y1} auto={row.y1_auto} onSave={(v) => onPatch(row, { y1: v })} />
      </td>
      <td className="hf-statuses-td hf-statuses-td-narrow">
        <DoneCell on={row.y1_done} onToggle={(v) => onPatch(row, { y1_done: v })} />
      </td>

      <td className="hf-statuses-td">
        <DateCell value={row.dismissal_date} onSave={(v) => onPatch(row, { dismissal_date: v })} />
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


// ============================================================
// Ячейки, перенесённые из ClickUp
// ============================================================

/** Цвет пилюли выводим из самого текста: одинаковое значение всегда одного
 *  цвета, а новые должности/отделы получают свой без ручной настройки. */
function pillHue(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) % 360;
  return h;
}

/** Значение из списка с цветной пилюлей — как «Должность» и «Рук-ль» в ClickUp.
 *
 *  Ввод свободный намеренно: в ClickUp список пополняется на лету, и жёсткий
 *  выбор не дал бы завести новую должность, не трогая справочник. */
function PillCell({
  value, options, onSave,
}: { value: string | null; options: string[]; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const listId = useRef(`pill-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => { setDraft(value || ""); }, [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value || "")) onSave(next || null);
  };

  if (editing) {
    return (
      <>
        <input
          className="hf-statuses-input"
          autoFocus
          list={listId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
          }}
        />
        <datalist id={listId}>
          {options.map((o) => <option key={o} value={o} />)}
        </datalist>
      </>
    );
  }

  if (!value) {
    return (
      <button className="hf-statuses-empty-cell" onClick={() => setEditing(true)}>—</button>
    );
  }

  const hue = pillHue(value);
  return (
    <button
      className="hf-statuses-pill"
      onClick={() => setEditing(true)}
      style={{
        background: `hsl(${hue} 70% 94%)`,
        color: `hsl(${hue} 55% 32%)`,
        borderColor: `hsl(${hue} 60% 84%)`,
      }}
      title={value}
    >
      {value}
    </button>
  );
}

/** HR, ведущий сотрудника. В ClickUp это Assignee с аватаром-инициалами. */
function AssigneeCell({
  row, people, onSave,
}: {
  row: BoardRow;
  people: { user_id: number; user_name: string | null }[];
  onSave: (v: number | null) => void;
}) {
  const initials = (row.assignee_name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <div className="hf-statuses-assignee">
      <select
        className="hf-statuses-assignee-select"
        value={row.assignee_user_id ?? ""}
        onChange={(e) => onSave(e.target.value ? Number(e.target.value) : null)}
        title={row.assignee_name || "не назначен"}
      >
        <option value="">—</option>
        {people.map((p) => (
          <option key={p.user_id} value={p.user_id}>{p.user_name || `#${p.user_id}`}</option>
        ))}
      </select>
      {initials ? (
        <span
          className="hf-statuses-avatar"
          style={{ background: `hsl(${pillHue(row.assignee_name || "")} 60% 45%)` }}
        >
          {initials}
        </span>
      ) : (
        <span className="hf-statuses-avatar hf-statuses-avatar-empty">—</span>
      )}
    </div>
  );
}

/** Отметка «веха пройдена» — в ClickUp это колонки в скобках. */
function DoneCell({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      className={clsx("hf-statuses-done", on && "hf-statuses-done-on")}
      onClick={() => onToggle(!on)}
      title={on ? "Пройдено" : "Не отмечено"}
    >
      {on ? "✓" : ""}
    </button>
  );
}
