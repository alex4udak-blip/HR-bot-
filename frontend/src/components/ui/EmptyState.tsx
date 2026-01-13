import { LucideIcon, Briefcase, Users, FileText, Search, Inbox } from 'lucide-react';
import clsx from 'clsx';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  size = 'md'
}: EmptyStateProps) {
  const sizeStyles = {
    sm: {
      container: 'py-8',
      icon: 'w-10 h-10',
      title: 'text-base',
      description: 'text-sm',
      button: 'px-3 py-1.5 text-sm'
    },
    md: {
      container: 'py-12',
      icon: 'w-16 h-16',
      title: 'text-lg',
      description: 'text-sm',
      button: 'px-4 py-2'
    },
    lg: {
      container: 'py-16',
      icon: 'w-20 h-20',
      title: 'text-xl',
      description: 'text-base',
      button: 'px-5 py-2.5'
    }
  };

  const styles = sizeStyles[size];

  return (
    <div className={clsx('text-center', styles.container, className)}>
      <Icon className={clsx(styles.icon, 'mx-auto text-white/20 mb-4')} />
      <h3 className={clsx('font-medium text-white/60', styles.title)}>{title}</h3>
      {description && (
        <p className={clsx('text-white/40 mt-1', styles.description)}>{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className={clsx(
            'mt-4 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors',
            'flex items-center gap-2 mx-auto',
            styles.button
          )}
        >
          + {action.label}
        </button>
      )}
    </div>
  );
}

// Pre-configured empty states

export function NoVacanciesEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={Briefcase}
      title="Нет вакансий"
      description="Создайте первую вакансию или импортируйте"
      action={{ label: 'Создать вакансию', onClick: onCreate }}
    />
  );
}

export function NoCandidatesEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      icon={Users}
      title="Нет кандидатов"
      description="Добавьте первого кандидата в вакансию"
      action={{ label: 'Добавить кандидата', onClick: onAdd }}
    />
  );
}

export function NoResultsEmpty({ query }: { query: string }) {
  return (
    <EmptyState
      icon={Search}
      title="Ничего не найдено"
      description={`По запросу "${query}" результатов не найдено`}
      size="sm"
    />
  );
}

export function NoDataEmpty() {
  return (
    <EmptyState
      icon={FileText}
      title="Нет данных"
      description="Данные пока отсутствуют"
    />
  );
}
