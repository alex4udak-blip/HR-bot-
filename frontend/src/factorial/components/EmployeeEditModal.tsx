import { useState, useEffect, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEmployee, updateEmployee, getMyProfile, updateMyProfile, listEmployees } from '../api/employees';
import DatePickerFactorial from './DatePickerFactorial';
import { formatPhone } from '../lib/phone';

// Редактирование сотрудника. selfMode=false — HR из реестра (рабочие поля, без паспорта).
// selfMode=true — сам сотрудник в ЛК (личные/паспортные данные тоже). extra_data мёржится.
export default function EmployeeEditModal({
  employeeId,
  selfMode = false,
  onClose,
  onSaved,
}: {
  employeeId?: number;
  selfMode?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useQuery({
    queryKey: selfMode ? ['fx', 'me'] : ['fx', 'employee', employeeId],
    queryFn: () => (selfMode ? getMyProfile() : getEmployee(employeeId!)),
  });
  // Существующие должности — для выпадающего списка.
  const { data: allEmps = [] } = useQuery({ queryKey: ['fx', 'employees', 'table'], queryFn: () => listEmployees(true), retry: false });
  const positions = Array.from(new Set(allEmps.map((e) => (e.position || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));

  const [form, setForm] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!emp) return;
    const e = (emp.extra_data || {}) as Record<string, unknown>;
    const s = (v: unknown) => (v == null ? '' : String(v));
    const d = (v: unknown) => (v ? String(v).slice(0, 10) : '');
    setForm({
      position: s(emp.position),
      phone: formatPhone(s(emp.phone)),
      telegram_username: s(emp.telegram_username),
      department_start_date: d(emp.department_start_date),
      last_name: s(e.last_name),
      first_name: s(e.first_name),
      middle_name: s(e.middle_name),
      full_name: s(e.full_name),
      birth_date: d(e.birth_date),
      passport_number: s(e.passport_number),
      passport_issued_by: s(e.passport_issued_by),
      passport_issued: d(e.passport_issued),
      address: s(e.address),
      emergency_contact_name: s(e.emergency_contact_name),
      emergency_contact_phone: formatPhone(s(e.emergency_contact_phone)),
    });
  }, [emp]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const baseExtra = (emp?.extra_data || {}) as Record<string, unknown>;
      const u = (v: string) => (v.trim() ? v.trim() : undefined);
      const extra: Record<string, unknown> = {
        ...baseExtra,
        last_name: u(form.last_name),
        first_name: u(form.first_name),
        middle_name: u(form.middle_name),
        full_name: u(form.full_name),
        birth_date: u(form.birth_date),
        passport_number: u(form.passport_number),
        passport_issued_by: u(form.passport_issued_by),
        passport_issued: u(form.passport_issued),
        address: u(form.address),
        emergency_contact_name: u(form.emergency_contact_name),
        emergency_contact_phone: u(form.emergency_contact_phone),
      };
      const body = {
        position: form.position.trim() || null,
        phone: form.phone.trim() || null,
        telegram_username: form.telegram_username.trim() || null,
        department_start_date: form.department_start_date ? `${form.department_start_date}T00:00:00` : null,
        extra_data: extra,
      };
      return selfMode ? updateMyProfile(body) : updateEmployee(employeeId!, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fx'] });
      onSaved?.();
      onClose();
    },
    onError: () => setErr('Не удалось сохранить. Попробуйте ещё раз.'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    save.mutate();
  };

  return createPortal(
    <div className="factorial-root" style={{ height: 'auto', background: 'transparent' }}>
    <div className="fx-modal-overlay" onClick={onClose}>
      <form className="fx-modal" style={{ width: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{selfMode ? 'Редактировать профиль' : 'Редактировать сотрудника'}</h3>
        {isLoading || !emp ? (
          <div className="fx-sub">Загрузка…</div>
        ) : (
          <>
            <div className="fx-field">
              <label>Должность</label>
              <select className="fx-select" value={form.position} onChange={(e) => set('position', e.target.value)}>
                <option value="">— Не выбрана —</option>
                {positions.map((p) => (<option key={p} value={p}>{p}</option>))}
                {form.position && !positions.includes(form.position) && <option value={form.position}>{form.position}</option>}
              </select>
            </div>

            <div className="fx-field" style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>Телефон</label>
                <input className="fx-input" value={form.phone} onChange={(e) => set('phone', formatPhone(e.target.value))} placeholder="+7 (___) ___-__-__" inputMode="tel" />
              </div>
              <div style={{ flex: 1 }}>
                <label>Telegram</label>
                <input className="fx-input" value={form.telegram_username} onChange={(e) => set('telegram_username', e.target.value)} />
              </div>
            </div>

            <div className="fx-field">
              <label>Дата начала работы</label>
              <DatePickerFactorial value={form.department_start_date} onChange={(v) => set('department_start_date', v)} />
            </div>

            <div className="fx-field" style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}><label>Фамилия</label><input className="fx-input" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></div>
              <div style={{ flex: 1 }}><label>Имя</label><input className="fx-input" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></div>
              <div style={{ flex: 1 }}><label>Отчество</label><input className="fx-input" value={form.middle_name} onChange={(e) => set('middle_name', e.target.value)} /></div>
            </div>

            {selfMode && (
              <>
                <div className="fx-field" style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}><label>Дата рождения</label><DatePickerFactorial value={form.birth_date} onChange={(v) => set('birth_date', v)} /></div>
                  <div style={{ flex: 1 }}><label>Паспорт №</label><input className="fx-input" value={form.passport_number} onChange={(e) => set('passport_number', e.target.value)} /></div>
                </div>
                <div className="fx-field" style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 2 }}><label>Кем выдан</label><input className="fx-input" value={form.passport_issued_by} onChange={(e) => set('passport_issued_by', e.target.value)} /></div>
                  <div style={{ flex: 1 }}><label>Дата выдачи</label><DatePickerFactorial value={form.passport_issued} onChange={(v) => set('passport_issued', v)} /></div>
                </div>
                <div className="fx-field"><label>Адрес</label><input className="fx-input" value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
                <div className="fx-field" style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}><label>Экстренный контакт — имя</label><input className="fx-input" value={form.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} /></div>
                  <div style={{ flex: 1 }}><label>Экстренный контакт — телефон</label><input className="fx-input" value={form.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', formatPhone(e.target.value))} inputMode="tel" /></div>
                </div>
              </>
            )}

            {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 8 }}>{err}</div>}
            <div className="fx-modal-actions">
              <button type="button" className="fx-btn fx-btn--secondary" onClick={onClose}>Отмена</button>
              <button type="submit" className="fx-btn fx-btn--primary" disabled={save.isPending}>{save.isPending ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </>
        )}
      </form>
    </div>
    </div>,
    document.body,
  );
}
