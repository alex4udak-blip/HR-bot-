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
  kind: 'company' | 'emp';
  id: string;
  empId?: number;
  name: string;
  position?: string;
  unitId?: number | null;
  deptName?: string;
  deptColor?: string;
  managerName?: string;
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
.fx-ot-dot { width:7px; height:7px; border-radius:999px; display:inline-block; margin-right:5px; flex:none; }
.fx-ot-toggle { position:absolute; left:50%; bottom:-16px; transform:translateX(-50%); z-index:3; display:inline-flex; align-items:center; gap:3px; background:#fff; border:1px solid #CBD5E1; border-radius:999px; padding:1px 7px; font-size:11px; color:#475569; cursor:pointer; box-shadow:0 1px 2px rgba(15,23,42,.08); }
.fx-ot-toggle:hover { background:#F8FAFC; color:#0F172A; }
.fx-ot-drop .fx-ot-av { outline:2px solid #6366F1; outline-offset:2px; }
`;

export default function EmployeesOrgChartPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['fx', 'org-chart'], queryFn: getOrgChart });
  const { data: org } = useQuery({ queryKey: ['fx', 'org-current'], queryFn: getCurrentOrganization, retry: false });
  const orgName = org?.name || '—';
  const refresh = () => qc.invalidateQueries({ queryKey: ['fx', 'org-chart'] });

  const mCreate = useMutation({ mutationFn: (v: { name: string }) => createOrgUnit({ name: v.name }), onSuccess: refresh });
  const mUpdate = useMutation({ mutationFn: (v: { id: number; name: string }) => updateOrgUnit(v.id, { name: v.name }), onSuccess: refresh });
  const mDelete = useMutation({ mutationFn: (id: number) => deleteOrgUnit(id), onSuccess: refresh });
  const mAssign = useMutation({ mutationFn: (v: { id: number; unit: number | null }) => assignEmployee(v.id, v.unit), onSuccess: refresh });
  const mManager = useMutation({ mutationFn: (v: { id: number; manager: number | null }) => setManager(v.id, v.manager), onSuccess: refresh, onError: () => {} });

  const units: OrgUnitNode[] = data?.units ?? [];
  const people: PersonNode[] = data?.people ?? [];

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const deptCount = (uid: number | null) => people.filter((p) => (p.org_unit_id ?? null) === uid).length;

  const tree = useMemo<TreeNode>(() => {
    const byMgr = new Map<number | null, PersonNode[]>();
    people.forEach((p) => { const m = p.manager_id ?? null; if (!byMgr.has(m)) byMgr.set(m, []); byMgr.get(m)!.push(p); });
    const nameById = new Map(people.map((p) => [p.id, p.user_name || '—']));
    const seen = new Set<number>();
    const buildPerson = (p: PersonNode): TreeNode => {
      seen.add(p.id);
      const u = p.org_unit_id ? unitById.get(p.org_unit_id) : null;
      return {
        kind: 'emp', id: 'e' + p.id, empId: p.id, name: p.user_name || '—', position: p.position || '',
        unitId: p.org_unit_id ?? null, deptName: u?.name || 'Без отдела', deptColor: u?.color || '#94A3B8',
        managerName: p.manager_id ? (nameById.get(p.manager_id) || '—') : '—',
        children: (byMgr.get(p.id) || []).filter((c) => !seen.has(c.id)).map(buildPerson),
      };
    };
    return { kind: 'company', id: 'root', name: 'Моя организация', children: (byMgr.get(null) || []).map(buildPerson) };
  }, [people, unitById]);

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
    if ((e.target as HTMLElement).closest('.fx-ot-card, .fx-ot-toggle, button')) return;
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

  const addDept = () => { const n = window.prompt('Название отдела:'); if (n) mCreate.mutate({ name: n }); };
  const renameDept = (id: number, name: string) => { const n = window.prompt('Новое название отдела:', name); if (n && n !== name) mUpdate.mutate({ id, name: n }); };
  const removeDept = (id: number, name: string) => { if (window.confirm(`Удалить отдел «${name}»? Его сотрудники станут без отдела.`)) mDelete.mutate(id); };

  // drag: перетаскиваем КАРТОЧКУ ЧЕЛОВЕКА (text/plain = employee id)
  const allowDrop = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; (e.currentTarget as HTMLElement).classList.add('fx-ot-drop'); };
  const leaveDrop = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop');
  const onDropPerson = (managerEmpId: number | null, e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).classList.remove('fx-ot-drop');
    const dragged = e.dataTransfer.getData('text/plain');
    if (dragged && Number(dragged) !== managerEmpId) mManager.mutate({ id: Number(dragged), manager: managerEmpId });
  };
  const chipOver = (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('ring-2', 'ring-indigo-500'); };
  const chipLeave = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('ring-2', 'ring-indigo-500');
  const onDropDept = (unitId: number | null, e: DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('ring-2', 'ring-indigo-500');
    const dragged = e.dataTransfer.getData('text/plain');
    if (dragged) mAssign.mutate({ id: Number(dragged), unit: unitId });
  };

  const avatarOf = (node: TreeNode) => {
    if (node.kind === 'company') return { bg: '#0F172A', fg: '#fff', text: 'МО' };
    const [bg, fg] = colorFor(node.name);
    return { bg, fg, text: initials(node.name) };
  };

  const nodeCard = (node: TreeNode): ReactNode => {
    const av = avatarOf(node);
    if (node.kind === 'company') {
      return (
        <div className="fx-ot-card" onClick={() => setSel(node)} onDragOver={allowDrop} onDragLeave={leaveDrop} onDrop={(e) => onDropPerson(null, e)}>
          <div className="fx-ot-av" style={{ background: av.bg, color: av.fg }}>{av.text}</div>
          <div className="fx-ot-name">{node.name}</div>
          <div className="fx-ot-meta"><span className="fx-ot-pill">{people.length} чел.</span></div>
        </div>
      );
    }
    const reports = node.children.length;
    return (
      <div className="fx-ot-card" onClick={() => setSel(node)} draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(node.empId)); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={allowDrop} onDragLeave={leaveDrop} onDrop={(e) => onDropPerson(node.empId!, e)}>
        <div className="fx-ot-av" style={{ background: av.bg, color: av.fg }}>{av.text}</div>
        <div className="fx-ot-name">{node.name}</div>
        {node.position && <div className="fx-ot-sub">{node.position}</div>}
        <div className="fx-ot-meta">
          {reports > 0 && <span className="fx-ot-count">{reports}</span>}
          <span className="fx-ot-pill"><i className="fx-ot-dot" style={{ background: node.deptColor }} />{node.deptName}</span>
        </div>
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

  return (
    <>
      <PageHeader breadcrumb={[{ label: 'Сотрудники', href: '/factorial/employees' }, { label: 'Оргсхема' }]} />
      <div className="px-8 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-fx-lg bg-indigo-100 flex items-center justify-center"><Network className="w-5 h-5 text-indigo-600" /></div>
            <div>
              <h1 className="text-fx-xl font-semibold leading-tight">Оргсхема</h1>
              <p className="text-fx-xs text-text-muted">Перетащите сотрудника под руководителя; на отдел внизу — чтобы сменить отдел.</p>
            </div>
          </div>
        </div>
        <SecondaryNav items={NAV} />
        <style>{TREE_CSS}</style>
        <div
          ref={viewportRef}
          className="relative border border-card-border-soft rounded-card overflow-hidden select-none"
          style={{ height: '60vh', background: '#FBFCFE', cursor: panning ? 'grabbing' : 'grab' }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        >
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-fx-sm text-text-muted">Загрузка…</div>
          ) : people.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-fx-sm text-text-muted">Сотрудников пока нет — добавьте их через приглашения.</div>
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

        {/* Полоса отделов — перетащи сюда сотрудника, чтобы сменить отдел */}
        <div className="rounded-card border border-card-border-soft bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-fx-sm">Отделы</span>
            <button type="button" onClick={addDept} className="px-3 py-1.5 rounded-fx-lg text-fx-sm font-medium bg-primary text-white hover:bg-primary-hover">+ Отдел</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {units.map((u) => (
              <div key={u.id} className="group flex items-center gap-2 border border-card-border-soft rounded-fx-lg px-3 py-1.5 bg-white"
                onDragOver={chipOver} onDragLeave={chipLeave} onDrop={(e) => onDropDept(u.id, e)}>
                <i className="w-2.5 h-2.5 rounded-full" style={{ background: u.color || '#94A3B8' }} />
                <span className="text-fx-sm font-medium">{u.name}</span>
                <span className="text-fx-xs text-text-muted">{deptCount(u.id)}</span>
                <button type="button" title="Переименовать" onClick={() => renameDept(u.id, u.name)} className="hidden group-hover:block p-0.5 rounded hover:bg-sidebar-hover"><Pencil className="w-3 h-3" /></button>
                <button type="button" title="Удалить" onClick={() => removeDept(u.id, u.name)} className="hidden group-hover:block p-0.5 rounded hover:bg-sidebar-hover text-rose-600"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
            <div className="flex items-center gap-2 border border-dashed border-card-border-soft rounded-fx-lg px-3 py-1.5 text-text-muted"
              onDragOver={chipOver} onDragLeave={chipLeave} onDrop={(e) => onDropDept(null, e)}>
              <span className="text-fx-sm">Без отдела</span>
              <span className="text-fx-xs">{deptCount(null)}</span>
            </div>
          </div>
        </div>
      </div>

      {sel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSel(null)} />
          <div className="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl border-l border-card-border-soft z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-card-border-soft">
              <span className="font-semibold text-fx-sm">{sel.kind === 'emp' ? 'Сотрудник' : 'Организация'}</span>
              <button type="button" onClick={() => setSel(null)} className="p-1 rounded hover:bg-sidebar-hover"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              <div className="flex flex-col items-center gap-2">
                {(() => { const av = avatarOf(sel); return <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-xl font-semibold" style={{ background: av.bg, color: av.fg }}>{av.text}</div>; })()}
                <div className="font-semibold text-fx-base text-center">{sel.name}</div>
              </div>
              <div>
                <h3 className="text-fx-sm font-semibold mb-1">Информация о работе</h3>
                {sel.kind === 'emp' ? <>
                  <DetailRow label="Должность" value={sel.position || '—'} />
                  <DetailRow label="Отдел" value={sel.deptName || '—'} />
                  <DetailRow label="Руководитель" value={sel.managerName || '—'} />
                  <DetailRow label="Подчинённых" value={String(sel.children.length)} />
                  <DetailRow label="Юр.лицо" value={orgName} />
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
          </div>
        </>
      )}
    </>
  );
}
