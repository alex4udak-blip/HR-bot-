import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings,
  Trash2,
  LogOut,
  Menu,
  X,
  Phone,
  Building2,
  Shield,
  UserCog,
  UserPlus,
  Briefcase,
  UserCheck,
  HelpCircle,
  type LucideIcon
} from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import BackgroundEffects from './BackgroundEffects';
import { OnboardingTour } from './onboarding';
import clsx from 'clsx';

// Icon mapping for dynamic menu
const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  MessageSquare,
  Users,
  Phone,
  Building2,
  UserCog,
  UserPlus,
  Settings,
  Shield,
  Trash2,
  Briefcase,
  UserCheck,
};

// Localized labels
const labelMap: Record<string, string> = {
  'Dashboard': 'Главная',
  'Candidates': 'База кандидатов',
  'Chats': 'Чаты',
  'Contacts': 'Контакты',
  'Calls': 'Созвоны',
  'Vacancies': 'Вакансии',
  'Departments': 'Департаменты',
  'Users': 'Пользователи',
  'Invite': 'Приглашения',
  'Settings': 'Настройки',
  'Admin Panel': 'Симулятор ролей',
  'Trash': 'Корзина',
};

// Map paths to data-tour attributes
const pathToTourAttribute: Record<string, string> = {
  '/candidates': 'candidates-link',
  '/vacancies': 'vacancies-link',
  '/contacts': 'contacts-link',
  '/chats': 'chats-link',
  '/dashboard': 'dashboard-link',
};

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout, isImpersonating, exitImpersonation, menuItems, fetchPermissions, customRoleName, hasFeature } = useAuthStore();
  const navigate = useNavigate();
  const { startTour, resetTour, hasCompletedTour } = useOnboardingTour();

  // Handler for starting/restarting the tour
  const handleHelpClick = () => {
    resetTour();
    setTimeout(() => startTour(), 100);
  };

  // Fetch permissions on mount
  useEffect(() => {
    if (user) {
      fetchPermissions();
    }
  }, [user?.id]);

  const handleExitImpersonation = async () => {
    try {
      await exitImpersonation();
    } catch (error) {
      console.error('Failed to exit impersonation:', error);
    }
  };

  // Use dynamic menu from backend if available, otherwise fall back to static menu
  const navItems = useMemo(() => {
    // If we have menu items from backend, use them
    if (menuItems && menuItems.length > 0) {
      return menuItems.map(item => ({
        path: item.path === '/' ? '/dashboard' : item.path,
        icon: iconMap[item.icon] || LayoutDashboard,
        label: labelMap[item.label] || item.label,
      }));
    }

    // Fallback to static menu
    const items = [
      { path: '/candidates', icon: UserCheck, label: 'База кандидатов' },
      { path: '/dashboard', icon: LayoutDashboard, label: 'Главная' },
      { path: '/chats', icon: MessageSquare, label: 'Чаты' },
      { path: '/calls', icon: Phone, label: 'Созвоны' },
      { path: '/contacts', icon: Users, label: 'Контакты' },
      { path: '/trash', icon: Trash2, label: 'Корзина' },
    ];

    // Add vacancies only if user has access to the feature
    if (hasFeature('vacancies')) {
      items.splice(5, 0, { path: '/vacancies', icon: Briefcase, label: 'Вакансии' });
    }

    // Add menu items for superadmin
    if (user?.role === 'superadmin') {
      items.push({ path: '/users', icon: Users, label: 'Пользователи' });
    }

    // Add menu items for superadmin and org owner
    if (user?.role === 'superadmin' || user?.org_role === 'owner') {
      items.push({ path: '/departments', icon: Building2, label: 'Департаменты' });
      items.push({ path: '/settings', icon: Settings, label: 'Настройки' });
    }

    // Add admin simulator only for superadmin
    if (user?.role === 'superadmin') {
      items.push({ path: '/admin/simulator', icon: Shield, label: 'Симулятор ролей' });
    }

    return items;
  }, [menuItems, user?.role, user?.org_role, hasFeature]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen flex flex-col lg:flex-row relative overflow-x-hidden">
      <BackgroundEffects />
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 h-screen glass border-r border-white/5">
        <div className="p-6 border-b border-white/5">
          <h1 className="text-xl font-bold bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            Чат Аналитика
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path.includes('?')}
              data-tour={pathToTourAttribute[item.path]}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 py-2.5 px-4 rounded-xl transition-all duration-200',
                  isActive
                    ? 'bg-accent-500/20 text-accent-400'
                    : 'text-dark-300 hover:text-dark-100 hover:bg-white/5'
                )
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-accent-500/20 flex items-center justify-center">
              <span className="text-accent-400 font-semibold">
                {user?.name?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-dark-400 truncate">{user?.email}</p>
              {customRoleName && (
                <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-accent-500/20 text-accent-400 rounded-full">
                  {customRoleName}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleHelpClick}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all duration-200 mb-2"
          >
            <HelpCircle className="w-5 h-5" />
            <span className="font-medium">{hasCompletedTour ? 'Пройти тур заново' : 'Помощь'}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Выход</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden glass border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
          Чат Аналитика
        </h1>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg hover:bg-white/5"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="lg:hidden fixed inset-0 z-50 bg-dark-950/80"
          onClick={() => setMobileMenuOpen(false)}
        >
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute right-0 top-0 h-full w-64 glass flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 space-y-1 overflow-y-auto flex-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
                      isActive
                        ? 'bg-accent-500/20 text-accent-400'
                        : 'text-dark-300 hover:text-dark-100 hover:bg-white/5'
                    )
                  }
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium truncate">{item.label}</span>
                </NavLink>
              ))}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Impersonation Banner */}
        {isImpersonating() && user && (
          <div className="bg-yellow-500/20 border-b border-yellow-500/30 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-yellow-400" />
              <div>
                <p className="text-sm font-semibold text-yellow-200">
                  Режим имперсонации
                </p>
                <p className="text-xs text-yellow-300">
                  Вы действуете от имени: <span className="font-medium">{user.name}</span> ({user.email})
                  {user.original_user_name && (
                    <span className="ml-2">
                      • Вернуться к: <span className="font-medium">{user.original_user_name}</span>
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={handleExitImpersonation}
              className="px-4 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 hover:text-yellow-100 transition-colors text-sm font-medium border border-yellow-500/30"
            >
              Выйти из имперсонации
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden glass border-t border-white/5 px-2 py-2 flex">
        {navItems.slice(0, 4).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            data-tour={pathToTourAttribute[item.path]}
            className={({ isActive }) =>
              clsx(
                'flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all duration-200',
                isActive
                  ? 'text-accent-400'
                  : 'text-dark-400 hover:text-dark-200'
              )
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span className="text-xs truncate max-w-full">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Onboarding Tour */}
      <OnboardingTour autoStart />
    </div>
  );
}
