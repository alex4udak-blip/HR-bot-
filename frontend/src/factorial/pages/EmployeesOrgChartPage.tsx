import { useState, useRef, useMemo, type ReactNode, type MouseEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Plus, Minus, Pencil, Trash2, ChevronDown, Maximize2, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '@/factorial/components/PageHeader';
import SecondaryNav from '@/factorial/components/SecondaryNav';
import DetailRow from '@/factorial/components/cabinet/DetailRow';
import { getCurrentOrganization } from '@/services/api/auth';
import {
  getOrgChart, createOrgUnit, updateOrgUnit, deleteOrgUnit, assignEmployee, setManager,
  type OrgUnitNode, type PersonNode,
} from '@/factorial/api/orgUnits';

const NAV = [
  { label: 'Сотрудники', href: '/factorial/employees', end: true },
  { label: 'Команды', href: '/factorial/employees/teams' },
  { label: 'Оргсхема', href: '/factorial/employees/org-chart' },
  { label: 'Вакансии', href: '/factorial/employees/vacancies' },
];

const PALETTE: [string, string][] = [
  ['#DBEAFE', '#1D4ED8'], ['#FCE7F3', '#BE185D'], ['#DCFCE7', '#15803D'],
  ['#FEF3C7', '#B45309'], ['#EDE9FE', '#6D28D9'], ['#E0F2FE', '#0369A1'],
];
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '—';
const colorFor = (key: string): [string, string] => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

type TreeNode = {
  kind: 'company' | 'unit' | 'emp';
  id: string;
  empId?: number;
  unitId?: number | null;
  parentUnitId?: number | null;
  name: string;
  position?: string;
  deptName?: string;
  deptColor?: string;
  managerName?: string;
  count?: number;
  children: TreeNode[];
};

const TREE_CSS = `
.fx-ot, .fx-ot ul { margin:0; padding:0; }
.fx-ot ul { display:flex; justify-content:center; padding-top:32px; position:relative; }
.fx-ot li { list-style:none; position:relative; padding:32px 16px 0; }
.fx-ot li::before, .fx-ot li::after { content:''; position:absolute; top:0; right:50%; border-top:1.5px solid #E2E8F0; width:50%; height:32px; }
.fx-ot li::after { right:auto; left:50%; border-left:1.5px solid #E2E8F0; }
.fx-ot li:only-child::before, .fx-ot li:only-child::after { display:none; }
.fx-ot li:first-child::before, .fx-ot li:last-child::after { border:0 none; }
.fx-ot li:last-child::before { border-right:1.5px solid #E2E8F0; border-radius:0 8px 0 0; }
.fx-ot li:first-child::after { border-radius:8px 0 0 0; }
.fx-ot ul ul::before { content:''; position:absolute; top:0; left:50%; border-left:1.5px solid #E2E8F0; width:0; height:32px; }
.fx-ot > ul { padding-top:0; }
.fx-ot > ul > li { padding-top:0; }
.fx-ot > ul > li::before, .fx-ot > ul > li::after { display:none; }
.fx-ot-wrap { position:relative; display:inline-flex; flex-direction:column; align-items:center; }
.fx-ot-card { position:relative; display:inline-flex; flex-direction:column; align-items:center; gap:5px; background:transparent; border:0; padding:8px 12px; border-radius:16px; cursor:pointer; transition:background .12s; }
.fx-ot-card:hover { background:rgba(99,102,241,.07); }
.fx-ot-av { width:56px; height:56px; border-radius:18px; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:16px; box-shadow:0 1px 2px rgba(15,23,42,.10); }
.fx-ot-name { font-weight:600; font-size:13px; color:#0F172A; max-width:180px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fx-ot-sub { font-size:11px; color:#64748B; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fx-ot-meta { display:flex; align-items:center; gap:5px; }
.fx-ot-count { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:#F1F5F9; color:#475569; font-size:11px; }
.fx-ot-pill { display:inline-flex; align-items:center; font-size:11px; padding:2px 8px; border-radius:6px; background:#F1F5F9; color:#475569; max-width:170px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fx-ot-toggle { position:absolute; left:50%; bottom:-16px; transform:translateX(-50%); z-index:3; display:inline-flex; align-items:center; gap:3px; background:#fff; border:1px solid #CBD5E1; border-radius:999px; padding:1px 7px; font-size:11px; color:#475569; cursor:pointer; box-shadow:0 1px 2px rgba(15,23,42,.08); }
.fx-ot-toggle:hover { background:#F8FAFC; color:#0F172A; }
.fx-ot-drop .fx-ot-av { outline:2px solid #6366F1; outline-offset:2px; }
/* отдел-узел */
.fx-ot-unit { position:relative; display:inline-flex; align-items:center; gap:9px; background:#fff; border:1px solid #E2E8F0; border-radius:14px; padding:9px 12px 9px 10px; box-shadow:0 1px 2px rgba(15,23,42,.08); cursor:pointer; min-width:128px; transition:border-color .12s, box-shadow .12s; }
.fx-ot-unit:hover { border-color:#C7D2FE; box-shadow:0 2px 8px rgba(99,102,241,.12); }
.fx-ot-unit-bar { width:6px; align-self:stretch; min-height:34px; border-radius:999px; flex:none; }
.fx-ot-unit-body { display:flex; flex-direction:column; }
.fx-ot-unit-name { font-weight:600; font-size:13px; color:#0F172A; max-width:170px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fx-ot-unit-count { font-size:11px; color:#64748B; }
.fx-ot-unit-actions { position:absolute; top:-14px; right:4px; display:none; align-items:center; gap:1px; background:#fff; border:1px solid #E2E8F0; border-radius:9px; padding:2px; box-shadow:0 2px 8px rgba(15,23,42,.14); z-index:4; }
.fx-ot-unit:hover .fx-ot-unit-actions { display:inline-flex; }
.fx-ot-unit-actions button { display:inline-flex; padding:4px; border-radius:6px; color:#64748B; }
.fx-ot-unit-actions button:hover { background:#F1F5F9; color:#0F172A; }
.fx-ot-drop-unit { outline:2px solid #6366F1; outline-offset:2px; }
`;

export default function EmployeesOrgChartPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['fx', 'org-chart'], queryFn: getOrgChart });
  const { data: org } = useQuery({ queryKey: ['fx', 'org-current'], queryFn: getCurrentOrganization, retry: false });
  const orgName = org?.name || '—';
  const refresh = () => qc.invalidateQueries({ queryKey: ['fx', 'org-chart'] });

  const mCreate = useMutation({ mutationFn: (v: { name: string; parent: number | null }) => createOrgUnit({ name: v.name, parent_id: v.parent, color: colorFor(v.name)[1] }), onSuccess: refresh });
  const mUpdate = useMutation({ mutationFn: (v: { id: number; name: string }) => updateOrgUnit(v.id, { name: v.name }), onSuccess: refresh });
  const mReparent = useMutation({ mutationFn: (v: { id: number; parent: number | null }) => updateOrgUnit(v.id, { parent_id: v.parent }), onSuccess: refresh, onError: () => {} });
  const mDelete = useMutation({ mutationFn: (id: number) => deleteOrgUnit(id), onSuccess: refresh });
  const mAssign = useMutation({ mutationFn: (v: { id: number; unit: number | null }) => assignEmployee(v.id, v.unit), onSuccess: refresh });
  const mManager = useMutation({ mutationFn: (v: { id: number; manager: number | null }) => setManager(v.id, v.manager), onSuccess: refresh, onError: () => {} });

  const units: OrgUnitNode[] = data?.units ?? [];
  const people: PersonNode[] = data?.people ?? [];
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  // Дерево: Организация → Отделы (вложенные) → Сотрудники (внутри отдела — по руководителю)
  const tree = useMemo<TreeNode>(() => {
    const unitsByParent = new Map<number | null, OrgUnitNode[]>();
    units.forEach((u) => { const k = u.parent_id ?? null; if (!unitsByParent.has(k)) unitsByParent.set(k, []); unitsByParent.get(k)!.push(u); });
    const peopleByUnit = new Map<number | null, PersonNode[]>();
    people.forEach((p) => { const k = p.org_unit_id ?? null; if (!peopleByUnit.has(k)) peopleByUnit.set(k, []); peopleByUnit.get(k)!.push(p); });
    const nameById = new Map(people.map((p) => [p.id, p.user_name || '—']));

    // люди одного scope (один отдел или «без отдела»), вложенные по manager_id внутри scope
    const buildPersonForest = (scopeUnitId: number | null): TreeNode[] => {
      const scope = peopleByUnit.get(scopeUnitId) || [];
      const scopeIds = new Set(scope.map((p) => p.id));
      const childrenByMgr = new Map<number, PersonNode[]>();
      scope.forEach((p) => {
        if (p.manager_id != null && scopeIds.has(p.manager_id)) {
          if (!childrenByMgr.has(p.manager_id)) childrenByMgr.set(p.manager_id, []);
          childrenByMgr.get(p.manager_id)!.push(p);
        }
      });
      const seen = new Set<number>();
      const buildPerson = (p: PersonNode): TreeNode => {
        seen.add(p.id);
        const u = p.org_unit_id != null ? unitById.get(p.org_unit_id) : null;
        return {
          kind: 'emp', id: 'e' + p.id, empId: p.id, name: p.user_name || '—', position: p.position || '',
          unitId: p.org_unit_id ?? null, deptName: u?.name || 'Без отдела', deptColor: u?.color || '#94A3B8',
          managerName: p.manager_id != null ? (nameById.get(p.manager_id) || '—') : '—',
          children: (childrenByMgr.get(p.id) || []).filter((c) => !seen.has(c.id)).map(buildPerson),
        };
      };
      const roots = scope.filter((p) => p.manager_id == null || !scopeIds.has(p.manager_id));
      return roots.map(buildPerson);
    };

    const buildUnit = (u: OrgUnitNode): TreeNode => ({
      kind: 'unit', id: 'u' + u.id, unitId: u.id, name: u.name, deptColor: u.color || '#94A3B8',
      parentUnitId: u.parent_id ?? null,
      count: (peopleByUnit.get(u.id) || []).length,
      children: [
        ...(unitsByParent.get(u.id) || []).map(buildUnit),
        ...buildPersonForest(u.id),
      ],
    });

    return {
      kind: 'company', id: 'root', name: orgName && orgName !== '—' ? orgName : 'Организация',
      count: people.length,
      children: [
        ...(unitsByParent.get(null) || []).map(buildUnit),
        ...buildPersonForest(null),
      ],
    };
  }, [people, units, unitById, orgName]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandAll = () => setCollapsed(new Set());

  const [sel, setSel] = useState<TreeNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const onDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.fx-ot-card, .fx-ot-unit, .fx-ot-toggle, button')) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    setPanning(true);
  };
  const onMove = (e: MouseEvent) => {
    if (!drag.current) return;
    setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
  };
  const onUp = () => { drag.current = null; setPanning(false); };
  const fit = () => {
    const vp = viewportRef.current, ct = contentRef.current;
    if (!vp || !ct) return;
    const cw = ct.scrollWidth || 1, ch = ct.scrollHeight || 1;
    const z = Math.min((vp.clientWidth - 48) / cw, (vp.clientHeight - 72) / ch, 1.4);
    setZoom(z > 0.2 ? +z.toFixed(2) : 0.2);
    setPan({ x: 0, y: 0 });
  };

  const addDept = (parent: number | null) => { const n = window.prompt(parent ? 'Название под-отдела:' : 'Название отдела:'); if (n && n.trim()) mCreate.mutate({ name: n.trim(), parent }); };
  const renameDept = (id: number, name: string) => { const n = window.prompt('Новое название:', name); if (n && n.trim() && n.trim() !== name) mUpdate.mutate({ id, name: n.trim() }); };
  const removeDept = (id: number, name: string) => { if (window.confirm(`Удалить отдел «${name}»? Под-отделы поднимутся уровнем выше, сотрудники станут без отдела.`)) mDelete.mutate(id); };

  // drag payload: "emp:<id>" | "unit:<id>"
  const parseDrag = (e: DragEvent): { type: string; id: number } | null => {
    const raw = e.dataTransfer.getData('text/plain'); if (!raw) return null;
    const [t, idStr] = raw.split(':'); const id = Number(idStr);
    return id ? { type: t, id } : null;
  };
  const allowDrop = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; (e.currentTarget as HTMLElement).classList.add('fx-ot-drop'); };
  const leaveDrop = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop');
  const allowUnitDrop = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; (e.currentTarget as HTMLElement).classList.add('fx-ot-drop-unit'); };
  const leaveUnitDrop = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop-unit');

  // сотрудник → на сотрудника: назначить руководителем
  const onDropPerson = (targetEmpId: number, e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop');
    const d = parseDrag(e);
    if (d && d.type === 'emp' && d.id !== targetEmpId) mManager.mutate({ id: d.id, manager: targetEmpId });
  };
  // → на отдел: сотрудника привязать к отделу; отдел вложить в отдел
  const onDropUnit = (unitId: number, e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop-unit');
    const d = parseDrag(e); if (!d) return;
    if (d.type === 'emp') mAssign.mutate({ id: d.id, unit: unitId });
    else if (d.type === 'unit' && d.id !== unitId) mReparent.mutate({ id: d.id, parent: unitId });
  };
  // → на «Организацию»: убрать из отдела / поднять отдел на верхний уровень
  const onDropCompany = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop');
    const d = parseDrag(e); if (!d) return;
    if (d.type === 'emp') mAssign.mutate({ id: d.id, unit: null });
    else if (d.type === 'unit') mReparent.mutate({ id: d.id, parent: null });
  };

  const avatarOf = (node: TreeNode) => {
    if (node.kind === 'company') return { bg: '#0F172A', fg: '#fff', text: initials(node.name) };
    if (node.kind === 'unit') return { bg: node.deptColor || '#64748B', fg: '#fff', text: initials(node.name) };
    const [bg, fg] = colorFor(node.name);
    return { bg, fg, text: initials(node.name) };
  };

  const nodeCard = (node: TreeNode): ReactNode => {
    const av = avatarOf(node);
    if (node.kind === 'company') {
      return (
        <div className="fx-ot-card" onClick={() => setSel(node)} onDragOver={allowDrop} onDragLeave={leaveDrop} onDrop={onDropCompany}>
          <div className="fx-ot-av" style={{ background: av.bg, color: av.fg }}>{av.text}</div>
          <div className="fx-ot-name">{node.name}</div>
          <div className="fx-ot-meta"><span className="fx-ot-pill">{people.length} чел.</span></div>
        </div>
      );
    }
    if (node.kind === 'unit') {
      return (
        <div className="fx-ot-unit" onClick={() => setSel(node)} draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'unit:' + node.unitId); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={allowUnitDrop} onDragLeave={leaveUnitDrop} onDrop={(e) => onDropUnit(node.unitId!, e)}>
          <span className="fx-ot-unit-bar" style={{ background: node.deptColor }} />
          <div className="fx-ot-unit-body">
            <div className="fx-ot-unit-name">{node.name}</div>
            <div className="fx-ot-unit-count">{node.count || 0} чел.</div>
          </div>
          <div className="fx-ot-unit-actions">
            <button type="button" title="Добавить под-отдел" onClick={(e) => { e.stopPropagation(); addDept(node.unitId!); }}><Plus className="w-3.5 h-3.5" /></button>
            <button type="button" title="Переименовать" onClick={(e) => { e.stopPropagation(); renameDept(node.unitId!, node.name); }}><Pencil className="w-3.5 h-3.5" /></button>
            <button type="button" title="Удалить" onClick={(e) => { e.stopPropagation(); removeDept(node.unitId!, node.name); }}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      );
    }
    const reports = node.children.length;
    return (
      <div className="fx-ot-card" onClick={() => setSel(node)} draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'emp:' + node.empId); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={allowDrop} onDragLeave={leaveDrop} onDrop={(e) => onDropPerson(node.empId!, e)}>
        <div className="fx-ot-av" style={{ background: av.bg, color: av.fg }}>{av.text}</div>
        <div className="fx-ot-name">{node.name}</div>
        {node.position && <div className="fx-ot-sub">{node.position}</div>}
        {reports > 0 && <div className="fx-ot-meta"><span className="fx-ot-count">{reports}</span></div>}
      </div>
    );
  };

  const renderNode = (node: TreeNode): ReactNode => {
    const kids = node.children;
    const isColl = collapsed.has(node.id);
    return (
      <li key={node.id}>
        <div className="fx-ot-wrap">
          {nodeCard(node)}
          {kids.length > 0 && (
            <button type="button" className="fx-ot-toggle" title={isColl ? 'Развернуть' : 'Свернуть'} onClick={() => toggle(node.id)}>
              <span>{kids.length}</span>
              <ChevronDown className="w-3 h-3" style={{ transform: isColl ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }} />
            </button>
          )}
        </div>
        {kids.length > 0 && !isColl && <ul>{kids.map(renderNode)}</ul>}
      </li>
    );
  };

  const empty = people.length === 0 && units.length === 0;
  const parentName = sel?.kind === 'unit' && sel.parentUnitId != null ? (unitById.get(sel.parentUnitId)?.name || '—') : null;

  return (
    <>
      <PageHeader breadcrumb={[{ label: 'Сотрудники', href: '/factorial/employees' }, { label: 'Оргсхема' }]} />
      <div className="px-8 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-fx-lg bg-indigo-100 flex items-center justify-center"><Network className="w-5 h-5 text-indigo-600" /></div>
            <div>
              <h1 className="text-fx-xl font-semibold leading-tight">Оргсхема</h1>
              <p className="text-fx-xs text-text-muted">Перетащите сотрудника в отдел; на другого сотрудника — назначить руководителя. Отделы можно вкладывать друг в друга.</p>
            </div>
          </div>
          <button type="button" onClick={() => addDept(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-fx-lg text-fx-sm font-medium bg-primary text-white hover:bg-primary-hover">
            <Plus className="w-4 h-4" />Отдел
          </button>
        </div>
        <SecondaryNav items={NAV} />
        <style>{TREE_CSS}</style>
        <div
          ref={viewportRef}
          className="relative border border-card-border-soft rounded-card overflow-hidden select-none"
          style={{ height: '64vh', background: '#FBFCFE', cursor: panning ? 'grabbing' : 'grab' }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        >
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-fx-sm text-text-muted">Загрузка…</div>
          ) : empty ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fx-sm text-text-muted">
              <span>Пока нет ни отделов, ни сотрудников.</span>
              <button type="button" onClick={() => addDept(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-fx-lg text-fx-sm font-medium bg-primary text-white hover:bg-primary-hover"><Plus className="w-4 h-4" />Создать отдел</button>
            </div>
          ) : (
            <div
              ref={contentRef}
              className="fx-ot"
              style={{
                position: 'absolute', left: '50%', top: 28,
                transformOrigin: 'top center',
                transform: `translate(calc(-50% + ${pan.x}px), ${pan.y}px) scale(${zoom})`,
                transition: panning ? 'none' : 'transform .15s ease',
              }}
            >
              <ul>{renderNode(tree)}</ul>
            </div>
          )}
          <div className="absolute left-3 bottom-3 flex items-center gap-2 z-10">
            <div className="flex items-center bg-white border border-card-border-soft rounded-fx-lg shadow-card overflow-hidden text-fx-sm">
              <button type="button" className="px-2 py-1.5 hover:bg-sidebar-hover" title="Уменьшить" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))}><Minus className="w-4 h-4" /></button>
              <button type="button" className="px-3 py-1.5 hover:bg-sidebar-hover border-x border-card-border-soft" onClick={fit}>Подогнать масштаб</button>
              <button type="button" className="px-2 py-1.5 hover:bg-sidebar-hover" title="Увеличить" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}><Plus className="w-4 h-4" /></button>
            </div>
            <button type="button" className="flex items-center gap-1.5 bg-white border border-card-border-soft rounded-fx-lg shadow-card px-3 py-1.5 text-fx-sm hover:bg-sidebar-hover" onClick={expandAll}>
              <Maximize2 className="w-4 h-4" />Развернуть все
            </button>
          </div>
        </div>
      </div>

      {sel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSel(null)} />
          <div className="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl border-l border-card-border-soft z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-card-border-soft">
              <span className="font-semibold text-fx-sm">{sel.kind === 'emp' ? 'Сотрудник' : sel.kind === 'unit' ? 'Отдел' : 'Организация'}</span>
              <button type="button" onClick={() => setSel(null)} className="p-1 rounded hover:bg-sidebar-hover"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              <div className="flex flex-col items-center gap-2">
                {(() => { const av = avatarOf(sel); return <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-xl font-semibold" style={{ background: av.bg, color: av.fg }}>{av.text}</div>; })()}
                <div className="font-semibold text-fx-base text-center">{sel.name}</div>
              </div>
              <div>
                <h3 className="text-fx-sm font-semibold mb-1">Информация</h3>
                {sel.kind === 'emp' ? <>
                  <DetailRow label="Должность" value={sel.position || '—'} />
                  <DetailRow label="Отдел" value={sel.deptName || '—'} />
                  <DetailRow label="Руководитель" value={sel.managerName || '—'} />
                  <DetailRow label="Подчинённых" value={String(sel.children.length)} />
                  <DetailRow label="Юр.лицо" value={orgName} />
                </> : sel.kind === 'unit' ? <>
                  <DetailRow label="Отдел" value={sel.name} />
                  <DetailRow label="Сотрудников" value={String(sel.count || 0)} />
                  <DetailRow label="Под-отделов" value={String(sel.children.filter((c) => c.kind === 'unit').length)} />
                  <DetailRow label="Входит в" value={parentName || 'Верхний уровень'} />
                </> : <>
                  <DetailRow label="Сотрудников" value={String(people.length)} />
                  <DetailRow label="Отделов" value={String(units.length)} />
                </>}
              </div>
            </div>
            {sel.kind === 'emp' && (
              <div className="p-4 border-t border-card-border-soft">
                <button type="button" onClick={() => navigate('/factorial/profile')} className="w-full px-3 py-2 rounded-fx-lg text-fx-sm font-medium bg-primary text-white hover:bg-primary-hover">Перейти в профиль</button>
              </div>
            )}
            {sel.kind === 'unit' && sel.unitId != null && (
              <div className="p-4 border-t border-card-border-soft flex gap-2">
                <button type="button" onClick={() => addDept(sel.unitId!)} className="flex-1 px-3 py-2 rounded-fx-lg text-fx-sm font-medium border border-card-border-soft hover:bg-sidebar-hover">+ Под-отдел</button>
                <button type="button" onClick={() => { renameDept(sel.unitId!, sel.name); setSel(null); }} className="px-3 py-2 rounded-fx-lg text-fx-sm font-medium border border-card-border-soft hover:bg-sidebar-hover"><Pencil className="w-4 h-4" /></button>
                <button type="button" onClick={() => { removeDept(sel.unitId!, sel.name); setSel(null); }} className="px-3 py-2 rounded-fx-lg text-fx-sm font-medium border border-card-border-soft text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
