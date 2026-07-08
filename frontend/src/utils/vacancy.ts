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
 * Личное принятие заявки, 2026-07-08: «воронка общая, но заявку каждый
 * берёт сам». Взятие статуса вакансии в open происходит один раз (при
 * первом чьём-либо «Взять в работу»), но это НЕ означает, что все
 * назначенные автоматически согласились работать над ней — трекается
 * отдельно в extra_data.accepted_by (backend: take_vacancy/decline_vacancy).
 */
export function hasPersonallyAccepted(v: Vacancy, userId: number | undefined | null): boolean {
  if (!userId) return false;
  const acceptedBy = ((v.extra_data as Record<string, unknown> | undefined)?.accepted_by as number[] | undefined) || [];
  return acceptedBy.includes(userId);
}

/**
 * «Моя» ли эта воронка ЛИЧНО для юзера прямо сейчас: создатель (создание =
 * неявное согласие работать) ИЛИ лично принял через «Взять в работу».
 * Просто «назначен» (assigned_to/assigned_to_all) — недостаточно, если сам
 * ещё не принял. Используется для «Мои вакансии» (в отличие от
 * isVacancyParticipant, который считает участником любого назначенного).
 */
export function isPersonallyActive(v: Vacancy, userId: number | undefined | null): boolean {
  if (!userId) return false;
  if (v.created_by === userId) return true;
  return hasPersonallyAccepted(v, userId);
}

/**
 * Видимость ЗАЯВКИ в быстром списке «Заявки» (сайдбар), 2026-07-08:
 * - admin/owner/superadmin/hr → только НЕРАСПРЕДЕЛЁННЫЕ заявки (нужно раздать).
 *   Как только админ назначил рекрутёра — заявка уходит из сайдбара (она целиком
 *   есть в «Перейти к заявкам», ничего не теряется).
 * - рекрутёр (member) → заявки, где он участник (создал ИЛИ назначен), но
 *   ЕЩЁ НЕ принял лично — даже если статус уже open (кто-то ДРУГОЙ из
 *   назначенных уже взял её в работу). Как только сам принял —
 *   isPersonallyActive становится true и заявка пропадает отсюда, появляясь
 *   в «Мои вакансии».
 * ВНИМАНИЕ: правило для САЙДБАРА. Полная страница /vacancies («Перейти к
 * заявкам») показывает админу ВСЕ заявки независимо от назначения.
 */
export function isRequestVisibleTo(
  v: Vacancy,
  userId: number | undefined | null,
  isAdmin: boolean,
): boolean {
  if (isAdmin) {
    const assigned = (v.assigned_to || []).length > 0 || !!v.assigned_to_all;
    return !assigned;
  }
  return isVacancyParticipant(v, userId) && !isPersonallyActive(v, userId);
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
