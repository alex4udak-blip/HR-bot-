import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Users,
  Briefcase,
  Target,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/authStore';
import { ErrorMessage } from '@/components/ui';
import api from '@/services/api/client';

// Types
interface DashboardOverview {
  vacancies_total: number;
  vacancies_open: number;
  vacancies_draft: number;
  vacancies_closed_this_month: number;
  candidates_total: number;
  candidates_new_this_month: number;
  candidates_in_pipeline: number;
  applications_total: number;
  applications_this_month: number;
  hires_this_month: number;
  hires_this_quarter: number;
  avg_time_to_hire_days: number | null;
  rejections_this_month: number;
}

interface TrendDataPoint {
  date: string;
  value: number;
}

interface DashboardTrends {
  applications_trend: TrendDataPoint[];
  hires_trend: TrendDataPoint[];
  vacancies_trend: TrendDataPoint[];
}

interface FunnelStage {
  stage: string;
  label: string;
  count: number;
  percentage: number;
  conversion_from_previous: number | null;
}

interface FunnelData {
  stages: FunnelStage[];
  total_applications: number;
  total_hires: number;
  overall_conversion: number;
  rejected_count: number;
  withdrawn_count: number;
}

interface PipelineHealth {
  total_in_pipeline: number;
  stuck_candidates: number;
  high_score_waiting: number;
  urgent_vacancies_without_candidates: number;
  stages_health: Record<string, { label: string; count: number; avg_days_in_stage: number; is_bottleneck: boolean }>;
}

interface DepartmentSummary {
  id: number;
  name: string;
  vacancies: number;
  open_vacancies: number;
  applications: number;
  hires: number;
}

export default function AnalyticsPage() {
  useAuthStore();

  // State
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [, setTrends] = useState<DashboardTrends | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealth | null>(null);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedDepartment, setSelectedDepartment] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState(30);

  // Load data
  useEffect(() => {
    loadData();
  }, [selectedDepartment, dateRange]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const params = {
        department_id: selectedDepartment || undefined,
        days: dateRange,
      };

      const [overviewRes, trendsRes, funnelRes, healthRes, deptsRes] = await Promise.all([
        api.get<DashboardOverview>('/analytics/dashboard/overview', { params }),
        api.get<DashboardTrends>('/analytics/dashboard/trends', { params }),
        api.get<FunnelData>('/analytics/funnel/overview', { params }),
        api.get<PipelineHealth>('/analytics/funnel/health', { params }),
        api.get<DepartmentSummary[]>('/analytics/dashboard/departments-summary'),
      ]);

      setOverview(overviewRes.data);
      setTrends(trendsRes.data);
      setFunnel(funnelRes.data);
      setPipelineHealth(healthRes.data);
      setDepartments(deptsRes.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics');
      toast.error('Ошибка загрузки аналитики');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && !overview) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !overview) {
    return <ErrorMessage error={error} onRetry={loadData} />;
  }

  return (
    <div className="h-full flex flex-col bg-dark-900 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-dark-700 sticky top-0 bg-dark-900 z-10">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-accent-500" />
          <h1 className="text-xl font-semibold text-white">HR Аналитика</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Department filter */}
          <select
            value={selectedDepartment || ''}
            onChange={(e) => setSelectedDepartment(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-accent-500"
          >
            <option value="">Все отделы</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>

          {/* Date range filter */}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(Number(e.target.value))}
            className="px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-accent-500"
          >
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
          </select>

          {/* Refresh */}
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
          >
            <RefreshCw size={18} className={clsx(isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Key Metrics */}
        {overview && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Ключевые метрики</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <MetricCard
                icon={Briefcase}
                label="Открыто вакансий"
                value={overview.vacancies_open}
                subtext={`из ${overview.vacancies_total} всего`}
                color="blue"
              />
              <MetricCard
                icon={Users}
                label="Кандидатов в работе"
                value={overview.candidates_in_pipeline}
                subtext={`+${overview.candidates_new_this_month} за месяц`}
                color="purple"
              />
              <MetricCard
                icon={Target}
                label="Заявок за месяц"
                value={overview.applications_this_month}
                subtext={`${overview.applications_total} всего`}
                color="green"
              />
              <MetricCard
                icon={CheckCircle}
                label="Наймов за месяц"
                value={overview.hires_this_month}
                subtext={`${overview.hires_this_quarter} за квартал`}
                color="emerald"
              />
              <MetricCard
                icon={Clock}
                label="Время найма"
                value={overview.avg_time_to_hire_days ? `${overview.avg_time_to_hire_days}д` : '—'}
                subtext="в среднем"
                color="amber"
              />
              <MetricCard
                icon={XCircle}
                label="Отказов за месяц"
                value={overview.rejections_this_month}
                color="red"
              />
            </div>
          </section>
        )}

        {/* Hiring Funnel */}
        {funnel && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Воронка найма</h2>
            <div className="bg-dark-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <span className="text-2xl font-bold text-white">{funnel.total_applications}</span>
                <span className="text-dark-400">заявок →</span>
                <span className="text-2xl font-bold text-green-400">{funnel.total_hires}</span>
                <span className="text-dark-400">наймов</span>
                <span className="px-2 py-1 bg-green-500/20 text-green-400 text-sm rounded ml-2">
                  {funnel.overall_conversion}% конверсия
                </span>
              </div>

              <div className="space-y-3">
                {funnel.stages.map((stage, index) => (
                  <div key={stage.stage} className="flex items-center gap-4">
                    <div className="w-24 text-sm text-dark-400">{stage.label}</div>
                    <div className="flex-1 h-8 bg-dark-700 rounded-lg overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${stage.percentage}%` }}
                        transition={{ duration: 0.5, delay: index * 0.1 }}
                        className={clsx(
                          'h-full rounded-lg',
                          stage.stage === 'hired'
                            ? 'bg-green-500'
                            : stage.stage === 'rejected'
                            ? 'bg-red-500'
                            : 'bg-accent-500'
                        )}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-white">
                        {stage.count}
                      </span>
                    </div>
                    <div className="w-20 text-right">
                      {stage.conversion_from_previous !== null && (
                        <span className="text-sm text-dark-400">
                          {stage.conversion_from_previous}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Rejected/Withdrawn */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-dark-700">
                <div className="flex items-center gap-2 text-sm text-dark-400">
                  <XCircle size={14} className="text-red-400" />
                  <span>Отказано: {funnel.rejected_count}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-dark-400">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <span>Отозвано: {funnel.withdrawn_count}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Pipeline Health */}
        {pipelineHealth && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Здоровье пайплайна</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-dark-800 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-5 h-5 text-accent-500" />
                  <span className="text-dark-400 text-sm">В работе</span>
                </div>
                <span className="text-2xl font-bold text-white">
                  {pipelineHealth.total_in_pipeline}
                </span>
              </div>

              <div className="p-4 bg-dark-800 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <span className="text-dark-400 text-sm">Застряли (&gt;14 дней)</span>
                </div>
                <span
                  className={clsx(
                    'text-2xl font-bold',
                    pipelineHealth.stuck_candidates > 0 ? 'text-amber-400' : 'text-white'
                  )}
                >
                  {pipelineHealth.stuck_candidates}
                </span>
              </div>

              <div className="p-4 bg-dark-800 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-5 h-5 text-green-500" />
                  <span className="text-dark-400 text-sm">Высокий скор ждёт</span>
                </div>
                <span
                  className={clsx(
                    'text-2xl font-bold',
                    pipelineHealth.high_score_waiting > 0 ? 'text-green-400' : 'text-white'
                  )}
                >
                  {pipelineHealth.high_score_waiting}
                </span>
              </div>

              <div className="p-4 bg-dark-800 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Briefcase className="w-5 h-5 text-red-500" />
                  <span className="text-dark-400 text-sm">Срочные без кандидатов</span>
                </div>
                <span
                  className={clsx(
                    'text-2xl font-bold',
                    pipelineHealth.urgent_vacancies_without_candidates > 0
                      ? 'text-red-400'
                      : 'text-white'
                  )}
                >
                  {pipelineHealth.urgent_vacancies_without_candidates}
                </span>
              </div>
            </div>

            {/* Stage Health */}
            <div className="mt-4 p-4 bg-dark-800 rounded-xl">
              <h3 className="text-sm font-medium text-dark-400 mb-3">Среднее время на этапе</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {Object.entries(pipelineHealth.stages_health).map(([stage, data]) => (
                  <div
                    key={stage}
                    className={clsx(
                      'p-3 rounded-lg border',
                      data.is_bottleneck
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-dark-700 border-dark-600'
                    )}
                  >
                    <div className="text-xs text-dark-400 mb-1">{data.label}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-semibold text-white">{data.count}</span>
                      <span className="text-xs text-dark-400">чел.</span>
                    </div>
                    <div className="text-xs text-dark-400">
                      ~{data.avg_days_in_stage}д в среднем
                    </div>
                    {data.is_bottleneck && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded">
                        bottleneck
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Departments Summary */}
        {departments.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">По отделам</h2>
            <div className="bg-dark-800 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-700">
                    <th className="px-4 py-3 text-left text-sm font-medium text-dark-400">Отдел</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-dark-400">
                      Вакансий
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-dark-400">
                      Открыто
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-dark-400">
                      Заявок
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-dark-400">
                      Наймов
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-dark-400">
                      Конверсия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept) => {
                    const conversion =
                      dept.applications > 0
                        ? ((dept.hires / dept.applications) * 100).toFixed(1)
                        : '0';
                    return (
                      <tr key={dept.id} className="border-b border-dark-700 last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 size={16} className="text-dark-400" />
                            <span className="text-white">{dept.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-dark-300">{dept.vacancies}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-1 bg-accent-500/20 text-accent-400 text-sm rounded">
                            {dept.open_vacancies}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-dark-300">{dept.applications}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-green-400 font-medium">{dept.hires}</span>
                        </td>
                        <td className="px-4 py-3 text-center text-dark-300">{conversion}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  color = 'blue',
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subtext?: string;
  color?: 'blue' | 'purple' | 'green' | 'emerald' | 'amber' | 'red';
}) {
  const colorClasses = {
    blue: 'bg-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/20 text-purple-400',
    green: 'bg-green-500/20 text-green-400',
    emerald: 'bg-emerald-500/20 text-emerald-400',
    amber: 'bg-amber-500/20 text-amber-400',
    red: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="p-4 bg-dark-800 rounded-xl">
      <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colorClasses[color])}>
        <Icon size={20} />
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-sm text-dark-400">{label}</div>
      {subtext && <div className="text-xs text-dark-500 mt-1">{subtext}</div>}
    </div>
  );
}
