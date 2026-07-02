import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Paperclip, Star, FileText } from 'lucide-react';
import {
  getPublicCandidatePreview,
  type PublicCandidatePreview,
} from '@/services/api/entities';

/**
 * Публичный предпросмотр кандидата для заказчика (модуль 3).
 * Реплика КАРТОЧКИ кандидата: инфо-строки + фото, зелёный блок текущего этапа
 * с историей/комментариями и названиями файлов. НИЧЕГО кликабельного — это
 * просто предпросмотр без авторизации, вне Layout.
 */

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-[3px] text-[14px]">
      <span className="w-[96px] shrink-0 text-slate-400">{label}</span>
      <span className="text-slate-900 min-w-0">{children}</span>
    </div>
  );
}

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
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
          {/* Шапка карточки: инфо-строки слева, фото справа */}
          <div className="flex justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-slate-900">{data.name}</h1>
              {subtitle && <p className="text-slate-500 mt-0.5 mb-4">{subtitle}</p>}

              <div>
                {data.phone && <InfoRow label="Телефон">{data.phone}</InfoRow>}
                {data.email && <InfoRow label="Эл. почта">{data.email}</InfoRow>}
                {data.telegram && <InfoRow label="Telegram">{String(data.telegram).replace(/^@/, '')}</InfoRow>}
                {data.age && <InfoRow label="Возраст">{data.age}</InfoRow>}
                {data.city && (
                  <InfoRow label="Город">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" /> {data.city}
                    </span>
                  </InfoRow>
                )}
                {data.salary && <InfoRow label="Зарплата">{data.salary}</InfoRow>}
                {data.total_experience && <InfoRow label="Опыт">{data.total_experience}</InfoRow>}
                {data.source && <InfoRow label="Источник">{data.source}</InfoRow>}
              </div>

              {typeof data.rating === 'number' && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-sm text-amber-700">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  Оценка HR: {data.rating}/5
                </div>
              )}
            </div>

            {data.photo_url && (
              <img
                src={data.photo_url}
                alt={data.name}
                referrerPolicy="no-referrer"
                className="w-[130px] h-[150px] rounded-xl object-cover shrink-0"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
          </div>

          {/* Зелёный блок текущего этапа — как в карточке кандидата */}
          {(data.stage_label || data.timeline.length > 0 || data.files.length > 0) && (
            <div className="mt-6 rounded-xl bg-emerald-50 border-l-4 border-emerald-500 p-5">
              {data.stage_label && (
                <>
                  <div className="text-lg font-semibold text-emerald-700">{data.stage_label}</div>
                  {data.vacancy_title && (
                    <div className="text-sm text-emerald-600/80">{data.vacancy_title}</div>
                  )}
                </>
              )}

              {data.timeline.length > 0 && (
                <div className="mt-4 space-y-3">
                  {data.timeline.map((item, i) => (
                    <div key={i}>
                      <div className="text-xs text-emerald-600/90">
                        {item.author_name || 'HR'}
                        {item.date && ` · ${new Date(item.date).toLocaleString('ru', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                      <div className="text-[14px] text-emerald-950 whitespace-pre-wrap">
                        {item.title && <div>{item.title}</div>}
                        {item.text && <div>{item.text}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {data.files.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-emerald-600/90 mb-1">Файлы</div>
                  {data.files.map((f, i) => (
                    <div key={i} className="text-[14px] text-emerald-950 inline-flex items-center gap-1.5 mr-4">
                      <Paperclip className="w-3.5 h-3.5 text-emerald-600/70" /> {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 pt-4">
          Страница предпросмотра кандидата · ссылка действует ограниченное время
        </p>
      </div>
    </div>
  );
}
