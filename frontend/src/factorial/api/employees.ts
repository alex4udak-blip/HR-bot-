import api from '@/services/api/client';
import type { Employee, LeaveBalance, LeaveRequest, Reminder } from './types';

export const listEmployees = (activeOnly = true) =>
  api.get<Employee[]>(`/employees?active_only=${activeOnly}`).then((r) => r.data);

export const getMyProfile = () =>
  api.get<Employee>('/employees/me').then((r) => r.data);

export const getEmployee = (id: number) =>
  api.get<Employee>(`/employees/${id}`).then((r) => r.data);

export const createEmployee = (body: Partial<Employee> & { user_id: number }) =>
  api.post<Employee>('/employees', body).then((r) => r.data);

export const updateEmployee = (id: number, body: Partial<Employee>) =>
  api.put<Employee>(`/employees/${id}`, body).then((r) => r.data);

// Сотрудник правит СВОЙ профиль (личный кабинет) — PUT /employees/me.
export const updateMyProfile = (body: Partial<Employee>) =>
  api.put<Employee>('/employees/me', body).then((r) => r.data);

export const dismissEmployee = (id: number, reason?: string) =>
  api
    .delete(`/employees/${id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)
    .then((r) => r.data);

export const getLeaveBalance = (id: number) =>
  api.get<LeaveBalance>(`/employees/${id}/leave-balance`).then((r) => r.data);

export const createLeaveRequest = (
  id: number,
  body: { type: string; start_date: string; end_date: string; days: number; reason?: string },
) => api.post<LeaveRequest>(`/employees/${id}/leave-request`, body).then((r) => r.data);

export const listLeaveRequests = (status?: string) =>
  api
    .get<LeaveRequest[]>(`/employees/leave-requests${status ? `?status_filter=${status}` : ''}`)
    .then((r) => r.data);

export const approveLeave = (rid: number) =>
  api.put(`/employees/leave-requests/${rid}/approve`).then((r) => r.data);

export const rejectLeave = (rid: number) =>
  api.put(`/employees/leave-requests/${rid}/reject`).then((r) => r.data);

export const getReminders = () =>
  api.get<Reminder[]>('/employees/reminders').then((r) => r.data);

export const uploadMyPassport = (filename: string, content_type: string, data_base64: string) =>
  api.post('/employees/me/passport', { filename, content_type, data_base64 }).then((r) => r.data);

export const getMyPassport = () =>
  api.get<{ filename: string; content_type: string; data_base64: string }>('/employees/me/passport').then((r) => r.data);

// Скан паспорта сотрудника — для HR/руководителя (бэкенд проверяет доступ: self/HR/руководитель).
export const getEmployeePassport = (id: number) =>
  api.get<{ filename: string; content_type: string; data_base64: string }>(`/employees/${id}/passport`).then((r) => r.data);
