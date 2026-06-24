import type { VacancyActivityBlock as ActivityBlock } from '@/services/api/entities';
import { sanitizeHtml } from '@/utils/sanitizeHtml';

interface Props {
  block: ActivityBlock;
  stageLabel: (stage: string) => string;
}

export default function VacancyActivityBlock({ block, stageLabel }: Props) {
  const events = block.events || [];

  return (
    <div className="rounded-xl border border-[color:var(--hf-white-alpha-08)] p-4 mb-3">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--hf-accent-bg-15)] text-[var(--hf-accent)]">
          {stageLabel(block.current_stage)}
        </span>
        <span className="text-sm font-medium text-[var(--hf-dark-100)]">
          {block.vacancy_title}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="text-sm text-[var(--hf-dark-600)]">Нет записей</div>
      ) : (
        <div className="relative pl-6 border-l border-[color:var(--hf-white-alpha-08)]">
          {events.map((e, i) => (
            <div key={e.id ?? i} className="relative pb-5 last:pb-0">
              <div className="absolute -left-[25px] w-3 h-3 rounded-full border-2 border-[color:var(--hf-dark-800)] bg-[var(--hf-accent)]" />
              <div className="text-xs text-[var(--hf-dark-600)] mb-1">
                {e.created_at &&
                  new Date(e.created_at).toLocaleString('ru', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
              </div>
              <div className="text-sm text-[var(--hf-dark-300)] mb-1">
                <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--hf-white-alpha-06)]">
                  {stageLabel(e.to_stage)}
                </span>
              </div>
              {e.comment && (
                <div
                  className="text-sm text-[var(--hf-dark-400)] mt-1 whitespace-pre-wrap hf-rich-content"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(e.comment) }}
                />
              )}
              {e.changed_by_name && (
                <div className="text-xs text-[var(--hf-dark-600)] mt-1">{e.changed_by_name}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
