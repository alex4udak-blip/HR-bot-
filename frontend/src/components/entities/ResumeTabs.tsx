import { useMemo, useState } from 'react';
import { FileText, Download, ExternalLink } from 'lucide-react';
import type { EntityFile } from '@/services/api/entities';

interface ResumeDemo { title?: string; saved_at?: string; text?: string; }

interface Props {
  entityFiles: EntityFile[];
  extraData: Record<string, unknown> | null;
  resumeText?: string | null;
}

interface ResumeTab {
  key: string;
  date: string | null;
  label: string;
  file?: EntityFile;
  text?: string | null;
}

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('ru', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '';

export default function ResumeTabs({ entityFiles, extraData, resumeText }: Props) {
  const tabs = useMemo<ResumeTab[]>(() => {
    const fileTabs: ResumeTab[] = entityFiles
      .filter((f) => f.file_type === 'resume' && f.mime_type !== 'image/jpeg')
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map((f, idx) => ({
        key: `file-${f.id}`, date: f.created_at, label: 'Резюме', file: f,
        // Распарсенный текст из extra_data относится к САМОМУ свежему резюме —
        // показываем его только на первой (новейшей) вкладке, чтобы не дублировать
        // один и тот же текст под старыми датами.
        text: idx === 0 ? (resumeText ?? null) : null,
      }));
    const demos = (extraData?.resume_demos as ResumeDemo[] | undefined) || [];
    const demoTabs: ResumeTab[] = demos.map((d, i) => ({
      key: `demo-${i}`, date: d.saved_at || null, label: 'Резюме',
      text: d.text || null,
    }));
    return [...fileTabs, ...demoTabs];
  }, [entityFiles, extraData, resumeText]);

  const [active, setActive] = useState(0);
  if (tabs.length === 0) {
    return <div className="text-sm text-[var(--hf-dark-500)] px-5 py-4">Нет загруженных резюме</div>;
  }
  const cur = tabs[Math.min(active, tabs.length - 1)];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-1 border-b border-[color:var(--hf-white-alpha-06)] px-5">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setActive(i)}
            className={`px-3 py-2.5 text-sm border-b-2 transition-colors flex items-center gap-1.5 ${
              i === active
                ? 'border-[var(--hf-accent)] text-[var(--hf-dark-100)]'
                : 'border-transparent text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-200)]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            {t.label}
            {t.date && <span className="text-[10px] text-[var(--hf-dark-500)]">{fmt(t.date).split(',')[0]}</span>}
          </button>
        ))}
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <span className="text-xs text-[var(--hf-dark-500)]">
            {cur.date ? `Сохранено ${fmt(cur.date)}` : 'Резюме'}
          </span>
          {cur.file && (
            <div className="flex gap-2">
              <a
                href={`/api/entities/${cur.file.entity_id}/files/${cur.file.id}/download?download=1`}
                download={cur.file.file_name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-08)] text-xs text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)]"
              >
                <Download className="w-3.5 h-3.5" /> Скачать
              </a>
              <a
                href={`/api/entities/${cur.file.entity_id}/files/${cur.file.id}/download`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--hf-white-alpha-08)] text-xs text-[var(--hf-dark-300)] hover:bg-[var(--hf-white-alpha-04)]"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Открыть
              </a>
            </div>
          )}
        </div>
        {cur.file && (
          <div className="inline-flex items-center gap-1.5 text-xs text-[var(--hf-dark-400)] mb-3">
            <FileText className="w-3 h-3" /> {cur.file.file_name}
          </div>
        )}
        {cur.text ? (
          <pre className="whitespace-pre-wrap font-mono text-sm text-[var(--hf-dark-200)] leading-relaxed">
            {cur.text}
          </pre>
        ) : (
          <div className="text-sm text-[var(--hf-dark-500)]">Текстовая версия недоступна</div>
        )}
      </div>
    </div>
  );
}
