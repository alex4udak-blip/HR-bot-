import type { ReactNode } from 'react';
import { Network } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '@/factorial/components/PageHeader';
import SecondaryNav from '@/factorial/components/SecondaryNav';
import {
  getOrgChart,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  assignEmployee,
  type OrgUnitNode,
} from '@/factorial/api/orgUnits';
import OrgUnitCard from '@/factorial/components/orgchart/OrgUnitCard';
import UnassignedPool from '@/factorial/components/orgchart/UnassignedPool';

export default function EmployeesOrgChartPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['fx', 'org-chart'], queryFn: getOrgChart });
  const refresh = () => qc.invalidateQueries({ queryKey: ['fx', 'org-chart'] });

  const mCreate = useMutation({ mutationFn: (v: { name: string; parent_id?: number | null }) => createOrgUnit(v), onSuccess: refresh });
  const mUpdate = useMutation({ mutationFn: (v: { id: number; name: string }) => updateOrgUnit(v.id, { name: v.name }), onSuccess: refresh });
  const mDelete = useMutation({ mutationFn: (id: number) => deleteOrgUnit(id), onSuccess: refresh });
  const mAssign = useMutation({ mutationFn: (v: { id: number; unit: number | null }) => assignEmployee(v.id, v.unit), onSuccess: refresh });
  const mReparent = useMutation({ mutationFn: (v: { id: number; parent: number | null }) => updateOrgUnit(v.id, { parent_id: v.parent }), onSuccess: refresh });

  const units = data?.units ?? [];
  const addRoot = () => { const n = window.prompt('Название отдела:'); if (n) mCreate.mutate({ name: n, parent_id: null }); };
  const addChild = (parentId: number) => { const n = window.prompt('Название под-отдела:'); if (n) mCreate.mutate({ name: n, parent_id: parentId }); };
  const rename = (u: OrgUnitNode) => { const n = window.prompt('Новое название:', u.name); if (n && n !== u.name) mUpdate.mutate({ id: u.id, name: n }); };
  const remove = (u: OrgUnitNode) => {
    if (window.confirm(`Удалить отдел «${u.name}»? Сотрудники станут нераспределёнными, под-отделы поднимутся на уровень вверх.`)) mDelete.mutate(u.id);
  };
  const move = (employeeId: number, unitId: number | null) => mAssign.mutate({ id: employeeId, unit: unitId });
  const reparent = (unitId: number, newParent: number | null) => mReparent.mutate({ id: unitId, parent: newParent });

  const renderTree = (parentId: number | null): ReactNode =>
    units
      .filter((u) => (u.parent_id ?? null) === parentId)
      .map((u) => (
        <OrgUnitCard
          key={u.id}
          unit={u}
          allUnits={units}
          onAddChild={addChild}
          onRename={rename}
          onDelete={remove}
          onMoveEmployee={move}
          onReparentUnit={reparent}
          childrenNodes={renderTree(u.id)}
        />
      ));

  return (
    <>
      <PageHeader breadcrumb={[{ label: 'Сотрудники', href: '/factorial/employees' }, { label: 'Оргсхема' }]} />
      <div className="px-8 py-6 space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-fx-lg bg-indigo-100 flex items-center justify-center">
            <Network className="w-5 h-5 text-indigo-600" />
          </div>
          <h1 className="text-fx-xl font-semibold">Оргсхема</h1>
        </div>
        <SecondaryNav
          items={[
            { label: 'Сотрудники', href: '/factorial/employees', end: true },
            { label: 'Команды', href: '/factorial/employees/teams' },
            { label: 'Оргсхема', href: '/factorial/employees/org-chart' },
            { label: 'Вакансии', href: '/factorial/employees/vacancies' },
          ]}
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div
                className="rounded-card border border-card-border-soft bg-card-translucent shadow-card px-4 py-2 font-semibold"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const uid = e.dataTransfer.getData('application/x-org-unit'); if (uid) reparent(Number(uid), null); }}
                title="Перетащите отдел сюда, чтобы сделать его верхнеуровневым"
              >
                Моя организация
              </div>
              <button onClick={addRoot} className="px-3 py-1.5 rounded-fx-lg text-fx-sm font-medium bg-primary text-white hover:bg-primary-hover">
                + Отдел
              </button>
            </div>
            {isLoading ? (
              <div className="text-fx-sm text-text-muted">Загрузка…</div>
            ) : units.length === 0 ? (
              <div className="text-fx-sm text-text-muted">Отделов пока нет — создайте первый кнопкой «+ Отдел».</div>
            ) : (
              renderTree(null)
            )}
          </div>
          <div>
            <UnassignedPool employees={data?.unassigned ?? []} units={units} onMoveEmployee={move} />
          </div>
        </div>
      </div>
    </>
  );
}
