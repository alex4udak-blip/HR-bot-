import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  MessageSquare,
  Users,
  FileSearch,
  TrendingUp,
  Mic,
  Video,
  FileText,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Layout, PageHeader } from '../components/layout'
import { Card, SkeletonStats } from '../components/ui'
import { getStats, getChats } from '../lib/api'
import { formatNumber, getMessageTypeLabel } from '../lib/utils'
import { useAuthStore } from '../lib/store'

const COLORS = ['#0ea5e9', '#a855f7', '#ec4899', '#f59e0b']

function StatCard({ icon: Icon, label, value, change, color }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="stat-card"
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}
        >
          <Icon className="w-6 h-6 text-white" />
        </div>
        {change && (
          <span className="flex items-center gap-1 text-emerald-400 text-sm font-medium">
            <TrendingUp className="w-4 h-4" />
            {change}
          </span>
        )}
      </div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-3xl font-bold text-dark-100 mb-1"
      >
        {formatNumber(value)}
      </motion.p>
      <p className="text-dark-400 text-sm">{label}</p>
    </motion.div>
  )
}

function ActivityChart({ data }) {
  return (
    <Card className="h-80">
      <h3 className="text-lg font-semibold text-dark-100 mb-4">
        Активность за неделю
      </h3>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#8e8ea0', fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#8e8ea0', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: '#343541',
              border: '1px solid #565869',
              borderRadius: '12px',
            }}
            labelStyle={{ color: '#ececf1' }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#0ea5e9"
            strokeWidth={2}
            fill="url(#colorCount)"
            name="Сообщений"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

function MessageTypesChart({ data }) {
  const chartData = Object.entries(data || {}).map(([type, count]) => ({
    name: getMessageTypeLabel(type),
    value: count,
  }))

  return (
    <Card className="h-80">
      <h3 className="text-lg font-semibold text-dark-100 mb-4">
        Типы сообщений
      </h3>
      <ResponsiveContainer width="100%" height="75%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#343541',
              border: '1px solid #565869',
              borderRadius: '12px',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-4">
        {chartData.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: COLORS[index % COLORS.length] }}
            />
            <span className="text-sm text-dark-400">{entry.name}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function DashboardPage() {
  const { user } = useAuthStore()

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  })

  const { data: chats } = useQuery({
    queryKey: ['chats'],
    queryFn: () => getChats(),
  })

  return (
    <Layout>
      <PageHeader
        title={`Привет, ${user?.name?.split(' ')[0] || 'Админ'}! 👋`}
        description="Вот что происходит в ваших чатах"
      />

      {/* Stats Grid */}
      {statsLoading ? (
        <SkeletonStats />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={MessageSquare}
            label="Всего чатов"
            value={stats?.total_chats || 0}
            color="bg-gradient-to-br from-accent-500 to-accent-600"
          />
          <StatCard
            icon={FileText}
            label="Сообщений"
            value={stats?.total_messages || 0}
            change={stats?.messages_today ? `+${stats.messages_today} сегодня` : null}
            color="bg-gradient-to-br from-purple-500 to-purple-600"
          />
          <StatCard
            icon={Users}
            label="Участников"
            value={stats?.total_users || 0}
            color="bg-gradient-to-br from-pink-500 to-pink-600"
          />
          <StatCard
            icon={FileSearch}
            label="Анализов"
            value={stats?.total_analyses || 0}
            color="bg-gradient-to-br from-amber-500 to-amber-600"
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ActivityChart data={stats?.chats_by_day || []} />
        <MessageTypesChart data={stats?.messages_by_type} />
      </div>

      {/* Recent Chats */}
      <Card>
        <h3 className="text-lg font-semibold text-dark-100 mb-4">
          Последние чаты
        </h3>
        <div className="space-y-3">
          {chats?.slice(0, 5).map((chat, index) => (
            <motion.div
              key={chat.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-dark-800/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-500/20 to-purple-500/20 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-accent-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-dark-100 truncate">
                  {chat.title}
                </p>
                <p className="text-sm text-dark-400">
                  {chat.messages_count} сообщений • {chat.users_count} участников
                </p>
              </div>
              <div
                className={`w-2 h-2 rounded-full ${
                  chat.is_active ? 'bg-emerald-400' : 'bg-dark-600'
                }`}
              />
            </motion.div>
          ))}
        </div>
      </Card>
    </Layout>
  )
}
