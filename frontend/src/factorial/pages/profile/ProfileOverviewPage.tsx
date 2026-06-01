import { Copy, ChevronRight, Plus, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/factorial/components/ui/toast';
import ProfileTemplate from '@/factorial/templates/ProfileTemplate';
import { getMyProfile } from '@/factorial/api/employees';
import { formatDateRu } from '@/factorial/lib/formatDate';
import { PROFILE_SUBNAV } from './_subNav';

export default function ProfileOverviewPage() {
  // Реальная карточка текущего сотрудника из бэкенда Энцеладуса.
  const { data: me } = useQuery({ queryKey: ['fx', 'me'], queryFn: getMyProfile });
  const email = me?.user_email || '—';
  const legal = me?.department_name || 'MSTech L.L.C-FZ';
  const startRaw = me?.department_start_date || me?.practice_start_date || me?.created_at || null;
  const startStr = startRaw ? formatDateRu(startRaw) : '—';

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано', description: text });
  };

  return (
    <ProfileTemplate
      breadcrumb={[{ label: 'Профиль' }]}
      titleIcon={<div className="w-9 h-9 rounded-fx-lg bg-pink-100 flex items-center justify-center"><User className="w-5 h-5 text-pink-600" /></div>}
      title="Профиль"
      subNav={PROFILE_SUBNAV}
      leftColumn={(
        <>
          <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Задачи</h2>
              <a href="#" onClick={(e) => e.preventDefault()} className="text-fx-sm text-text-secondary hover:text-text-primary inline-flex items-center gap-1">
                Задачи <ChevronRight className="w-3 h-3" />
              </a>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-fx-4xl font-semibold leading-none">0</div>
                <div className="text-fx-xs text-text-muted mt-2">Просрочено</div>
              </div>
              <div>
                <div className="text-fx-4xl font-semibold leading-none">0</div>
                <div className="text-fx-xs text-text-muted mt-2">Срок</div>
              </div>
              <div>
                <div className="text-fx-4xl font-semibold leading-none">0</div>
                <div className="text-fx-xs text-text-muted mt-2">Без срока</div>
              </div>
            </div>
            <div className="border-t border-card-border-soft pt-3 text-center text-fx-sm text-text-muted py-4">
              Нет назначенных задач
            </div>
          </article>

          <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-fx-3xl">⚡️</div>
              <div>
                <h2 className="font-semibold">Заставьте ваши проекты взлететь</h2>
                <p className="text-fx-sm text-text-muted mt-0.5">Планируйте, отслеживайте и не теряйте из виду важное.</p>
              </div>
            </div>
            <button type="button" className="text-fx-sm font-medium text-text-primary hover:underline">Подробнее</button>
          </article>

          <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Расходы</h2>
              <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-fx-xs font-medium border border-card-border-soft rounded-fx-lg hover:bg-sidebar-hover">
                <Plus className="w-3 h-3" /> Новый расход
              </button>
            </div>
            <table className="w-full text-fx-sm">
              <thead className="text-text-muted">
                <tr><th className="text-left font-medium py-1">Статус</th><th className="text-right font-medium py-1">Расходы</th></tr>
              </thead>
              <tbody>
                {['В ведомости', 'В ожидании', 'Одобрено', 'Оплачено', 'Отправлено к оплате'].map((s) => (
                  <tr key={s} className="border-t border-card-border-soft">
                    <td className="py-2">{s}</td>
                    <td className="py-2 text-right">0,00 €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="bg-card-translucent border border-card-border-soft rounded-card shadow-card p-5 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Компенсации</h2>
              <p className="text-fx-sm text-text-muted mt-0.5">Посмотрите, как менялась зарплата CEO со временем.</p>
            </div>
            <button type="button" className="text-fx-sm font-medium text-text-primary hover:underline">Добавить информацию</button>
          </article>
        </>
      )}
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
        {
          label: 'Юридическое лицо',
          value: (
            <button type="button" onClick={() => copy(legal)} className="flex items-center gap-2 hover:text-primary group">
              <span>{legal}</span>
              <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
            </button>
          ),
        },
        { label: 'Дата начала', value: <span>{startStr}</span> },
        {
          label: 'Рабочие дни',
          value: (
            <div className="flex gap-1 flex-wrap">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт'].map((day) => (
                <button key={day} type="button" className="px-2 py-1 rounded border border-border text-fx-xs hover:bg-sidebar-hover">{day}</button>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}
