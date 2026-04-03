/**
 * Employee Portal Page
 *
 * For regular employees (/my-profile): personal profile, leave balance, documents
 * For HRD/admin (/employees): employee list, reminders, leave request management
 */
import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Users, Calendar, AlertTriangle, CheckCircle, XCircle,
  Clock, FileText, User, Building2, Briefcase,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import * as employeesApi from '@/services/api/employees';
import type {
  EmployeeData,
  LeaveBalance,
  LeaveRequestData,
  ReminderItem,
  LeaveRequestCreate,
} from '@/services/api/employees';

// ─── Helper ─────────────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  vacation: 'Отпуск',
  sick: 'Больничный',
  family_leave: 'Family leave',
  bereavement: 'Утрата',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'На рассмотрении',
  approved: 'Одобрено',
  rejected: 'Отклонено',
};

// ─── Leave Request Modal ────────────────────────────────────

function LeaveRequestModal({
  employeeId,
  onClose,
  onCreated,
}: {
  employeeId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<'vacation' | 'sick' | 'family_leave' | 'bereavement'>('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const days = startDate && endDate
    ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
    : 0;

  const handleSubmit = async () => {
    if (!startDate || !endDate || days <= 0) {
      setError('Укажите корректные даты');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload: LeaveRequestCreate = {
        type,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        days,
        reason: reason || null,
      };
      await employeesApi.createLeaveRequest(employeeId, payload);
      onCreated();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail || 'Ошибка создания запроса');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-dark-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-400" />
          Запрос на отпуск
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-white/50 mb-1">Тип</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="w-full bg-dark-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="vacation">Отпуск</option>
              <option value="sick">Больничный</option>
              <option value="family_leave">Family leave</option>
              <option value="bereavement">Утрата</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">С</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-dark-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">По</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-dark-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          {days > 0 && (
            <div className="text-sm text-emerald-400">
              Дней: {days}
            </div>
          )}

          <div>
            <label className="block text-xs text-white/50 mb-1">Причина</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full bg-dark-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none"
              placeholder="Необязательно..."
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || days <= 0}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? 'Отправка...' : 'Отправить запрос'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Employee Profile (self-service view) ───────────────────

function MyProfileView() {
  const [profile, setProfile] = useState<EmployeeData | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      const p = await employeesApi.getMyEmployeeProfile();
      setProfile(p);
      const b = await employeesApi.getLeaveBalance(p.id);
      setBalance(b);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err?.response?.status === 404) {
        setError('Профиль сотрудника ещё не создан. Обратитесь к HR.');
      } else {
        setError('Ошибка загрузки профиля');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <User className="w-12 h-12 text-white/20 mx-auto mb-4" />
        <p className="text-white/40 text-sm">{error || 'Профиль не найден'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Profile card */}
      <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <User className="w-7 h-7 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white">{profile.user_name}</h2>
            <p className="text-sm text-white/50">{profile.user_email}</p>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/60">
              {profile.position && (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" />
                  {profile.position}
                </span>
              )}
              {profile.department_name && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  {profile.department_name}
                </span>
              )}
              {profile.department_start_date && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Начало работы: {formatDate(profile.department_start_date)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Leave balance */}
      {balance && (
        <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-4">
            Отпуска и больничные
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase">
                  <th className="text-left py-2 pr-4">Тип</th>
                  <th className="text-center py-2 px-4">Доступно</th>
                  <th className="text-center py-2 px-4">Использовано</th>
                  <th className="text-center py-2 px-4">Остаток</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                <tr className="border-t border-white/5">
                  <td className="py-3 pr-4">Отпуск</td>
                  <td className="text-center py-3 px-4">{balance.vacation_total} дн.</td>
                  <td className="text-center py-3 px-4">{balance.vacation_used}</td>
                  <td className="text-center py-3 px-4 font-medium text-emerald-400">{balance.vacation_remaining} дн.</td>
                </tr>
                <tr className="border-t border-white/5">
                  <td className="py-3 pr-4">Больничный</td>
                  <td className="text-center py-3 px-4">{balance.sick_total} дн.</td>
                  <td className="text-center py-3 px-4">{balance.sick_used}</td>
                  <td className="text-center py-3 px-4 font-medium text-emerald-400">{balance.sick_remaining} дн.</td>
                </tr>
                <tr className="border-t border-white/5">
                  <td className="py-3 pr-4">Family leave</td>
                  <td className="text-center py-3 px-4">{balance.family_leave_total} дн.</td>
                  <td className="text-center py-3 px-4">{balance.family_leave_used}</td>
                  <td className="text-center py-3 px-4 font-medium text-emerald-400">{balance.family_leave_remaining} дн.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <button
            onClick={() => setShowLeaveModal(true)}
            className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-xl text-sm font-medium transition-colors"
          >
            <Calendar className="w-4 h-4" />
            Запросить отпуск
          </button>
        </div>
      )}

      {/* Documents */}
      <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-4">
          Документы
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <FileText className="w-4 h-4 text-white/30" />
            <span className="text-white/60">NDA:</span>
            {profile.nda_signed ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle className="w-4 h-4" />
                Подписан {formatDate(profile.nda_signed_at)}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400">
                <Clock className="w-4 h-4" />
                Ожидает подписания
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <FileText className="w-4 h-4 text-white/30" />
            <span className="text-white/60">Договор:</span>
            {profile.contract_signed ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle className="w-4 h-4" />
                Подписан {formatDate(profile.contract_signed_at)}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400">
                <Clock className="w-4 h-4" />
                Ожидает подписания
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Leave modal */}
      {showLeaveModal && (
        <LeaveRequestModal
          employeeId={profile.id}
          onClose={() => setShowLeaveModal(false)}
          onCreated={loadProfile}
        />
      )}
    </div>
  );
}

// ─── Admin view: Employee list + reminders + leave requests ─

function AdminEmployeesView() {
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'leave' | 'reminders'>('list');

  const load = useCallback(async () => {
    try {
      const [emps, rems, lrs] = await Promise.all([
        employeesApi.getEmployees(),
        employeesApi.getEmployeeReminders(),
        employeesApi.getAllLeaveRequests(),
      ]);
      setEmployees(emps);
      setReminders(rems);
      setLeaveRequests(lrs);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: number) => {
    try {
      await employeesApi.approveLeaveRequest(id);
      load();
    } catch {
      // silently ignore
    }
  };

  const handleReject = async (id: number) => {
    try {
      await employeesApi.rejectLeaveRequest(id);
      load();
    } catch {
      // silently ignore
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reminders banner */}
      {reminders.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            Напоминания
          </h3>
          <div className="space-y-2">
            {reminders.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-white/70">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="font-medium text-white">{r.employee_name}</span>
                <span>—</span>
                <span>
                  {r.type === 'probation_ending'
                    ? `Испытательный заканчивается через ${r.days_remaining} дн.`
                    : `1 год работы через ${r.days_remaining} дн.`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-dark-800/50 rounded-xl p-1 w-fit">
        {[
          { id: 'list' as const, label: 'Сотрудники', icon: Users, count: employees.length },
          { id: 'leave' as const, label: 'Запросы отпусков', icon: Calendar, count: leaveRequests.length },
          { id: 'reminders' as const, label: 'Напоминания', icon: AlertTriangle, count: reminders.length },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-white/10 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'list' && (
        <div className="bg-dark-800/50 border border-white/5 rounded-2xl overflow-hidden">
          {employees.length === 0 ? (
            <div className="py-12 text-center text-white/30 text-sm">
              Нет сотрудников. Создайте первого через кнопку ниже.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs uppercase border-b border-white/5">
                    <th className="text-left py-3 px-4">Имя</th>
                    <th className="text-left py-3 px-4">Должность</th>
                    <th className="text-left py-3 px-4">Отдел</th>
                    <th className="text-left py-3 px-4">Начало работы</th>
                    <th className="text-left py-3 px-4">Испытательный</th>
                    <th className="text-center py-3 px-4">Отпуск</th>
                    <th className="text-center py-3 px-4">Документы</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => {
                    const vacRemaining = Math.max(0, (emp.vacation_days_total || 0) - (emp.vacation_days_used || 0));
                    const probationDays = emp.probation_end_date
                      ? Math.ceil((new Date(emp.probation_end_date).getTime() - Date.now()) / 86400000)
                      : null;
                    return (
                      <tr key={emp.id} className="border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4">
                          <div>
                            <span className="text-white font-medium">{emp.user_name || '—'}</span>
                            {emp.user_email && (
                              <p className="text-[11px] text-white/30">{emp.user_email}</p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-white/60">{emp.position || '—'}</td>
                        <td className="py-3 px-4 text-white/60">{emp.department_name || '—'}</td>
                        <td className="py-3 px-4 text-white/60">{formatDate(emp.department_start_date)}</td>
                        <td className="py-3 px-4">
                          {probationDays !== null ? (
                            probationDays > 0 ? (
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                probationDays <= 7
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-blue-500/20 text-blue-400'
                              }`}>
                                {probationDays} дн.
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                                Завершён
                              </span>
                            )
                          ) : (
                            <span className="text-white/20">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="text-emerald-400 font-medium">{vacRemaining}</span>
                          <span className="text-white/30 text-xs"> дн.</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {emp.nda_signed ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                            )}
                            {emp.contract_signed ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'leave' && (
        <div className="bg-dark-800/50 border border-white/5 rounded-2xl overflow-hidden">
          {leaveRequests.length === 0 ? (
            <div className="py-12 text-center text-white/30 text-sm">
              Нет заявок на отпуск
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {leaveRequests.map((lr) => (
                <div key={lr.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium text-sm">{lr.employee_name}</span>
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-500/20 text-blue-400">
                        {LEAVE_TYPE_LABELS[lr.type] || lr.type}
                      </span>
                    </div>
                    <p className="text-xs text-white/40 mt-1">
                      {formatDate(lr.start_date)} — {formatDate(lr.end_date)} ({lr.days} дн.)
                      {lr.reason && <span className="ml-2 text-white/30">• {lr.reason}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {lr.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleApprove(lr.id)}
                          className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 transition-colors"
                          title="Одобрить"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleReject(lr.id)}
                          className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                          title="Отклонить"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        lr.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {STATUS_LABELS[lr.status] || lr.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'reminders' && (
        <div className="bg-dark-800/50 border border-white/5 rounded-2xl overflow-hidden">
          {reminders.length === 0 ? (
            <div className="py-12 text-center text-white/30 text-sm">
              Нет предстоящих напоминаний
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {reminders.map((r, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    r.type === 'probation_ending' ? 'bg-amber-500/20' : 'bg-blue-500/20'
                  }`}>
                    {r.type === 'probation_ending' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400" />
                    ) : (
                      <Calendar className="w-5 h-5 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-white font-medium">{r.employee_name}</p>
                    <p className="text-xs text-white/40">
                      {r.type === 'probation_ending'
                        ? 'Испытательный срок заканчивается'
                        : '1 год работы'}{' '}
                      — {formatDate(r.date)}
                    </p>
                  </div>
                  <span className={`text-sm font-medium ${
                    r.days_remaining <= 3 ? 'text-red-400' : r.days_remaining <= 7 ? 'text-amber-400' : 'text-blue-400'
                  }`}>
                    {r.days_remaining} дн.
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────

export default function EmployeePortalPage() {
  const location = useLocation();
  const { user } = useAuthStore();
  const isAdminView = location.pathname === '/employees';
  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  // If /employees but not admin, redirect to profile view
  const showAdmin = isAdminView && isAdmin;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        {showAdmin ? (
          <>
            <Users className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold text-white">Сотрудники</h1>
          </>
        ) : (
          <>
            <User className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold text-white">Мой профиль</h1>
          </>
        )}
      </div>

      {showAdmin ? <AdminEmployeesView /> : <MyProfileView />}
    </div>
  );
}
