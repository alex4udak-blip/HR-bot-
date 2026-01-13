import { LucideIcon, Briefcase, Users, FileText, Search, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  link?: {
    label: string;
    to: string;
  };
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  link,
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
      {link && (
        <Link
          to={link.to}
          className={clsx(
            'mt-4 text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1',
            styles.description
          )}
        >
          {link.label} &rarr;
        </Link>
      )}
    </div>
  );
}

// Pre-configured empty states

export function NoVacanciesEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={Briefcase}
      title="No vacancies yet"
      description="Create your first vacancy to start building your talent pipeline"
      action={{ label: 'Create Vacancy', onClick: onCreate }}
    />
  );
}

export function NoCandidatesEmpty({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={Users}
      title="No candidates yet"
      description="Add candidates to this vacancy from the contacts page"
      action={onAdd ? { label: 'Add Candidate', onClick: onAdd } : undefined}
      link={!onAdd ? { label: 'Go to Contacts', to: '/contacts' } : undefined}
    />
  );
}

export function NoResultsEmpty({ query }: { query: string }) {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description={`No results found for "${query}"`}
      size="sm"
    />
  );
}

export function NoDataEmpty() {
  return (
    <EmptyState
      icon={FileText}
      title="No data"
      description="No data available yet"
    />
  );
}

export function NoEntityVacanciesEmpty({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={Briefcase}
      title="Not applied to any vacancies"
      description="Add this candidate to a vacancy"
      action={onAdd ? { label: 'Add to Vacancy', onClick: onAdd } : undefined}
      size="sm"
    />
  );
}
