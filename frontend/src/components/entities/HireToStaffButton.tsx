import { useState, useEffect, useRef } from 'react';
import { Briefcase, X, Copy, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { hireEntity, getDepartments } from '@/services/api';
import type { Department } from '@/services/api';
import { getErrorDetail } from '@/utils';
import DatePickerFactorial from '@/factorial/components/DatePickerFactorial';

const HIREABLE = new Set(['hired', 'probation']);

interface Props {
  entityId: number;
  entityName: string;
  status: string;
  email?: string | null;
  phone?: string | null;
  telegram?: string | null;
  position?: string | null;
  canHire: boolean;
  onHired: (employeeId: number) => void;
}

export default function HireToStaffButton(props: Props) {
  const { entityId, entityName, status, email, position, canHire, onHired } = props;
  const [open, setOpen] = useState(false);
  const [depts, setDepts] = useState<Department[]>([]);
  const [deptId, setDeptId] = useState<number | ''>('');
  const [mail, setMail] = useState(email || '');
  const [pos, setPos] = useState(position || '');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const deptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) getDepartments().then((d) => setDepts(d)).catch(() => setDepts([]));
  }, [open]);

  // Подставляем логин(email)/должность кандидата. useState-инициализатор срабатывает
  // ОДИН раз при монтировании, а кнопка переиспользуется между кандидатами и профиль
  // догружается асинхронно — без синхронизации поля «залипали» на прежнем кандидате
  // (пустой email, чужая должность), хотя шапка уже показывала верное имя. Синкаем
  // только пока модалка ЗАКРЫТА, чтобы не затирать то, что рекрутёр уже вписал.
  useEffect(() => {
    if (!open) {
      setMail(email || '');
      setPos(position || '');
    }
  }, [entityId, email, position, open]);

  useEffect(() => {
    if (!deptOpen) return;
    const onDown = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [deptOpen]);

  if (!canHire || !HIREABLE.has(status)) return null;

  const selectedDept = depts.find((d) => d.id === deptId);

  const submit = async () => {
    if (!mail.trim()) { toast.error('Укажите email — это логин сотрудника'); return; }
    if (deptId === '') { toast.error('Выберите отдел'); return; }
    setSaving(true);
    try {
      const res = await hireEntity(entityId, {
        department_id: Number(deptId), email: mail.trim(), position: pos.trim() || null,
        department_start_date: date || null,
      });
      if (res.temporary_password) setPassword(res.temporary_password);
      else { toast.success('Оформлен в штат (аккаунт уже был)'); setOpen(false); }
      onHired(res.employee_id);
    } catch (e) {
      toast.error(getErrorDetail(e, 'Не удалось оформить в штат'));
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    if (password) { navigator.clipboard?.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-colors"
      >
        <Briefcase className="w-3.5 h-3.5" />
        Взять в штат
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-dark-800 border border-white/10 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">Взять в штат — {entityName}</h3>
              <button onClick={() => !saving && setOpen(false)} aria-label="Закрыть"><X className="w-4 h-4 text-dark-400" /></button>
            </div>

            {!password ? (
              <div className="space-y-3">
                <div className="block">
                  <span className="text-xs text-dark-400">Отдел</span>
                  <div className="relative mt-1" ref={deptRef}>
                    <button type="button" onClick={() => setDeptOpen((v) => !v)}
                      className="w-full flex items-center justify-between rounded-lg bg-dark-700 border border-white/10 px-3 py-2 text-sm text-white hover:border-white/20">
                      <span className={selectedDept ? '' : 'text-dark-400'}>{selectedDept ? selectedDept.name : '— выберите отдел —'}</span>
                      <ChevronDown className={clsx('w-4 h-4 text-dark-400 transition-transform', deptOpen && 'rotate-180')} />
                    </button>
                    {deptOpen && (
                      <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-lg bg-dark-700 border border-white/10 p-1 shadow-xl">
                        {depts.length === 0 && <div className="px-3 py-2 text-xs text-dark-400">Нет отделов</div>}
                        {depts.map((d) => (
                          <button key={d.id} type="button"
                            onClick={() => { setDeptId(d.id); setDeptOpen(false); }}
                            className={clsx('w-full text-left px-3 py-2 text-sm rounded-md hover:bg-white/5',
                              d.id === deptId ? 'bg-green-500/15 text-green-400' : 'text-white')}>
                            {d.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <label className="block">
                  <span className="text-xs text-dark-400">Email (логин)</span>
                  <input value={mail} onChange={(e) => setMail(e.target.value)} type="email" placeholder="ivan@company.com"
                    className="mt-1 w-full rounded-lg bg-dark-700 border border-white/10 px-3 py-2 text-sm text-white" />
                </label>
                <label className="block">
                  <span className="text-xs text-dark-400">Должность</span>
                  <input value={pos} onChange={(e) => setPos(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-dark-700 border border-white/10 px-3 py-2 text-sm text-white" />
                </label>
                <div className="block">
                  <span className="text-xs text-dark-400">Дата выхода</span>
                  <div className="mt-1">
                    <DatePickerFactorial value={date} onChange={setDate} placeholder="дд.мм.гггг" />
                  </div>
                </div>
                <button onClick={submit} disabled={saving}
                  className="w-full mt-2 rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 py-2 text-sm font-medium hover:bg-green-500/30 disabled:opacity-50">
                  {saving ? 'Оформляем…' : 'Подтвердить'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white">Аккаунт создан. Передайте пароль сотруднику — он показывается один раз:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-dark-700 border border-white/10 px-3 py-2 text-sm text-green-400 select-all">{password}</code>
                  <button onClick={copy} className="rounded-lg border border-white/10 p-2 text-dark-300 hover:text-white" aria-label="Копировать">
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setOpen(false)} className="w-full rounded-lg bg-dark-700 border border-white/10 py-2 text-sm text-white">Готово</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
