import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Settings,
  Search,
  LogOut,
  Menu,
  X,
  Phone,
  Building2,
  Shield,
  UserCog,
  Briefcase,
  GraduationCap,
  FolderKanban,
  ListTodo,
  Cloud,
  GitBranch,
  Bell,
  Check,
  BarChart3,
  Plus,
  User,
  UserPlus,
  Puzzle,
  ChevronDown,
  Calendar,
  AlertTriangle,
  ClipboardList,
  MessageSquare,
  Mail,
  Wand2,
  Code2,
  Palette,
  Filter,
  Layers,
  FileText,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useVacancyStore } from "@/stores/vacancyStore";
import * as notificationsApi from "@/services/api/notifications";
import type { Notification as AppNotification } from "@/services/api/notifications";
import BackgroundEffects from "./BackgroundEffects";
import ThemeToggle from "./ThemeToggle";
import { VacancyForm } from "@/components/vacancies";
import ParserModal from "@/components/parser/ParserModal";
import TelegramConnectBanner from "@/components/TelegramConnectBanner";
import { getVacancy, takeVacancy } from "@/services/api/vacancies";
import type { Vacancy } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import toast from "react-hot-toast";

// Note: iconMap and labelMap removed — using section-based navigation now

// Map paths to data-tour attributes
const pathToTourAttribute: Record<string, string> = {
  "/all-candidates": "candidates-link",
  "/analytics": "analytics-link",
  "/chats": "chats-link",
  "/dashboard": "dashboard-link",
};

const BLOCK_ICONS: Record<string, LucideIcon> = {
  projects: FolderKanban,
  hr: Briefcase,
  admin: Shield,
};

const BLOCK_ACTIVE_BG: Record<string, string> = {
  projects: "bg-[var(--hf-status-blue-badge)] text-[var(--hf-status-blue)] border-[color:var(--hf-status-blue-badge)]",
  practice: "bg-[var(--hf-status-purple-badge)] text-[var(--hf-status-purple)] border-[color:var(--hf-status-purple-badge)]",
  hr: "bg-[var(--hf-status-green-badge)] text-[var(--hf-status-green)] border-[color:var(--hf-status-green-badge)]",
  admin: "bg-[var(--hf-status-yellow-badge)] text-[var(--hf-status-yellow)] border-[color:var(--hf-status-yellow-badge)]",
};

const BLOCK_ACCENT: Record<string, string> = {
  projects: "bg-[var(--hf-status-blue-badge)] text-[var(--hf-status-blue)]",
  practice: "bg-[var(--hf-status-purple-badge)] text-[var(--hf-status-purple)]",
  hr: "bg-[var(--hf-status-green-badge)] text-[var(--hf-status-green)]",
  admin: "bg-[var(--hf-status-yellow-badge)] text-[var(--hf-status-yellow)]",
};

const HF_HR_SIDEBAR_WIDTH_STORAGE_KEY = "hf.hrSidebarWidth";
const HF_HR_SIDEBAR_WIDTH_LEGACY_STORAGE_KEY = "left-menu-width";
const HF_HR_SIDEBAR_WIDTH_MIN = 266;
const HF_HR_SIDEBAR_WIDTH_DEFAULT = 266;
const HF_HR_SIDEBAR_WIDTH_MAX = 416;
const APP_THEME_STORAGE_KEY = "theme";
const APP_DEFAULT_THEME = "dark";

function readStoredAppTheme() {
  if (typeof window === "undefined") return APP_DEFAULT_THEME;
  const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : APP_DEFAULT_THEME;
}

function clampHrSidebarWidth(width: number) {
  return Math.min(
    HF_HR_SIDEBAR_WIDTH_MAX,
    Math.max(HF_HR_SIDEBAR_WIDTH_MIN, width),
  );
}

function readStoredHrSidebarWidth() {
  if (typeof window === "undefined") return HF_HR_SIDEBAR_WIDTH_DEFAULT;
  const stored =
    window.localStorage.getItem(HF_HR_SIDEBAR_WIDTH_STORAGE_KEY) ??
    window.localStorage.getItem(HF_HR_SIDEBAR_WIDTH_LEGACY_STORAGE_KEY);
  const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampHrSidebarWidth(parsed)
    : HF_HR_SIDEBAR_WIDTH_DEFAULT;
}

function persistHrSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  const normalizedWidth = String(Math.round(clampHrSidebarWidth(width)));
  window.localStorage.setItem(
    HF_HR_SIDEBAR_WIDTH_STORAGE_KEY,
    normalizedWidth,
  );
  window.localStorage.setItem(
    HF_HR_SIDEBAR_WIDTH_LEGACY_STORAGE_KEY,
    normalizedWidth,
  );
}

function HfSpriteIcon({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <use href={`/huntflow-sprite.svg#${id}`} />
    </svg>
  );
}

type HrSettingsItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  path?: string;
  adminOnly?: boolean;
  missing?: boolean;
};

type SidebarVacancyMode = "view" | "edit";

function formatSidebarVacancyDate(date?: string | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

function RequestPreviewBlock({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  if (!children) return null;
  return (
    <div className="hf-request-preview-block">
      <div className="hf-request-preview-label">{title}</div>
      <div className="hf-request-preview-value">{children}</div>
    </div>
  );
}

export function SidebarRequestPreviewModal({
  vacancy,
  onClose,
  onEdit,
  onTaken,
}: {
  vacancy: Vacancy;
  onClose: () => void;
  onEdit: () => void;
  onTaken: () => void;
}) {
  const { user } = useAuthStore();
  const { vacancies, fetchVacancies } = useVacancyStore();
  const [taking, setTaking] = useState(false);
  const isTakenByMe = useMemo(() => {
    if (!user) return false;
    return vacancies.some(
      (v) =>
        v.created_by === user.id &&
        (v.extra_data as Record<string, unknown> | undefined)
          ?.cloned_from_request_id === vacancy.id,
    );
  }, [user, vacancies, vacancy.id]);
  const requestDate = formatSidebarVacancyDate(
    vacancy.published_at || vacancy.created_at,
  );
  const customerName =
    vacancy.hiring_manager_name || vacancy.created_by_name || "Не указан";
  const departmentName = vacancy.department_name || "Не выбрано";
  const positionsCount =
    typeof vacancy.extra_data?.positions_count === "number"
      ? vacancy.extra_data.positions_count
      : 1;

  const handleTake = async () => {
    // Guard: повторный клик пока запрос ещё в полёте не должен
    // отправлять второй POST — иначе создавались дубли-клоны.
    if (taking) return;
    setTaking(true);

    const doTake = async (force: boolean) => {
      await takeVacancy(vacancy.id, force);
      await fetchVacancies();
      toast.success('Заявка взята в работу — открыта в "Мои вакансии"');
      onTaken();
    };

    try {
      await doTake(false);
    } catch (err) {
      // Backend вернул 409 duplicate_clone — у юзера уже есть вакансия по
      // этой заявке. Не блокируем жёстко, а спрашиваем — вдруг дубль нужен.
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      const isDuplicate =
        detail !== null &&
        typeof detail === "object" &&
        (detail as { code?: string }).code === "duplicate_clone";
      if (isDuplicate) {
        const msg =
          (detail as { message?: string }).message ||
          "У вас уже есть такая вакансия. Создать дубликат?";
        if (window.confirm(msg)) {
          try {
            await doTake(true);
          } catch {
            toast.error("Не удалось взять заявку");
          }
        }
      } else {
        toast.error("Не удалось взять заявку");
      }
    } finally {
      setTaking(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="hf-vacancy-modal-overlay hf-request-preview-overlay"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
        className="hf-vacancy-modal hf-request-preview-modal"
      >
        <div className="hf-vacancy-modal-header">
          <h2 className="hf-vacancy-modal-title">
            {vacancy.title?.trim() || "Заявка"}
          </h2>
          <div className="hf-vacancy-header-actions">
            <button
              type="button"
              onClick={onClose}
              className="hf-vacancy-close-btn"
              aria-label="Закрыть"
            >
              <X className="hf-request-preview-close-icon" />
            </button>
          </div>
        </div>

        <div className="hf-vacancy-form-scroll">
          <div className="hf-vacancy-modal-grid hf-request-preview-grid grid min-h-full">
            <div className="hf-vacancy-modal-main hf-request-preview-main">
              <RequestPreviewBlock title="Отдел, подразделение">
                {departmentName}
              </RequestPreviewBlock>
              <RequestPreviewBlock title="Обязанности кандидата">
                {vacancy.responsibilities || vacancy.description}
              </RequestPreviewBlock>
              <RequestPreviewBlock title="Требования к кандидату">
                {vacancy.requirements}
              </RequestPreviewBlock>
              <RequestPreviewBlock title="Условия работы">
                {vacancy.description && vacancy.responsibilities
                  ? vacancy.description
                  : null}
              </RequestPreviewBlock>
            </div>

            <aside className="hf-vacancy-modal-aside hf-request-preview-aside">
              <RequestPreviewBlock title="Сколько человек нужно нанять">
                {positionsCount}
              </RequestPreviewBlock>
              <RequestPreviewBlock
                title={requestDate ? `Заказчик, ${requestDate}` : "Заказчик"}
              >
                {customerName}
              </RequestPreviewBlock>
              <RequestPreviewBlock title="Заявка получена">
                {departmentName}
              </RequestPreviewBlock>
            </aside>
          </div>
        </div>

        <div className="hf-vacancy-footer hf-request-preview-footer">
          <button
            type="button"
            onClick={handleTake}
            disabled={taking || isTakenByMe}
            className="hf-vacancy-primary-btn"
          >
            {taking ? "Беру..." : isTakenByMe ? "Уже в работе" : "Взять в работу"}
          </button>
          <button type="button" onClick={onClose} className="hf-vacancy-secondary-btn">
            Закрыть
          </button>
          <button type="button" onClick={onEdit} className="hf-vacancy-secondary-btn">
            Редактировать
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const HR_SETTINGS_ORG_ITEMS: HrSettingsItem[] = [
  {
    title: "Рекрутеры и заказчики",
    description: "Добавление пользователей и настройка прав",
    icon: Users,
    color: "text-[var(--hf-red-500)]",
    path: "/users",
    adminOnly: true,
  },
  {
    title: "Организация",
    description: "Название, оргструктура, безопасность и уведомления",
    icon: Building2,
    color: "text-[var(--hf-status-indigo)]",
    path: "/departments",
    adminOnly: true,
  },
  {
    title: "Воронка",
    description: "Этапы подбора, воронки, отказы и контроль сроков",
    icon: Filter,
    color: "text-[var(--hf-status-pink)]",
    path: "/all-candidates",
  },
  {
    title: "Бизнес-процесс",
    description: "Заявки, вакансии, справочники, метки и источники резюме",
    icon: GitBranch,
    color: "text-[var(--hf-status-green)]",
    path: "/vacancies",
  },
  {
    title: "Шаблоны, оценка и анкеты",
    description: "Письма, анкеты, обратная связь и оценка рекрутмента",
    icon: Layers,
    color: "text-[var(--hf-status-cyan)]",
    path: "/email-templates",
  },
  {
    title: "Темы оформления",
    description: "Цвета, темы и персонализация интерфейса",
    icon: Palette,
    color: "text-[var(--hf-status-lime)]",
    missing: true,
  },
  {
    title: "Сбор откликов",
    description: "Карьерный сайт и публикация вакансий",
    icon: Link2,
    color: "text-[var(--hf-status-orange)]",
    path: "/form-builder",
  },
  {
    title: "API и вебхуки",
    description: "Интеграция с вашими внутренними ресурсами",
    icon: Code2,
    color: "text-[var(--hf-status-blue)]",
    missing: true,
  },
];

const HR_SETTINGS_MY_ITEMS: HrSettingsItem[] = [
  {
    title: "Профиль",
    description: "Обо мне, часовой пояс, аккаунт, язык интерфейса",
    icon: User,
    color: "text-[var(--hf-status-yellow)]",
    path: "/my-profile",
  },
  {
    title: "Почта и календарь",
    description: "Google, Exchange, Outlook365 и другие",
    icon: Mail,
    color: "text-[var(--hf-status-cyan)]",
    missing: true,
  },
  {
    title: "Волшебная кнопка",
    description: "Сохранение резюме с 20+ сайтов одним кликом",
    icon: Wand2,
    color: "text-[var(--hf-red-400)]",
    path: "/extension",
  },
  {
    title: "Джоб-сайты",
    description: "HH, Avito, Хабр Карьера, AmazingHiring и другие",
    icon: FileText,
    color: "text-[var(--hf-status-pink)]",
    missing: true,
  },
  {
    title: "Интеграции",
    description: "Zoom, MS Teams, Google Meet и другие",
    icon: Puzzle,
    color: "text-[var(--hf-status-indigo)]",
    missing: true,
  },
];

function HrSettingsCard({
  item,
  onSelect,
}: {
  item: HrSettingsItem;
  onSelect: (item: HrSettingsItem) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="hf-hr-settings-card"
    >
      <Icon
        className={clsx(
          "hf-hr-settings-card-icon",
          item.color,
        )}
      />
      <span className="hf-hr-settings-card-content">
        <span className="hf-hr-settings-card-title">
          {item.title}
        </span>
        <span className="hf-hr-settings-card-desc">
          {item.description}
        </span>
      </span>
    </button>
  );
}

function HrSettingsModal({
  canUseAdmin,
  onClose,
  onNavigate,
}: {
  canUseAdmin: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filterItems = (items: HrSettingsItem[]) =>
    normalizedQuery
      ? items.filter((item) =>
          `${item.title} ${item.description}`
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : items;
  const orgItems = filterItems(HR_SETTINGS_ORG_ITEMS);
  const myItems = filterItems(HR_SETTINGS_MY_ITEMS);

  const handleSelect = (item: HrSettingsItem) => {
    if (item.missing) {
      toast("Этого раздела пока нет в HR-bot, оставляем как отсутствующую фичу Huntflow");
      return;
    }
    if (item.adminOnly && !canUseAdmin) {
      toast("Раздел доступен только администратору");
      return;
    }
    if (item.path) {
      onNavigate(item.path);
    }
  };

  return (
    <div
      className="hf-hr-settings-overlay"
      onMouseDown={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.985 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
        className="hf-hr-settings-modal"
      >
        <div className="hf-hr-settings-header">
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки"
            className="hf-hr-settings-close"
          >
            <X className="hf-hr-settings-close-icon" />
          </button>
          <h2 className="hf-hr-settings-title">
            HR-bot
          </h2>
          <p className="hf-hr-settings-subtitle">
            Настройки рабочего пространства и рекрутингового контура
          </p>
        </div>

        <div className="hf-hr-settings-body">
          <label className="hf-hr-settings-search">
            <Search
              className="hf-hr-settings-search-icon"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
              placeholder="Поиск"
              className="hf-hr-settings-search-input"
            />
          </label>

          <div className="hf-hr-settings-grid hf-hr-settings-grid-first">
            {orgItems.map((item) => (
              <HrSettingsCard
                key={item.title}
                item={item}
                onSelect={handleSelect}
              />
            ))}
          </div>

          <div className="hf-hr-settings-section">
            <h3 className="hf-hr-settings-section-title">
              Мой профиль
            </h3>
            <div className="hf-hr-settings-grid hf-hr-settings-grid-first">
              {myItems.map((item) => (
                <HrSettingsCard
                  key={item.title}
                  item={item}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// FAB — floating action button for HR block
function FABButton({
  onCreateVacancy,
  onAddCandidate,
}: {
  onCreateVacancy: () => void;
  onAddCandidate: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="absolute bottom-16 right-0 flex flex-col gap-2 items-end mb-2">
          <button
            onClick={() => {
              onCreateVacancy();
              setOpen(false);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--hf-green-600)] hover:bg-[var(--hf-green-500)] text-[var(--hf-white)] text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            <Briefcase className="w-4 h-4" />
            Добавить вакансию
          </button>
          <button
            onClick={() => {
              onAddCandidate();
              setOpen(false);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--hf-cyan-700)] hover:bg-[var(--hf-cyan-600)] text-[var(--hf-white)] text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            Добавить кандидата
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        title="Создать"
        className={clsx(
          "w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-[var(--hf-shadow-lg)]",
          open
            ? "bg-[var(--hf-red-600)] hover:bg-[var(--hf-red-500)] shadow-[0_10px_15px_-3px_var(--hf-status-red-badge)]"
            : "bg-[var(--hf-cyan-600)] hover:bg-[var(--hf-status-blue)] shadow-[0_10px_15px_-3px_var(--hf-status-blue-badge)] animate-pulse-subtle",
        )}
      >
        <Plus
          className={clsx(
            "w-6 h-6 text-[var(--hf-white)] transition-transform",
            open && "rotate-45",
          )}
          strokeWidth={2.5}
        />
      </button>
    </div>
  );
}

function getBlockForPath(path: string): string | null {
  if (
    path.startsWith("/projects") ||
    path.startsWith("/all-tasks") ||
    path.startsWith("/saturn") ||
    path.startsWith("/team") ||
    path.startsWith("/dept-manager") ||
    path.startsWith("/timeoff") ||
    path.startsWith("/blockers")
  ) {
    return "projects";
  }
  if (
    path.startsWith("/chats") ||
    path.startsWith("/interns") ||
    path.startsWith("/practice-list") ||
    path.startsWith("/calls")
  ) {
    return "practice";
  }
  if (
    [
      "/dashboard",
      "/all-candidates",
      "/workspaces",
      "/my-funnels",
      "/form-builder",
      "/document-templates",
      "/email-templates",
      "/employees",
      "/vacancies",
      "/analytics",
      "/hr-reports",
      "/pen",
      "/extension",
      "/exports",
      "/import",
    ].some((p) => path.startsWith(p))
  ) {
    return "hr";
  }
  if (
    ["/users", "/departments", "/settings", "/admin", "/trash"].some((p) =>
      path.startsWith(p),
    )
  ) {
    return "admin";
  }
  return null;
}

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const {
    user,
    logout,
    isImpersonating,
    exitImpersonation,
    fetchPermissions,
    customRoleName,
    hasFeature,
  } = useAuthStore();

  const defaultBlock = useMemo(() => {
    if (user?.org_role === "admin" || user?.org_role === "hr") return "hr";
    return "projects";
  }, [user?.org_role]);
  const [activeBlock, setActiveBlock] = useState<string>(defaultBlock);

  // Sync default block when user role becomes available
  useEffect(() => {
    if (!location.pathname || location.pathname === "/") {
      if (user?.org_role === "admin" || user?.org_role === "hr") {
        setActiveBlock("hr");
      }
    }
  }, [user?.org_role]);
  const navigate = useNavigate();

  // Sidebar: expandable "Мои воронки" with vacancy list
  const { vacancies, fetchVacancies } = useVacancyStore();
  const [expandedFunnels, setExpandedFunnels] = useState(false);
  const [expandedRequests, setExpandedRequests] = useState(true);
  const [sidebarVacancy, setSidebarVacancy] = useState<Vacancy | null>(null);
  const [sidebarVacancyMode, setSidebarVacancyMode] =
    useState<SidebarVacancyMode>("view");
  const routeBlock = getBlockForPath(location.pathname);
  const activeNavigationBlock = routeBlock || activeBlock;
  const isHrSidebar = routeBlock === "hr";
  const [hrSidebarWidth, setHrSidebarWidth] = useState(readStoredHrSidebarWidth);
  const hrSidebarWidthRef = useRef(hrSidebarWidth);
  const [isHrSidebarResizing, setIsHrSidebarResizing] = useState(false);

  // FAB-triggered modals — открываются in-place без навигации
  const [showFabVacancyForm, setShowFabVacancyForm] = useState(false);
  const [showFabParserModal, setShowFabParserModal] = useState(false);
  const [showHrFabActions, setShowHrFabActions] = useState(false);
  const [showHrSettingsModal, setShowHrSettingsModal] = useState(false);
  const [showHrFunnelsPicker, setShowHrFunnelsPicker] = useState(false);
  const [showHrUserMenu, setShowHrUserMenu] = useState(false);
  const hrFabActionsRef = useRef<HTMLDivElement | null>(null);
  const hrFunnelsPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (routeBlock === "hr") {
      fetchVacancies();
    }
  }, [routeBlock, fetchVacancies]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (isHrSidebar) {
      root.setAttribute("data-theme", "light");
      root.dataset.hrForcedLightTheme = "true";
      return () => {
        if (root.dataset.hrForcedLightTheme === "true") {
          root.setAttribute("data-theme", readStoredAppTheme());
          delete root.dataset.hrForcedLightTheme;
        }
      };
    }

    if (root.dataset.hrForcedLightTheme === "true") {
      root.setAttribute("data-theme", readStoredAppTheme());
      delete root.dataset.hrForcedLightTheme;
    }
  }, [isHrSidebar]);

  useEffect(() => {
    if (!showHrUserMenu) {
      setShowNotifications(false);
    }
  }, [showHrUserMenu]);

  useEffect(() => {
    if (!showHrFabActions) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        hrFabActionsRef.current &&
        !hrFabActionsRef.current.contains(event.target as Node)
      ) {
        setShowHrFabActions(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showHrFabActions]);

  useEffect(() => {
    if (!showHrFunnelsPicker) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        hrFunnelsPickerRef.current &&
        !hrFunnelsPickerRef.current.contains(event.target as Node)
      ) {
        setShowHrFunnelsPicker(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showHrFunnelsPicker]);

  useEffect(() => {
    hrSidebarWidthRef.current = hrSidebarWidth;
  }, [hrSidebarWidth]);

  useEffect(() => {
    if (!isHrSidebarResizing) return;
    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = clampHrSidebarWidth(event.clientX);
      setHrSidebarWidth(nextWidth);
      persistHrSidebarWidth(nextWidth);
    };
    const handleMouseUp = () => {
      persistHrSidebarWidth(hrSidebarWidthRef.current);
      setIsHrSidebarResizing(false);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isHrSidebarResizing]);

  useEffect(() => {
    if (!isHrSidebar) return;
    persistHrSidebarWidth(hrSidebarWidth);
  }, [hrSidebarWidth, isHrSidebar]);

  const openVacancyModal = useCallback(
    async (id: number) => {
      const cachedVacancy = vacancies.find((v) => v.id === id);
      if (cachedVacancy) {
        setSidebarVacancy(cachedVacancy);
        setSidebarVacancyMode("view");
      }
      try {
        const v = await getVacancy(id);
        setSidebarVacancy(v);
        setSidebarVacancyMode("view");
      } catch {
        if (!cachedVacancy) {
          toast.error("Не удалось открыть заявку");
        }
      }
    },
    [vacancies],
  );

  // Count of vacancies for the "Заявки" badge.
  // Админ — нераспределённые заявки 'На рассмотрении' (+ legacy draft),
  //   но НЕ свои собственные (когда админ сам создаёт заявку, ему не
  //   нужен пинг про неё — иначе любая создание сразу "флешит жёлтым").
  // Рекрутёр — назначенные ему/всем, ещё не взятые в работу (нет клона).
  const assignedDraftCount = useMemo(() => {
    if (!user) return 0;
    const isAdmin =
      user.role === "superadmin" ||
      user.org_role === "owner" ||
      user.org_role === "admin";
    if (isAdmin) {
      return vacancies.filter(
        (v) =>
          (v.status === "pending_review" || v.status === "draft") &&
          v.created_by !== user.id,
      ).length;
    }
    const myCloneFor = new Set<number>();
    vacancies.forEach((v) => {
      if (v.created_by !== user.id) return;
      const src = (v.extra_data as Record<string, unknown> | undefined)
        ?.cloned_from_request_id;
      if (typeof src === "number") myCloneFor.add(src);
    });
    return vacancies.filter((v) => {
      if (v.created_by === user.id) return false;
      const assigned =
        v.assigned_to_all || (v.assigned_to && v.assigned_to.includes(user.id));
      if (!assigned) return false;
      return !myCloneFor.has(v.id);
    }).length;
  }, [vacancies, user]);

  // Notifications state
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsList, setNotificationsList] = useState<AppNotification[]>(
    [],
  );
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
      setNotificationsList((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllNotificationsRead();
      setNotificationsList((prev) =>
        prev.map((n) => ({ ...n, is_read: true })),
      );
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
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    if (!user) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [user?.id, fetchUnreadCount]);

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
      console.error("Failed to exit impersonation:", error);
    }
  };

  // Auto-switch active block based on current URL
  useEffect(() => {
    const nextBlock = getBlockForPath(location.pathname);
    if (nextBlock) setActiveBlock(nextBlock);
  }, [location.pathname]);

  // Navigation sections — 3 blocks: Projects, HR, Analytics + Admin
  type NavSection = {
    id: string;
    label: string;
    items: { path: string; icon: LucideIcon; label: string }[];
  };

  const navSections = useMemo((): NavSection[] => {
    const sections: NavSection[] = [];

    // Роли:
    // - platform admin (superadmin/owner) — видит ВСЁ
    // - HR-блок (org_role=admin/hr, но НЕ платформенный админ) — видит ТОЛЬКО HR
    // - обычные сотрудники (member) — видят только Проекты (ограниченные)
    // - Practice-only (член депта 'Практика', не платформ-админ) — видит ТОЛЬКО блок Практика
    const isPlatformAdmin =
      user?.role === "superadmin" || user?.org_role === "owner";
    const isHrOnly =
      !isPlatformAdmin &&
      (user?.org_role === "admin" || user?.org_role === "hr");
    const isPracticeMember = (user?.department_names || []).some(
      (n) => n.trim().toLowerCase() === "практика",
    );
    const isPracticeOnly = isPracticeMember && !isPlatformAdmin;

    // PROJECTS block — скрыт у HR-only и Practice-only
    if (!isHrOnly && !isPracticeOnly) {
      const projectItems: { path: string; icon: LucideIcon; label: string }[] =
        [
          {
            path: "/projects",
            icon: FolderKanban,
            label: isPlatformAdmin ? "Все проекты" : "Мои проекты",
          },
          {
            path: "/all-tasks",
            icon: ListTodo,
            label: isPlatformAdmin ? "Все задачи" : "Мои задачи",
          },
        ];
      if (isPlatformAdmin) {
        projectItems.push(
          { path: "/team", icon: Users, label: "Команда" },
          { path: "/timeoff", icon: Calendar, label: "Отпуска" },
          { path: "/blockers", icon: AlertTriangle, label: "Блокеры" },
          { path: "/dept-manager", icon: Building2, label: "Отделы" },
          { path: "/saturn", icon: Cloud, label: "Saturn" },
        );
      }
      sections.push({
        id: "projects",
        label: "Проекты",
        items: projectItems,
      });
    }

    // PRACTICE block — superadmin, owner, HR Admin (org_role='admin'),
    // и любой член депта 'Практика'. Содержит: чаты с AI/критериями/отчётами,
    // Созвоны, Практиканты, База практикантов.
    const isHrAdmin = isPlatformAdmin || user?.org_role === "admin";
    if (isHrAdmin || isPracticeMember) {
      sections.push({
        id: "practice",
        label: "Практика",
        items: [
          { path: "/chats", icon: MessageSquare, label: "Чаты" },
          { path: "/calls", icon: Phone, label: "Созвоны" },
          { path: "/interns", icon: GraduationCap, label: "Практиканты" },
          {
            path: "/practice-list",
            icon: ClipboardList,
            label: "База практикантов",
          },
        ],
      });
    }

    // HR block — superadmin, owner, admin (HR Admin), hr (рекрутер)
    // member (обычные сотрудники) и Practice-only НЕ видят HR блок
    const isHrRole =
      isPlatformAdmin || user?.org_role === "admin" || user?.org_role === "hr";
    if (isHrRole && !isPracticeOnly) {
      const hrItems: { path: string; icon: LucideIcon; label: string }[] = [];
      hrItems.push({
        path: "/all-candidates",
        icon: Users,
        label: "Все кандидаты",
      });
      hrItems.push({ path: "/analytics", icon: BarChart3, label: "Аналитика" });
      hrItems.push({
        path: "/my-funnels",
        icon: Briefcase,
        label: "Мои вакансии",
      });
      hrItems.push({ path: "/vacancies", icon: GitBranch, label: "Заявки" });
      sections.push({
        id: "hr",
        label: "HR",
        items: hrItems,
      });
    }

    // ADMIN block — только superadmin/owner, скрыт у HR-only
    if (isPlatformAdmin) {
      const adminItems: { path: string; icon: LucideIcon; label: string }[] = [
        { path: "/departments", icon: Building2, label: "Департаменты" },
        { path: "/settings", icon: Settings, label: "Настройки" },
      ];
      if (user?.role === "superadmin") {
        adminItems.unshift({
          path: "/users",
          icon: UserCog,
          label: "Пользователи",
        });
        adminItems.push({
          path: "/admin/simulator",
          icon: Shield,
          label: "Симулятор ролей",
        });
      }
      sections.push({
        id: "admin",
        label: "Управление",
        items: adminItems,
      });
    }

    return sections;
  }, [user?.role, user?.org_role, hasFeature]);

  // Flat list for mobile bottom nav
  const navItems = useMemo(() => {
    return navSections.flatMap((s) => s.items);
  }, [navSections]);

  const mobileNavItems = useMemo(() => {
    return (
      navSections.find((section) => section.id === activeNavigationBlock)?.items ??
      navItems
    );
  }, [activeNavigationBlock, navItems, navSections]);

  const hrMobileNavItems = useMemo(
    () => [
      { path: "/all-candidates", icon: Users, label: "Все кандидаты" },
      { path: "/analytics", icon: BarChart3, label: "Аналитика" },
      { path: "/vacancies", icon: GitBranch, label: "Заявки" },
      { path: "/my-funnels", icon: Briefcase, label: "Мои вакансии" },
      { path: "/my-funnels?status=closed", icon: FolderKanban, label: "Закрытые вакансии" },
    ],
    [],
  );

  const activeMobileNavItems = isHrSidebar ? hrMobileNavItems : mobileNavItems;

  const handleBlockSwitch = useCallback(
    (section: NavSection) => {
      setActiveBlock(section.id);
      const targetPath = section.items[0]?.path;
      if (targetPath && location.pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [location.pathname, navigate],
  );

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleHrSettingsNavigate = (path: string) => {
    setShowHrSettingsModal(false);
    navigate(path);
  };

  const isHrSidebarAdmin =
    user?.role === "superadmin" ||
    user?.org_role === "owner" ||
    user?.org_role === "admin";
  const sidebarSearchParams = new URLSearchParams(location.search);
  const sidebarSelectedVacancyId = sidebarSearchParams.get("v");
  const isClosedFunnelsView =
    location.pathname === "/my-funnels" &&
    sidebarSearchParams.get("status") === "closed";
  const isMyFunnelsRootView =
    location.pathname === "/my-funnels" &&
    !sidebarSelectedVacancyId &&
    !isClosedFunnelsView;
  // Все исходные заявки, у которых уже есть клон («взяли в работу»).
  // Оригинал после взятия переходит в status=open и без этого фильтра
  // дублировал клон в «Мои вакансии» (видно как два одинаковых «Тест»).
  const allClonedSourceIds = new Set<number>();
  vacancies.forEach((v) => {
    const src = (v.extra_data as Record<string, unknown> | undefined)
      ?.cloned_from_request_id;
    if (typeof src === "number") allClonedSourceIds.add(src);
  });
  const sidebarOpenVacancies = vacancies
    .filter((v) => v.status === "open")
    .filter((v) => !allClonedSourceIds.has(v.id))
    .filter((v) => isHrSidebarAdmin || (user && v.created_by === user.id));
  // Заявки, которые ТЕКУЩИЙ юзер уже взял в работу (есть свой клон).
  // После «Взять в работу» исходная заявка должна пропасть из списка —
  // она уже взята. Раньше она оставалась висеть.
  const myTakenRequestIds = new Set<number>();
  if (user) {
    vacancies.forEach((v) => {
      if (v.created_by !== user.id) return;
      const src = (v.extra_data as Record<string, unknown> | undefined)
        ?.cloned_from_request_id;
      if (typeof src === "number") myTakenRequestIds.add(src);
    });
  }
  const sidebarRequestVacancies = vacancies
    .filter(
      (v) =>
        v.status === "pending_review" ||
        v.status === "draft" ||
        v.status === "open" ||
        v.status === "paused",
    )
    .filter((v) => {
      // Клон (вакансия, взятая рекрутёром в работу) — это НЕ заявка,
      // а рабочая копия в «Мои вакансии». Без этой проверки после
      // «Взять в работу» клон висел дубликатом в «Заявки», и каждый
      // повторный клик плодил ещё один.
      const clonedFrom = (v.extra_data as Record<string, unknown> | undefined)
        ?.cloned_from_request_id;
      if (typeof clonedFrom === "number") return false;
      // Заявку, которую текущий юзер уже взял в работу, прячем —
      // и для админа, и для рекрутёра.
      if (myTakenRequestIds.has(v.id)) return false;
      if (isHrSidebarAdmin) {
        if (v.assigned_to_all) return false;
        if (v.assigned_to && v.assigned_to.length > 0) return false;
        return true;
      }
      if (!user) return false;
      // Рекрутёр видит назначенные на него заявки И свои собственные
      // созданные через «+» — раньше своя заявка скрывалась и казалось
      // что создание не сработало.
      if (v.created_by === user.id) return true;
      if (v.assigned_to_all) return true;
      if (v.assigned_to && v.assigned_to.includes(user.id)) return true;
      return false;
    })
    .slice(0, 2);
  const getSidebarRequestAuthor = (vacancy: Vacancy) =>
    vacancy.created_by_name ||
    vacancy.hiring_manager_name ||
    "Автор не указан";

  return (
    <div
      className={clsx(
        isHrSidebar
          ? "hf-hr-layout-shell hf-hr-layout-shell--hr"
          : "app-layout-shell",
      )}
    >
      <BackgroundEffects />
      <AnimatePresence>
        {showHrSettingsModal && (
          <HrSettingsModal
            canUseAdmin={isHrSidebarAdmin}
            onClose={() => setShowHrSettingsModal(false)}
            onNavigate={handleHrSettingsNavigate}
          />
        )}
      </AnimatePresence>
      {/* Desktop Sidebar */}
      <aside
        style={isHrSidebar ? { width: hrSidebarWidth } : undefined}
        className={clsx(
          "hidden lg:flex h-screen min-h-0 flex-col",
          isHrSidebar
            ? "hf-hr-sidebar"
            : "w-64 app-sidebar-default glass border-r border-[color:var(--hf-workspace-divider)]",
        )}
        role="navigation"
        aria-label="Main navigation"
      >
        {isHrSidebar ? (
          <>
            <div
              className="hf-hr-sidebar-card"
            >
              <div className="hf-hr-block-tabs">
                {navSections.map((section) => {
                  const Icon = BLOCK_ICONS[section.id] || LayoutDashboard;
                  const isActive = activeNavigationBlock === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => handleBlockSwitch(section)}
                      className={clsx(
                        "hf-hr-block-tab",
                        isActive && "hf-hr-block-tab-active",
                      )}
                      title={section.label}
                    >
                      <Icon className="hf-hr-block-icon" />
                      <span className="max-w-full truncate">
                        {section.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <nav
                className={clsx(
                  "hf-hr-nav",
                  showHrFunnelsPicker && "hf-hr-nav-popover-open",
                )}
                aria-label="Primary navigation"
              >
                <div className="hf-hr-nav-list">
                  <NavLink
                    to="/all-candidates"
                    data-tour={pathToTourAttribute["/all-candidates"]}
                    className={({ isActive }) =>
                      clsx(
                        "hf-hr-nav-item",
                        isActive && "hf-hr-nav-item-active",
                      )
                    }
                  >
                    <HfSpriteIcon id="home-20" className="hf-hr-nav-icon" />
                    Все кандидаты
                  </NavLink>
                  <NavLink
                    to="/analytics"
                    data-tour={pathToTourAttribute["/analytics"]}
                    className={({ isActive }) =>
                      clsx(
                        "hf-hr-nav-item",
                        isActive && "hf-hr-nav-item-active",
                      )
                    }
                  >
                    <HfSpriteIcon
                      id="graph-20"
                      className="hf-hr-nav-icon"
                    />
                    Аналитика
                  </NavLink>
                </div>

                <div className="hf-hr-sidebar-divider hf-hr-sidebar-divider-requests" />

                <div>
                  <button
                    type="button"
                    onClick={() => setExpandedRequests(!expandedRequests)}
                    className="hf-hr-nav-item hf-hr-nav-item-white w-full"
                    aria-expanded={expandedRequests}
                  >
                    <HfSpriteIcon
                      id="edit-2-20"
                      className="hf-hr-nav-icon"
                    />
                    <span className="min-w-0 flex-1">Заявки</span>
                    <span className="hf-hr-secondary-text">
                      {expandedRequests ? "Свернуть" : "Развернуть"}
                    </span>
                  </button>
                  {expandedRequests && (
                    <div className="hf-hr-request-list">
                      {sidebarRequestVacancies.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => openVacancyModal(v.id)}
                          className="group hf-hr-request-item"
                        >
                          <span
                            className={clsx(
                              "hf-hr-request-dot",
                              v.status === "paused"
                                ? "bg-[var(--hf-sidebar-status-paused)]"
                                : "bg-[var(--hf-sidebar-status-active)]",
                            )}
                          />
                          <span className="min-w-0">
                            <span className="hf-hr-request-title">
                              {v.title}
                            </span>
                            <span className="hf-hr-request-meta">
                              {getSidebarRequestAuthor(v)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hf-hr-sidebar-divider hf-hr-sidebar-divider-funnels" />

                <div className="hf-hr-funnels-picker-wrap" ref={hrFunnelsPickerRef}>
                  <div className="hf-hr-funnels-header">
                    <button
                      type="button"
                      className={clsx(
                        "hf-hr-nav-item hf-hr-funnels-trigger min-w-0",
                        isMyFunnelsRootView
                          ? "hf-hr-nav-item-active"
                          : "hf-hr-nav-item-white",
                      )}
                      onClick={() => setShowHrFunnelsPicker((value) => !value)}
                      aria-label="Выбрать владельца вакансий"
                      aria-expanded={showHrFunnelsPicker}
                      aria-haspopup="listbox"
                    >
                      <HfSpriteIcon
                        id="business-folder"
                        className="hf-hr-nav-icon"
                      />
                      <span className="truncate">Мои вакансии</span>
                      <span className="hf-hr-funnels-trigger-caret">
                        <ChevronDown
                          className={clsx(
                            "hf-hr-chevron-icon",
                            showHrFunnelsPicker && "rotate-180",
                          )}
                        />
                      </span>
                    </button>
                  </div>
                  <AnimatePresence>
                    {showHrFunnelsPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.985 }}
                        transition={{ duration: 0.12, ease: "easeOut" }}
                        className="hf-hr-funnels-picker"
                        role="listbox"
                      >
                        <label className="hf-hr-funnels-search">
                          <Search className="hf-hr-funnels-search-icon" />
                          <input
                            className="hf-hr-funnels-search-input"
                            placeholder="Поиск..."
                          />
                        </label>
                        <button
                          type="button"
                          className="hf-hr-funnels-option"
                          onClick={() => {
                            setShowHrFunnelsPicker(false);
                            navigate("/my-funnels");
                          }}
                          role="option"
                          aria-selected="true"
                        >
                          <Check className="hf-hr-funnels-check" />
                          <span className="hf-hr-funnels-avatar">
                            {user?.name?.[0]?.toUpperCase() || "Я"}
                          </span>
                          <span className="hf-hr-funnels-option-text">
                            <span className="hf-hr-funnels-option-title">
                              Я, {user?.name || user?.email || "Профиль"}
                            </span>
                            <span className="hf-hr-funnels-option-subtitle">
                              {user?.email || "—"}
                            </span>
                          </span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {sidebarOpenVacancies.length > 0 && (
                    <div className="hf-hr-subnav">
                      {sidebarOpenVacancies.map((v) => (
                        <NavLink
                          key={v.id}
                          to={`/my-funnels?v=${v.id}`}
                          className={() =>
                            clsx(
                              "hf-hr-subnav-link",
                              sidebarSelectedVacancyId === String(v.id) &&
                                "hf-hr-subnav-link-active",
                            )
                          }
                        >
                          <span className="hf-hr-request-title">
                            {v.title}
                          </span>
                          <span className="hf-hr-request-meta">
                            {typeof (
                              v.extra_data as
                                | Record<string, unknown>
                                | undefined
                            )?.department === "string"
                              ? ((v.extra_data as Record<string, unknown>)
                                  .department as string)
                              : "IT"}
                          </span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hf-hr-sidebar-divider hf-hr-sidebar-divider-closed" />

                <NavLink
                  to="/my-funnels?status=closed"
                  className={clsx(
                    "hf-hr-nav-item",
                    isClosedFunnelsView
                      ? "hf-hr-nav-item-active"
                      : "hf-hr-nav-item-white",
                  )}
                >
                  <HfSpriteIcon
                    id="archive-2-20"
                    className="hf-hr-nav-icon"
                  />
                  <span className="min-w-0 flex-1">Закрытые вакансии</span>
                </NavLink>
              </nav>

              <div
                ref={hrFabActionsRef}
                className="hf-hr-fab-wrap"
              >
                <AnimatePresence>
                  {showHrFabActions && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.98 }}
                      transition={{ duration: 0.12, ease: "easeOut" }}
                      className="hf-hr-fab-menu"
                    >
                      {[
                        {
                          label: "Добавить вакансию",
                          action: () => setShowFabVacancyForm(true),
                        },
                        {
                          label: "Добавить кандидата",
                          action: () => navigate("/all-candidates?add=resume"),
                        },
                        {
                          label: "Заявка на подбор",
                          action: () => navigate("/vacancies"),
                        },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            item.action();
                            setShowHrFabActions(false);
                          }}
                          className="hf-hr-fab-menu-item"
                        >
                          {item.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  onClick={() => setShowHrFabActions((open) => !open)}
                  className="hf-hr-fab"
                  aria-label="Открыть меню добавления"
                >
                  <Plus className="hf-hr-fab-icon" />
                </button>
              </div>

              <div className="hf-hr-sidebar-bottom">
                <div className="hf-hr-user-row hf-hr-bottom-row">
                  <button
                    type="button"
                    onClick={() => setShowHrUserMenu((open) => !open)}
                    className="hf-hr-user-toggle"
                    aria-expanded={showHrUserMenu}
                    aria-label={
                      showHrUserMenu
                        ? "Свернуть меню пользователя"
                        : "Развернуть меню пользователя"
                    }
                  >
                    <span className="hf-hr-user-avatar">
                      {user?.name?.[0]?.toUpperCase() || "U"}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="hf-hr-user-name">
                        {user?.name}
                      </span>
                      <span className="hf-hr-user-email">
                        {user?.email}
                      </span>
                    </span>
                    <ChevronDown
                      className={clsx(
                        "hf-hr-user-chevron",
                        showHrUserMenu && "hf-hr-user-chevron-open",
                      )}
                      strokeWidth={1.8}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHrSettingsModal(true)}
                    aria-label="Открыть настройки HR"
                    title="Настройки"
                    className="hf-hr-settings-btn"
                  >
                    <Settings className="hf-hr-settings-icon" strokeWidth={1.8} />
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {showHrUserMenu && (
                    <motion.div
                      key="hr-user-menu"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                      className="hf-hr-user-menu"
                    >
                      <div className="relative hf-hr-bottom-row" ref={notifRef}>
                        <button
                          type="button"
                          onClick={handleToggleNotifications}
                          className="hf-hr-nav-item w-full text-[color:var(--hf-white-alpha-72)]"
                        >
                          <Bell className="h-[var(--hf-avatar-3xs)] w-[var(--hf-avatar-3xs)]" strokeWidth={1.8} />
                          <span className="min-w-0 flex-1 truncate text-left">
                            Уведомления
                          </span>
                          {unreadCount > 0 && (
                            <span className="flex min-w-[18px] items-center justify-center rounded-full bg-[var(--hf-red-500)] px-[5px] text-[length:var(--hf-fs-5xs)] font-bold leading-[16px] text-[var(--hf-white)]">
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          )}
                        </button>

                        {showNotifications && (
                          <div className="hf-hr-notifications-popover absolute bottom-full left-0 z-[120] mb-2 w-80 max-h-96 overflow-hidden rounded-xl shadow-[var(--hf-shadow-2xl)]">
                            <div className="hf-hr-notifications-header flex items-center justify-between px-4 py-3">
                              <span className="hf-hr-notifications-title text-sm font-medium">
                                Уведомления
                              </span>
                              {unreadCount > 0 && (
                                <button
                                  type="button"
                                  onClick={handleMarkAllRead}
                                  className="flex items-center gap-1 text-xs text-[var(--hf-status-blue)] transition-colors hover:text-[var(--hf-cyan-400)]"
                                >
                                  <Check className="h-3 w-3" />
                                  Прочитать все
                                </button>
                              )}
                            </div>
                            <div className="max-h-80 overflow-y-auto">
                              {notificationsLoading ? (
                                <div className="flex items-center justify-center py-8">
                                  <div className="hf-loading-spinner h-5 w-5 border-2" />
                                </div>
                              ) : notificationsList.length === 0 ? (
                                <div className="hf-hr-notifications-empty py-8 text-center text-xs">
                                  Нет уведомлений
                                </div>
                              ) : (
                                notificationsList.map((notif) => (
                                  <button
                                    key={notif.id}
                                    type="button"
                                    onClick={() => {
                                      if (!notif.is_read) handleMarkRead(notif.id);
                                      if (notif.link) {
                                        navigate(notif.link);
                                        setShowNotifications(false);
                                      }
                                    }}
                                    className={clsx(
                                      "hf-hr-notifications-item w-full px-4 py-3 text-left transition-colors",
                                      !notif.is_read && "hf-hr-notifications-item-unread",
                                    )}
                                  >
                                    <div className="flex items-start gap-2">
                                      {!notif.is_read && (
                                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--hf-status-blue)]" />
                                      )}
                                      <div
                                        className={clsx(
                                          "min-w-0 flex-1",
                                          notif.is_read && "ml-4",
                                        )}
                                      >
                                        <p className="hf-hr-notifications-item-title truncate text-xs font-medium">
                                          {notif.title}
                                        </p>
                                        {notif.message && (
                                          <p className="hf-hr-notifications-item-message mt-0.5 truncate text-[length:var(--hf-fs-4xs)]">
                                            {notif.message}
                                          </p>
                                        )}
                                        <p className="hf-hr-notifications-item-time mt-1 text-[length:var(--hf-fs-5xs)]">
                                          {new Date(notif.created_at).toLocaleString(
                                            "ru-RU",
                                            {
                                              day: "numeric",
                                              month: "short",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            },
                                          )}
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

                      {!isHrSidebar && <ThemeToggle />}

                      <NavLink
                        to="/my-profile"
                        className={({ isActive }) =>
                          clsx(
                            "hf-hr-nav-item w-full",
                            isActive
                              ? "hf-hr-nav-item-active"
                              : "text-[color:var(--hf-white-alpha-72)]",
                          )
                        }
                      >
                        <User className="h-[var(--hf-avatar-3xs)] w-[var(--hf-avatar-3xs)]" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1 truncate text-left">
                          Мой профиль
                        </span>
                      </NavLink>

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="hf-hr-nav-item w-full text-[color:var(--hf-white-alpha-72)] hover:bg-[var(--hf-status-red-bg)] hover:text-[var(--hf-red-300)]"
                        aria-label="Выйти из аккаунта"
                      >
                        <LogOut className="h-[var(--hf-avatar-3xs)] w-[var(--hf-avatar-3xs)]" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1 truncate text-left">
                          Выход
                        </span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <button
              type="button"
              aria-label="Изменить ширину HR-сайдбара"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsHrSidebarResizing(true);
              }}
              className={clsx(
                "hf-hr-resizer",
                isHrSidebarResizing && "hf-hr-resizer-active",
              )}
            >
              <span className="hf-hr-resizer-line" />
              <span className="hf-hr-resizer-handle" />
            </button>
          </>
        ) : (
          <>
            {/* Block switcher — top row of icons */}
            <div className="p-3 border-b border-[color:var(--hf-workspace-divider)]">
              <div className="flex items-center gap-1">
                {navSections.map((section) => {
                  const Icon = BLOCK_ICONS[section.id] || LayoutDashboard;
                  const isActive = activeNavigationBlock === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => handleBlockSwitch(section)}
                      className={clsx(
                        "flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl transition-all duration-200",
                        isActive
                          ? clsx("border", BLOCK_ACTIVE_BG[section.id])
                          : "text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)] border border-transparent",
                      )}
                      title={section.label}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[length:var(--hf-fs-6xs)] font-semibold uppercase tracking-wider">
                        {section.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active block navigation */}
            <nav
              className="flex-1 min-h-0 px-3 py-3 overflow-y-auto"
              aria-label="Primary navigation"
            >
              {navSections
                .filter((s) => s.id === activeNavigationBlock)
                .map((section) => (
                  <div key={section.id}>
                    <div className="space-y-0.5">
                      {section.items.map((item) => {
                        // "Мои воронки" — expandable with vacancy sub-list
                        if (item.path === "/my-funnels") {
                          // Логика та же, что на RecruiterFunnelsPage: HR Admin видит все
                          // open/paused, рекрутёр — только свои (created_by === user.id).
                          const isAdminViewer =
                            user?.role === "superadmin" ||
                            user?.org_role === "owner" ||
                            user?.org_role === "admin";
                          const myVacancies = vacancies
                            .filter(
                              (v) =>
                                v.status === "open" || v.status === "paused",
                            )
                            .filter(
                              (v) =>
                                isAdminViewer ||
                                (user && v.created_by === user.id),
                            )
                            .slice(0, 10);
                          return (
                            <div key={item.path}>
                              <div className="flex items-center">
                                <NavLink
                                  to={item.path}
                                  className={({ isActive }) =>
                                    clsx(
                                      "flex-1 flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all duration-200 text-sm",
                                      isActive
                                        ? clsx(BLOCK_ACCENT[activeNavigationBlock])
                                        : "text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)]",
                                    )
                                  }
                                >
                                  <item.icon className="w-4 h-4 flex-shrink-0" />
                                  <span className="font-medium truncate">
                                    {item.label}
                                  </span>
                                </NavLink>
                                {myVacancies.length > 0 && (
                                  <button
                                    onClick={() =>
                                      setExpandedFunnels(!expandedFunnels)
                                    }
                                    className="p-1.5 rounded-lg text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)] transition-all"
                                  >
                                    <ChevronDown
                                      className={clsx(
                                        "w-3.5 h-3.5 transition-transform",
                                        expandedFunnels && "rotate-180",
                                      )}
                                    />
                                  </button>
                                )}
                              </div>
                              {expandedFunnels && myVacancies.length > 0 && (
                                <div className="ml-4 pl-3 border-l border-[color:var(--hf-white-alpha-05)] mt-0.5 space-y-0.5">
                                  {myVacancies.map((v) => (
                                    <NavLink
                                      key={v.id}
                                      to={`/my-funnels?v=${v.id}`}
                                      className={({ isActive }) =>
                                        clsx(
                                          "flex items-center gap-2 py-1.5 px-2 rounded-md text-xs transition-all",
                                          isActive
                                 ? "text-[var(--hf-status-blue)] bg-[var(--hf-status-blue-bg)]"
                                            : "text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)]",
                                        )
                                      }
                                    >
                                      <span
                                        className={clsx(
                                          "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                          v.status === "open"
                                            ? "bg-[var(--hf-status-green)]"
                                            : "bg-[var(--hf-status-yellow)]",
                                        )}
                                      />
                                      <span className="truncate">
                                        {v.title}
                                      </span>
                                    </NavLink>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }

                        // "Заявки" — expandable with vacancy request sub-list
                        if (item.path === "/vacancies") {
                          // Админ видит НЕназначенные заявки (нужно распределить).
                          // Рекрутёр — назначенные на него и ещё не взятые в работу.
                          const isAdminUser =
                            user?.role === "superadmin" ||
                            user?.org_role === "owner" ||
                            user?.org_role === "admin";
                          const myClonesFor = new Set<number>();
                          if (user) {
                            vacancies.forEach((v) => {
                              if (v.created_by !== user.id) return;
                              const src = (
                                v.extra_data as
                                  | Record<string, unknown>
                                  | undefined
                              )?.cloned_from_request_id;
                              if (typeof src === "number") myClonesFor.add(src);
                            });
                          }
                          const requestVacancies = vacancies
                            .filter((v) => {
                              const statusOk =
                                v.status === "pending_review" ||
                                v.status === "draft" ||
                                v.status === "open" ||
                                v.status === "paused";
                              if (!statusOk) return false;
                              if (isAdminUser) {
                                if (v.assigned_to_all) return false;
                                if (v.assigned_to && v.assigned_to.length > 0)
                                  return false;
                                return true;
                              }
                              if (!user) return false;
                              if (v.created_by === user.id) return false;
                              if (myClonesFor.has(v.id)) return false;
                              if (v.assigned_to_all) return true;
                              if (
                                v.assigned_to &&
                                v.assigned_to.includes(user.id)
                              )
                                return true;
                              return false;
                            })
                            .slice(0, 15);
                          return (
                            <div key={item.path}>
                              <div className="flex items-center">
                                <NavLink
                                  to={item.path}
                                  className={({ isActive }) =>
                                    clsx(
                                      "flex-1 flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all duration-200 text-sm",
                                      isActive
                                        ? clsx(BLOCK_ACCENT[activeNavigationBlock])
                                        : "text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)]",
                                    )
                                  }
                                >
                                  <item.icon className="w-4 h-4 flex-shrink-0" />
                                  <span className="font-medium truncate">
                                    {item.label}
                                  </span>
                                  {assignedDraftCount > 0 && (
                                    <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[length:var(--hf-fs-5xs)] font-bold bg-[var(--hf-status-orange)] text-[var(--hf-white)] rounded-full">
                                      {assignedDraftCount > 99
                                        ? "99+"
                                        : assignedDraftCount}
                                    </span>
                                  )}
                                </NavLink>
                                {requestVacancies.length > 0 && (
                                  <button
                                    onClick={() =>
                                      setExpandedRequests(!expandedRequests)
                                    }
                                    className="p-1.5 rounded-lg text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)] transition-all"
                                  >
                                    <ChevronDown
                                      className={clsx(
                                        "w-3.5 h-3.5 transition-transform",
                                        expandedRequests && "rotate-180",
                                      )}
                                    />
                                  </button>
                                )}
                              </div>
                              {expandedRequests &&
                                requestVacancies.length > 0 && (
                                  <div className="ml-4 pl-3 border-l border-[color:var(--hf-white-alpha-05)] mt-0.5 space-y-0.5">
                                    {requestVacancies.map((v) => (
                                      <button
                                        key={v.id}
                                        onClick={() => openVacancyModal(v.id)}
                                        className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-xs transition-all text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)]"
                                      >
                                        <span
                                          className={clsx(
                                            "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                            v.status === "pending_review"
                                              ? "bg-[var(--hf-status-purple)]"
                                              : v.status === "draft"
                                                ? "bg-[var(--hf-status-orange)]"
                                                : v.status === "open"
                                                  ? "bg-[var(--hf-status-green)]"
                                                  : "bg-[var(--hf-status-yellow)]",
                                          )}
                                        />
                                        <span className="truncate text-left">
                                          {v.title}
                                        </span>
                                        <span className="text-[var(--hf-dark-500)] truncate ml-auto text-[length:var(--hf-fs-5xs)]">
                                          {getSidebarRequestAuthor(v)}
                                        </span>
                                      </button>
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
                            end={item.path.includes("?")}
                            data-tour={pathToTourAttribute[item.path]}
                            className={({ isActive }) =>
                              clsx(
                                "flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all duration-200 text-sm",
                                isActive
                                  ? clsx(BLOCK_ACCENT[activeNavigationBlock])
                                  : "text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)]",
                              )
                            }
                          >
                            <item.icon className="w-4 h-4 flex-shrink-0" />
                            <span className="font-medium truncate">
                              {item.label}
                            </span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </nav>

            <div className="app-sidebar-footer flex-shrink-0 border-t border-[color:var(--hf-workspace-divider)]">
              {/* Notification bell */}
              <div className="relative app-sidebar-footer-section" ref={notifRef}>
                <button
                  onClick={handleToggleNotifications}
                  className="app-sidebar-footer-action w-full text-[var(--hf-dark-300)] hover:text-[var(--hf-status-blue)] hover:bg-[var(--hf-status-blue-bg)]"
                >
                  <Bell className="w-5 h-5" />
                  <span className="font-medium text-sm">Уведомления</span>
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 left-7 w-4.5 h-4.5 flex items-center justify-center text-[length:var(--hf-fs-6xs)] font-bold bg-[var(--hf-red-500)] text-[var(--hf-white)] rounded-full min-w-[18px] px-1">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications dropdown */}
                {showNotifications && (
                  <div className="absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-[var(--hf-dark-panel-alpha-95)] backdrop-blur-xl border border-[color:var(--hf-white-alpha-10)] rounded-xl shadow-[var(--hf-shadow-2xl)] overflow-hidden z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--hf-white-alpha-05)]">
                      <span className="text-sm font-medium text-[var(--hf-white)]">
                        Уведомления
                      </span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="flex items-center gap-1 text-xs text-[var(--hf-status-blue)] hover:text-[var(--hf-cyan-400)] transition-colors"
                        >
                          <Check className="w-3 h-3" />
                          Прочитать все
                        </button>
                      )}
                    </div>
                    <div className="overflow-y-auto max-h-80">
                      {notificationsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="hf-loading-spinner h-5 w-5 border-2" />
                        </div>
                      ) : notificationsList.length === 0 ? (
                        <div className="py-8 text-center text-xs text-[color:var(--hf-white-alpha-30)]">
                          Нет уведомлений
                        </div>
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
                              "w-full text-left px-4 py-3 border-b border-[color:var(--hf-white-alpha-03)] hover:bg-[var(--hf-white-alpha-03)] transition-colors",
                              !notif.is_read && "bg-[var(--hf-white-alpha-05)]",
                            )}
                          >
                            <div className="flex items-start gap-2">
                              {!notif.is_read && (
                                <span className="w-2 h-2 rounded-full bg-[var(--hf-status-blue)] flex-shrink-0 mt-1.5" />
                              )}
                              <div
                                className={clsx(
                                  "flex-1 min-w-0",
                                  notif.is_read && "ml-4",
                                )}
                              >
                                <p className="text-xs font-medium text-[var(--hf-white)] truncate">
                                  {notif.title}
                                </p>
                                {notif.message && (
                                  <p className="text-[length:var(--hf-fs-4xs)] text-[color:var(--hf-white-alpha-30)] truncate mt-0.5">
                                    {notif.message}
                                  </p>
                                )}
                                <p className="text-[length:var(--hf-fs-5xs)] text-[color:var(--hf-white-alpha-20)] mt-1">
                                  {new Date(notif.created_at).toLocaleString(
                                    "ru-RU",
                                    {
                                      day: "numeric",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
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

              <div className="app-sidebar-user-row">
                <div className="w-10 h-10 rounded-full bg-[var(--hf-accent-bg-20)] flex items-center justify-center">
                  <span className="text-[var(--hf-accent)] font-semibold">
                    {user?.name?.[0]?.toUpperCase() || "U"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-[var(--hf-dark-400)] truncate">
                    {user?.email}
                  </p>
                  {customRoleName && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-[var(--hf-accent-bg-20)] text-[var(--hf-accent)] rounded-full">
                      {customRoleName}
                    </span>
                  )}
                </div>
              </div>
              {!isHrSidebar && <ThemeToggle />}
              <NavLink
                to="/my-profile"
                className={({ isActive }) =>
                  clsx(
                    "app-sidebar-footer-action w-full mb-1",
                    isActive
                      ? "text-[var(--hf-accent)] bg-[var(--hf-accent-bg-10)]"
                      : "text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-alpha-100)]",
                  )
                }
              >
                <User className="w-5 h-5" />
                <span className="font-medium">Мой профиль</span>
              </NavLink>
              <button
                onClick={handleLogout}
                className="app-sidebar-footer-action w-full text-[var(--hf-dark-300)] hover:text-[var(--hf-status-red)] hover:bg-[var(--hf-status-red-bg)]"
                aria-label="Выйти из аккаунта"
              >
                <LogOut className="w-5 h-5" aria-hidden="true" />
                <span className="font-medium">Выход</span>
              </button>
            </div>
          </>
        )}
      </aside>

      {/* Mobile Header */}
      <header
        className={clsx(
          "lg:hidden border-b px-4 py-3 flex items-center justify-between",
          isHrSidebar
            ? "hf-hr-mobile-header"
            : "glass border-[color:var(--hf-white-alpha-05)]",
        )}
        role="banner"
      >
        <h1
          className={clsx(
            "text-lg font-bold",
            isHrSidebar
              ? "hf-hr-mobile-brand"
              : "bg-[linear-gradient(to_right,var(--hf-accent),var(--hf-accent-hover))] bg-clip-text text-transparent",
          )}
        >
          Enceladus
        </h1>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className={clsx(
            "p-2 rounded-lg",
            isHrSidebar
              ? "hf-hr-mobile-menu-trigger"
              : "hover:bg-[var(--hf-bg-dark-panel)]",
          )}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
        >
          {mobileMenuOpen ? (
            <X className="w-6 h-6" aria-hidden="true" />
          ) : (
            <Menu className="w-6 h-6" aria-hidden="true" />
          )}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className={clsx(
            "lg:hidden fixed inset-0 z-50 animate-[fadeIn_0.15s_ease]",
            isHrSidebar ? "hf-hr-mobile-menu-overlay" : "bg-[var(--hf-black-alpha-80)]",
          )}
          onClick={() => setMobileMenuOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Мобильное меню"
        >
          <div
            className={clsx(
              "absolute right-0 top-0 h-full w-64 flex flex-col animate-[slideInRight_0.2s_ease]",
              isHrSidebar ? "hf-hr-mobile-menu" : "glass",
            )}
            onClick={(e) => e.stopPropagation()}
            id="mobile-menu"
          >
            <nav
              className="p-3 overflow-y-auto flex-1"
              aria-label="Мобильная навигация"
            >
              {isHrSidebar ? (
                <div className="hf-hr-mobile-nav-list">
                  {hrMobileNavItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          "hf-hr-mobile-nav-item",
                          isActive && "hf-hr-mobile-nav-item-active",
                        )
                      }
                    >
                      <item.icon className="hf-hr-mobile-nav-icon" aria-hidden="true" />
                      <span className="font-medium truncate">
                        {item.label}
                      </span>
                    </NavLink>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex gap-1 mb-4">
                    {navSections.map((section) => {
                      const Icon = BLOCK_ICONS[section.id] || LayoutDashboard;
                      return (
                        <button
                          key={section.id}
                          onClick={() => handleBlockSwitch(section)}
                          className={clsx(
                            "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all text-xs",
                            activeNavigationBlock === section.id
                              ? clsx("border", BLOCK_ACTIVE_BG[section.id])
                              : "text-[color:var(--hf-white-alpha-30)] border border-transparent",
                          )}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="text-[length:var(--hf-fs-6xs)] font-semibold uppercase">
                            {section.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {navSections
                    .filter((s) => s.id === activeNavigationBlock)
                    .map((section) => (
                      <div key={section.id}>
                        {section.items.map((item) => (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileMenuOpen(false)}
                            className={({ isActive }) =>
                              clsx(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm",
                                isActive
                                  ? clsx(BLOCK_ACCENT[activeNavigationBlock])
                                  : "text-[var(--hf-dark-300)] hover:text-[var(--hf-dark-100)] hover:bg-[var(--hf-bg-dark-panel)]",
                              )
                            }
                          >
                            <item.icon
                              className="w-4 h-4 flex-shrink-0"
                              aria-hidden="true"
                            />
                            <span className="font-medium truncate">
                              {item.label}
                            </span>
                          </NavLink>
                        ))}
                      </div>
                    ))}
                  {!isHrSidebar && <ThemeToggle />}
                </>
              )}
              <button
                onClick={handleLogout}
                className={clsx(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                  isHrSidebar
                    ? "hf-hr-mobile-logout"
                    : "text-[var(--hf-dark-300)] hover:text-[var(--hf-status-red)] hover:bg-[var(--hf-status-red-bg)]",
                )}
                aria-label="Выйти из аккаунта"
              >
                <LogOut className="w-5 h-5" aria-hidden="true" />
                <span className="font-medium">Выйти</span>
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main
        className={clsx(
          "flex-1 overflow-hidden flex flex-col",
          isHrSidebar ? "bg-[var(--hf-workspace-bg)]" : "bg-[var(--bg-body)]",
        )}
        role="main"
        aria-label="Main content"
      >
        {/* Telegram bot connect banner — показываем если у юзера не привязан tg */}
        <TelegramConnectBanner />
        {/* Impersonation Banner */}
        {isImpersonating() && user && (
          <div
            className="bg-[var(--hf-status-yellow-badge)] border-b border-[color:var(--hf-status-yellow-badge)] px-4 py-3 flex items-center justify-between"
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-[var(--hf-status-yellow)]" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-[var(--hf-yellow-300)]">
                  Режим имперсонации
                </p>
                <p className="text-xs text-[var(--hf-yellow-300)]">
                  Вы действуете от имени:{" "}
                  <span className="font-medium">{user.name}</span> ({user.email}
                  )
                  {user.original_user_name && (
                    <span className="ml-2">
                      • Вернуться к:{" "}
                      <span className="font-medium">
                        {user.original_user_name}
                      </span>
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={handleExitImpersonation}
              className="px-4 py-2 rounded-lg bg-[var(--hf-status-yellow-badge)] hover:bg-[var(--hf-status-yellow-bg)] text-[var(--hf-yellow-300)] hover:text-[var(--hf-yellow-300)] transition-colors text-sm font-medium border border-[color:var(--hf-status-yellow-badge)]"
              aria-label="Выйти из режима имперсонации"
            >
              Выйти из имперсонации
            </button>
          </div>
        )}

        <div
          className={clsx(
            "flex-1 overflow-y-auto overflow-x-hidden relative",
            isHrSidebar ? "bg-[var(--hf-workspace-bg)]" : "bg-[var(--bg-body)]",
          )}
        >
          <Outlet />

          {/* FAB — floating action button for HR block */}
          {isHrSidebar && !mobileMenuOpen && (
            <div className="lg:hidden">
              <FABButton
                onCreateVacancy={() => setShowFabVacancyForm(true)}
                onAddCandidate={() => setShowFabParserModal(true)}
              />
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav
        className={clsx(
          "lg:hidden border-t px-2 py-2 flex",
          isHrSidebar
            ? "hf-hr-mobile-bottom-nav"
            : "glass border-[color:var(--hf-white-alpha-05)]",
        )}
        aria-label="Нижняя навигация"
      >
        {activeMobileNavItems.slice(0, 4).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            data-tour={pathToTourAttribute[item.path]}
            className={({ isActive }) =>
              clsx(
                "flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all duration-200",
                isHrSidebar
                  ? isActive
                    ? "hf-hr-mobile-bottom-item-active"
                    : "hf-hr-mobile-bottom-item"
                  : isActive
                    ? "text-[var(--hf-accent)]"
                    : "text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-200)]",
              )
            }
            aria-label={item.label}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <span className="text-xs truncate max-w-full">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Sidebar Vacancy Modal */}
      <AnimatePresence>
        {sidebarVacancy && (
          sidebarVacancyMode === "view" ? (
            <SidebarRequestPreviewModal
              key={`sidebar-view-${sidebarVacancy.id}`}
              vacancy={sidebarVacancy}
              onClose={() => setSidebarVacancy(null)}
              onEdit={() => setSidebarVacancyMode("edit")}
              onTaken={() => setSidebarVacancy(null)}
            />
          ) : (
              <VacancyForm
                key={`sidebar-edit-${sidebarVacancy.id}`}
                vacancy={sidebarVacancy}
                onClose={() => setSidebarVacancy(null)}
                onSuccess={() => {
                  setSidebarVacancy(null);
                  fetchVacancies();
                }}
              />
          )
        )}
      </AnimatePresence>

      {/* FAB → Новая вакансия — открывается прямо здесь, без перехода на /vacancies */}
      <AnimatePresence>
        {showFabVacancyForm && (
          <VacancyForm
            key="fab-new-vacancy"
            onClose={() => setShowFabVacancyForm(false)}
            onSuccess={() => {
              setShowFabVacancyForm(false);
              fetchVacancies();
              toast.success("Вакансия создана");
            }}
          />
        )}
      </AnimatePresence>

      {/* FAB → Добавить кандидата — парсер резюме поверх текущей страницы */}
      <AnimatePresence>
        {showFabParserModal && (
          <ParserModal
            type="resume"
            onClose={() => setShowFabParserModal(false)}
            onParsed={() => {
              setShowFabParserModal(false);
              toast.success("Кандидат добавлен");
            }}
            onAttachedToEntity={() => {
              setShowFabParserModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
