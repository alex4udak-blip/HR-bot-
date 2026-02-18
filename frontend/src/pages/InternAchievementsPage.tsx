import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy,
  ArrowLeft,
  ChevronDown,
  BookOpen,
  Loader,
  Clock,
  Flame,
  Star,
  CheckCircle2,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { MOCK_INTERNS, MOCK_ACHIEVEMENTS } from '@/data/mockInterns';
import { formatDate } from '@/utils';

// Donut chart colors
const COMPLETION_COLORS = ['#10b981', '#f59e0b', '#6b7280'];
const GRADE_COLORS = ['#8b5cf6', '#3b82f6', '#f59e0b', '#ef4444'];
const ENGAGEMENT_COLORS = ['#10b981', '#1f2937'];

function getAvatarInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <span className="font-medium text-sm">{title}</span>
          {badge !== undefined && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white/60">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-white/5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Custom donut chart center label
function DonutCenterLabel({ value, label }: { value: string; label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs text-white/50">{label}</span>
    </div>
  );
}

// Custom tooltip for charts
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

export default function InternAchievementsPage() {
  const { internId } = useParams<{ internId: string }>();
  const navigate = useNavigate();

  const intern = useMemo(
    () => MOCK_INTERNS.find(i => i.id === Number(internId)),
    [internId]
  );
  const achievements = useMemo(
    () => MOCK_ACHIEVEMENTS[Number(internId)],
    [internId]
  );

  if (!intern || !achievements) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-white/10">
          <button
            onClick={() => navigate('/interns')}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm">Назад к списку</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/40">
            <Trophy className="w-16 h-16 mx-auto mb-4 opacity-50 text-amber-400/50" />
            <h3 className="text-lg font-medium mb-2">Практикант не найден</h3>
            <p className="text-sm">Проверьте корректность ссылки</p>
          </div>
        </div>
      </div>
    );
  }

  const { completionStats, gradeStats, engagementLevel } = achievements;
  const totalModules = completionStats.completed + completionStats.inProgress + completionStats.notStarted;

  // Chart data
  const completionData = [
    { name: 'Завершено', value: completionStats.completed, fill: COMPLETION_COLORS[0] },
    { name: 'В процессе', value: completionStats.inProgress, fill: COMPLETION_COLORS[1] },
    { name: 'Не начато', value: completionStats.notStarted, fill: COMPLETION_COLORS[2] },
  ];

  const gradeData = [
    { name: 'Отлично', value: gradeStats.excellent, fill: GRADE_COLORS[0] },
    { name: 'Хорошо', value: gradeStats.good, fill: GRADE_COLORS[1] },
    { name: 'Удовл.', value: gradeStats.satisfactory, fill: GRADE_COLORS[2] },
    { name: 'Нужно улучшить', value: gradeStats.needsImprovement, fill: GRADE_COLORS[3] },
  ].filter(d => d.value > 0);

  const engagementData = [
    { name: 'Вовлечённость', value: engagementLevel, fill: ENGAGEMENT_COLORS[0] },
    { name: 'Остаток', value: 100 - engagementLevel, fill: ENGAGEMENT_COLORS[1] },
  ];

  const completionPercent = Math.round((completionStats.completed / totalModules) * 100);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/interns')}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-white/60" />
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-medium text-sm flex-shrink-0">
              {getAvatarInitials(intern.name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <h1 className="text-lg font-bold truncate">Успехи</h1>
              </div>
              <p className="text-sm text-white/50 truncate">{intern.name} — {intern.position}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Completion Stats Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/5 border border-white/10 rounded-xl p-4"
          >
            <h3 className="text-sm font-medium text-white/70 mb-3 text-center">Статистика прохождения</h3>
            <div className="relative h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={completionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {completionData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <DonutCenterLabel value={`${completionPercent}%`} label="пройдено" />
            </div>
            {/* Legend */}
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
              {completionData.map((item, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs text-white/60">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span>{item.name}: {item.value}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Grades Stats Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/5 border border-white/10 rounded-xl p-4"
          >
            <h3 className="text-sm font-medium text-white/70 mb-3 text-center">Статистика оценок</h3>
            <div className="relative h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={gradeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {gradeData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <DonutCenterLabel value={`${achievements.averageScore.toFixed(1)}`} label="средний балл" />
            </div>
            {/* Legend */}
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
              {gradeData.map((item, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs text-white/60">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span>{item.name}: {item.value}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Engagement Level Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/5 border border-white/10 rounded-xl p-4"
          >
            <h3 className="text-sm font-medium text-white/70 mb-3 text-center">Общий уровень вовлечённости</h3>
            <div className="relative h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={engagementData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={0}
                    dataKey="value"
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {engagementData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <DonutCenterLabel value={`${engagementLevel}%`} label="вовлечённость" />
            </div>
            {/* Engagement indicators */}
            <div className="mt-3 flex justify-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-white/60">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>Серия: {achievements.streak} дн.</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/60">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                <span>Посл. визит: {formatDate(achievements.lastVisit, 'short')}</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Quick stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-white/5 border border-white/10 rounded-xl p-3"
          >
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <Star className="w-4 h-4 text-amber-400" />
              <span className="text-xs">Средний балл</span>
            </div>
            <p className="text-xl font-bold">{achievements.averageScore.toFixed(1)}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white/5 border border-white/10 rounded-xl p-3"
          >
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <Clock className="w-4 h-4 text-blue-400" />
              <span className="text-xs">Время обучения</span>
            </div>
            <p className="text-xl font-bold">{achievements.totalTimeSpent}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="bg-white/5 border border-white/10 rounded-xl p-3"
          >
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-xs">Серия дней</span>
            </div>
            <p className="text-xl font-bold">{achievements.streak} дн.</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white/5 border border-white/10 rounded-xl p-3"
          >
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-xs">Прогресс</span>
            </div>
            <p className="text-xl font-bold">{completionStats.completed}/{totalModules}</p>
          </motion.div>
        </div>

        {/* Collapsible sections */}
        <div className="space-y-3">
          {/* Completed modules */}
          <CollapsibleSection
            title="Какие модули пройдены"
            icon={CheckCircle2}
            badge={achievements.completedModules.length}
            defaultOpen
          >
            <div className="mt-3 space-y-2">
              {achievements.completedModules.map(mod => (
                <div
                  key={mod.id}
                  className="flex items-center justify-between p-2.5 bg-white/5 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-sm truncate">{mod.name}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-white/40">{formatDate(mod.completedDate, 'short')}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      mod.score >= 90 ? 'bg-emerald-500/20 text-emerald-400' :
                      mod.score >= 75 ? 'bg-blue-500/20 text-blue-400' :
                      mod.score >= 60 ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {mod.score}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* In-progress modules */}
          <CollapsibleSection
            title="Модули в процессе"
            icon={Loader}
            badge={achievements.inProgressModules.length}
          >
            <div className="mt-3 space-y-2">
              {achievements.inProgressModules.map(mod => (
                <div
                  key={mod.id}
                  className="p-2.5 bg-white/5 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <BookOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <span className="text-sm truncate">{mod.name}</span>
                    </div>
                    <span className="text-xs text-white/50 flex-shrink-0">{mod.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all"
                      style={{ width: `${mod.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* Activity summary */}
          <CollapsibleSection title="Активность и время" icon={Clock}>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-xs text-white/40 mb-1">Общее время обучения</p>
                <p className="text-sm font-medium">{achievements.totalTimeSpent}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-xs text-white/40 mb-1">Последний визит</p>
                <p className="text-sm font-medium">{formatDate(achievements.lastVisit, 'medium')}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-xs text-white/40 mb-1">Текущая серия</p>
                <p className="text-sm font-medium">{achievements.streak} дней подряд</p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-xs text-white/40 mb-1">Уровень вовлечённости</p>
                <p className="text-sm font-medium">{engagementLevel}%</p>
              </div>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
