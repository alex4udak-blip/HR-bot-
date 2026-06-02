import { useState } from 'react';
import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import TableTemplate from '@/factorial/templates/TableTemplate';
import UserAvatar from '@/factorial/components/UserAvatar';
import StatusPill from '@/factorial/components/StatusPill';
import { useQuery } from '@tanstack/react-query';
import { listEmployees } from '@/factorial/api/employees';
import { getOrgChart } from '@/factorial/api/orgUnits';
import { formatHiredAgo } from '@/factorial/lib/formatDate';
import InviteEmployeeModal from '@/factorial/components/InviteEmployeeModal';
import type { Employee } from '@/factorial/mocks/employees';

export default function EmployeesPage() {
  const navigate = useNavigate();
  const [invite, setInvite] = useState(false);
  // Реальные данные из бэкенда Энцеладуса (active_only). Маппим в строки таблицы
  // ровно той же формы, что ждут колонки клона — визуал не меняется.
  const { data: rows = [] } = useQuery({
    queryKey: ['fx', 'employees', 'table'],
    queryFn: () => listEmployees(true),
  });
  // Отдел (HR org_unit) + Руководитель — из данных оргсхемы.
  const { data: chart } = useQuery({ queryKey: ['fx', 'org-chart'], queryFn: getOrgChart });
  const people = chart?.people ?? [];
  const units = chart?.units ?? [];
  const metaOf = (empId: number) => {
    const p = people.find((x) => x.id === empId);
    if (!p) return { dept: '—', manager: '—' };
    const dept = p.org_unit_id ? (units.find((u) => u.id === p.org_unit_id)?.name || '—') : '—';
    const manager = p.manager_id ? (people.find((x) => x.id === p.manager_id)?.user_name || '—') : '—';
    return { dept, manager };
  };
  const employees: Employee[] = rows.map((e) => ({
    id: e.id,
    fullName: e.user_name || '—',
    position: e.position || '',
    location: e.department_name || 'MSTech L.L.C-FZ',
    hiredAt: e.department_start_date || e.practice_start_date || e.created_at || '',
    accessStatus: e.is_active ? 'active' : 'inactive',
    contractStatus: e.contract_signed ? 'completed' : 'in_progress',
  }));

  const columns: ColumnDef<Employee, any>[] = [
    {
      id: 'select',
      header: '',
      cell: () => (
        <input
          type="checkbox"
          className="rounded border-border"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 32,
    },
    {
      accessorKey: 'fullName',
      header: 'Сотрудник',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar fullName={row.original.fullName} size="sm" singleLetter />
          <span className="font-medium">{row.original.fullName}</span>
        </div>
      ),
    },
    { accessorKey: 'position', header: 'Должность', cell: ({ getValue }) => (getValue() as string) || '' },
    { id: 'dept', header: 'Отдел', accessorFn: (r) => metaOf(r.id).dept },
    { id: 'manager', header: 'Руководитель', accessorFn: (r) => metaOf(r.id).manager },
    { accessorKey: 'location', header: 'Место работы' },
    { accessorKey: 'hiredAt', header: 'Нанят', cell: ({ getValue }) => { const v = getValue() as string; return v ? formatHiredAgo(v) : '—'; } },
    {
      accessorKey: 'accessStatus',
      header: 'Доступ',
      cell: ({ getValue }) => <StatusPill label={getValue() === 'active' ? 'Активен' : 'Неактивен'} />,
    },
    {
      accessorKey: 'contractStatus',
      header: 'Статус контракта',
      cell: () => <StatusPill label="В процессе" variant="success" dot />,
    },
  ];

  return (
    <>
    <TableTemplate
      breadcrumb={[{ label: 'Сотрудники' }]}
      titleIcon={
        <div className="w-9 h-9 rounded-fx-lg bg-pink-100 flex items-center justify-center">
          <Users className="w-5 h-5 text-pink-600" />
        </div>
      }
      title="Сотрудники"
      secondaryNav={[
        { label: 'Сотрудники', href: '/factorial/employees', end: true },
        { label: 'Команды', href: '/factorial/employees/teams' },
        { label: 'Оргсхема', href: '/factorial/employees/org-chart' },
        { label: 'Вакансии', href: '/factorial/employees/vacancies' },
      ]}
      beforeToolbar={
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <MiniCard label="0 ожидает принятия" />
          <MiniCard label="0 не приглашен" />
        </div>
      }
      toolbar={{
        searchKey: 'fullName',
        searchPlaceholder: 'Поиск сотрудника...',
        filterAction: () => alert('Demo mode — фильтры'),
        exportAction: () => navigate('/factorial/employees/export'),
        primaryCta: { label: 'Добавить сотрудника', onClick: () => setInvite(true) },
      }}
      columns={columns}
      data={employees}
      pageSize={20}
    />
    {invite && <InviteEmployeeModal onClose={() => setInvite(false)} />}
    </>
  );
}

function MiniCard({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-fx-lg border border-border px-4 py-3 flex items-center justify-between">
      <span className="text-fx-sm">{label}</span>
      <button type="button" className="p-1 rounded hover:bg-sidebar-hover text-text-muted">⚙</button>
    </div>
  );
}
