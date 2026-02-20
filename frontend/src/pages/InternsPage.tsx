import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Search,
  GraduationCap,
  BarChart3,
  Clock,
  GitBranch,
  Download,
  Zap,
  BookOpen,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { formatRelativeTime } from '@/utils';
import { getPrometheusInterns } from '@/services/api';
import type { PrometheusIntern } from '@/services/api';
import InternsAnalyticsTab from '@/components/interns/InternsAnalyticsTab';
import InternsStagesTab from '@/components/interns/InternsStagesTab';

// Tabs for interns section
type InternTab = 'interns' | 'analytics' | 'stages' | 'csv';

const INTERN_TABS: { key: InternTab; label: string; icon: typeof GraduationCap }[] = [
  { key: 'interns', label: 'Практиканты', icon: GraduationCap },
  { key: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { key: 'stages', label: 'Этапы прохождения', icon: GitBranch },
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
  const [selectedTrailFilter, setSelectedTrailFilter] = useState('all');

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

  // Build a global trailId -> trailName lookup from all interns
  const trailNameMap = useMemo(() => {
    const map = new Map<string, string>();
    interns.forEach(intern => {
      intern.trails.forEach(t => {
        if (t.trailId && t.trailName && t.trailName.trim() && !map.has(t.trailId)) {
          map.set(t.trailId, t.trailName);
        }
      });
    });
    return map;
  }, [interns]);

  // Extract unique trails for filter dropdown
  const availableTrails = useMemo(() => {
    return Array.from(trailNameMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [trailNameMap]);

  // Filter interns by search query and trail
  const filteredInterns = useMemo(() => {
    let result = interns;

    // Filter by selected trail
    if (selectedTrailFilter !== 'all') {
      result = result.filter(intern =>
        intern.trails.some(t => t.trailId === selectedTrailFilter)
      );
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(intern =>
        intern.name.toLowerCase().includes(query) ||
        (intern.email && intern.email.toLowerCase().includes(query)) ||
        (intern.telegramUsername && intern.telegramUsername.toLowerCase().includes(query)) ||
        intern.trails.some(t => t.trailName?.toLowerCase().includes(query))
      );
    }

    return result;
  }, [searchQuery, selectedTrailFilter, interns]);

  // Render a single intern card (Prometheus data shape)
  const renderInternCard = (intern: PrometheusIntern) => {
    // Determine which trail to display based on the filter
    const namedTrails = intern.trails.filter(t => t.trailName && t.trailName.trim());

    // If a specific trail is selected in the filter, show that trail's data
    // Otherwise, auto-detect the "current" trail
    const displayTrail = selectedTrailFilter !== 'all'
      ? intern.trails.find(t => t.trailId === selectedTrailFilter) || null
      : (namedTrails.find(t => t.completedModules > 0 && t.completedModules < t.totalModules)
        || namedTrails.find(t => t.completedModules > 0)
        || namedTrails[0]
        || intern.trails[0]
        || null);

    // Module counts and progress based on the display trail
    const completedModules = displayTrail ? (displayTrail.completedModules || 0) : 0;
    const totalModules = displayTrail ? (displayTrail.totalModules || 0) : 0;
    const completionPercent = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

    // Resolve trail name
    const trailDisplayName = displayTrail
      ? (displayTrail.trailName?.trim()
        || trailNameMap.get(displayTrail.trailId)
        || 'Без названия')
      : null;

    return (
      <motion.div
        key={intern.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => navigate(`/interns/${intern.id}/stats`)}
        className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors group overflow-hidden flex flex-col cursor-pointer"
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

        {/* XP badge */}
        <div className="flex items-center gap-2 mb-2 ml-12">
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full whitespace-nowrap bg-amber-500/20 text-amber-400">
            <Zap className="w-3 h-3" />
            {intern.totalXP} XP
          </span>
        </div>

        {/* Last active */}
        <div className="text-xs text-white/60 ml-12 mb-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 flex-shrink-0" />
            <span>Активность: {formatDaysSinceActive(intern.daysSinceActive, intern.lastActiveAt)}</span>
          </div>
        </div>

        {/* Module progress summary */}
        {displayTrail ? (
          <div className="mt-1 ml-12 space-y-1.5">
            {/* Trail name */}
            <div className="flex items-center gap-1.5">
              <GitBranch className="w-3 h-3 text-blue-400 flex-shrink-0" />
              <span className="text-xs text-white/50 truncate">
                {trailDisplayName}
              </span>
            </div>

            {/* Modules progress for the trail */}
            <div className="flex items-center gap-2">
              <BookOpen className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="text-xs text-white/70 font-medium">
                Модулей: {completedModules}/{totalModules}
              </span>
              <span className="text-xs text-white/40">({completionPercent}%)</span>
            </div>

            {/* Progress bar for the trail */}
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={clsx('h-full rounded-full transition-all', {
                  'bg-emerald-400': completionPercent >= 80,
                  'bg-amber-400': completionPercent >= 50 && completionPercent < 80,
                  'bg-blue-400': completionPercent < 50,
                })}
                style={{ width: `${completionPercent}%` }}
              />
            </div>

            {/* Additional trails count (only when showing auto-detected trail, not filtered) */}
            {selectedTrailFilter === 'all' && intern.trails.length > 1 && (
              <p className="text-[10px] text-white/30">
                +{intern.trails.length - 1} {intern.trails.length - 1 === 1 ? 'трейл' : intern.trails.length - 1 < 5 ? 'трейла' : 'трейлов'}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-1 ml-12">
            <p className="text-xs text-white/30 flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" />
              Нет назначенных трейлов
            </p>
          </div>
        )}

        {/* Action button — pinned to the bottom */}
        <div className="mt-auto pt-3 border-t border-white/10">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/interns/${intern.id}/stats`); }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Статистика
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

            {/* Filters row */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              {/* Search input */}
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

              {/* Trail dropdown filter */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-white/40 whitespace-nowrap">
                  <GitBranch className="w-3 h-3 inline mr-1" />
                  Трейл:
                </label>
                <div className="relative">
                  <select
                    value={selectedTrailFilter}
                    onChange={e => setSelectedTrailFilter(e.target.value)}
                    className="appearance-none pl-3 pr-8 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-emerald-500/50 cursor-pointer min-w-[140px] [&>option]:bg-dark-900 [&>option]:text-white"
                  >
                    <option value="all">Все трейлы</option>
                    {availableTrails.map(trail => (
                      <option key={trail.id} value={trail.id}>
                        {trail.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                </div>
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
                    {searchQuery || selectedTrailFilter !== 'all'
                      ? 'Ничего не найдено'
                      : 'Нет практикантов'}
                  </h3>
                  <p className="text-sm">
                    {searchQuery || selectedTrailFilter !== 'all'
                      ? 'Попробуйте изменить параметры поиска или фильтров'
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
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Выгрузка в CSV" icon={Download} />
        </div>
      )}
    </div>
  );
}
