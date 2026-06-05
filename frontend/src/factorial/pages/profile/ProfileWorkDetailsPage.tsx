import { useState } from 'react';
import { User, Pencil } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import ProfileTemplate from '@/factorial/templates/ProfileTemplate';
import { getMyProfile } from '@/factorial/api/employees';
import { getCurrentOrganization } from '@/services/api/auth';
import { formatDateRu, formatTenure } from '@/factorial/lib/formatDate';
import { CABINET_TABS } from '@/factorial/lib/routes';
import DetailRow from '@/factorial/components/cabinet/DetailRow';
import EmployeeEditModal from '@/factorial/components/EmployeeEditModal';

const TITLE_ICON = (
  <div className="w-9 h-9 rounded-fx-lg bg-pink-100 flex items-center justify-center">
    <User className="w-5 h-5 text-pink-600" />
  </div>
);

export default function ProfileWorkDetailsPage() {
  const { data: me, isError } = useQuery({ queryKey: ['fx', 'me'], queryFn: getMyProfile, retry: false });
  const { data: org } = useQuery({ queryKey: ['fx', 'org-current'], queryFn: getCurrentOrganization, retry: false });
  const [editOpen, setEditOpen] = useState(false);

  const startRaw = me?.department_start_date || me?.practice_start_date || me?.created_at || null;
  const start = startRaw ? `${formatDateRu(startRaw)} (${formatTenure(startRaw)} назад)` : '—';
  const fmt = (d?: string | null) => (d ? formatDateRu(d) : '—');
  const sign = (ok?: boolean, at?: string | null) =>
    ok ? `Подписан${at ? ' · ' + formatDateRu(at) : ''}` : 'Не подписан';

  return (
    <ProfileTemplate
      breadcrumb={[{ label: 'Профиль' }, { label: 'Детали работы' }]}
      titleIcon={TITLE_ICON}
      title="Профиль"
      subNav={CABINET_TABS}
      leftColumn={
        isError ? (
          <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-6 text-fx-sm text-text-muted">
            Профиль сотрудника ещё не заведён.
          </article>
        ) : (
          <>
            <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">Детали работы</h2>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-fx-xs font-medium border border-card-border-soft rounded-fx-lg hover:bg-sidebar-hover"
                >
                  <Pencil className="w-3.5 h-3.5" /> Изменить
                </button>
              </div>
              <DetailRow label="Должность" value={me?.position || '—'} />
              <DetailRow label="Отдел" value={me?.department_name || '—'} />
              <DetailRow label="Юр.лицо" value={org?.name || '—'} />
              <DetailRow label="Дата начала" value={start} />
              <DetailRow label="Начало практики" value={fmt(me?.practice_start_date)} />
              <DetailRow label="Конец испытательного" value={fmt(me?.probation_end_date)} />
              <DetailRow label="Год работы" value={fmt(me?.one_year_date)} />
              <DetailRow label="Договор" value={sign(me?.contract_signed, me?.contract_signed_at)} />
              <DetailRow label="NDA" value={sign(me?.nda_signed, me?.nda_signed_at)} />
            </article>
            {editOpen && <EmployeeEditModal selfMode onClose={() => setEditOpen(false)} />}
          </>
        )
      }
      rightDetails={[
        { label: 'Электронная почта', value: <span>{me?.user_email || '—'}</span> },
        { label: 'Отдел', value: <span>{me?.department_name || '—'}</span> },
      ]}
    />
  );
}
