import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../lib/store'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Главная' },
  { to: '/chats', icon: MessageSquare, label: 'Чаты' },
  { to: '/users', icon: Users, label: 'Юзеры', superadmin: true },
  { to: '/settings', icon: Settings, label: 'Ещё' },
]

export function MobileNav() {
  const { user } = useAuthStore()
  const location = useLocation()

  const isSuperadmin = user?.role === 'superadmin'

  const visibleItems = navItems.filter(
    (item) => !item.superadmin || isSuperadmin
  )

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden glass border-t border-dark-700/50 safe-area-pb">
      <div className="flex justify-around items-center h-16">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.to

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-1 px-4 py-2"
            >
              <div className="relative">
                <item.icon
                  className={cn(
                    'w-5 h-5 transition-colors',
                    isActive ? 'text-accent-400' : 'text-dark-400'
                  )}
                />
                {isActive && (
                  <motion.div
                    layoutId="mobileActiveTab"
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-400"
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-xs transition-colors',
                  isActive ? 'text-accent-400' : 'text-dark-500'
                )}
              >
                {item.label}
              </span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
