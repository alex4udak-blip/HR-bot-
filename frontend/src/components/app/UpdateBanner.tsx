import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useNewBuild } from '@/hooks/useNewBuild';
import { isSnoozed, snooze, UPDATE_SNOOZE_MS } from '@/utils/appVersion';

/**
 * Плашка «Вышло обновление» (Эльвира и владелец, 19.10.2026): исправления
 * доходят до открытой вкладки только после перезагрузки, а о деплое никто не
 * знает. Показывается один раз на сборку, «Позже» прячет на два часа.
 * Обновление безопасно: черновики комментариев и ответы анкет хранятся в
 * браузере и переживают перезагрузку.
 */
export default function UpdateBanner() {
  const build = useNewBuild();
  const [hidden, setHidden] = useState(false);

  // Отложенную плашку возвращаем, когда истекут два часа (вкладка открыта днями).
  useEffect(() => {
    if (!build) return;
    setHidden(isSnoozed(build));
    const t = window.setInterval(() => setHidden(isSnoozed(build)), 60 * 1000);
    return () => window.clearInterval(t);
  }, [build]);

  if (!build || hidden) return null;

  return (
    <div
      className="px-4 py-2 flex items-center gap-3 border-b text-[13px]"
      style={{ background: '#e0edff', color: '#1e3a8a', borderColor: '#bfd4fb' }}
      role="status"
      aria-live="polite"
    >
      <RefreshCw className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">Вышло обновление Enceladus.</span>
        <span className="ml-1.5">
          Обновите страницу, чтобы исправления заработали — набранные комментарии не пропадут.
        </span>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex-shrink-0"
        style={{ background: '#2563eb' }}
      >
        Обновить
      </button>
      <button
        type="button"
        onClick={() => {
          snooze(build);
          setHidden(true);
        }}
        className="p-1 flex-shrink-0 opacity-60 hover:opacity-100"
        title={`Напомнить через ${UPDATE_SNOOZE_MS / 3600000} ч`}
        aria-label="Напомнить позже"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
