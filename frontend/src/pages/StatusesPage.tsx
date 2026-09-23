import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Loader2, Plus, Pencil, Trash2, Eye, EyeOff, Check, X,
  ChevronRight, ChevronDown, Paperclip, Upload, SlidersHorizontal,
} from "lucide-react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  getBoardRows, updateBoardRow,
  getBoardDepartments, createBoardDepartment, renameBoardDepartment, setBoardDepartmentHidden,
  type BoardDepartment, type BoardRow, type BoardRowUpdate,
} from "@/services/api/staffBoard";
import { uploadEntityFile, deleteEntityFile, downloadEntityFile } from "@/services/api/entities";
import { getBoardPositions, getBoardManagers } from "@/services/api/staffBoard";
import { getOrgMembers } from "@/services/api/accessHub";
import { removeTagFromEntity } from "@/services/api/tags";
import { useUrlTab } from "@/hooks/useUrlTab";

/**
 * Страница «Статусы» — доска жизненного цикла сотрудника внутри направления.
 *
 * Слева — отделы оргструктуры (бывшие «направления»; «+ Отдел» заводит новый).
 * Справа — таблица, сгруппированная в сворачиваемые секции по статусам
 * ПРАКТИКА / ПЕРЕВЁЛСЯ / УВОЛЕН / УВОЛИЛСЯ. Все колонки редактируются инлайн,
 * у каждой — свой фильтр. Вехи 1/3/12 мес считаются от «выход в отдел»
 * автоматически (авто-значение показано курсивом), но их можно перебить.
 *
 * Оформление — семейство .hf-statuses-* в index.css (HR-дизайн-система).
 */

/** Порядок групп повторяет доску ClickUp: там сверху «Перевёлся», а
 *  «Практика» замыкает список. */
const STATUSES = [
  { key: "transferred", label: "ПЕРЕВЁЛСЯ",          members: ["transferred"] },
  // «Уволен» и «Уволился» — одна группа: HR неважно, кто инициатор, а две
  // полупустые секции только удлиняли доску. В базе различие остаётся
  // (dismissed / quit) — объединяем только показ, данные не трогаем.
  { key: "dismissed",   label: "УВОЛЕН / УВОЛИЛСЯ",  members: ["dismissed", "quit"] },
  { key: "probation",   label: "ПРАКТИКА",           members: ["probation"] },
  // Этапы воронки «Выставлен оффер» и «Оффер принят» — люди отсюда попадают
  // на доску сами, как только рекрутёр двигает их в воронке.
  { key: "offer",       label: "ОФФЕР ВЫСЛАН",       members: ["offer"] },
  { key: "hired",       label: "ОФФЕР ПРИНЯТ",       members: ["hired"] },
] as const;

/** В какую группу попадает статус строки. */
const groupOf = (status: string) =>
  STATUSES.find((g) => (g.members as readonly string[]).includes(status))?.key ?? status;

/** Пока человек на практике, отдела и должности нет — обе колонки
 *  показывают «Сандбокс» и не редактируются. */
const SANDBOX_LABEL = "Сандбокс";

const UNASSIGNED = "__none__";

type FilterKey =
  | "name" | "assignee" | "position" | "department" | "telegram"
  | "practice_start_date" | "manager" | "department_start_date"
  | "dept_done" | "w2" | "w2_done" | "m1" | "m1_done"
  | "m3" | "m3_done" | "y1" | "y1_done" | "dismissal_date";

/** Порядок и состав повторяют доску «Сотрудники» в ClickUp: после каждой
 *  вехи идёт колонка-отметка «пройдено» (в ClickUp она называлась так же,
 *  но в скобках). «2 недели» — наша дополнительная веха, в ClickUp её нет. */
/** Ширина в px задана у каждой колонки: без неё 19 колонок растягивались как
 *  попало, длинная должность раздувала свою, а даты сжимались до переноса.
 *  Суммарно таблица шире экрана — прокрутка есть, но имя закреплено слева. */
const COLUMNS: { key: FilterKey | "offer"; label: string; filter: boolean; narrow?: boolean; width: number }[] = [
  { key: "name",                  label: "Сотрудник",         filter: true, width: 250 },
  { key: "assignee",              label: "HR",                filter: true, width: 130 },
  { key: "position",              label: "Должность",         filter: true, width: 160 },
  { key: "department",            label: "Отдел",             filter: true, width: 150 },
  { key: "telegram",              label: "Telegram",          filter: true, width: 140 },
  { key: "practice_start_date",   label: "Выход на практику", filter: true, width: 104 },
  { key: "manager",               label: "Рук-ль",            filter: true, width: 110 },
  { key: "offer",                 label: "Оффер",             filter: false, narrow: true, width: 64 },
  { key: "department_start_date", label: "Выход в отдел",     filter: true, width: 104 },
  { key: "dept_done",             label: "✓",                 filter: true, narrow: true, width: 40 },
  { key: "w2",                    label: "2 недели",          filter: true, width: 96 },
  { key: "w2_done",               label: "✓",                 filter: true, narrow: true, width: 40 },
  { key: "m1",                    label: "1 мес",             filter: true, width: 96 },
  { key: "m1_done",               label: "✓",                 filter: true, narrow: true, width: 40 },
  { key: "m3",                    label: "3 мес",             filter: true, width: 96 },
  { key: "m3_done",               label: "✓",                 filter: true, narrow: true, width: 40 },
  { key: "y1",                    label: "1 год",             filter: true, width: 96 },
  { key: "y1_done",               label: "✓",                 filter: true, narrow: true, width: 40 },
  { key: "dismissal_date",        label: "Дата увольнения",   filter: true, width: 110 },
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

const FILTERS_STORAGE_KEY = "hf-statuses-rules";

/** Колонки, по которым можно сортировать кликом по заголовку: даты выходов.
 *  Мария смотрит, кто вышел последним, — без сортировки приходилось искать
 *  глазами (встреча 23.09.2026). */
type SortKey = "practice_start_date" | "department_start_date" | "dismissal_date";
const SORTABLE: SortKey[] = ["practice_start_date", "department_start_date", "dismissal_date"];
type SortDir = "asc" | "desc";

/** Операторы как в конструкторе фильтров ClickUp. */
type FilterOp = "is" | "is_not" | "contains" | "set" | "not_set";

const OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: "is",       label: "равно",         needsValue: true },
  { value: "is_not",   label: "не равно",      needsValue: true },
  { value: "contains", label: "содержит",      needsValue: true },
  { value: "set",      label: "заполнено",     needsValue: false },
  { value: "not_set",  label: "не заполнено",  needsValue: false },
];

interface FilterRule {
  id: string;
  key: FilterKey;
  op: FilterOp;
  value: string;
}

let ruleSeq = 0;
const newRuleId = () => `r${(ruleSeq += 1)}`;

/** Пустая ячейка рисуется как «—», поэтому прочерк тоже считаем пустотой. */
const isBlank = (v: string) => !v.trim() || v.trim() === "—";

const cellText = (r: BoardRow, key: FilterKey): string => {
  switch (key) {
    case "name": return r.name || "";
    case "assignee": return rowAssignees(r).map((a) => a.name || "").filter(Boolean).join(", ");
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
  const [departments, setDepartments] = useState<BoardDepartment[]>([]);
  // Справочники для выпадающих списков: должности и руководители собираются
  // из уже существующих значений, HR — из участников организации.
  const [positions, setPositions] = useState<string[]>([]);
  const [managers, setManagers] = useState<string[]>([]);
  const [people, setPeople] = useState<{ user_id: number; user_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  // Отдел слева живёт в URL (?dept=) — работают браузерные «Назад/Вперёд».
  // Раньше тут были «направления» — отдельный список папок, но это те же
  // отделы (решение владельца 21.09.2026), так что панель строится по отделам.
  const [dept, setDept] = useUrlTab<string>("dept", "all");
  const [q, setQ] = useState("");
  // Быстрый фильтр по HR — запоминаем: Лиза открывает доску и сразу видит своих
  const [hrFilter, setHrFilter] = useState<string>(() => {
    try { return localStorage.getItem(HR_FILTER_STORAGE_KEY) || ""; } catch { return ""; }
  });
  useEffect(() => {
    try {
      if (hrFilter) localStorage.setItem(HR_FILTER_STORAGE_KEY, hrFilter);
      else localStorage.removeItem(HR_FILTER_STORAGE_KEY);
    } catch { /* без хранилища просто не запоминаем */ }
  }, [hrFilter]);

  // Конструктор фильтров повторяет ClickUp: список правил
  // «поле → оператор → значение», которые применяются вместе.
  const [rules, setRules] = useState<FilterRule[]>(() => {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) {
        return (JSON.parse(raw) as FilterRule[])
          .filter((r) => FILTERABLE.some((c) => c.key === r.key) && OPS.some((o) => o.value === r.op))
          .map((r) => ({ ...r, id: newRuleId() }));
      }
    } catch { /* повреждённое значение — начинаем без фильтров */ }
    return [];
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  // Сортировка по дате: клик по заголовку — сначала новые, второй — старые,
  // третий возвращает обычный порядок.
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur?.key !== key ? { key, dir: "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null
    );

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(rules));
    } catch { /* приватный режим — переживём без сохранения */ }
  }, [rules]);

  const addRule = () =>
    setRules((cur) => [...cur, { id: newRuleId(), key: "department", op: "is", value: "" }]);

  const patchRule = (id: string, patch: Partial<FilterRule>) =>
    setRules((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const dropRule = (id: string) => setRules((cur) => cur.filter((r) => r.id !== id));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  /** Смена статуса. Перевод в «Уволен»/«Уволился» на бэкенде запускает
   *  оффбординг: гасит аккаунт, отзывает сессии и отвязывает Telegram.
   *  Молча это делать нельзя — сообщаем, что именно произошло. */
  const changeStatus = async (row: BoardRow, status: string) => {
    const label = STATUSES.find((s2) => s2.key === status)?.label || status;
    await patch(row, { status });
    if (status === "dismissed" || status === "quit") {
      toast(
        `${row.name} → ${label}. Аккаунт отключён, сессии сброшены, Telegram отвязан.`,
        { icon: "⚠️", duration: 6000 }
      );
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getBoardRows());
    } catch {
      toast.error("Не удалось загрузить доску");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    getBoardDepartments().then(setDepartments).catch(() => setDepartments([]));
    getBoardPositions().then(setPositions).catch(() => setPositions([]));
    getBoardManagers().then(setManagers).catch(() => setManagers([]));
    // Вести сотрудника может только HR. В организации числятся все
    // работники, и без фильтра в список попадали бы полсотни человек,
    // среди которых нужного не найти.
    getOrgMembers()
      .then((m) =>
        setPeople(
          m
            .filter((x) => x.role === "owner" || x.role === "admin" || x.role === "hr")
            .filter((x) => isBoardHr(x.user_name))
            .map((x) => ({ user_id: x.user_id, user_name: x.user_name }))
            .sort((a, b) => (a.user_name || "").localeCompare(b.user_name || "", "ru"))
        )
      )
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
    // HR из воронки тоже считается: «кандидаты Лизы» — все, кого она ведёт,
    // а не только те, за кем её закрепили руками.
    if (hrFilter === HR_NONE) {
      out = out.filter((r) => rowAssignees(r).length === 0);
    } else if (hrFilter) {
      const uid = Number(hrFilter);
      out = out.filter((r) => rowAssignees(r).some((a) => a.user_id === uid));
    }
    // Отмеченная колонка = условие «у человека она заполнена». Несколько
    // отмеченных требуют заполненности КАЖДОЙ.
    // Правила применяются вместе (И) — как в ClickUp.
    for (const rule of rules) {
      const spec = OPS.find((o) => o.value === rule.op);
      // Правило без выбранного значения ничего не отбирает: иначе только что
      // добавленная строка мгновенно обнуляла бы таблицу.
      if (spec?.needsValue && !rule.value) continue;
      out = out.filter((r) => {
        const cell = cellText(r, rule.key).trim();
        switch (rule.op) {
          case "set": return !isBlank(cell);
          case "not_set": return isBlank(cell);
          case "is": return cell.toLowerCase() === rule.value.trim().toLowerCase();
          case "is_not": return cell.toLowerCase() !== rule.value.trim().toLowerCase();
          case "contains": return cell.toLowerCase().includes(rule.value.toLowerCase());
          default: return true;
        }
      });
    }
    return out;
  }, [rows, q, rules, hrFilter]);

  /** HR для быстрого фильтра — только те, у кого на доске кто-то есть. */
  const hrOptions = useMemo(() => {
    const map = new Map<number, { name: string; count: number }>();
    let none = 0;
    for (const r of rows) {
      const list = rowAssignees(r);
      if (list.length === 0) none += 1;
      for (const a of list) {
        const cur = map.get(a.user_id);
        map.set(a.user_id, { name: cur?.name || a.name || `#${a.user_id}`, count: (cur?.count || 0) + 1 });
      }
    }
    const list = [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return { list, none };
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: searched.length, [UNASSIGNED]: 0 };
    for (const r of searched) {
      const key = r.department_id != null ? String(r.department_id) : UNASSIGNED;
      c[key] = (c[key] || 0) + 1;
    }
    return c;
  }, [searched]);

  const visible = useMemo(() => {
    if (dept === "all") return searched;
    if (dept === UNASSIGNED) return searched.filter((r) => r.department_id == null);
    return searched.filter((r) => String(r.department_id) === dept);
  }, [searched, dept]);

  /** Значения для выбора в правиле — те, что реально есть в таблице.
   *  Считаем по строкам текущей папки и поиска, но БЕЗ учёта самих правил:
   *  иначе, выбрав значение, человек терял бы возможность сменить его. */
  const valuesFor = useCallback(
    (key: FilterKey): { value: string; count: number }[] => {
      const needle = q.trim().toLowerCase();
      const map = new Map<string, number>();
      for (const r of rows) {
        if (needle && ![r.name, r.position, r.department_name, r.telegram, r.manager]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle))) continue;
        const v = cellText(r, key).trim();
        if (isBlank(v)) continue;
        map.set(v, (map.get(v) || 0) + 1);
      }
      return [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "ru"));
    },
    [rows, q]
  );

  const activeCount = rules.length;

  const grouped = useMemo(
    () => STATUSES.map((s) => {
      const items = visible.filter((r) => (s.members as readonly string[]).includes(r.status));
      if (!sort) return { ...s, items };
      // Пустая дата — всегда в конце, в любую сторону: строка без даты не
      // «самая старая», про неё просто ничего не известно.
      const val = (r: BoardRow) => r[sort.key] || "";
      return {
        ...s,
        items: [...items].sort((a, b) => {
          const x = val(a), y = val(b);
          if (!x || !y) return x ? -1 : y ? 1 : 0;
          return sort.dir === "asc" ? x.localeCompare(y) : y.localeCompare(x);
        }),
      };
    }),
    [visible, sort]
  );

  return (
    <div className="hf-statuses-page">
      <div className="hf-statuses-header">
        <div>
          <h1 className="hf-statuses-title">Статусы</h1>
          <p className="hf-statuses-subtitle">Жизненный цикл сотрудника по отделам</p>
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

          <select
            className={clsx("hf-statuses-hr-filter", hrFilter && "hf-statuses-hr-filter-on")}
            value={hrFilter}
            onChange={(e) => setHrFilter(e.target.value)}
            title="Показать людей конкретного HR"
          >
            <option value="">HR: все</option>
            {hrOptions.list.map((h) => (
              <option key={h.id} value={String(h.id)}>{h.name} · {h.count}</option>
            ))}
            {/* выбранный HR мог пропасть с доски — не сбрасываем выбор молча */}
            {hrFilter && hrFilter !== HR_NONE && !hrOptions.list.some((h) => String(h.id) === hrFilter) && (
              <option value={hrFilter}>HR #{hrFilter} · 0</option>
            )}
            {hrOptions.none > 0 && <option value={HR_NONE}>Без HR · {hrOptions.none}</option>}
          </select>

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
                    <span>Фильтры</span>
                    {rules.length > 0 && (
                      <div className="hf-statuses-picker-actions">
                        <button onClick={() => setRules([])}>очистить</button>
                      </div>
                    )}
                  </div>

                  {rules.length === 0 && (
                    <div className="hf-statuses-rule-empty">
                      Фильтров нет — показаны все сотрудники
                    </div>
                  )}

                  {rules.map((rule) => {
                    const spec = OPS.find((o) => o.value === rule.op);
                    return (
                      <div key={rule.id} className="hf-statuses-rule">
                        <select
                          className="hf-statuses-rule-field"
                          value={rule.key}
                          onChange={(e) =>
                            patchRule(rule.id, { key: e.target.value as FilterKey, value: "" })
                          }
                        >
                          {FILTERABLE.map((c) => (
                            <option key={c.key} value={c.key}>
                              {FILTER_LABELS[c.key] || c.label}
                            </option>
                          ))}
                        </select>

                        <select
                          className="hf-statuses-rule-op"
                          value={rule.op}
                          onChange={(e) =>
                            patchRule(rule.id, { op: e.target.value as FilterOp })
                          }
                        >
                          {OPS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>

                        {spec?.needsValue ? (
                          <>
                            {/* Обычное текстовое поле. Подсказки через datalist:
                                значения из таблицы под рукой, но вписать можно
                                что угодно, включая ещё не встречавшееся. */}
                            <input
                              className="hf-statuses-rule-value"
                              list={`vals-${rule.id}`}
                              value={rule.value}
                              placeholder="значение"
                              onChange={(e) => patchRule(rule.id, { value: e.target.value })}
                            />
                            <datalist id={`vals-${rule.id}`}>
                              {valuesFor(rule.key).map((v) => (
                                <option key={v.value} value={v.value} />
                              ))}
                            </datalist>
                          </>
                        ) : (
                          <span className="hf-statuses-rule-value hf-statuses-rule-value-off" />
                        )}

                        <button
                          className="hf-statuses-rule-drop"
                          onClick={() => dropRule(rule.id)}
                          title="Удалить фильтр"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}

                  <button className="hf-statuses-rule-add" onClick={addRule}>
                    <Plus size={14} /> Добавить фильтр
                  </button>
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
          <DepartmentSidebar
            departments={departments}
            counts={counts}
            active={dept}
            onSelect={setDept}
            onCreated={(d) => setDepartments((cur) => [...cur, d])}
            onRenamed={(d) => setDepartments((cur) => cur.map((x) => (x.id === d.id ? d : x)))}
            onHidden={(d) => setDepartments((cur) => cur.map((x) => (x.id === d.id ? d : x)))}
          />

          <div className="hf-statuses-table-wrap">
            <table className="hf-statuses-table">
              <colgroup>
                {COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const sortable = SORTABLE.includes(c.key as SortKey);
                    const on = sort?.key === c.key;
                    return (
                      <th
                        key={c.key}
                        className={clsx(
                          "hf-statuses-th",
                          c.key === "name" && "hf-statuses-sticky",
                          sortable && "hf-statuses-th-sortable",
                          on && "hf-statuses-th-sorted"
                        )}
                        title={
                          sortable
                            ? `${c.label} — сортировать по дате`
                            : FILTER_LABELS[c.key as FilterKey] || c.label
                        }
                        onClick={sortable ? () => toggleSort(c.key as SortKey) : undefined}
                      >
                        {c.label}
                        {sortable && (
                          <span className="hf-statuses-th-arrow">
                            {on ? (sort!.dir === "desc" ? "↓" : "↑") : "↕"}
                          </span>
                        )}
                      </th>
                    );
                  })}
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
                          departments={departments}
                          positions={positions}
                          managers={managers}
                          people={people}
                          saving={savingId === r.entity_id}
                          onPatch={patch}
                          onStatus={changeStatus}
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

/** Отделы слева — вместо прежних «направлений» (это были те же отделы).
 *  Сначала отделы, где кто-то есть, потом пустые: пустых в оргструктуре
 *  много, и за ними терялись нужные. «+ Отдел» заводит отдел прямо здесь; это
 *  СВОЙ справочник доски, оргструктуру Enceladus он не трогает. */
function DepartmentSidebar({
  departments, counts, active, onSelect, onCreated, onRenamed, onHidden,
}: {
  departments: BoardDepartment[];
  counts: Record<string, number>;
  active: string;
  onSelect: (id: string) => void;
  onCreated: (d: BoardDepartment) => void;
  onRenamed: (d: BoardDepartment) => void;
  onHidden: (d: BoardDepartment) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  // Скрытые не выбрасываем из списка совсем: их можно раскрыть и вернуть.
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const cancel = () => { setAdding(false); setName(""); };

  const create = async () => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || busy) return;
    // Такой уже есть — не плодим близнецов, просто открываем его
    const same = departments.find((d) => d.name.trim().toLowerCase() === clean.toLowerCase());
    if (same) {
      toast(`Отдел «${same.name}» уже есть`);
      onSelect(String(same.id));
      cancel();
      return;
    }
    setBusy(true);
    try {
      const d = await createBoardDepartment(clean);
      onCreated(d);
      onSelect(String(d.id));
      toast.success(`Отдел «${d.name}» создан`);
      cancel();
    } catch (e: any) {
      toast.error(
        e?.response?.status === 403
          ? "Создавать отделы может только владелец организации"
          : e?.response?.data?.detail || "Не удалось создать отдел"
      );
    } finally {
      setBusy(false);
    }
  };

  const label = (d: BoardDepartment) => d.name;
  const hiddenCount = departments.filter((d) => d.hidden).length;
  const sorted = [...departments]
    .filter((d) => showHidden || !d.hidden || String(d.id) === active)
    .sort((a, b) => {
      const ca = counts[String(a.id)] ?? 0;
      const cb = counts[String(b.id)] ?? 0;
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
      if ((ca > 0) !== (cb > 0)) return ca > 0 ? -1 : 1;
      return label(a).localeCompare(label(b), "ru");
    });

  const rename = async (d: BoardDepartment) => {
    const clean = editName.trim().replace(/\s+/g, " ");
    if (!clean || busy) return;
    if (clean === d.name) { setEditing(null); return; }
    setBusy(true);
    try {
      onRenamed(await renameBoardDepartment(d.id, clean));
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Не удалось переименовать отдел");
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (d: BoardDepartment) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await setBoardDepartmentHidden(d.id, !d.hidden);
      onHidden(next);
      if (next.hidden && active === String(d.id)) onSelect("all");
      toast.success(next.hidden ? `Отдел «${d.name}» скрыт` : `Отдел «${d.name}» снова виден`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Не удалось изменить отдел");
    } finally {
      setBusy(false);
    }
  };

  const item = (id: string, text: string) => (
    <button
      key={id}
      onClick={() => onSelect(id)}
      className={clsx("hf-statuses-folder", active === id && "hf-statuses-folder-active")}
      title={text}
    >
      <span className="hf-statuses-folder-name">{text}</span>
      <span className="hf-statuses-folder-count">{counts[id] ?? 0}</span>
    </button>
  );

  return (
    <div className="hf-statuses-sidebar">
      {item("all", "Все")}

      {sorted.map((d) =>
        editing === d.id ? (
          <div key={d.id} className="hf-statuses-folder-edit">
            <input
              autoFocus
              className="hf-statuses-folder-input"
              value={editName}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(d);
                if (e.key === "Escape") setEditing(null);
              }}
            />
            <button className="hf-statuses-folder-action" onClick={() => rename(d)} title="Сохранить">
              <Check size={14} />
            </button>
            <button className="hf-statuses-folder-action" onClick={() => setEditing(null)} title="Отмена">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div key={d.id} className={clsx("hf-statuses-folder-row", d.hidden && "hf-statuses-folder-hidden")}>
            {item(String(d.id), label(d))}
            <div className="hf-statuses-folder-actions">
              <button
                className="hf-statuses-folder-action"
                title="Переименовать"
                onClick={(e) => { e.stopPropagation(); setEditing(d.id); setEditName(d.name); }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="hf-statuses-folder-action"
                title={d.hidden ? "Показывать отдел" : "Скрыть отдел (останется у людей)"}
                onClick={(e) => { e.stopPropagation(); toggleHidden(d); }}
              >
                {d.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
          </div>
        )
      )}

      {item(UNASSIGNED, "Без отдела")}

      {hiddenCount > 0 && (
        <button className="hf-statuses-folder-add" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          {showHidden ? "Спрятать скрытые" : `Показать скрытые · ${hiddenCount}`}
        </button>
      )}

      {adding ? (
        <div className="hf-statuses-folder-edit">
          <input
            autoFocus
            className="hf-statuses-folder-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") cancel();
            }}
            placeholder="Название отдела"
            maxLength={100}
            disabled={busy}
          />
          <button className="hf-statuses-folder-action" onClick={create} disabled={busy} title="Создать">
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
          </button>
          <button className="hf-statuses-folder-action" onClick={cancel} disabled={busy} title="Отмена">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button className="hf-statuses-folder-add" onClick={() => setAdding(true)}>
          <Plus size={14} /> Отдел
        </button>
      )}
    </div>
  );
}

// ============================================================
// ROW
// ============================================================

function Row({
  row, departments, positions, managers, people, saving, onPatch, onStatus, onReload,
}: {
  row: BoardRow;
  departments: BoardDepartment[];
  positions: string[];
  managers: string[];
  people: { user_id: number; user_name: string | null }[];
  saving: boolean;
  onPatch: (row: BoardRow, body: BoardRowUpdate) => Promise<void>;
  onStatus: (row: BoardRow, status: string) => Promise<void>;
  onReload: () => void;
}) {
  const sandbox = row.status === "probation";

  return (
    <tr className={clsx("hf-statuses-row", saving && "hf-statuses-row-saving")}>
      <td className="hf-statuses-td hf-statuses-sticky">
        {/* Всё в одну строку: раньше имя, статус и направление шли друг под
            другом, строка вырастала втрое и таблицу «трясло» при листании. */}
        <div className="hf-statuses-name-controls">
          {/* Имя — ссылка на карточку в «Все кандидаты»: кандидат и сотрудник —
              одна запись, вся история (резюме, воронки, комментарии) там. */}
          <Link
            to={`/all-candidates?entity=${row.entity_id}`}
            className="hf-statuses-name hf-statuses-name-link"
            title="Открыть карточку в «Все кандидаты»"
          >
            {row.name}
          </Link>
          {/* Смена статуса прямо в строке: раньше перевести человека из
              «Практики» в «Уволен» через интерфейс было нельзя вообще. */}
          <select
            className={clsx("hf-statuses-status", `hf-statuses-status-${groupOf(row.status)}`)}
            value={groupOf(row.status)}
            onChange={(e) => {
              // Уже в объединённой группе — повторный выбор ничего не меняет,
              // иначе «уволился» молча переписался бы в «уволен».
              if (e.target.value !== groupOf(row.status)) onStatus(row, e.target.value);
            }}
          >
            {STATUSES.map((st) => (
              <option key={st.key} value={st.key}>{st.label}</option>
            ))}
          </select>
        </div>
      </td>

      <td className="hf-statuses-td hf-statuses-td-assignee">
        <AssigneeCell
          row={row}
          people={people}
          onSave={(ids) => onPatch(row, { assignee_user_ids: ids })}
          onReload={onReload}
        />
      </td>

      <td className="hf-statuses-td">
        {sandbox ? (
          <span className="hf-statuses-pill hf-statuses-pill-locked" title="Назначается автоматически на практике">
            {SANDBOX_LABEL}
          </span>
        ) : (
          <PillCell
            value={row.position}
            options={positions}
            onSave={(v) => onPatch(row, { position: v })}
          />
        )}
      </td>

      <td className="hf-statuses-td">
        {sandbox ? (
          <span className="hf-statuses-pill hf-statuses-pill-locked" title="Назначается автоматически на практике">
            {SANDBOX_LABEL}
          </span>
        ) : (
          <select
            className="hf-statuses-select"
            value={row.department_id ?? ""}
            onChange={(e) => onPatch(row, { department_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">—</option>
            {departments
              .filter((d) => !d.hidden || d.id === row.department_id)
              .map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.hidden ? " (скрыт)" : ""}</option>
              ))}
          </select>
        )}
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

/** Ведущие HR строки; старый ответ бэка без assignees — из одиночного поля. */
const rowAssignees = (r: BoardRow) =>
  r.assignees ?? (r.assignee_user_id != null
    ? [{ user_id: r.assignee_user_id, name: r.assignee_name, auto: !!r.assignee_auto }]
    : []);

/** Быстрый фильтр «кандидаты Лизы»: id HR или «без HR». */
const HR_NONE = "none";
const HR_FILTER_STORAGE_KEY = "hf-statuses-hr";

/** Кого можно добавить в колонку HR через «+». Решение владельца 21.09.2026:
 *  доску «Статусы» ведут только Мария и Эльвира, остальные HR в списке
 *  мешали. Сверяем по первому слову имени (кириллица или латиница), без учёта
 *  регистра. Уже назначенных других HR это не снимает — их кружки остаются. */
const BOARD_HR_FIRST_NAMES = ["мария", "maria", "эльвира", "elvira"];
const isBoardHr = (name: string | null | undefined) =>
  BOARD_HR_FIRST_NAMES.includes((name || "").trim().split(/\s+/)[0].toLowerCase());

/** Сколько HR можно закрепить за человеком — как на бэке (MAX_ASSIGNEES). */
const MAX_HR = 5;

const initialsOf = (name: string | null | undefined) =>
  (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

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
          placeholder="впишите или выберите"
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

/** HR и сорсеры человека — кружками с инициалами.
 *
 * Подтягиваются из меток кандидата: «HR: …» (их считает воронка) и метки-
 * сорсеры (кто привёл). Кандидат и сотрудник — одна запись, так что заново
 * вбивать их не нужно.
 *
 * Наведение на кружок меняет инициалы на «×» — снять этого человека. «+»
 * справа — добавить HR. HR после правки хранятся на доске (метки воронки их
 * больше не перебивают); сорсер снимается с самой карточки — это та же метка.
 */
function AssigneeCell({
  row, people, onSave, onReload,
}: {
  row: BoardRow;
  people: { user_id: number; user_name: string | null }[];
  onSave: (ids: number[]) => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const assignees = rowAssignees(row);
  const ids = assignees.map((a) => a.user_id);
  const sourcers = row.sourcers ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || plusRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    // Меню fixed — при прокрутке доски оно бы «отстало» от ячейки
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const openMenu = () => {
    if (open) { setOpen(false); return; }
    if (ids.length >= MAX_HR) { toast.error(`Не больше ${MAX_HR} HR на человека`); return; }
    const r = plusRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 232)) });
    setOpen(true);
  };

  const add = (uid: number) => {
    setOpen(false);
    onSave([...ids, uid]);
  };

  const removeSourcer = async (tagId: number, name: string) => {
    try {
      await removeTagFromEntity(row.entity_id, tagId);
      onReload();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || `Не удалось снять «${name}»`);
    }
  };

  const options = people.filter((p) => !ids.includes(p.user_id));

  return (
    <div className="hf-statuses-assignee" data-many={assignees.length + sourcers.length > 2}>
      {assignees.map((a) => {
        const name = a.name || `#${a.user_id}`;
        return (
          <button
            key={`hr-${a.user_id}`}
            type="button"
            className="hf-statuses-avatar hf-statuses-avatar-removable"
            style={{ background: `hsl(${pillHue(a.name || "")} 60% 45%)` }}
            title={`HR: ${name} — убрать`}
            aria-label={`Убрать HR ${name}`}
            onClick={() => onSave(ids.filter((x) => x !== a.user_id))}
          >
            <span className="hf-statuses-avatar-text">{initialsOf(a.name)}</span>
            <X className="hf-statuses-avatar-x" size={13} />
          </button>
        );
      })}
      {sourcers.map((t) => (
        <button
          key={`src-${t.id}`}
          type="button"
          className="hf-statuses-avatar hf-statuses-avatar-removable"
          style={{ background: t.color }}
          title={`Сорсер: ${t.name} — убрать`}
          aria-label={`Убрать сорсера ${t.name}`}
          onClick={() => removeSourcer(t.id, t.name)}
        >
          <span className="hf-statuses-avatar-text">{initialsOf(t.name)}</span>
          <X className="hf-statuses-avatar-x" size={13} />
        </button>
      ))}
      <button
        ref={plusRef}
        type="button"
        className="hf-statuses-avatar-add"
        title="Добавить HR"
        aria-label="Добавить HR"
        onClick={openMenu}
      >
        <Plus size={13} />
      </button>
      {open && pos && (
        <div ref={menuRef} className="hf-statuses-hr-menu" style={{ top: pos.top, left: pos.left }}>
          <div className="hf-statuses-hr-menu-hint">Добавить HR</div>
          {options.length === 0 && <div className="hf-statuses-hr-menu-hint">Все HR уже добавлены</div>}
          {options.map((p) => (
            <button key={p.user_id} type="button" className="hf-statuses-hr-option" onClick={() => add(p.user_id)}>
              <span
                className="hf-statuses-avatar hf-statuses-avatar-sm"
                style={{ background: `hsl(${pillHue(p.user_name || "")} 60% 45%)` }}
              >
                {initialsOf(p.user_name)}
              </span>
              {p.user_name || `#${p.user_id}`}
            </button>
          ))}
        </div>
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
