import toast from 'react-hot-toast';
import { Copy } from 'lucide-react';
import type { FormDispatchInfo } from '@/services/api/forms';

export function AnketaResponses({ dispatches }: { dispatches: FormDispatchInfo[] }) {
  if (dispatches.length === 0) {
    return <div className="p-8 text-center text-gray-400 text-sm">Анкеты ещё не присылались</div>;
  }
  return (
    <div className="p-5 space-y-3">
      {dispatches.map(d => (
        <div key={d.id} className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm text-gray-900">{d.form_title || 'Анкета'}</p>
            <span className="text-xs text-gray-500">{d.status}</span>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/form/d/${d.token}`); toast.success('Ссылка скопирована'); }}
            className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          >
            <Copy className="w-3 h-3" /> Скопировать ссылку
          </button>
          {d.answers && (
            <div className="mt-3 border-t pt-2 space-y-1">
              {Object.entries(d.answers).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="text-gray-400">{k}:</span>
                  <span className="text-gray-800">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
