import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  GraduationCap,
  TrendingUp,
  Star,
  Activity,
  ClipboardCheck,
  ArrowUpDown,
  ChevronDown,
  AtSign,
  Filter,
  X,
  Calendar,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import clsx from 'clsx';
import {
  MOCK_INTERNS,
  MOCK_ACHIEVEMENTS,
  MOCK_INFO,
  STATUS_LABELS,
  STATUS_COLORS,
} from '@/data/mockInterns';
import type { InternStatus, InternInfoData } from '@/data/mockInterns';
import { formatDate } from '@/utils';

// Chart colors
const STATUS_CHART_COLORS: Record<InternStatus, string> = {
  studying: '#3b82f6',
  accepted: '#10b981',
  not_admitted: '#ef4444',
};

const COMPLETION_COLORS = ['#10b981', '#f59e0b', '#6b7280'];
const GRADE_COLORS = ['#8b5cf6', '#3b82f6', '#f59e0b', '#ef4444'];

type SortField = 'name' | 'score' | 'engagement' | 'completed' | 'submittedWorks' | 'registrationDate';
type SortDir = 'asc' | 'desc';

function getSubmittedWorksCount(info: InternInfoData | undefined): number {
  if (!info) return 0;
  return info.works.filter(w => w.status === 'submitted' || w.status === 'reviewed' || w.status === 'returned').length;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { fill: string } }> }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="bg-dark-800 border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.payload.fill }} />
        <span className="text-white/80">{item.name}</span>
        <span className="font-semibold">{item.value}</span>
      </div>
    </div>
  );
}

function DonutCenterLabel({ value, label }: { value: string; label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs text-white/50">{label}</span>
    </div>
  );
}

export default function InternsAnalyticsTab() {
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [telegramSearch, setTelegramSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<InternStatus[]>([]);
  const [minWorks, setMinWorks] = useState('');
  const [maxWorks, setMaxWorks] = useState('');
  const [trailStartFrom, setTrailStartFrom] = useState('');
  const [trailStartTo, setTrailStartTo] = useState('');
  const [trailEndFrom, setTrailEndFrom] = useState('');
  const [trailEndTo, setTrailEndTo] = useState('');
  const [regFrom, setRegFrom] = useState('');
  const [regTo, setRegTo] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (telegramSearch) count++;
    if (selectedStatuses.length > 0) count++;
    if (minWorks || maxWorks) count++;
    if (trailStartFrom || trailStartTo) count++;
    if (trailEndFrom || trailEndTo) count++;
    if (regFrom || regTo) count++;
    return count;
  }, [telegramSearch, selectedStatuses, minWorks, maxWorks, trailStartFrom, trailStartTo, trailEndFrom, trailEndTo, regFrom, regTo]);

  // Filtered interns
  const filteredInterns = useMemo(() => {
    let result = MOCK_INTERNS;

    if (telegramSearch) {
      const q = telegramSearch.toLowerCase();
      result = result.filter(i => i.telegramUsername?.toLowerCase().includes(q));
    }

    if (selectedStatuses.length > 0) {
      result = result.filter(i => selectedStatuses.includes(i.status));
    }

    if (minWorks) {
      const min = parseInt(minWorks, 10);
      if (!isNaN(min)) {
        result = result.filter(i => getSubmittedWorksCount(MOCK_INFO[i.id]) >= min);
      }
    }

    if (maxWorks) {
      const max = parseInt(maxWorks, 10);
      if (!isNaN(max)) {
        result = result.filter(i => getSubmittedWorksCount(MOCK_INFO[i.id]) <= max);
      }
    }

    if (regFrom) {
      result = result.filter(i => i.registrationDate >= regFrom);
    }
    if (regTo) {
      result = result.filter(i => i.registrationDate <= regTo);
    }

    if (trailStartFrom || trailStartTo || trailEndFrom || trailEndTo) {
      result = result.filter(i => {
        const info = MOCK_INFO[i.id];
        if (!info) return false;
        return info.trails.some(t => {
          if (trailStartFrom && t.startDate < trailStartFrom) return false;
          if (trailStartTo && t.startDate > trailStartTo) return false;
          if (trailEndFrom && t.endDate < trailEndFrom) return false;
          if (trailEndTo && t.endDate > trailEndTo) return false;
          return true;
        });
      });
    }

    return result;
  }, [telegramSearch, selectedStatuses, minWorks, maxWorks, trailStartFrom, trailStartTo, trailEndFrom, trailEndTo, regFrom, regTo]);

  // Sorted interns for table
  const sortedInterns = useMemo(() => {
    const sorted = [...filteredInterns];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'score':
          cmp = (MOCK_ACHIEVEMENTS[a.id]?.averageScore ?? 0) - (MOCK_ACHIEVEMENTS[b.id]?.averageScore ?? 0);
          break;
        case 'engagement':
          cmp = (MOCK_ACHIEVEMENTS[a.id]?.engagementLevel ?? 0) - (MOCK_ACHIEVEMENTS[b.id]?.engagementLevel ?? 0);
          break;
        case 'completed':
          cmp = (MOCK_ACHIEVEMENTS[a.id]?.completionStats.completed ?? 0) - (MOCK_ACHIEVEMENTS[b.id]?.completionStats.completed ?? 0);
          break;
        case 'submittedWorks':
          cmp = getSubmittedWorksCount(MOCK_INFO[a.id]) - getSubmittedWorksCount(MOCK_INFO[b.id]);
          break;
        case 'registrationDate':
          cmp = a.registrationDate.localeCompare(b.registrationDate);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredInterns, sortField, sortDir]);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = filteredInterns.length;
    const byStatus: Record<InternStatus, number> = { studying: 0, accepted: 0, not_admitted: 0 };
    let totalScore = 0;
    let totalEngagement = 0;
    let totalCompleted = 0;
    let totalInProgress = 0;
    let totalNotStarted = 0;
    let totalExcellent = 0;
    let totalGood = 0;
    let totalSatisfactory = 0;
    let totalNeedsImprovement = 0;
    let internsWithAchievements = 0;

    filteredInterns.forEach(intern => {
      byStatus[intern.status]++;
      const ach = MOCK_ACHIEVEMENTS[intern.id];
      if (ach) {
        internsWithAchievements++;
        totalScore += ach.averageScore;
        totalEngagement += ach.engagementLevel;
        totalCompleted += ach.completionStats.completed;
        totalInProgress += ach.completionStats.inProgress;
        totalNotStarted += ach.completionStats.notStarted;
        totalExcellent += ach.gradeStats.excellent;
        totalGood += ach.gradeStats.good;
        totalSatisfactory += ach.gradeStats.satisfactory;
        totalNeedsImprovement += ach.gradeStats.needsImprovement;
      }
    });

    const avgScore = internsWithAchievements > 0 ? totalScore / internsWithAchievements : 0;
    const avgEngagement = internsWithAchievements > 0 ? totalEngagement / internsWithAchievements : 0;

    return {
      total,
      byStatus,
      avgScore,
      avgEngagement,
      completion: { completed: totalCompleted, inProgress: totalInProgress, notStarted: totalNotStarted },
      grades: { excellent: totalExcellent, good: totalGood, satisfactory: totalSatisfactory, needsImprovement: totalNeedsImprovement },
    };
  }, [filteredInterns]);

  // Chart data
  const statusChartData = useMemo(() =>
    (Object.keys(stats.byStatus) as InternStatus[])
      .filter(key => stats.byStatus[key] > 0)
      .map(key => ({
        name: STATUS_LABELS[key],
        value: stats.byStatus[key],
        fill: STATUS_CHART_COLORS[key],
      })),
    [stats.byStatus]
  );

  const completionChartData = useMemo(() => [
    { name: 'Завершено', value: stats.completion.completed, fill: COMPLETION_COLORS[0] },
    { name: 'В процессе', value: stats.completion.inProgress, fill: COMPLETION_COLORS[1] },
    { name: 'Не начато', value: stats.completion.notStarted, fill: COMPLETION_COLORS[2] },
  ].filter(d => d.value > 0), [stats.completion]);

  const gradeChartData = useMemo(() => [
    { name: 'Отлично', value: stats.grades.excellent, fill: GRADE_COLORS[0] },
    { name: 'Хорошо', value: stats.grades.good, fill: GRADE_COLORS[1] },
    { name: 'Удовл.', value: stats.grades.satisfactory, fill: GRADE_COLORS[2] },
    { name: 'Нужно улучшить', value: stats.grades.needsImprovement, fill: GRADE_COLORS[3] },
  ].filter(d => d.value > 0), [stats.grades]);

  const engagementBarData = useMemo(() =>
    filteredInterns.map(i => ({
      name: i.name.split(' ').slice(1, 3).join(' '),
      value: MOCK_ACHIEVEMENTS[i.id]?.engagementLevel ?? 0,
      fill: (MOCK_ACHIEVEMENTS[i.id]?.engagementLevel ?? 0) >= 80 ? '#10b981' :
            (MOCK_ACHIEVEMENTS[i.id]?.engagementLevel ?? 0) >= 60 ? '#f59e0b' : '#ef4444',
    })),
    [filteredInterns]
  );

  const totalModules = stats.completion.completed + stats.completion.inProgress + stats.completion.notStarted;
  const completionPercent = totalModules > 0 ? Math.round((stats.completion.completed / totalModules) * 100) : 0;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setTelegramSearch('');
    setSelectedStatuses([]);
    setMinWorks('');
    setMaxWorks('');
    setTrailStartFrom('');
    setTrailStartTo('');
    setTrailEndFrom('');
    setTrailEndTo('');
    setRegFrom('');
    setRegTo('');
  };

  const toggleStatus = (status: InternStatus) => {
    setSelectedStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-all active:scale-95',
              activeFiltersCount > 0
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            )}
          >
            <Filter className="w-4 h-4" />
            <span>Фильтры</span>
            {activeFiltersCount > 0 && (
              <span className="px-1.5 py-0.5 bg-emerald-600 text-white text-[10px] rounded-full">
                {activeFiltersCount}
              </span>
            )}
          </button>
          {activeFiltersCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Сбросить
            </button>
          )}
        </div>

        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-4 overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Telegram search */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Telegram-никнейм</label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    placeholder="@username"
                    value={telegramSearch}
                    onChange={e => setTelegramSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Status filter */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Статус кандидата</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_LABELS) as InternStatus[]).map(status => (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={clsx(
                        'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                        selectedStatuses.includes(status)
                          ? STATUS_COLORS[status] + ' border-current'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                      )}
                    >
                      {STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submitted works range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Сданные работы (кол-во)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="от"
                    min="0"
                    value={minWorks}
                    onChange={e => setMinWorks(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="number"
                    placeholder="до"
                    min="0"
                    value={maxWorks}
                    onChange={e => setMaxWorks(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Trail start date range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Дата начала трейла
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={trailStartFrom}
                    onChange={e => setTrailStartFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="date"
                    value={trailStartTo}
                    onChange={e => setTrailStartTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Trail end date range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Дата окончания трейла
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={trailEndFrom}
                    onChange={e => setTrailEndFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="date"
                    value={trailEndTo}
                    onChange={e => setTrailEndTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Registration date range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Дата регистрации
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={regFrom}
                    onChange={e => setRegFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="date"
                    value={regTo}
                    onChange={e => setRegTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <Users className="w-4 h-4 text-emerald-400" />
            <span className="text-xs">Всего</span>
          </div>
          <p className="text-xl font-bold">{stats.total}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <GraduationCap className="w-4 h-4 text-blue-400" />
            <span className="text-xs">Обучается</span>
          </div>
          <p className="text-xl font-bold text-blue-400">{stats.byStatus.studying}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-xs">Принят</span>
          </div>
          <p className="text-xl font-bold text-emerald-400">{stats.byStatus.accepted}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <X className="w-4 h-4 text-red-400" />
            <span className="text-xs">Недопущен</span>
          </div>
          <p className="text-xl font-bold text-red-400">{stats.byStatus.not_admitted}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <Star className="w-4 h-4 text-amber-400" />
            <span className="text-xs">Средний балл</span>
          </div>
          <p className="text-xl font-bold">{stats.avgScore.toFixed(1)}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <Activity className="w-4 h-4 text-purple-400" />
            <span className="text-xs">Вовлечённость</span>
          </div>
          <p className="text-xl font-bold">{Math.round(stats.avgEngagement)}%</p>
        </motion.div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status Distribution */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white/70 mb-3 text-center">По статусам</h3>
          {statusChartData.length > 0 ? (
            <>
              <div className="relative h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value" stroke="none">
                      {statusChartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenterLabel value={String(stats.total)} label="всего" />
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {statusChartData.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-white/60">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span>{item.name}: {item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-white/30 text-sm">Нет данных</div>
          )}
        </motion.div>

        {/* Grade Distribution */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white/70 mb-3 text-center">Статистика оценок</h3>
          {gradeChartData.length > 0 ? (
            <>
              <div className="relative h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gradeChartData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value" stroke="none">
                      {gradeChartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenterLabel value={stats.avgScore.toFixed(1)} label="ср. балл" />
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {gradeChartData.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-white/60">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span>{item.name}: {item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-white/30 text-sm">Нет данных</div>
          )}
        </motion.div>

        {/* Completion Progress */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white/70 mb-3 text-center">Прогресс модулей</h3>
          {completionChartData.length > 0 ? (
            <>
              <div className="relative h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={completionChartData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value" stroke="none">
                      {completionChartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenterLabel value={`${completionPercent}%`} label="пройдено" />
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {completionChartData.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-white/60">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span>{item.name}: {item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-white/30 text-sm">Нет данных</div>
          )}
        </motion.div>

        {/* Engagement Bar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white/70 mb-3 text-center">Вовлечённость</h3>
          {engagementBarData.length > 0 ? (
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={engagementBarData} layout="vertical" margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#2d2d3a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                    formatter={(value: number) => [`${value}%`, 'Вовлечённость']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                    {engagementBarData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[190px] flex items-center justify-center text-white/30 text-sm">Нет данных</div>
          )}
        </motion.div>
      </div>

      {/* Summary Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-emerald-400" />
            Сводная таблица
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-white/10 text-white/50">{sortedInterns.length}</span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <SortableHeader label="Имя" field="name" current={sortField} dir={sortDir} onClick={handleSort} />
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Telegram</th>
                <SortableHeader label="Статус" field="name" current={sortField} dir={sortDir} onClick={() => {}} noSort />
                <SortableHeader label="Балл" field="score" current={sortField} dir={sortDir} onClick={handleSort} />
                <SortableHeader label="Вовлечённость" field="engagement" current={sortField} dir={sortDir} onClick={handleSort} />
                <SortableHeader label="Модули" field="completed" current={sortField} dir={sortDir} onClick={handleSort} />
                <SortableHeader label="Работ сдано" field="submittedWorks" current={sortField} dir={sortDir} onClick={handleSort} />
                <SortableHeader label="Регистрация" field="registrationDate" current={sortField} dir={sortDir} onClick={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedInterns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-white/30">
                    Нет данных по выбранным фильтрам
                  </td>
                </tr>
              ) : (
                sortedInterns.map(intern => {
                  const ach = MOCK_ACHIEVEMENTS[intern.id];
                  const info = MOCK_INFO[intern.id];
                  const submitted = getSubmittedWorksCount(info);
                  const totalMods = ach ? ach.completionStats.completed + ach.completionStats.inProgress + ach.completionStats.notStarted : 0;

                  return (
                    <tr key={intern.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-medium truncate max-w-[180px]">{intern.name}</td>
                      <td className="px-4 py-3 text-white/60">{intern.telegramUsername || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('px-2 py-0.5 text-xs rounded-full', STATUS_COLORS[intern.status])}>
                          {STATUS_LABELS[intern.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('font-medium', {
                          'text-emerald-400': (ach?.averageScore ?? 0) >= 90,
                          'text-blue-400': (ach?.averageScore ?? 0) >= 75 && (ach?.averageScore ?? 0) < 90,
                          'text-amber-400': (ach?.averageScore ?? 0) >= 60 && (ach?.averageScore ?? 0) < 75,
                          'text-red-400': (ach?.averageScore ?? 0) < 60 && (ach?.averageScore ?? 0) > 0,
                        })}>
                          {ach?.averageScore.toFixed(1) ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={clsx('h-full rounded-full', {
                                'bg-emerald-400': (ach?.engagementLevel ?? 0) >= 80,
                                'bg-amber-400': (ach?.engagementLevel ?? 0) >= 60 && (ach?.engagementLevel ?? 0) < 80,
                                'bg-red-400': (ach?.engagementLevel ?? 0) < 60,
                              })}
                              style={{ width: `${ach?.engagementLevel ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-white/50">{ach?.engagementLevel ?? 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        {ach ? `${ach.completionStats.completed}/${totalMods}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-white/60">{submitted}</td>
                      <td className="px-4 py-3 text-white/50 text-xs">{formatDate(intern.registrationDate, 'short')}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

function SortableHeader({
  label,
  field,
  current,
  dir,
  onClick,
  noSort,
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onClick: (field: SortField) => void;
  noSort?: boolean;
}) {
  const isActive = current === field && !noSort;
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-white/40">
      {noSort ? (
        <span>{label}</span>
      ) : (
        <button
          onClick={() => onClick(field)}
          className={clsx(
            'flex items-center gap-1 transition-colors',
            isActive ? 'text-white/80' : 'hover:text-white/60'
          )}
        >
          {label}
          <ArrowUpDown className={clsx('w-3 h-3', isActive ? 'text-emerald-400' : 'text-white/20')} />
          {isActive && (
            <ChevronDown className={clsx('w-3 h-3 text-emerald-400 transition-transform', dir === 'asc' ? 'rotate-180' : '')} />
          )}
        </button>
      )}
    </th>
  );
}
