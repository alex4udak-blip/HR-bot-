import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Info,
  ArrowLeft,
  Mail,
  AtSign,
  User,
  Calendar,
  GitBranch,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Zap,
  Star,
  Flame,
  Award,
  Loader2,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  FileCheck,
  TrendingUp,
} from 'lucide-react';
import clsx from 'clsx';
import { getStudentAchievements, getPrometheusInterns } from '@/services/api';
import type { StudentTrailProgress, Certificate } from '@/services/api';
import { formatDate } from '@/utils';

function getAvatarInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: 'Студент',
  TEACHER: 'Преподаватель',
  HR: 'HR',
  CO_ADMIN: 'Со-админ',
  ADMIN: 'Администратор',
};

// Paginated scrollable list component
const ITEMS_PER_PAGE = 3;

function PaginatedList<T>({
  title,
  icon: Icon,
  items,
  renderItem,
  emptyText,
}: {
  title: string;
  icon: typeof GitBranch;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const pagedItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col h-full">
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-blue-400" />
          <h4 className="text-sm font-medium">{title}</h4>
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-white/10 text-white/50">
            {items.length}
          </span>
        </div>
      </div>

      <div className="flex-1 p-3 space-y-2 min-h-0">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/30 text-sm py-6">
            {emptyText}
          </div>
        ) : (
          pagedItems.map(renderItem)
        )}
      </div>

      {totalPages > 1 && (
        <div className="p-2 border-t border-white/5 flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4 text-white/50" />
          </button>
          <span className="text-xs text-white/40">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4 text-white/50" />
          </button>
        </div>
      )}
    </div>
  );
}

function MetaCard({
  icon: Icon,
  label,
  value,
  valueColor,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 text-white/40 mb-1">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <p className={clsx('text-sm font-medium truncate', valueColor)} title={value}>{value}</p>
    </div>
  );
}

function TrailItem({ trail }: { trail: StudentTrailProgress }) {
  return (
    <div className="p-2.5 bg-white/5 rounded-lg">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium truncate">{trail.trailTitle}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {trail.completionPercent === 100 ? (
            <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Завершён
            </span>
          ) : (
            <span className="text-xs text-white/50">{trail.completionPercent}%</span>
          )}
        </div>
      </div>
      {trail.completionPercent < 100 ? (
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', {
              'bg-emerald-400': trail.completionPercent >= 80,
              'bg-amber-400': trail.completionPercent >= 50 && trail.completionPercent < 80,
              'bg-blue-400': trail.completionPercent < 50,
            })}
            style={{ width: `${trail.completionPercent}%` }}
          />
        </div>
      ) : (
        <div className="text-xs text-emerald-400/70">100% завершён</div>
      )}
      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30">
        <span>{trail.completedModules}/{trail.totalModules} модулей</span>
        <span>Начало: {formatDate(trail.enrolledAt, 'short')}</span>
      </div>
    </div>
  );
}

function CertificateItem({ cert }: { cert: Certificate }) {
  return (
    <div className="p-2.5 bg-white/5 rounded-lg flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: cert.trail.color ? `${cert.trail.color}20` : 'rgba(255,255,255,0.1)' }}
      >
        <Award className="w-4 h-4" style={{ color: cert.trail.color || '#f59e0b' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{cert.trail.title}</span>
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', {
            'bg-emerald-500/20 text-emerald-400': cert.level === 'Senior',
            'bg-blue-500/20 text-blue-400': cert.level === 'Middle',
            'bg-gray-500/20 text-gray-400': cert.level === 'Junior',
          })}>
            {cert.level}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-white/30">
          <span>Код: {cert.code}</span>
          <span>{formatDate(cert.issuedAt, 'short')}</span>
        </div>
      </div>
    </div>
  );
}

export default function InternInfoPage() {
  const { internId } = useParams<{ internId: string }>();
  const navigate = useNavigate();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['student-achievements', internId],
    queryFn: () => getStudentAchievements(internId!),
    enabled: !!internId,
    staleTime: 60000,
    retry: 1,
  });

  // Pull telegram username from cached interns list
  const { data: interns } = useQuery({
    queryKey: ['prometheus-interns'],
    queryFn: getPrometheusInterns,
    staleTime: 300000,
    retry: 0,
  });
  const internFromList = interns?.find(i => i.id === internId);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-white/10">
          <button onClick={() => navigate('/interns')} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm">Назад к списку</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/40">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin opacity-50" />
            <h3 className="text-lg font-medium mb-2">Загрузка информации...</h3>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-white/10">
          <button onClick={() => navigate('/interns')} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm">Назад к списку</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/40">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400/60" />
            <h3 className="text-lg font-medium mb-2 text-red-400/80">
              {(error as Error)?.message?.includes('404') ? 'Студент не найден' : 'Ошибка загрузки'}
            </h3>
            <p className="text-sm mb-4">{(error as Error)?.message || 'Не удалось загрузить данные'}</p>
            <button onClick={() => refetch()} className="flex items-center gap-2 mx-auto px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors">
              <RefreshCw className="w-4 h-4" />
              Попробовать снова
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { student, submissionStats, trailProgress, certificates } = data;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/interns')} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-white/60" />
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-medium text-sm flex-shrink-0">
              {getAvatarInitials(student.name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <h1 className="text-lg font-bold truncate">Информация</h1>
              </div>
              <p className="text-sm text-white/50 truncate">{student.name}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Meta information cards */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h3 className="text-sm font-medium text-white/50 mb-3">Личные данные</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetaCard icon={User} label="ФИО" value={student.name} />
            <MetaCard icon={Mail} label="Email" value={student.email || '—'} />
            <MetaCard icon={AtSign} label="Telegram" value={internFromList?.telegramUsername || '—'} />
            <MetaCard icon={User} label="Роль" value={ROLE_LABELS[student.role] || student.role} />
            <MetaCard icon={Calendar} label="Регистрация" value={formatDate(student.registeredAt, 'medium')} />
            <MetaCard icon={Calendar} label="Последняя активность" value={formatDate(student.lastActiveAt, 'medium')} />
            <MetaCard
              icon={AlertTriangle}
              label="Дней без активности"
              value={`${student.daysSinceActive} дн.`}
              valueColor={
                student.daysSinceActive <= 3 ? 'text-emerald-400' :
                student.daysSinceActive <= 7 ? 'text-amber-400' :
                'text-red-400'
              }
            />
            <MetaCard icon={Star} label="Позиция в рейтинге" value={`#${student.leaderboardRank}`} />
          </div>
        </motion.div>

        {/* Stats cards row */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h3 className="text-sm font-medium text-white/50 mb-3">Статистика</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-2 text-white/50 mb-1">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-xs">XP</span>
              </div>
              <p className="text-xl font-bold">{student.totalXP}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-2 text-white/50 mb-1">
                <Flame className="w-4 h-4 text-orange-400" />
                <span className="text-xs">Серия</span>
              </div>
              <p className="text-xl font-bold">{student.currentStreak} дн.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-2 text-white/50 mb-1">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span className="text-xs">Модулей</span>
              </div>
              <p className="text-xl font-bold">{student.modulesCompleted}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-2 text-white/50 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs">Одобрено</span>
              </div>
              <p className="text-xl font-bold">{submissionStats.approved}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-2 text-white/50 mb-1">
                <TrendingUp className="w-4 h-4 text-purple-400" />
                <span className="text-xs">Всего работ</span>
              </div>
              <p className="text-xl font-bold">{submissionStats.total}</p>
            </div>
          </div>
        </motion.div>

        {/* Submission stats breakdown */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h3 className="text-sm font-medium text-white/50 mb-3">Статус работ</h3>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <SubmissionBadge label="Одобрено" count={submissionStats.approved} color="bg-emerald-500/20 text-emerald-400" icon={CheckCircle2} />
              <SubmissionBadge label="На проверке" count={submissionStats.pending} color="bg-amber-500/20 text-amber-400" icon={FileCheck} />
              <SubmissionBadge label="На доработке" count={submissionStats.revision} color="bg-purple-500/20 text-purple-400" icon={ClipboardCheck} />
              {submissionStats.failed > 0 && (
                <SubmissionBadge label="Отклонено" count={submissionStats.failed} color="bg-red-500/20 text-red-400" icon={AlertTriangle} />
              )}
            </div>
            {submissionStats.total > 0 && (
              <div className="mt-3">
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden flex">
                  {submissionStats.approved > 0 && (
                    <div className="h-full bg-emerald-400" style={{ width: `${(submissionStats.approved / submissionStats.total) * 100}%` }} />
                  )}
                  {submissionStats.pending > 0 && (
                    <div className="h-full bg-amber-400" style={{ width: `${(submissionStats.pending / submissionStats.total) * 100}%` }} />
                  )}
                  {submissionStats.revision > 0 && (
                    <div className="h-full bg-purple-400" style={{ width: `${(submissionStats.revision / submissionStats.total) * 100}%` }} />
                  )}
                  {submissionStats.failed > 0 && (
                    <div className="h-full bg-red-400" style={{ width: `${(submissionStats.failed / submissionStats.total) * 100}%` }} />
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Trails and Certificates lists */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h3 className="text-sm font-medium text-white/50 mb-3">Детальная информация</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PaginatedList
              title="Записан на трейлы"
              icon={GitBranch}
              items={trailProgress}
              emptyText="Нет трейлов"
              renderItem={(trail: StudentTrailProgress) => (
                <TrailItem key={trail.trailId} trail={trail} />
              )}
            />

            <PaginatedList
              title="Сертификаты"
              icon={Award}
              items={certificates}
              emptyText="Нет сертификатов"
              renderItem={(cert: Certificate) => (
                <CertificateItem key={cert.id} cert={cert} />
              )}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function SubmissionBadge({
  label,
  count,
  color,
  icon: Icon,
}: {
  label: string;
  count: number;
  color: string;
  icon: typeof CheckCircle2;
}) {
  return (
    <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg', color)}>
      <Icon className="w-4 h-4" />
      <span className="text-sm font-medium">{count}</span>
      <span className="text-xs opacity-80">{label}</span>
    </div>
  );
}
