import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Search,
  GraduationCap,
  Trophy,
  Info,
  Clock,
  BarChart3,
  GitBranch,
  MessageSquare,
  Download,
  Flame,
  Zap,
  BookOpen,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { formatRelativeTime } from '@/utils';
import { getPrometheusInterns } from '@/services/api';
import type { PrometheusIntern } from '@/services/api';
import InternsAnalyticsTab from '@/components/interns/InternsAnalyticsTab';
import InternsStagesTab from '@/components/interns/InternsStagesTab';

// Tabs for interns section
type InternTab = 'interns' | 'analytics' | 'stages' | 'chats' | 'csv';

const INTERN_TABS: { key: InternTab; label: string; icon: typeof GraduationCap }[] = [
  { key: 'interns', label: 'Практиканты', icon: GraduationCap },
  { key: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { key: 'stages', label: 'Этапы прохождения', icon: GitBranch },
  { key: 'chats', label: 'Чаты', icon: MessageSquare },
  { key: 'csv', label: 'Выгрузка в CSV', icon: Download },
];

function getAvatarInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

// Stub content for non-implemented tabs
function TabStub({ title, icon: Icon }: { title: string; icon: typeof GraduationCap }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-white/40">
        <Icon className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        <p className="text-sm">Раздел в разработке</p>
      </div>
    </div>
  );
}

function formatDaysSinceActive(daysSinceActive: number | null, lastActiveAt: string | null): string {
  if (daysSinceActive === null && lastActiveAt === null) return 'Нет данных';
  if (daysSinceActive === 0) return 'Сегодня';
  if (daysSinceActive === 1) return 'Вчера';
  if (daysSinceActive !== null) {
    return `${daysSinceActive} дн. назад`;
  }
  if (lastActiveAt) return formatRelativeTime(lastActiveAt);
  return 'Нет данных';
}

export default function InternsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<InternTab>('interns');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch interns from Prometheus via backend proxy
  const {
    data: interns = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['prometheus-interns'],
    queryFn: getPrometheusInterns,
    staleTime: 60000, // 1 min
    retry: 1,
  });

  // Filter interns by search query
  const filteredInterns = useMemo(() => {
    if (!searchQuery) return interns;
    const query = searchQuery.toLowerCase();
    return interns.filter(intern =>
      intern.name.toLowerCase().includes(query) ||
      (intern.email && intern.email.toLowerCase().includes(query)) ||
      (intern.telegramUsername && intern.telegramUsername.toLowerCase().includes(query)) ||
      intern.trails.some(t => t.trailName?.toLowerCase().includes(query))
    );
  }, [searchQuery, interns]);

  // Render a single intern card (Prometheus data shape)
  const renderInternCard = (intern: PrometheusIntern) => {
    const totalTrailModules = intern.trails.reduce((s, t) => s + (t.totalModules || 0), 0);
    const completedTrailModules = intern.trails.reduce((s, t) => s + (t.completedModules || 0), 0);

    return (
      <motion.div
        key={intern.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors group overflow-hidden flex flex-col"
      >
        {/* Name + avatar */}
        <div className="flex items-start gap-2 mb-2">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-medium text-sm flex-shrink-0">
            {getAvatarInitials(intern.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{intern.name}</h4>
            {intern.email && (
              <p className="text-xs text-white/50 truncate">{intern.email}</p>
            )}
          </div>
        </div>

        {/* XP + Streak badges */}
        <div className="flex items-center gap-2 mb-2 ml-12">
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full whitespace-nowrap bg-amber-500/20 text-amber-400">
            <Zap className="w-3 h-3" />
            {intern.totalXP} XP
          </span>
          {intern.currentStreak > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full whitespace-nowrap bg-orange-500/20 text-orange-400">
              <Flame className="w-3 h-3" />
              {intern.currentStreak} дн.
            </span>
          )}
        </div>

        {/* Last active */}
        <div className="text-xs text-white/60 ml-12 mb-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 flex-shrink-0" />
            <span>Активность: {formatDaysSinceActive(intern.daysSinceActive, intern.lastActiveAt)}</span>
          </div>
        </div>

        {/* Trails summary */}
        {intern.trails.length > 0 && (
          <div className="mt-1 ml-12 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-white/50 mb-1">
              <BookOpen className="w-3 h-3 flex-shrink-0" />
              <span>Треки ({completedTrailModules}/{totalTrailModules} модулей)</span>
            </div>
            {intern.trails.slice(0, 3).map((trail, idx) => (
              <div key={trail.trailId || idx} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/60 truncate">{trail.trailName || 'Без названия'}</p>
                </div>
                <span className="text-xs text-white/40 whitespace-nowrap">
                  {trail.completedModules ?? 0}/{trail.totalModules ?? 0}
                </span>
              </div>
            ))}
            {intern.trails.length > 3 && (
              <p className="text-xs text-white/30">+{intern.trails.length - 3} ещё</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
          <button
            onClick={() => navigate(`/interns/${intern.id}/achievements`)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <Trophy className="w-3.5 h-3.5" />
            Успехи
          </button>
          <button
            onClick={() => navigate(`/interns/${intern.id}/info`)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
            Информация
          </button>
        </div>
      </motion.div>
    );
  };

  // Loading state
  const renderLoading = () => (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-white/40">
        <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin opacity-50" />
        <h3 className="text-lg font-medium mb-2">Загрузка практикантов...</h3>
        <p className="text-sm">Получаем данные из Prometheus</p>
      </div>
    </div>
  );

  // Error state
  const renderError = () => (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-white/40">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400/60" />
        <h3 className="text-lg font-medium mb-2 text-red-400/80">Ошибка загрузки</h3>
        <p className="text-sm mb-4 max-w-md mx-auto">
          {(error as Error)?.message || 'Не удалось загрузить данные практикантов'}
        </p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 mx-auto px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Попробовать снова
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="px-4 pt-4 border-b border-white/10">
        <div className="flex items-center gap-1 overflow-x-auto pb-0 scrollbar-hide">
          {INTERN_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 -mb-[1px]',
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-white/50 hover:text-white/80 hover:border-white/20'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'interns' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-white/10 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap">
                <GraduationCap className="w-6 h-6 text-emerald-400" />
                База практикантов
                {!isLoading && !isError && (
                  <span className="text-sm font-medium text-white/40 bg-white/5 px-2 py-0.5 rounded-full ml-1">
                    {filteredInterns.length}
                  </span>
                )}
              </h2>
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', isLoading && 'animate-spin')} />
                Обновить
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-emerald-400 transition-colors" />
                <input
                  type="text"
                  placeholder="Поиск по имени, email, трекам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 text-sm transition-all"
                />
              </div>
            </div>
          </div>

          {/* Cards Grid / Loading / Error */}
          <div className="flex-1 overflow-auto p-4">
            {isLoading ? renderLoading() : isError ? renderError() : filteredInterns.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-white/40">
                  <GraduationCap className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium mb-2">
                    {searchQuery ? 'Ничего не найдено' : 'Нет практикантов'}
                  </h3>
                  <p className="text-sm">
                    {searchQuery
                      ? 'Попробуйте изменить параметры поиска'
                      : 'Практиканты появятся здесь после добавления'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredInterns.map(intern => renderInternCard(intern))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'analytics' ? (
        <div className="flex-1 overflow-auto p-4">
          <InternsAnalyticsTab />
        </div>
      ) : activeTab === 'stages' ? (
        <div className="flex-1 overflow-auto p-4">
          <InternsStagesTab />
        </div>
      ) : activeTab === 'chats' ? (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Чаты" icon={MessageSquare} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Выгрузка в CSV" icon={Download} />
        </div>
      )}
    </div>
  );
}
