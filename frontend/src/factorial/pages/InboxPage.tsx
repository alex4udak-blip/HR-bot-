import { useLocation } from 'react-router-dom';
import { Inbox, SlidersHorizontal } from 'lucide-react';
import PageHeader from '@/factorial/components/PageHeader';
import SecondaryNav from '@/factorial/components/SecondaryNav';
import EmptyState from '@/factorial/components/EmptyState';
import InboxFilterPanel from '@/factorial/components/InboxFilterPanel';

export default function InboxPage() {
  const loc = useLocation();
  const tab = loc.pathname.endsWith('/completed') ? 'completed' : 'todo';

  return (
    <>
      <PageHeader breadcrumb={[{ label: 'Входящие' }]} />
      <div className="px-8 py-6 space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-fx-lg bg-red-100 flex items-center justify-center">
            <Inbox className="w-5 h-5 text-red-600" />
          </div>
          <h1 className="text-fx-xl font-semibold">Входящие</h1>
        </div>

        <SecondaryNav
          items={[
            { label: 'Задачи', href: '/inbox/todo' },
            { label: 'Завершено', href: '/inbox/completed' },
          ]}
        />

        <div className="space-y-3">
          <h2 className="text-fx-base font-semibold">
            {tab === 'todo' ? '0 незавершённые задачи' : '0 завершённые задачи'}
          </h2>
          <div className="flex items-center justify-between">
            <InboxFilterPanel />
            <button
              type="button"
              onClick={() => alert('Demo mode — настройки')}
              className="w-9 h-9 rounded-fx-lg border border-card-border-soft bg-white flex items-center justify-center hover:bg-sidebar-hover"
              title="Настройки"
              aria-label="Настройки"
            >
              <SlidersHorizontal className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        <EmptyState
          emoji="☕️"
          heading="Отличная работа!"
          description={
            tab === 'todo'
              ? 'Вы достигли нуля входящих сообщений.'
              : 'Здесь будут завершённые сообщения.'
          }
        />
      </div>
    </>
  );
}
