import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Briefcase, Clock, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { getEntityVacancies } from '@/services/api';
import type { VacancyApplication } from '@/types';
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGE_COLORS } from '@/types';
import { ListSkeleton, EmptyState } from '@/components/ui';

interface EntityVacanciesProps {
  entityId: number;
}

export default function EntityVacancies({ entityId }: EntityVacanciesProps) {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<VacancyApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadVacancies = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getEntityVacancies(entityId);
        setApplications(data);
      } catch (err) {
        console.error('Failed to load entity vacancies:', err);
        setError('Не удалось загрузить вакансии');
      } finally {
        setLoading(false);
      }
    };

    loadVacancies();
  }, [entityId]);

  // Format date for display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  // Navigate to vacancy kanban board
  const handleNavigateToVacancy = (vacancyId: number) => {
    navigate(`/vacancies/${vacancyId}`);
  };

  if (loading) {
    return <ListSkeleton count={3} />;
  }

  if (error) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Ошибка загрузки"
        description={error}
        size="sm"
      />
    );
  }

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Нет связанных вакансий"
        description="Добавьте кандидата в вакансию"
        size="sm"
      />
    );
  }

  return (
    <div className="space-y-3">
      {applications.map((app) => (
        <motion.div
          key={app.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => handleNavigateToVacancy(app.vacancy_id)}
          className="p-4 bg-white/5 rounded-xl border border-white/10 cursor-pointer hover:bg-white/10 transition-colors group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="p-2 bg-blue-500/20 rounded-lg flex-shrink-0">
                <Briefcase size={20} className="text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium text-white truncate">
                    {app.vacancy_title || `Вакансия #${app.vacancy_id}`}
                  </h4>
                  <ExternalLink
                    size={14}
                    className="text-white/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx(
                    'text-xs px-2 py-0.5 rounded-full',
                    APPLICATION_STAGE_COLORS[app.stage]
                  )}>
                    {APPLICATION_STAGE_LABELS[app.stage]}
                  </span>
                  {app.source && (
                    <span className="text-xs px-2 py-0.5 bg-white/5 rounded-full text-white/40">
                      {app.source}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <div className="flex items-center gap-1 text-xs text-white/40">
                <Clock size={12} />
                <span>{formatDate(app.applied_at)}</span>
              </div>
              {app.rating && (
                <div className="mt-1 text-xs text-yellow-400">
                  Рейтинг: {app.rating}/5
                </div>
              )}
            </div>
          </div>

          {/* Notes preview */}
          {app.notes && (
            <div className="mt-3 p-2 bg-white/5 rounded-lg text-sm text-white/60 line-clamp-2">
              {app.notes}
            </div>
          )}

          {/* Next interview indicator */}
          {app.next_interview_at && (
            <div className="mt-2 text-xs text-cyan-400">
              Следующее собеседование: {formatDate(app.next_interview_at)}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
