/**
 * Дефолтный лендинг-путь после логина / редиректа с неизвестного маршрута.
 *
 * Логика:
 *   - Практика-only (член депта 'Практика', не платформ-админ) → /chats
 *   - Все остальные → /dashboard
 */
import type { User } from '@/types';

export function getDefaultLandingPath(user: User | null | undefined): string {
  if (!user) return '/dashboard';

  const isPlatformAdmin = user.role === 'superadmin' || user.org_role === 'owner';
  const isPracticeMember = (user.department_names || []).some(
    (n) => n.trim().toLowerCase() === 'практика'
  );

  if (isPracticeMember && !isPlatformAdmin) {
    return '/chats';
  }
  return '/dashboard';
}
