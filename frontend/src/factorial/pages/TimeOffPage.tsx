import { useState } from 'react';
import { Palmtree as TreePalm } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import CalendarTemplate, { type CalendarEvent } from '@/factorial/templates/CalendarTemplate';
import RequestLeaveModal from '@/factorial/components/RequestLeaveModal';
import { getMyProfile, listLeaveRequests } from '@/factorial/api/employees';
import { CABINET_TABS } from '@/factorial/lib/routes';

const TYPE_COLOR: Record<string, string> = {
  vacation: '#16A34A',
  sick: '#DC2626',
  family_leave: '#2563EB',
  bereavement: '#6B7280',
};
const TYPE_LABEL: Record<string, string> = {
  vacation: 'Отпуск',
  sick: 'Больничный',
  family_leave: 'Семейные дни',
  bereavement: 'По утрате',
};

export default function TimeOffPage() {
  const [open, setOpen] = useState(false);
  const { data: me } = useQuery({ queryKey: ['fx', 'me'], queryFn: getMyProfile });
  // Свои заявки на отпуск. Эндпоинт может быть admin-only — глушим ошибку в пустой список.
  const { data: reqs = [] } = useQuery({
    queryKey: ['fx', 'leaves', 'mine'],
    queryFn: () => listLeaveRequests().catch(() => []),
  });

  const myReqs = me ? reqs.filter((r) => r.employee_id === me.id) : [];
  const events: CalendarEvent[] = myReqs.map((r) => ({
    id: r.id,
    date: r.start_date,
    title: `${TYPE_LABEL[r.type] || r.type} (${r.days}д)`,
    color: TYPE_COLOR[r.type] || '#16A34A',
  }));

  return (
    <>
      <CalendarTemplate
        breadcrumb={[{ label: 'Отпуска' }]}
        titleIcon={
          <div className="w-9 h-9 rounded-fx-lg bg-emerald-100 flex items-center justify-center">
            <TreePalm className="w-5 h-5 text-emerald-600" />
          </div>
        }
        title="Отпуска"
        secondaryNav={CABINET_TABS}
        events={events}
        primaryCta={{ label: 'Запросить отпуск', onClick: () => setOpen(true) }}
      />
      {open && me && <RequestLeaveModal employeeId={me.id} onClose={() => setOpen(false)} />}
    </>
  );
}
