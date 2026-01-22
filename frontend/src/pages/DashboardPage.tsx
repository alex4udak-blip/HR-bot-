import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Users,
  BarChart3,
  TrendingUp,
  Activity,
  Briefcase,
  UserCheck,
  Clock,
  Target
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { getStats } from '@/services/api';
import api from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

// HR Analytics types
interface HRAnalytics {
  vacancies_total: number;
  vacancies_open: number;
  candidates_total: number;
  candidates_in_pipeline: number;
  hires_this_month: number;
  avg_time_to_hire_days: number | null;
}

export default function DashboardPage() {
  const { hasFeature } = useAuthStore();
  const hasCandidateDatabase = hasFeature('candidate_database');

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    staleTime: 30000,
  });

  // Load HR analytics only if user has access to candidate database
  const { data: hrAnalytics } = useQuery({
    queryKey: ['hr-analytics-overview'],
    queryFn: async () => {
      const { data } = await api.get<HRAnalytics>('/analytics/dashboard/overview');
      return data;
    },
    staleTime: 60000,
    enabled: hasCandidateDatabase,
  });

  if (isLoading || !stats) {
    return (
      <div className="h-full flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: 'Всего чатов', value: stats.total_chats, icon: MessageSquare, color: 'from-blue-500 to-blue-600' },
    { label: 'Сообщений', value: stats.total_messages, icon: BarChart3, color: 'from-purple-500 to-purple-600' },
    { label: 'Участников', value: stats.total_participants, icon: Users, color: 'from-green-500 to-green-600' },
    { label: 'Анализов', value: stats.total_analyses, icon: Activity, color: 'from-orange-500 to-orange-600' },
  ];

  return (
    <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-6">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-6 max-w-7xl mx-auto w-full"
      >
        {/* Header */}
        <motion.div variants={item}>
          <h1 className="text-2xl font-bold mb-2">Панель управления</h1>
          <p className="text-dark-400">Обзор HR аналитики</p>
        </motion.div>

        {/* Stats Cards */}
        <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                <TrendingUp className="w-5 h-5 text-green-500" />
              </div>
              <p className="text-dark-400 text-sm mb-1 truncate">{stat.label}</p>
              <p className="text-2xl font-bold truncate">{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </motion.div>

        {/* HR Analytics Widget - only for users with candidate_database feature */}
        {hasCandidateDatabase && hrAnalytics && (
          <motion.div variants={item} className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-accent-500" />
              HR Аналитика
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="glass-light rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Briefcase className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-dark-400">Вакансии</span>
                </div>
                <p className="text-2xl font-bold">{hrAnalytics.vacancies_open}</p>
                <p className="text-xs text-dark-500">открытых из {hrAnalytics.vacancies_total}</p>
              </div>
              <div className="glass-light rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <UserCheck className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-dark-400">Кандидаты</span>
                </div>
                <p className="text-2xl font-bold">{hrAnalytics.candidates_in_pipeline}</p>
                <p className="text-xs text-dark-500">в работе из {hrAnalytics.candidates_total}</p>
              </div>
              <div className="glass-light rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-dark-400">Наймы</span>
                </div>
                <p className="text-2xl font-bold">{hrAnalytics.hires_this_month}</p>
                <p className="text-xs text-dark-500">в этом месяце</p>
              </div>
              <div className="glass-light rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-orange-400" />
                  <span className="text-sm text-dark-400">Время найма</span>
                </div>
                <p className="text-2xl font-bold">
                  {hrAnalytics.avg_time_to_hire_days ? `${hrAnalytics.avg_time_to_hire_days}д` : '—'}
                </p>
                <p className="text-xs text-dark-500">в среднем</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Activity Chart */}
        <motion.div variants={item} className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">Активность (7 дней)</h2>
          <div className="h-64 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.activity_by_day}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ca5eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ca5eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" stroke="#7c7c95" fontSize={12} />
                <YAxis stroke="#7c7c95" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(29, 29, 40, 0.9)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                  }}
                  labelStyle={{ color: '#ebebef' }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#0ca5eb"
                  fillOpacity={1}
                  fill="url(#colorCount)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Chats */}
          <motion.div variants={item} className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4">Топ чатов</h2>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {stats.top_chats.length === 0 ? (
                <p className="text-dark-400 text-center py-4">Пока нет чатов</p>
              ) : (
                stats.top_chats.map((chat, index) => (
                  <div
                    key={chat.id}
                    className="flex items-center gap-4 p-3 rounded-xl glass-light"
                  >
                    <span className="w-8 h-8 rounded-lg bg-accent-500/20 flex items-center justify-center text-accent-400 font-semibold">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{chat.custom_name || chat.title}</p>
                      <p className="text-sm text-dark-400 truncate">{chat.messages} сообщ.</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {/* Messages by Type */}
          <motion.div variants={item} className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4">По типу сообщений</h2>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {Object.entries(stats.messages_by_type).length === 0 ? (
                <p className="text-dark-400 text-center py-4">Пока нет сообщений</p>
              ) : (
                Object.entries(stats.messages_by_type).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-4">
                    <span className="w-20 text-sm text-dark-400 capitalize truncate">{type}</span>
                    <div className="flex-1 h-2 bg-dark-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-accent-500 to-accent-600 rounded-full"
                        style={{
                          width: `${(count / stats.total_messages) * 100}%`
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium w-16 text-right">{count}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>

        {/* Quick Stats */}
        <motion.div variants={item} className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="glass rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm truncate">Активных</p>
            <p className="text-xl font-bold text-accent-400 truncate">{stats.active_chats}</p>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm truncate">Сегодня</p>
            <p className="text-xl font-bold text-green-400 truncate">{stats.messages_today}</p>
          </div>
          <div className="glass rounded-xl p-4 text-center sm:col-span-1 col-span-2">
            <p className="text-dark-400 text-sm truncate">За неделю</p>
            <p className="text-xl font-bold text-purple-400 truncate">{stats.messages_this_week}</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
