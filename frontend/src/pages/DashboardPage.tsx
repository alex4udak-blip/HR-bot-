import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Briefcase,
  UserCheck,
  Clock,
  AlertTriangle,
  ArrowRight,
  Plus,
  Search,
  BarChart3,
  CalendarDays,
} from 'lucide-react';
import clsx from 'clsx';
import api from '@/services/api/client';
import { getCandidatesKanban } from '@/services/api/candidates';
import { getEmployeeReminders } from '@/services/api/employees';
import { useAuthStore } from '@/stores/authStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HRAnalytics {
  vacancies_total: number;
  vacancies_open: number;
  candidates_total: number;
  candidates_in_pipeline: number;
  hires_this_month: number;
  avg_time_to_hire_days: number | null;
}

// Pipeline status config
const PIPELINE_STATUSES = [
  { key: 'new', label: 'Новые', color: 'bg-blue-500' },
  { key: 'screening', label: 'Скрининг', color: 'bg-cyan-500' },
  { key: 'is_interview', label: 'ИС', color: 'bg-purple-500' },
  { key: 'practice', label: 'Практика', color: 'bg-amber-500' },
  { key: 'tech_practice', label: 'Тех-практика', color: 'bg-orange-500' },
  { key: 'offer', label: 'Оффер', color: 'bg-emerald-500' },
  { key: 'hired', label: 'Принят', color: 'bg-green-500' },
  { key: 'rejected', label: 'Отклонён', color: 'bg-red-500' },
] as const;

const STATUS_BADGE_COLORS: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-300',
  screening: 'bg-cyan-500/20 text-cyan-300',
  practice: 'bg-amber-500/20 text-amber-300',
  tech_practice: 'bg-orange-500/20 text-orange-300',
  is_interview: 'bg-purple-500/20 text-purple-300',
  offer: 'bg-emerald-500/20 text-emerald-300',
  hired: 'bg-green-500/20 text-green-300',
  rejected: 'bg-red-500/20 text-red-300',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый',
  screening: 'Скрининг',
  practice: 'Практика',
  tech_practice: 'Тех-практика',
  is_interview: 'ИС',
  offer: 'Оффер',
  hired: 'Принят',
  rejected: 'Отклонён',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate();
  const { hasFeature } = useAuthStore();
  const hasCandidateDatabase = hasFeature('candidate_database');

  // HR overview stats
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['hr-analytics-overview'],
    queryFn: async () => {
      const { data } = await api.get<HRAnalytics>('/analytics/dashboard/overview');
      return data;
    },
    staleTime: 60000,
    enabled: hasCandidateDatabase,
  });

  // Kanban pipeline data
  const { data: kanban, isLoading: kanbanLoading } = useQuery({
    queryKey: ['dashboard-kanban'],
    queryFn: () => getCandidatesKanban(),
    staleTime: 60000,
    enabled: hasCandidateDatabase,
  });

  // Upcoming deadlines (probation etc)
  const { data: reminders } = useQuery({
    queryKey: ['dashboard-reminders'],
    queryFn: getEmployeeReminders,
    staleTime: 120000,
    enabled: hasCandidateDatabase,
  });

  const isLoading = analyticsLoading || kanbanLoading;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Build pipeline counts from kanban columns
  const pipelineCounts: Record<string, number> = {};
  let pipelineTotal = 0;
  if (kanban) {
    for (const col of kanban.columns) {
      pipelineCounts[col.status] = col.count;
      pipelineTotal += col.count;
    }
  }

  // Recent candidates: flatten kanban cards, sort by created_at desc, take 7
  const recentCandidates = kanban
    ? kanban.columns
        .flatMap((col) => col.cards.map((c) => ({ ...c, status: col.status, statusLabel: col.label })))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 7)
    : [];

  // Filter reminders to next 14 days
  const upcomingReminders = (reminders ?? [])
    .filter((r) => r.days_remaining >= 0 && r.days_remaining <= 14)
    .sort((a, b) => a.days_remaining - b.days_remaining);

  // Quick action buttons
  const quickActions = [
    { label: 'Добавить кандидата', icon: Plus, path: '/all-candidates' },
    { label: 'Вакансии', icon: Briefcase, path: '/vacancies' },
    { label: 'Канбан', icon: BarChart3, path: '/candidates' },
    { label: 'Поиск', icon: Search, path: '/all-candidates' },
    { label: 'Практика', icon: CalendarDays, path: '/practice-list' },
  ];

  // Top stats
  const stats = [
    {
      label: 'Кандидаты в работе',
      value: analytics?.candidates_in_pipeline ?? 0,
      icon: Users,
      iconColor: 'text-blue-400',
    },
    {
      label: 'Открытые вакансии',
      value: analytics?.vacancies_open ?? 0,
      icon: Briefcase,
      iconColor: 'text-purple-400',
    },
    {
      label: 'Наймы за месяц',
      value: analytics?.hires_this_month ?? 0,
      icon: UserCheck,
      iconColor: 'text-green-400',
    },
    {
      label: 'Среднее время найма',
      value: analytics?.avg_time_to_hire_days ? `${analytics.avg_time_to_hire_days}д` : '\u2014',
      icon: Clock,
      iconColor: 'text-orange-400',
    },
  ];

  return (
    <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-6">
      <div className="space-y-6 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white/90 mb-1">Дашборд</h1>
          <p className="text-white/40 text-sm">Обзор HR процессов</p>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
            >
              <div className="flex items-center gap-3 mb-3">
                <s.icon className={clsx('w-5 h-5', s.iconColor)} />
                <span className="text-white/40 text-sm">{s.label}</span>
              </div>
              <p className="text-2xl font-bold text-white/90">
                {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Pipeline Overview */}
        {kanban && pipelineTotal > 0 && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white/90">Воронка</h2>
              <span className="text-white/40 text-sm">{pipelineTotal} кандидатов</span>
            </div>

            {/* Horizontal stacked bar */}
            <div className="flex h-8 rounded-lg overflow-hidden mb-4">
              {PIPELINE_STATUSES.map((ps) => {
                const count = pipelineCounts[ps.key] ?? 0;
                if (count === 0) return null;
                const pct = (count / pipelineTotal) * 100;
                return (
                  <div
                    key={ps.key}
                    className={clsx(ps.color, 'flex items-center justify-center text-xs font-medium text-white transition-all')}
                    style={{ width: `${pct}%`, minWidth: pct > 3 ? undefined : '24px' }}
                    title={`${ps.label}: ${count}`}
                  >
                    {pct > 6 ? count : ''}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {PIPELINE_STATUSES.map((ps) => {
                const count = pipelineCounts[ps.key] ?? 0;
                if (count === 0) return null;
                return (
                  <div key={ps.key} className="flex items-center gap-2 text-sm">
                    <div className={clsx('w-2.5 h-2.5 rounded-sm', ps.color)} />
                    <span className="text-white/40">{ps.label}</span>
                    <span className="text-white/70 font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Middle Row: Recent Candidates + Deadlines */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Candidates */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white/90">Недавние кандидаты</h2>
              <button
                onClick={() => navigate('/all-candidates')}
                className="text-white/40 hover:text-white/70 text-sm flex items-center gap-1 transition-colors"
              >
                Все <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {recentCandidates.length === 0 ? (
                <p className="text-white/30 text-sm py-4 text-center">Нет кандидатов</p>
              ) : (
                recentCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-colors cursor-pointer"
                    onClick={() => navigate(`/contacts/${c.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white/90 truncate">{c.name}</p>
                      <p className="text-xs text-white/30 truncate">
                        {c.source ?? 'Без источника'}
                        {c.position ? ` \u00b7 ${c.position}` : ''}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'text-xs px-2 py-0.5 rounded-full whitespace-nowrap',
                        STATUS_BADGE_COLORS[c.status] ?? 'bg-gray-500/20 text-gray-300',
                      )}
                    >
                      {STATUS_LABEL[c.status] ?? c.statusLabel}
                    </span>
                    <span className="text-xs text-white/30 whitespace-nowrap">
                      {formatDate(c.created_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Deadlines */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white/90">Ближайшие дедлайны</h2>
              <button
                onClick={() => navigate('/practice-list')}
                className="text-white/40 hover:text-white/70 text-sm flex items-center gap-1 transition-colors"
              >
                Практика <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {upcomingReminders.length === 0 ? (
                <p className="text-white/30 text-sm py-4 text-center">
                  Нет дедлайнов в ближайшие 14 дней
                </p>
              ) : (
                upcomingReminders.map((r, i) => {
                  const urgent = r.days_remaining <= 3;
                  return (
                    <div
                      key={`${r.employee_id}-${r.type}-${i}`}
                      className={clsx(
                        'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                        urgent
                          ? 'bg-red-500/[0.06] border-red-500/20'
                          : 'bg-white/[0.02] border-white/[0.04]',
                      )}
                    >
                      <AlertTriangle
                        className={clsx('w-4 h-4 flex-shrink-0', urgent ? 'text-red-400' : 'text-amber-400')}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/90 truncate">{r.employee_name}</p>
                        <p className="text-xs text-white/30">
                          {r.type === 'probation_ending' ? 'Конец испытательного' : 'Годовщина'}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={clsx('text-sm font-medium', urgent ? 'text-red-400' : 'text-amber-400')}>
                          {r.days_remaining === 0 ? 'Сегодня' : `${r.days_remaining}д`}
                        </p>
                        <p className="text-xs text-white/30">{formatDate(r.date)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          {quickActions.map((a) => (
            <button
              key={a.path + a.label}
              onClick={() => navigate(a.path)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] text-white/70 hover:text-white/90 hover:border-white/[0.12] text-sm transition-colors"
            >
              <a.icon className="w-4 h-4" />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
