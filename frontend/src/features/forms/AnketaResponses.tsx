import toast from 'react-hot-toast';
import { Copy, ExternalLink } from 'lucide-react';
import type { FormDispatchInfo } from '@/services/api/forms';

// Бэкенд отдаёт наивный UTC ("2026-06-24T22:18:32" без зоны) — трактуем как UTC,
// чтобы toLocaleString показал корректное локальное время.
function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const norm = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const d = new Date(norm);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function AnketaResponses({ dispatches }: { dispatches: (FormDispatchInfo & { source_entity_id?: number; source_name?: string | null })[] }) {
  if (dispatches.length === 0) {
    return <div className="p-8 text-center text-gray-400 text-sm">Анкеты ещё не присылались</div>;
  }
  return (
    <div className="p-5 space-y-3">
      {dispatches.map(d => (
        <div key={d.id} className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm text-gray-900">{d.form_title || 'Анкета'}</p>
              {d.source_name && <p className="text-xs text-gray-500 mt-0.5">{d.source_name}</p>}
            </div>
            <div className="text-right shrink-0">
              <span className="text-xs text-gray-500">
                {d.status === 'submitted' ? 'Заполнена' : d.status === 'opened' ? 'Открыта' : 'Отправлена'}
              </span>
              {/* Когда проходил анкету: дата заполнения (или отправки, если ещё не заполнена) */}
              {(d.submitted_at || d.created_at) && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {d.submitted_at ? formatWhen(d.submitted_at) : formatWhen(d.created_at)}
                </p>
              )}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <a
              href={`${window.location.origin}/form/d/${d.token}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
            >
              <ExternalLink className="w-3 h-3" /> Открыть анкету
            </a>
            <button
              onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/form/d/${d.token}`); toast.success('Ссылка скопирована'); }}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
            >
              <Copy className="w-3 h-3" /> Скопировать ссылку
            </button>
          </div>
          {d.answers && (
            <div className="mt-3 border-t pt-2 space-y-1">
              {Object.entries(d.answers).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="text-gray-400">{d.field_labels?.[k] || k}:</span>
                  {/^https?:\/\//i.test(String(v)) ? (
                    <a href={String(v)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{String(v)}</a>
                  ) : (
                    <span className="text-gray-800 break-all">{String(v)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
