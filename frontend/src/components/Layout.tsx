import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
  Phone,
  Building2,
  Shield,
  UserCog,
  Briefcase,
  GraduationCap,
  HelpCircle,
  FileSpreadsheet,
  FolderKanban,
  ListTodo,
  Cloud,
  GitBranch,
  FileText,
  FileSignature,
  Bell,
  Check,
  BarChart3,
  Plus,
  User,
  UserPlus,
  TrendingUp,
  Puzzle,
  Upload,
  ChevronDown,
  Database,
  Calendar,
  AlertTriangle,
  type LucideIcon
} from 'lucide-react';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import * as notificationsApi from '@/services/api/notifications';
import type { Notification as AppNotification } from '@/services/api/notifications';
import BackgroundEffects from './BackgroundEffects';
import ThemeToggle from './ThemeToggle';
import { OnboardingTour } from './onboarding';
import clsx from 'clsx';

// Note: iconMap and labelMap removed — using section-based navigation now

// Map paths to data-tour attributes
const pathToTourAttribute: Record<string, string> = {
  '/candidates': 'candidates-link',
  '/contacts': 'contacts-link',
  '/chats': 'chats-link',
  '/dashboard': 'dashboard-link',
};

const BLOCK_ICONS: Record<string, LucideIcon> = {
  projects: FolderKanban,
  hr: Briefcase,
  admin: Shield,
};

const BLOCK_ACTIVE_BG: Record<string, string> = {
  projects: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  hr: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  admin: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const BLOCK_ACCENT: Record<string, string> = {
  projects: 'bg-blue-500/20 text-blue-400',
  hr: 'bg-emerald-500/20 text-emerald-400',
  admin: 'bg-amber-500/20 text-amber-400',
};

// FAB — floating action button for HR block
function FABButton({ navigate }: { navigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="absolute bottom-16 right-0 flex flex-col gap-2 items-end mb-2">
          <button
            onClick={() => { navigate('/vacancies?new=1'); setOpen(false); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            <Briefcase className="w-4 h-4" />
            Добавить вакансию
          </button>
          <button
            onClick={() => { navigate('/candidates?new=1'); setOpen(false); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            Добавить кандидата
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
          open ? 'bg-red-600 hover:bg-red-500' : 'bg-cyan-600 hover:bg-cyan-500'
        )}
      >
        <Plus className={clsx('w-5 h-5 text-white transition-transform', open && 'rotate-45')} />
      </button>
    </div>
  );
}

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { user, logout, isImpersonating, exitImpersonation, fetchPermissions, customRoleName, hasFeature } = useAuthStore();

  const defaultBlock = useMemo(() => {
    if (user?.org_role === 'admin' || user?.org_role === 'hr') return 'hr';
    return 'projects';
  }, [user?.org_role]);
  const [activeBlock, setActiveBlock] = useState<string>(defaultBlock);

  // Sync default block when user role becomes available
  useEffect(() => {
    if (!location.pathname || location.pathname === '/') {
      if (user?.org_role === 'admin' || user?.org_role === 'hr') {
        setActiveBlock('hr');
      }
    }
  }, [user?.org_role]);
  const navigate = useNavigate();
  const { startTour, resetTour, hasCompletedTour } = useOnboardingTour();

  // Sidebar: expandable "Мои воронки" with vacancy list
  const { vacancies, fetchVacancies } = useVacancyStore();
  const [expandedFunnels, setExpandedFunnels] = useState(false);

  useEffect(() => {
    if (activeBlock === 'hr') {
      fetchVacancies();
    }
  }, [activeBlock, fetchVacancies]);

  // Notifications state
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsList, setNotificationsList] = useState<AppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const result = await notificationsApi.getUnreadCount();
      setUnreadCount(result.count);
    } catch {
      // silently ignore
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const list = await notificationsApi.getNotifications();
      setNotificationsList(list);
    } catch {
      // silently ignore
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const handleToggleNotifications = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    if (next) fetchNotifications();
  };

  const handleMarkRead = async (id: number) => {
    try {
      await notificationsApi.markNotificationRead(id);
      setNotificationsList((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllNotificationsRead();
      setNotificationsList((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // silently ignore
    }
  };

  // Close notifications on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    if (!user) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [user?.id, fetchUnreadCount]);

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

  // Auto-switch active block based on current URL
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/projects') || path.startsWith('/all-tasks') || path.startsWith('/saturn') || path.startsWith('/team') || path.startsWith('/dept-manager') || path.startsWith('/chats') || path.startsWith('/timeoff') || path.startsWith('/blockers')) {
      setActiveBlock('projects');
    } else if (['/dashboard', '/all-candidates', '/workspaces', '/my-funnels', '/candidate-database', '/form-builder', '/practice-list', '/document-templates', '/employees', '/my-profile', '/vacancies', '/candidates', '/interns', '/analytics', '/pen', '/calls', '/extension', '/exports', '/import'].some(p => path.startsWith(p))) {
      setActiveBlock('hr');
    } else if (['/users', '/departments', '/settings', '/admin', '/trash'].some(p => path.startsWith(p))) {
      setActiveBlock('admin');
    }
  }, [location.pathname]);

  // Navigation sections — 3 blocks: Projects, HR, Analytics + Admin
  type NavSection = {
    id: string;
    label: string;
    items: { path: string; icon: LucideIcon; label: string }[];
  };

  const navSections = useMemo((): NavSection[] => {
    const sections: NavSection[] = [];

    // PROJECTS block — everyone sees this
    sections.push({
      id: 'projects',
      label: 'Проекты',
      items: [
        { path: '/projects', icon: FolderKanban, label: 'Все проекты' },
        { path: '/all-tasks', icon: ListTodo, label: 'Все задачи' },
        { path: '/chats', icon: MessageSquare, label: 'Чаты' },
        { path: '/team', icon: Users, label: 'Команда' },
        { path: '/timeoff', icon: Calendar, label: 'Отпуска' },
        { path: '/blockers', icon: AlertTriangle, label: 'Блокеры' },
        { path: '/dept-manager', icon: Building2, label: 'Отделы' },
        { path: '/saturn', icon: Cloud, label: 'Saturn' },
      ],
    });

    // HR block — superadmin, owner, admin (HR Admin = Настя), hr (рекрутер = Мария)
    // member (обычные сотрудники) НЕ видят HR блок
    const isHrRole = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin' || user?.org_role === 'hr';
    const isHrAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';
    if (isHrRole) {
      const hrItems: { path: string; icon: LucideIcon; label: string }[] = [];
      // Базовые HR — видят все HR роли
      hrItems.push({ path: '/dashboard', icon: LayoutDashboard, label: 'Дашборд' });
      hrItems.push({ path: '/all-candidates', icon: Users, label: 'Все кандидаты' });
      hrItems.push({ path: '/my-funnels', icon: GitBranch, label: 'Мои воронки' });
      hrItems.push({ path: '/vacancies', icon: Briefcase, label: 'Вакансии' });
      // Расширенные — только admin/owner/superadmin
      if (isHrAdmin) {
        hrItems.push({ path: '/candidate-database', icon: Database, label: 'База кандидатов' });
        hrItems.push({ path: '/interns', icon: GraduationCap, label: 'Практиканты' });
        hrItems.push({ path: '/calls', icon: Phone, label: 'Созвоны' });
        hrItems.push({ path: '/extension', icon: Puzzle, label: 'Волшебная кнопка' });
        hrItems.push({ path: '/analytics', icon: BarChart3, label: 'HR Аналитика' });
        hrItems.push({ path: '/pen', icon: TrendingUp, label: 'ПЭН (бонусы)' });
        hrItems.push({ path: '/form-builder', icon: FileText, label: 'Конструктор форм' });
        hrItems.push({ path: '/document-templates', icon: FileSignature, label: 'Шаблоны документов' });
        hrItems.push({ path: '/employees', icon: UserCog, label: 'Сотрудники' });
        hrItems.push({ path: '/exports', icon: FileSpreadsheet, label: 'Экспорт CSV' });
        hrItems.push({ path: '/import', icon: Upload, label: 'Импорт CSV' });
      }

      sections.push({
        id: 'hr',
        label: 'HR',
        items: hrItems,
      });
    }

    // ADMIN block — superadmin/owner only
    if (user?.role === 'superadmin' || user?.org_role === 'owner') {
      const adminItems: { path: string; icon: LucideIcon; label: string }[] = [
        { path: '/departments', icon: Building2, label: 'Департаменты' },
        { path: '/settings', icon: Settings, label: 'Настройки' },
      ];
      if (user?.role === 'superadmin') {
        adminItems.unshift({ path: '/users', icon: UserCog, label: 'Пользователи' });
        adminItems.push({ path: '/admin/simulator', icon: Shield, label: 'Симулятор ролей' });
      }
      sections.push({
        id: 'admin',
        label: 'Управление',
        items: adminItems,
      });
    }

    return sections;
  }, [user?.role, user?.org_role, hasFeature]);

  // Flat list for mobile bottom nav
  const navItems = useMemo(() => {
    return navSections.flatMap((s) => s.items);
  }, [navSections]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen w-full max-w-full flex flex-col lg:flex-row relative overflow-hidden">
      <BackgroundEffects />
      {/* Desktop Sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 h-screen glass border-r border-white/5"
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Block switcher — top row of icons */}
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-1">
            {navSections.map((section) => {
              const Icon = BLOCK_ICONS[section.id] || LayoutDashboard;
              const isActive = activeBlock === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveBlock(section.id)}
                  className={clsx(
                    'flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl transition-all duration-200',
                    isActive
                      ? clsx('border', BLOCK_ACTIVE_BG[section.id])
                      : 'text-white/30 hover:text-white/50 hover:bg-white/[0.03] border border-transparent'
                  )}
                  title={section.label}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[9px] font-semibold uppercase tracking-wider">{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active block navigation */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto" aria-label="Primary navigation">
          {navSections
            .filter((s) => s.id === activeBlock)
            .map((section) => (
              <div key={section.id}>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    // "Мои воронки" — expandable with vacancy sub-list
                    if (item.path === '/my-funnels') {
                      const myVacancies = vacancies.filter(v => v.status === 'open' || v.status === 'paused').slice(0, 10);
                      return (
                        <div key={item.path}>
                          <div className="flex items-center">
                            <NavLink
                              to={item.path}
                              className={({ isActive }) =>
                                clsx(
                                  'flex-1 flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all duration-200 text-sm',
                                  isActive
                                    ? clsx(BLOCK_ACCENT[activeBlock])
                                    : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800/50'
                                )
                              }
                            >
                              <item.icon className="w-4 h-4 flex-shrink-0" />
                              <span className="font-medium truncate">{item.label}</span>
                            </NavLink>
                            {myVacancies.length > 0 && (
                              <button
                                onClick={() => setExpandedFunnels(!expandedFunnels)}
                                className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
                              >
                                <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', expandedFunnels && 'rotate-180')} />
                              </button>
                            )}
                          </div>
                          {expandedFunnels && myVacancies.length > 0 && (
                            <div className="ml-4 pl-3 border-l border-white/5 mt-0.5 space-y-0.5">
                              {myVacancies.map(v => (
                                <NavLink
                                  key={v.id}
                                  to={`/vacancies/${v.id}`}
                                  className={({ isActive }) =>
                                    clsx(
                                      'flex items-center gap-2 py-1.5 px-2 rounded-md text-xs transition-all',
                                      isActive
                                        ? 'text-blue-400 bg-blue-500/10'
                                        : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
                                    )
                                  }
                                >
                                  <span className={clsx(
                                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                    v.status === 'open' ? 'bg-green-400' : 'bg-yellow-400'
                                  )} />
                                  <span className="truncate">{v.title}</span>
                                </NavLink>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path.includes('?')}
                        data-tour={pathToTourAttribute[item.path]}
                        className={({ isActive }) =>
                          clsx(
                            'flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all duration-200 text-sm',
                            isActive
                              ? clsx(BLOCK_ACCENT[activeBlock])
                              : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800/50'
                          )
                        }
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="font-medium truncate">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          {/* Notification bell */}
          <div className="relative mb-3" ref={notifRef}>
            <button
              onClick={handleToggleNotifications}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-dark-300 hover:text-blue-400 hover:bg-blue-500/10 transition-all duration-200 relative"
            >
              <Bell className="w-5 h-5" />
              <span className="font-medium text-sm">Уведомления</span>
              {unreadCount > 0 && (
                <span className="absolute top-1.5 left-7 w-4.5 h-4.5 flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full min-w-[18px] px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notifications dropdown */}
            {showNotifications && (
              <div className="absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                  <span className="text-sm font-medium text-white">Уведомления</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      Прочитать все
                    </button>
                  )}
                </div>
                <div className="overflow-y-auto max-h-80">
                  {notificationsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full" />
                    </div>
                  ) : notificationsList.length === 0 ? (
                    <div className="py-8 text-center text-xs text-white/30">Нет уведомлений</div>
                  ) : (
                    notificationsList.map((notif) => (
                      <button
                        key={notif.id}
                        onClick={() => {
                          if (!notif.is_read) handleMarkRead(notif.id);
                          if (notif.link) {
                            navigate(notif.link);
                            setShowNotifications(false);
                          }
                        }}
                        className={clsx(
                          'w-full text-left px-4 py-3 border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors',
                          !notif.is_read && 'bg-blue-500/[0.05]'
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {!notif.is_read && (
                            <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 mt-1.5" />
                          )}
                          <div className={clsx('flex-1 min-w-0', notif.is_read && 'ml-4')}>
                            <p className="text-xs font-medium text-white truncate">{notif.title}</p>
                            {notif.message && (
                              <p className="text-[11px] text-white/30 truncate mt-0.5">{notif.message}</p>
                            )}
                            <p className="text-[10px] text-white/20 mt-1">
                              {new Date(notif.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

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
          <ThemeToggle />
          <NavLink
            to="/my-profile"
            className={({ isActive }) =>
              clsx(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mb-1',
                isActive
                  ? 'text-accent-400 bg-accent-500/10'
                  : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800/50'
              )
            }
          >
            <User className="w-5 h-5" />
            <span className="font-medium">Мой профиль</span>
          </NavLink>
          <button
            onClick={handleHelpClick}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all duration-200 mb-2"
            aria-label={hasCompletedTour ? 'Пройти тур заново' : 'Открыть справку'}
          >
            <HelpCircle className="w-5 h-5" aria-hidden="true" />
            <span className="font-medium">{hasCompletedTour ? 'Пройти тур заново' : 'Помощь'}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
            aria-label="Выйти из аккаунта"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
            <span className="font-medium">Выход</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden glass border-b border-white/5 px-4 py-3 flex items-center justify-between" role="banner">
        <h1 className="text-lg font-bold bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
          Enceladus
        </h1>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg hover:bg-dark-800/50"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" aria-hidden="true" /> : <Menu className="w-6 h-6" aria-hidden="true" />}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-dark-950/80 animate-[fadeIn_0.15s_ease]"
          onClick={() => setMobileMenuOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation menu"
        >
          <div
            className="absolute right-0 top-0 h-full w-64 glass flex flex-col animate-[slideInRight_0.2s_ease]"
            onClick={(e) => e.stopPropagation()}
            id="mobile-menu"
          >
            <nav className="p-3 overflow-y-auto flex-1" aria-label="Mobile navigation">
              {/* Block switcher */}
              <div className="flex gap-1 mb-4">
                {navSections.map((section) => {
                  const Icon = BLOCK_ICONS[section.id] || LayoutDashboard;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveBlock(section.id)}
                      className={clsx(
                        'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all text-xs',
                        activeBlock === section.id
                          ? clsx('border', BLOCK_ACTIVE_BG[section.id])
                          : 'text-white/30 border border-transparent'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[9px] font-semibold uppercase">{section.label}</span>
                    </button>
                  );
                })}
              </div>
              {/* Active block items */}
              {navSections
                .filter((s) => s.id === activeBlock)
                .map((section) => (
                  <div key={section.id}>
                    {section.items.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }) =>
                          clsx(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm',
                            isActive
                              ? clsx(BLOCK_ACCENT[activeBlock])
                              : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800/50'
                          )
                        }
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                        <span className="font-medium truncate">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                ))}
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
                aria-label="Выйти из аккаунта"
              >
                <LogOut className="w-5 h-5" aria-hidden="true" />
                <span className="font-medium">Logout</span>
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col" role="main" aria-label="Main content">
        {/* Impersonation Banner */}
        {isImpersonating() && user && (
          <div
            className="bg-yellow-500/20 border-b border-yellow-500/30 px-4 py-3 flex items-center justify-between"
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-yellow-400" aria-hidden="true" />
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
              aria-label="Выйти из режима имперсонации"
            >
              Выйти из имперсонации
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <Outlet />

          {/* FAB — floating action button for HR block */}
          {activeBlock === 'hr' && (
            <FABButton navigate={navigate} />
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden glass border-t border-white/5 px-2 py-2 flex" aria-label="Bottom navigation">
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
            aria-label={item.label}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <span className="text-xs truncate max-w-full">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Onboarding Tour */}
      <OnboardingTour autoStart />
    </div>
  );
}
