import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Phone, Mail, Send, MapPin, Star, FileText, MessageSquare } from 'lucide-react';
import {
  getPublicCandidatePreview,
  type PublicCandidatePreview,
} from '@/services/api/entities';

/**
 * Публичный предпросмотр кандидата для заказчика (модуль 3).
 * Открывается по токен-ссылке БЕЗ авторизации, вне Layout — никакого
 * CRM-интерфейса: только ФИО/контакты, резюме и комментарии HR.
 */
export default function CandidatePreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicCandidatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getPublicCandidatePreview(token)
      .then(setData)
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setError(status === 410
          ? 'Срок действия ссылки истёк. Запросите новую у рекрутёра.'
          : 'Ссылка недействительна.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium">{error || 'Ссылка недействительна.'}</p>
        </div>
      </div>
    );
  }

  const subtitle = [data.position, data.company].filter(Boolean).join(' · ');

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Шапка: ФИО + контакты */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h1 className="text-2xl font-bold text-slate-900">{data.name}</h1>
          {subtitle && <p className="text-slate-500 mt-0.5">{subtitle}</p>}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-slate-700">
            {data.phone && (
              <a href={`tel:${data.phone}`} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                <Phone className="w-4 h-4 text-slate-400" /> {data.phone}
              </a>
            )}
            {data.email && (
              <a href={`mailto:${data.email}`} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                <Mail className="w-4 h-4 text-slate-400" /> {data.email}
              </a>
            )}
            {data.telegram && (
              <a
                href={`https://t.me/${String(data.telegram).replace(/^@/, '')}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-slate-900"
              >
                <Send className="w-4 h-4 text-slate-400" /> @{String(data.telegram).replace(/^@/, '')}
              </a>
            )}
            {data.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" /> {data.city}
              </span>
            )}
            {data.salary && <span>💰 {data.salary}</span>}
          </div>
          {typeof data.rating === 'number' && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-sm text-amber-700">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              Оценка HR: {data.rating}/5
            </div>
          )}
        </div>

        {/* Резюме */}
        {data.resume_text && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3 inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> Резюме
            </h2>
            <div className="whitespace-pre-wrap text-slate-800 text-[15px] leading-relaxed">
              {data.resume_text}
            </div>
          </div>
        )}

        {/* Комментарии HR */}
        {data.notes.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-4 inline-flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4" /> Комментарии HR
            </h2>
            <div className="space-y-4">
              {data.notes.map((n, i) => (
                <div key={i} className="border-l-2 border-slate-200 pl-4">
                  <div className="text-xs text-slate-400 mb-0.5">
                    {n.author_name || 'HR'}
                    {n.date && ` · ${new Date(n.date).toLocaleDateString('ru')}`}
                    {n.stage_label && ` · ${n.stage_label}`}
                  </div>
                  <div className="text-slate-800 text-[15px] whitespace-pre-wrap">{n.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 pt-2">
          Страница предпросмотра кандидата · ссылка действует ограниченное время
        </p>
      </div>
    </div>
  );
}
