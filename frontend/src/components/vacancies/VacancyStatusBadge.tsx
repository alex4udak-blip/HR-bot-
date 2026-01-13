import clsx from 'clsx';
import type { VacancyStatus } from '@/types';

/**
 * Status badge component for vacancies with colored backgrounds.
 * Colors are optimized for dark theme backgrounds.
 */

interface VacancyStatusBadgeProps {
  status: VacancyStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Status colors mapping:
 * - draft: gray
 * - open: green
 * - paused: yellow
 * - closed: red
 * - cancelled: red
 */
export const VACANCY_STATUS_BADGE_COLORS: Record<VacancyStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
  open: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  closed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
};

/**
 * English status labels for display.
 */
export const VACANCY_STATUS_BADGE_LABELS: Record<VacancyStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  paused: 'Paused',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * Russian status labels (for backward compatibility).
 */
export const VACANCY_STATUS_BADGE_LABELS_RU: Record<VacancyStatus, string> = {
  draft: 'Черновик',
  open: 'Открыта',
  paused: 'На паузе',
  closed: 'Закрыта',
  cancelled: 'Отменена',
};

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
  lg: 'text-sm px-2.5 py-1',
};

export default function VacancyStatusBadge({
  status,
  size = 'md',
  className,
}: VacancyStatusBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full',
        sizeClasses[size],
        VACANCY_STATUS_BADGE_COLORS[status],
        className
      )}
    >
      {VACANCY_STATUS_BADGE_LABELS_RU[status]}
    </span>
  );
}
