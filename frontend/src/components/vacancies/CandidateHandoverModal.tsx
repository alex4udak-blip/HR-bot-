// ================================================================
// CandidateHandoverModal — «Передача кандидатов» (в рамках HR).
//
// Сотрудник увольняется → его аккаунт удалят, всё владение обнулится. Здесь
// админ/суперадмин ПЕРЕД удалением раздаёт его воронки: выбрал уходящего →
// появляются ЕГО воронки, у каждой свой выбор «кому передать» (можно разным,
// можно оставить пустым = не передавать). Отдельная строка — кандидаты вне
// воронок. Открывается кнопкой в верхней панели «Мои вакансии».
// ================================================================
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Loader2, X, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import { getOrgMembers, getHandoverSummary, reassignSplit } from '@/services/api';
import type { HandoverSummary } from '@/services/api/auth';

type Recruiter = { id: number; name: string };

export default function CandidateHandoverModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone?: () => void;
}) {
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [fromId, setFromId] = useState<number | ''>('');
  const [summary, setSummary] = useState<HandoverSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  // vacancy_id → получатель; ключ 'pool' → кандидаты вне воронок.
  const [assign, setAssign] = useState<Record<string, number | ''>>({});

  // Все рекрутёры орга (owner/admin/hr) — уходящий и получатели.
  useEffect(() => {
    getOrgMembers()
      .then((ms) =>
        setRecruiters(
          ms
            .filter((m) => ['owner', 'admin', 'hr'].includes(m.role))
            .map((m) => ({ id: m.user_id, name: m.user_name })),
        ),
      )
      .catch(() => toast.error('Не удалось загрузить рекрутёров'));
  }, []);

  // Выбрали уходящего → тянем его воронки + пул.
  useEffect(() => {
    setSummary(null);
    setAssign({});
    if (fromId === '') return;
    setLoadingSummary(true);
    getHandoverSummary(Number(fromId))
      .then(setSummary)
      .catch(() => toast.error('Не удалось загрузить воронки рекрутёра'))
      .finally(() => setLoadingSummary(false));
  }, [fromId]);

  const fromName = useMemo(
    () => recruiters.find((r) => r.id === fromId)?.name || '',
    [recruiters, fromId],
  );
  // Получатели — все, кроме уходящего.
  const recipients = useMemo(
    () => recruiters.filter((r) => r.id !== fromId),
    [recruiters, fromId],
  );

  const chosen = useMemo(
    () => Object.entries(assign).filter(([, to]) => to !== ''),
    [assign],
  );
  const canSubmit = fromId !== '' && chosen.length > 0 && !busy;

  const setTarget = (key: string, val: number | '') =>
    setAssign((prev) => ({ ...prev, [key]: val }));

  const handleSubmit = async () => {
    if (!canSubmit || !summary) return;
    const assignments = summary.funnels
      .filter((f) => assign[String(f.vacancy_id)])
      .map((f) => ({ vacancy_id: f.vacancy_id, to_user_id: Number(assign[String(f.vacancy_id)]) }));

    const nameOf = (id: number) => recipients.find((r) => r.id === id)?.name || 'рекрутёру';
    const lines = assignments.map((a) => {
      const f = summary.funnels.find((x) => x.vacancy_id === a.vacancy_id);
      return `• «${f?.title}» → ${nameOf(a.to_user_id)}`;
    });
    if (!confirm(
      `Передать от «${fromName}»:\n\n${lines.join('\n')}\n\nДействие необратимо.`,
    )) return;

    setBusy(true);
    try {
      const r = await reassignSplit(Number(fromId), assignments);
      toast.success(`Передано: воронок ${r.vacancies}, кандидатов ${r.candidates}, заявок ${r.applications}`);
      onDone?.();
      onClose();
    } catch (e) {
      console.error('reassign split failed', e);
      toast.error('Не удалось передать — попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    'px-3 py-2 rounded-lg text-sm bg-[var(--hf-bg-panel)] border border-[color:var(--hf-main-200)] text-[var(--hf-main-900)] focus:outline-none focus:border-[color:var(--hf-cyan-500)] disabled:opacity-50';

  const recipientSelect = (key: string) => (
    <select
      value={assign[key] ?? ''}
      onChange={(e) => setTarget(key, e.target.value ? Number(e.target.value) : '')}
      disabled={busy}
      className={`${selectCls} min-w-[190px]`}
    >
      <option value="">— не передавать —</option>
      {recipients.map((r) => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </select>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-[600px] max-w-full max-h-[85vh] flex flex-col rounded-2xl bg-[var(--hf-bg-body,#fff)] border border-[color:var(--hf-main-200)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 pb-3">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <ArrowRightLeft className="w-5 h-5 text-[var(--hf-cyan-700)]" />
              <h2 className="text-base font-semibold text-[var(--hf-main-900)]">Передача кандидатов</h2>
            </div>
            <p className="text-sm text-[var(--hf-main-600)]">
              Сотрудник уходит? Раздайте его воронки другим рекрутёрам ДО удаления
              аккаунта — у каждой воронки свой получатель.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--hf-main-100)] text-[var(--hf-main-500)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6">
          <label className="block text-xs font-medium text-[var(--hf-main-600)] mb-1.5">
            От кого (уходящий)
          </label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : '')}
            disabled={busy}
            className={`${selectCls} w-full`}
          >
            <option value="">— выберите рекрутёра —</option>
            {recruiters.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        {/* Воронки уходящего + пул */}
        <div className="flex-1 overflow-y-auto px-6 py-4 mt-2">
          {fromId === '' ? (
            <div className="text-sm text-[var(--hf-main-400)] py-6 text-center">
              Выберите уходящего рекрутёра — появятся его воронки.
            </div>
          ) : loadingSummary ? (
            <div className="flex items-center gap-2 text-[var(--hf-main-500)] py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка воронок…
            </div>
          ) : summary && summary.funnels.length > 0 ? (
            <div className="space-y-2">
              {summary.funnels.map((f) => (
                <div
                  key={f.vacancy_id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[color:var(--hf-main-200)]"
                >
                  <Briefcase className="w-4 h-4 text-[var(--hf-main-400)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--hf-main-900)] truncate">{f.title}</div>
                    <div className="text-xs text-[var(--hf-main-500)]">{f.candidates} канд.</div>
                  </div>
                  {recipientSelect(String(f.vacancy_id))}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--hf-main-400)] py-6 text-center">
              У этого рекрутёра нет воронок и кандидатов для передачи.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-6 pt-3 border-t border-[color:var(--hf-main-200)]">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm text-[var(--hf-main-600)] hover:bg-[var(--hf-main-100)]"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[var(--hf-cyan-700)] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Передать{chosen.length ? ` (${chosen.length})` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
