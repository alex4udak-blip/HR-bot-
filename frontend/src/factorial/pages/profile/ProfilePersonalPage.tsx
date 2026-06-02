import { User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import ProfileTemplate from '@/factorial/templates/ProfileTemplate';
import { getMyProfile } from '@/factorial/api/employees';
import { formatDateRu } from '@/factorial/lib/formatDate';
import { CABINET_TABS } from '@/factorial/lib/routes';
import DetailRow from '@/factorial/components/cabinet/DetailRow';
import PassportCard from '@/factorial/components/PassportCard';

const TITLE_ICON = (
  <div className="w-9 h-9 rounded-fx-lg bg-pink-100 flex items-center justify-center">
    <User className="w-5 h-5 text-pink-600" />
  </div>
);

export default function ProfilePersonalPage() {
  const { data: me, isError } = useQuery({ queryKey: ['fx', 'me'], queryFn: getMyProfile, retry: false });

  const e = (me?.extra_data || {}) as Record<string, unknown>;
  const str = (v: unknown) => (v ? String(v) : '—');
  const dat = (v: unknown) => (v ? formatDateRu(v as string) : '—');
  const fio =
    (e.full_name as string) ||
    [e.last_name, e.first_name, e.middle_name].filter(Boolean).join(' ') ||
    '—';
  const passportMeta = e.passport as { filename?: string; uploaded_at?: string } | undefined;

  return (
    <ProfileTemplate
      breadcrumb={[{ label: 'Профиль' }, { label: 'Личные данные' }]}
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
              <h2 className="font-semibold mb-2">Личные данные</h2>
              <DetailRow label="ФИО" value={fio} />
              <DetailRow label="Дата рождения" value={dat(e.birth_date)} />
              <DetailRow label="№ паспорта" value={str(e.passport_number)} />
              <DetailRow label="Кем выдан" value={str(e.passport_issued_by)} />
              <DetailRow label="Дата выдачи" value={dat(e.passport_issued)} />
              <DetailRow label="Адрес" value={str(e.address)} />
              <DetailRow label="ИНН" value={str(e.inn)} />
              <DetailRow label="СНИЛС" value={str(e.snils)} />
              <DetailRow label="Телефон" value={str(me?.phone)} />
              <DetailRow label="Telegram" value={str(me?.telegram_username)} />
              <p className="text-fx-xs text-text-muted mt-3">Данные заполняет HR. Ниже можно загрузить скан паспорта.</p>
            </article>
            <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-5">
              <h2 className="font-semibold mb-2">Контакт для экстренной связи</h2>
              <DetailRow label="Имя" value={str(e.emergency_contact_name)} />
              <DetailRow label="Телефон" value={str(e.emergency_contact_phone)} />
              <p className="text-fx-xs text-text-muted mt-3">Заполняет HR.</p>
            </article>
            <PassportCard passport={passportMeta} />
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
