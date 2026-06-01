import { useState } from 'react';
import { Copy, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/factorial/components/ui/toast';
import ProfileTemplate from '@/factorial/templates/ProfileTemplate';
import { getMyProfile, getLeaveBalance } from '@/factorial/api/employees';
import { myDocuments } from '@/factorial/api/documents';
import { formatDateRu, formatTenure } from '@/factorial/lib/formatDate';
import { CABINET_TABS } from '@/factorial/lib/routes';
import LeaveBalanceCard from '@/factorial/components/cabinet/LeaveBalanceCard';
import MyDocsMini from '@/factorial/components/cabinet/MyDocsMini';
import EmployeeStatusCard from '@/factorial/components/cabinet/EmployeeStatusCard';
import RequestLeaveModal from '@/factorial/components/RequestLeaveModal';

const TITLE_ICON = (
  <div className="w-9 h-9 rounded-fx-lg bg-pink-100 flex items-center justify-center">
    <User className="w-5 h-5 text-pink-600" />
  </div>
);

export default function ProfileOverviewPage() {
  const { data: me, isError } = useQuery({ queryKey: ['fx', 'me'], queryFn: getMyProfile, retry: false });
  const { data: balance } = useQuery({
    queryKey: ['fx', 'leave-balance', me?.id],
    queryFn: () => getLeaveBalance(me!.id),
    enabled: !!me,
  });
  const { data: docs = [] } = useQuery({ queryKey: ['fx', 'my-docs'], queryFn: myDocuments, enabled: !!me });
  const [requestOpen, setRequestOpen] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано', description: text });
  };

  if (isError) {
    return (
      <ProfileTemplate
        breadcrumb={[{ label: 'Профиль' }]}
        titleIcon={TITLE_ICON}
        title="Профиль"
        subNav={CABINET_TABS}
        leftColumn={
          <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-6 text-fx-sm text-text-muted">
            Профиль сотрудника ещё не заведён. Обратитесь к HR, чтобы вас добавили в систему.
          </article>
        }
        rightDetails={[]}
      />
    );
  }

  const email = me?.user_email || '—';
  const startRaw = me?.department_start_date || me?.practice_start_date || me?.created_at || null;
  const startStr = startRaw ? `${formatDateRu(startRaw)} (${formatTenure(startRaw)} назад)` : '—';

  return (
    <ProfileTemplate
      breadcrumb={[{ label: 'Профиль' }]}
      titleIcon={TITLE_ICON}
      title="Профиль"
      subNav={CABINET_TABS}
      leftColumn={
        <>
          <LeaveBalanceCard balance={balance} onRequest={() => setRequestOpen(true)} />
          <MyDocsMini docs={docs} />
          <EmployeeStatusCard
            probationEndDate={me?.probation_end_date || null}
            oneYearDate={me?.one_year_date || null}
          />
          {requestOpen && me && <RequestLeaveModal employeeId={me.id} onClose={() => setRequestOpen(false)} />}
        </>
      }
      rightDetails={[
        {
          label: 'Электронная почта',
          value: (
            <button type="button" onClick={() => copy(email)} className="flex items-center gap-2 hover:text-primary group">
              <span>{email}</span>
              <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
            </button>
          ),
        },
        { label: 'Отдел', value: <span>{me?.department_name || '—'}</span> },
        { label: 'Дата начала', value: <span>{startStr}</span> },
        {
          label: 'Рабочие дни',
          value: (
            <div className="flex gap-1 flex-wrap">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт'].map((day) => (
                <span key={day} className="px-2 py-1 rounded border border-border text-fx-xs">{day}</span>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}
