import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  Sparkles,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore, useUIStore } from '../../lib/store'
import { Avatar } from '../ui'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Дашборд' },
  { to: '/chats', icon: MessageSquare, label: 'Чаты' },
  { to: '/users', icon: Users, label: 'Пользователи', superadmin: true },
  { to: '/settings', icon: Settings, label: 'Настройки' },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const { sidebarOpen, toggleSidebar } = useUIStore()
  const location = useLocation()

  const isSuperadmin = user?.role === 'superadmin'

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarOpen ? 280 : 80 }}
      className="fixed left-0 top-0 h-screen z-40 glass border-r border-dark-700/50"
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-dark-700/50">
          <div className="flex items-center justify-between">
            <motion.div
              initial={false}
              animate={{ opacity: sidebarOpen ? 1 : 0 }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-purple-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              {sidebarOpen && (
                <span className="font-semibold text-lg gradient-text">
                  HR Bot
                </span>
              )}
            </motion.div>
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-lg hover:bg-dark-700 transition-colors"
            >
              <ChevronLeft
                className={cn(
                  'w-5 h-5 text-dark-400 transition-transform',
                  !sidebarOpen && 'rotate-180'
                )}
              />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            if (item.superadmin && !isSuperadmin) return null

            const isActive = location.pathname === item.to

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'nav-link',
                  isActive && 'nav-link-active'
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <AnimatePresence>
                  {sidebarOpen && (
                    <motion.span
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-dark-700/50">
          <div className="flex items-center gap-3">
            <Avatar name={user?.name} size="md" />
            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 min-w-0"
                >
                  <p className="text-sm font-medium text-dark-100 truncate">
                    {user?.name}
                  </p>
                  <p className="text-xs text-dark-400 truncate">
                    {user?.email}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-dark-700 transition-colors"
              title="Выйти"
            >
              <LogOut className="w-4 h-4 text-dark-400" />
            </button>
          </div>
        </div>
      </div>
    </motion.aside>
  )
}
