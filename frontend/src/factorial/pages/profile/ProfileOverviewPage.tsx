import { useState } from 'react';
import { Copy, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/factorial/components/ui/toast';
import ProfileTemplate from '@/factorial/templates/ProfileTemplate';
import { getLeaveBalance } from '@/factorial/api/employees';
import { myDocuments, employeeDocuments } from '@/factorial/api/documents';
import { formatDateRu, formatTenure } from '@/factorial/lib/formatDate';
import { buildProfileTabs } from '@/factorial/lib/routes';
import { useProfileEmployee } from '@/factorial/lib/useProfileEmployee';
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
  const { data: me, isError, byId, employeeId } = useProfileEmployee();
  const base = byId ? `/factorial/employees/${employeeId}` : '/factorial/profile';
  const { data: balance } = useQuery({
    queryKey: ['fx', 'leave-balance', me?.id],
    queryFn: () => getLeaveBalance(me!.id),
    enabled: !!me,
  });
  const { data: docs = [] } = useQuery({
    queryKey: byId ? ['fx', 'emp-signed-docs', employeeId] : ['fx', 'my-docs'],
    queryFn: () => (byId ? employeeDocuments(employeeId!) : myDocuments()),
    enabled: !!me,
  });
  const [requestOpen, setRequestOpen] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано', description: text });
  };

  if (isError) {
    return (
      <ProfileTemplate
        breadcrumb={byId ? [{ label: 'Сотрудники', href: '/factorial/employees' }, { label: me?.user_name || 'Профиль' }] : [{ label: 'Профиль' }]}
        titleIcon={TITLE_ICON}
        title={byId ? (me?.user_name || 'Профиль') : 'Профиль'}
        subNav={buildProfileTabs(base)}
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
      breadcrumb={byId ? [{ label: 'Сотрудники', href: '/factorial/employees' }, { label: me?.user_name || 'Профиль' }] : [{ label: 'Профиль' }]}
      titleIcon={TITLE_ICON}
      title={byId ? (me?.user_name || 'Профиль') : 'Профиль'}
      subNav={buildProfileTabs(base)}
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
