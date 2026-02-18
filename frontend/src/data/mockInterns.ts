/**
 * Shared mock data for the Interns (Практиканты) section.
 * Used across InternsPage, InternAchievementsPage, InternInfoPage.
 */

// === Base Intern type ===

export interface Intern {
  id: number;
  name: string;
  position: string;
  email: string;
  phone: string;
  department: string;
  startDate: string;
  tags: string[];
  mentor: string;
  telegramUsername?: string;
}

export const MOCK_INTERNS: Intern[] = [
  {
    id: 1,
    name: 'Тест Алексей Петров',
    position: 'Frontend-разработчик',
    email: 'a.petrov@example.com',
    phone: '+7 (999) 123-45-67',
    department: 'Разработка',
    startDate: '2026-01-15',
    tags: ['React', 'TypeScript'],
    mentor: 'Иван Сидоров',
    telegramUsername: '@a_petrov',
  },
  {
    id: 2,
    name: 'Тест Мария Иванова',
    position: 'Backend-разработчик',
    email: 'm.ivanova@example.com',
    phone: '+7 (999) 234-56-78',
    department: 'Разработка',
    startDate: '2026-01-20',
    tags: ['Python', 'FastAPI'],
    mentor: 'Анна Козлова',
    telegramUsername: '@m_ivanova',
  },
  {
    id: 3,
    name: 'Тест Дмитрий Смирнов',
    position: 'Data Analyst',
    email: 'd.smirnov@example.com',
    phone: '+7 (999) 345-67-89',
    department: 'Аналитика',
    startDate: '2026-02-01',
    tags: ['SQL', 'Python', 'Tableau'],
    mentor: 'Олег Морозов',
    telegramUsername: '@d_smirnov',
  },
  {
    id: 4,
    name: 'Тест Елена Волкова',
    position: 'UI/UX Дизайнер',
    email: 'e.volkova@example.com',
    phone: '+7 (999) 456-78-90',
    department: 'Дизайн',
    startDate: '2026-02-05',
    tags: ['Figma', 'UI/UX'],
    mentor: 'Светлана Белова',
    telegramUsername: '@e_volkova',
  },
  {
    id: 5,
    name: 'Тест Николай Кузнецов',
    position: 'QA Engineer',
    email: 'n.kuznetsov@example.com',
    phone: '+7 (999) 567-89-01',
    department: 'Тестирование',
    startDate: '2026-01-25',
    tags: ['Selenium', 'Python'],
    mentor: 'Павел Новиков',
    telegramUsername: '@n_kuznetsov',
  },
  {
    id: 6,
    name: 'Тест Анна Соколова',
    position: 'DevOps Engineer',
    email: 'a.sokolova@example.com',
    phone: '+7 (999) 678-90-12',
    department: 'Инфраструктура',
    startDate: '2026-02-10',
    tags: ['Docker', 'CI/CD', 'Linux'],
    mentor: 'Дмитрий Орлов',
    telegramUsername: '@a_sokolova',
  },
];

// === Achievements mock data ===

export interface CompletedModule {
  id: number;
  name: string;
  completedDate: string;
  score: number;
}

export interface InProgressModule {
  id: number;
  name: string;
  progress: number;
}

export interface InternAchievementsData {
  completionStats: { completed: number; inProgress: number; notStarted: number };
  gradeStats: { excellent: number; good: number; satisfactory: number; needsImprovement: number };
  engagementLevel: number;
  completedModules: CompletedModule[];
  inProgressModules: InProgressModule[];
  averageScore: number;
  totalTimeSpent: string;
  lastVisit: string;
  streak: number;
}

export const MOCK_ACHIEVEMENTS: Record<number, InternAchievementsData> = {
  1: {
    completionStats: { completed: 8, inProgress: 3, notStarted: 2 },
    gradeStats: { excellent: 4, good: 3, satisfactory: 1, needsImprovement: 0 },
    engagementLevel: 82,
    completedModules: [
      { id: 1, name: 'Введение в React', completedDate: '2026-01-20', score: 95 },
      { id: 2, name: 'TypeScript основы', completedDate: '2026-01-25', score: 88 },
      { id: 3, name: 'Работа с API', completedDate: '2026-01-30', score: 92 },
      { id: 4, name: 'State Management', completedDate: '2026-02-03', score: 78 },
      { id: 5, name: 'Тестирование компонентов', completedDate: '2026-02-06', score: 85 },
      { id: 6, name: 'CSS и Tailwind', completedDate: '2026-02-08', score: 90 },
      { id: 7, name: 'Git Workflow', completedDate: '2026-02-10', score: 96 },
      { id: 8, name: 'Code Review практика', completedDate: '2026-02-14', score: 87 },
    ],
    inProgressModules: [
      { id: 9, name: 'Оптимизация производительности', progress: 65 },
      { id: 10, name: 'CI/CD интеграция', progress: 40 },
      { id: 11, name: 'Архитектурные паттерны', progress: 20 },
    ],
    averageScore: 88.9,
    totalTimeSpent: '124ч 30м',
    lastVisit: '2026-02-18',
    streak: 12,
  },
  2: {
    completionStats: { completed: 6, inProgress: 4, notStarted: 3 },
    gradeStats: { excellent: 3, good: 2, satisfactory: 1, needsImprovement: 0 },
    engagementLevel: 74,
    completedModules: [
      { id: 1, name: 'Python основы', completedDate: '2026-01-22', score: 92 },
      { id: 2, name: 'FastAPI фреймворк', completedDate: '2026-01-28', score: 88 },
      { id: 3, name: 'Базы данных (PostgreSQL)', completedDate: '2026-02-02', score: 85 },
      { id: 4, name: 'REST API дизайн', completedDate: '2026-02-05', score: 90 },
      { id: 5, name: 'Аутентификация и авторизация', completedDate: '2026-02-09', score: 76 },
      { id: 6, name: 'Docker основы', completedDate: '2026-02-13', score: 82 },
    ],
    inProgressModules: [
      { id: 7, name: 'Async Python', progress: 70 },
      { id: 8, name: 'SQLAlchemy 2.0', progress: 55 },
      { id: 9, name: 'Тестирование (pytest)', progress: 30 },
      { id: 10, name: 'Микросервисная архитектура', progress: 15 },
    ],
    averageScore: 85.5,
    totalTimeSpent: '98ч 15м',
    lastVisit: '2026-02-17',
    streak: 8,
  },
  3: {
    completionStats: { completed: 5, inProgress: 2, notStarted: 4 },
    gradeStats: { excellent: 2, good: 2, satisfactory: 1, needsImprovement: 0 },
    engagementLevel: 65,
    completedModules: [
      { id: 1, name: 'SQL основы', completedDate: '2026-02-03', score: 94 },
      { id: 2, name: 'Python для анализа', completedDate: '2026-02-06', score: 87 },
      { id: 3, name: 'Визуализация данных', completedDate: '2026-02-09', score: 80 },
      { id: 4, name: 'Статистика', completedDate: '2026-02-12', score: 75 },
      { id: 5, name: 'Tableau основы', completedDate: '2026-02-15', score: 91 },
    ],
    inProgressModules: [
      { id: 6, name: 'Machine Learning основы', progress: 45 },
      { id: 7, name: 'A/B тестирование', progress: 20 },
    ],
    averageScore: 85.4,
    totalTimeSpent: '76ч 40м',
    lastVisit: '2026-02-16',
    streak: 5,
  },
  4: {
    completionStats: { completed: 7, inProgress: 2, notStarted: 1 },
    gradeStats: { excellent: 5, good: 1, satisfactory: 1, needsImprovement: 0 },
    engagementLevel: 90,
    completedModules: [
      { id: 1, name: 'Основы UI/UX', completedDate: '2026-02-06', score: 96 },
      { id: 2, name: 'Figma мастерство', completedDate: '2026-02-08', score: 93 },
      { id: 3, name: 'Дизайн-система', completedDate: '2026-02-10', score: 91 },
      { id: 4, name: 'Прототипирование', completedDate: '2026-02-11', score: 88 },
      { id: 5, name: 'Юзабилити тестирование', completedDate: '2026-02-13', score: 94 },
      { id: 6, name: 'Анимация и Motion', completedDate: '2026-02-15', score: 97 },
      { id: 7, name: 'Типографика', completedDate: '2026-02-17', score: 78 },
    ],
    inProgressModules: [
      { id: 8, name: 'Дизайн для мобильных', progress: 60 },
      { id: 9, name: 'Accessibility (a11y)', progress: 35 },
    ],
    averageScore: 91.0,
    totalTimeSpent: '110ч 20м',
    lastVisit: '2026-02-18',
    streak: 15,
  },
  5: {
    completionStats: { completed: 4, inProgress: 3, notStarted: 3 },
    gradeStats: { excellent: 1, good: 2, satisfactory: 1, needsImprovement: 0 },
    engagementLevel: 58,
    completedModules: [
      { id: 1, name: 'Основы тестирования', completedDate: '2026-01-28', score: 82 },
      { id: 2, name: 'Selenium WebDriver', completedDate: '2026-02-03', score: 79 },
      { id: 3, name: 'API тестирование', completedDate: '2026-02-08', score: 91 },
      { id: 4, name: 'Тест-дизайн', completedDate: '2026-02-12', score: 74 },
    ],
    inProgressModules: [
      { id: 5, name: 'Нагрузочное тестирование', progress: 50 },
      { id: 6, name: 'CI/CD для QA', progress: 25 },
      { id: 7, name: 'Мобильное тестирование', progress: 10 },
    ],
    averageScore: 81.5,
    totalTimeSpent: '64ч 10м',
    lastVisit: '2026-02-15',
    streak: 3,
  },
  6: {
    completionStats: { completed: 6, inProgress: 3, notStarted: 2 },
    gradeStats: { excellent: 3, good: 2, satisfactory: 1, needsImprovement: 0 },
    engagementLevel: 77,
    completedModules: [
      { id: 1, name: 'Linux администрирование', completedDate: '2026-02-11', score: 93 },
      { id: 2, name: 'Docker и контейнеризация', completedDate: '2026-02-12', score: 90 },
      { id: 3, name: 'CI/CD пайплайны', completedDate: '2026-02-13', score: 86 },
      { id: 4, name: 'Мониторинг (Prometheus)', completedDate: '2026-02-15', score: 88 },
      { id: 5, name: 'Сети и безопасность', completedDate: '2026-02-16', score: 75 },
      { id: 6, name: 'Terraform основы', completedDate: '2026-02-17', score: 91 },
    ],
    inProgressModules: [
      { id: 7, name: 'Kubernetes', progress: 55 },
      { id: 8, name: 'AWS/GCP Cloud', progress: 30 },
      { id: 9, name: 'GitOps практики', progress: 15 },
    ],
    averageScore: 87.2,
    totalTimeSpent: '89ч 50м',
    lastVisit: '2026-02-18',
    streak: 9,
  },
};

// === Information page mock data ===

export interface InternChat {
  id: number;
  title: string;
  type: string;
  lastActivity: string;
}

export interface InternTrail {
  id: number;
  name: string;
  status: 'active' | 'completed' | 'pending';
  progress: number;
}

export interface InternWork {
  id: number;
  title: string;
  status: 'submitted' | 'reviewed' | 'pending' | 'returned';
  submittedDate?: string;
  grade?: number;
}

export interface InternInfoData {
  chats: InternChat[];
  trails: InternTrail[];
  works: InternWork[];
}

export const MOCK_INFO: Record<number, InternInfoData> = {
  1: {
    chats: [
      { id: 101, title: 'Frontend Team', type: 'work', lastActivity: '2026-02-18' },
      { id: 102, title: 'Практиканты 2026', type: 'hr', lastActivity: '2026-02-17' },
      { id: 103, title: 'React обсуждение', type: 'project', lastActivity: '2026-02-16' },
      { id: 104, title: 'Код-ревью', type: 'work', lastActivity: '2026-02-15' },
    ],
    trails: [
      { id: 201, name: 'Frontend Developer Path', status: 'active', progress: 75 },
      { id: 202, name: 'React Advanced', status: 'active', progress: 40 },
      { id: 203, name: 'Soft Skills', status: 'completed', progress: 100 },
      { id: 204, name: 'Git & DevOps Basics', status: 'completed', progress: 100 },
    ],
    works: [
      { id: 301, title: 'Лендинг страница', status: 'reviewed', submittedDate: '2026-02-10', grade: 92 },
      { id: 302, title: 'TODO приложение', status: 'reviewed', submittedDate: '2026-02-05', grade: 88 },
      { id: 303, title: 'Dashboard компонент', status: 'submitted', submittedDate: '2026-02-16' },
      { id: 304, title: 'API интеграция', status: 'pending' },
      { id: 305, title: 'Финальный проект', status: 'pending' },
    ],
  },
  2: {
    chats: [
      { id: 105, title: 'Backend Team', type: 'work', lastActivity: '2026-02-18' },
      { id: 106, title: 'Практиканты 2026', type: 'hr', lastActivity: '2026-02-17' },
      { id: 107, title: 'Python обсуждение', type: 'project', lastActivity: '2026-02-14' },
    ],
    trails: [
      { id: 205, name: 'Backend Developer Path', status: 'active', progress: 60 },
      { id: 206, name: 'Database Mastery', status: 'active', progress: 55 },
      { id: 207, name: 'API Design', status: 'completed', progress: 100 },
    ],
    works: [
      { id: 306, title: 'REST API сервис', status: 'reviewed', submittedDate: '2026-02-08', grade: 90 },
      { id: 307, title: 'CRUD приложение', status: 'reviewed', submittedDate: '2026-02-03', grade: 85 },
      { id: 308, title: 'Микросервис авторизации', status: 'submitted', submittedDate: '2026-02-15' },
      { id: 309, title: 'Оптимизация запросов', status: 'returned', submittedDate: '2026-02-12' },
    ],
  },
  3: {
    chats: [
      { id: 108, title: 'Analytics Team', type: 'work', lastActivity: '2026-02-16' },
      { id: 109, title: 'Практиканты 2026', type: 'hr', lastActivity: '2026-02-17' },
      { id: 110, title: 'Data Science Club', type: 'project', lastActivity: '2026-02-13' },
    ],
    trails: [
      { id: 208, name: 'Data Analyst Path', status: 'active', progress: 50 },
      { id: 209, name: 'SQL Mastery', status: 'completed', progress: 100 },
      { id: 210, name: 'Visualization', status: 'active', progress: 70 },
    ],
    works: [
      { id: 310, title: 'Дашборд продаж', status: 'reviewed', submittedDate: '2026-02-09', grade: 87 },
      { id: 311, title: 'SQL аналитика', status: 'reviewed', submittedDate: '2026-02-06', grade: 94 },
      { id: 312, title: 'Отчет по метрикам', status: 'submitted', submittedDate: '2026-02-14' },
    ],
  },
  4: {
    chats: [
      { id: 111, title: 'Design Team', type: 'work', lastActivity: '2026-02-18' },
      { id: 112, title: 'Практиканты 2026', type: 'hr', lastActivity: '2026-02-17' },
      { id: 113, title: 'UI/UX обсуждение', type: 'project', lastActivity: '2026-02-16' },
      { id: 114, title: 'Дизайн-система', type: 'project', lastActivity: '2026-02-15' },
      { id: 115, title: 'Креативная команда', type: 'work', lastActivity: '2026-02-14' },
    ],
    trails: [
      { id: 211, name: 'UI/UX Designer Path', status: 'active', progress: 85 },
      { id: 212, name: 'Figma Mastery', status: 'completed', progress: 100 },
      { id: 213, name: 'Motion Design', status: 'active', progress: 60 },
      { id: 214, name: 'Design Systems', status: 'completed', progress: 100 },
    ],
    works: [
      { id: 313, title: 'Редизайн лендинга', status: 'reviewed', submittedDate: '2026-02-11', grade: 96 },
      { id: 314, title: 'Мобильный интерфейс', status: 'reviewed', submittedDate: '2026-02-08', grade: 93 },
      { id: 315, title: 'Дизайн-система компании', status: 'submitted', submittedDate: '2026-02-17' },
      { id: 316, title: 'Анимации и переходы', status: 'pending' },
    ],
  },
  5: {
    chats: [
      { id: 116, title: 'QA Team', type: 'work', lastActivity: '2026-02-15' },
      { id: 117, title: 'Практиканты 2026', type: 'hr', lastActivity: '2026-02-17' },
      { id: 118, title: 'Баг-трекинг', type: 'project', lastActivity: '2026-02-13' },
    ],
    trails: [
      { id: 215, name: 'QA Engineer Path', status: 'active', progress: 45 },
      { id: 216, name: 'Automation Testing', status: 'active', progress: 30 },
      { id: 217, name: 'Manual Testing', status: 'completed', progress: 100 },
    ],
    works: [
      { id: 317, title: 'Тест-план модуля авторизации', status: 'reviewed', submittedDate: '2026-02-05', grade: 82 },
      { id: 318, title: 'Автотесты Selenium', status: 'returned', submittedDate: '2026-02-10' },
      { id: 319, title: 'Отчет о нагрузочном тестировании', status: 'pending' },
    ],
  },
  6: {
    chats: [
      { id: 119, title: 'DevOps Team', type: 'work', lastActivity: '2026-02-18' },
      { id: 120, title: 'Практиканты 2026', type: 'hr', lastActivity: '2026-02-17' },
      { id: 121, title: 'Infrastructure', type: 'project', lastActivity: '2026-02-16' },
      { id: 122, title: 'Мониторинг и алерты', type: 'work', lastActivity: '2026-02-14' },
    ],
    trails: [
      { id: 218, name: 'DevOps Engineer Path', status: 'active', progress: 65 },
      { id: 219, name: 'Docker & K8s', status: 'active', progress: 55 },
      { id: 220, name: 'Linux Admin', status: 'completed', progress: 100 },
      { id: 221, name: 'CI/CD Mastery', status: 'active', progress: 70 },
    ],
    works: [
      { id: 320, title: 'CI/CD пайплайн', status: 'reviewed', submittedDate: '2026-02-12', grade: 90 },
      { id: 321, title: 'Docker Compose стек', status: 'reviewed', submittedDate: '2026-02-08', grade: 88 },
      { id: 322, title: 'Мониторинг с Prometheus', status: 'submitted', submittedDate: '2026-02-16' },
      { id: 323, title: 'Kubernetes деплоймент', status: 'pending' },
    ],
  },
};
