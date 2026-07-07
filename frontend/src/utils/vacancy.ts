import type { Vacancy } from '@/types';

/**
 * Активный участник общей воронки (модель без клонов, 2026-07-02):
 * создатель ИЛИ назначенный (assigned_to / assigned_to_all), МИНУС те, кто
 * «закрыл у себя» (extra_data.dismissed_by). Используется для видимости
 * воронок («Мои вакансии», дропдауны добавления кандидата) и для решения
 * «выход vs полное закрытие» на кнопке «Закрыть вакансию».
 */
export function isVacancyParticipant(v: Vacancy, userId: number | undefined | null): boolean {
  if (!userId) return false;
  const dismissed = ((v.extra_data as Record<string, unknown> | undefined)?.dismissed_by as number[] | undefined) || [];
  if (dismissed.includes(userId)) return false;
  if (v.created_by === userId) return true;
  if ((v.assigned_to || []).includes(userId)) return true;
  if (v.assigned_to_all) return true;
  return false;
}

/**
 * Видимость ЗАЯВКИ (pending_review/draft) для пользователя — единое правило,
 * которое раньше было продублировано (с расхождениями) в нескольких местах
 * сайдбара/страниц: рекрутёр видит заявки, которые сам создал ИЛИ на него
 * назначены; admin/owner/superadmin видят ВСЕ заявки орга без исключений.
 */
export function isRequestVisibleTo(
  v: Vacancy,
  userId: number | undefined | null,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return isVacancyParticipant(v, userId);
}

/** Активные участники, кроме указанного юзера (для вопроса «ты последний?»). */
export function otherActiveParticipants(v: Vacancy, userId: number | undefined | null): number[] {
  const dismissed = new Set(
    (((v.extra_data as Record<string, unknown> | undefined)?.dismissed_by as number[] | undefined) || []),
  );
  const participants = new Set<number>(v.assigned_to || []);
  if (v.created_by) participants.add(v.created_by);
  return Array.from(participants).filter((id) => !dismissed.has(id) && id !== userId);
}
