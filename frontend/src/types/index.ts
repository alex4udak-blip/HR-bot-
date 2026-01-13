export type UserRole = 'superadmin' | 'admin';
export type OrgRole = 'owner' | 'admin' | 'member';
export type DeptRole = 'lead' | 'sub_admin' | 'member';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  org_role?: OrgRole;
  department_id?: number;
  department_name?: string;
  department_role?: DeptRole;
  telegram_id?: number;
  telegram_username?: string;
  // Additional contact identifiers for speaker matching
  additional_emails?: string[];
  additional_telegram_usernames?: string[];
  created_at: string;
  // Impersonation fields
  is_impersonating?: boolean;
  original_user_id?: number;
  original_user_name?: string;
  // Password reset flag
  must_change_password?: boolean;
}

export type ChatTypeId = 'work' | 'hr' | 'project' | 'client' | 'contractor' | 'sales' | 'support' | 'custom';

export interface ChatTypeInfo {
  id: ChatTypeId;
  name: string;
  description: string;
  icon: string;
  color: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
}

export interface ChatTypeConfig {
  type_info: ChatTypeInfo;
  quick_actions: QuickAction[];
  suggested_questions: string[];
  default_criteria: Criterion[];
}

export interface Chat {
  id: number;
  telegram_chat_id: number;
  title: string;
  custom_name?: string;
  chat_type: ChatTypeId;
  custom_type_name?: string;
  custom_type_description?: string;
  owner_id?: number;
  owner_name?: string;
  entity_id?: number;
  entity_name?: string;
  is_active: boolean;
  // Permission fields
  is_mine?: boolean;
  is_shared?: boolean;
  access_level?: 'view' | 'edit' | 'full' | null;
  messages_count: number;
  participants_count: number;
  last_activity?: string;
  created_at: string;
  has_criteria?: boolean;
  deleted_at?: string;
  days_until_permanent_delete?: number;
}

export interface DocumentMetadata {
  filename?: string;
  file_type?: string;
  file_size?: number;
  pages_count?: number;
  pages_parsed?: number;
  tables_count?: number;
  sheets?: string[];
  sheets_count?: number;
  slides_count?: number;
  extracted_files?: { name: string; status: string }[];
  ocr_method?: string;
  converted_from?: string;
  parsed_at?: string;
}

export interface Message {
  id: number;
  telegram_user_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  content: string;
  content_type: string;
  file_id?: string;
  file_path?: string;  // Local file path for imported media
  file_name?: string;
  document_metadata?: DocumentMetadata;
  parse_status?: 'parsed' | 'partial' | 'failed' | 'skipped';
  parse_error?: string;
  timestamp: string;
}

export interface Participant {
  telegram_user_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  messages_count: number;
}

export interface Criterion {
  name: string;
  description: string;
  weight: number;
  category: 'basic' | 'red_flags' | 'green_flags' | 'potential';
}

export interface CriteriaPreset {
  id: number;
  name: string;
  description?: string;
  criteria: Criterion[];
  category: string;
  is_global: boolean;
  created_by?: number;
  created_at: string;
}

export interface ChatCriteria {
  id: number;
  chat_id: number;
  criteria: Criterion[];
  updated_at: string;
}

export interface EntityCriteria {
  id: number;
  entity_id: number;
  criteria: Criterion[];
  updated_at: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AIConversation {
  id: number;
  chat_id: number;
  messages: AIMessage[];
  created_at: string;
  updated_at: string;
}

export interface AnalysisResult {
  id: number;
  chat_id: number;
  result: string;
  report_type: string;
  created_at: string;
}

export interface Stats {
  total_chats: number;
  total_messages: number;
  total_participants: number;
  total_analyses: number;
  active_chats: number;
  messages_today: number;
  messages_this_week: number;
  activity_by_day: { date: string; day: string; count: number }[];
  messages_by_type: Record<string, number>;
  top_chats: { id: number; title: string; custom_name?: string | null; messages: number }[];
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// === Entity Types ===

export type EntityType = 'candidate' | 'client' | 'contractor' | 'lead' | 'partner' | 'custom';

export type EntityStatus =
  | 'new'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'active'
  | 'paused'
  | 'churned'
  | 'converted'
  | 'ended'
  | 'negotiation';

export interface Entity {
  id: number;
  type: EntityType;
  name: string;
  status: EntityStatus;
  phone?: string;
  email?: string;
  telegram_user_id?: number;
  // Multiple identifiers support
  telegram_usernames?: string[];
  emails?: string[];
  phones?: string[];
  company?: string;
  position?: string;
  tags: string[];
  extra_data: Record<string, unknown>;
  created_by?: number;
  owner_id?: number;
  owner_name?: string;
  is_mine?: boolean;
  is_shared?: boolean;
  access_level?: 'view' | 'edit' | 'full';
  is_transferred?: boolean;
  transferred_to_id?: number;
  transferred_to_name?: string;
  transferred_at?: string;
  department_id?: number;
  department_name?: string;
  created_at: string;
  updated_at: string;
  chats_count?: number;
  calls_count?: number;
  // Expected salary for candidates
  expected_salary_min?: number;
  expected_salary_max?: number;
  expected_salary_currency?: string;
}

export interface EntityWithRelations extends Entity {
  chats: Array<{
    id: number;
    title: string;
    chat_type: ChatTypeId;
    created_at: string;
  }>;
  calls: Array<{
    id: number;
    source_type: CallSource;
    status: CallStatus;
    duration_seconds?: number;
    summary?: string;
    created_at: string;
  }>;
  transfers: EntityTransfer[];
  analyses: Array<{
    id: number;
    report_type?: string;
    result?: string;
    created_at: string;
  }>;
}

export interface EntityTransfer {
  id: number;
  entity_id: number;
  from_user_id?: number;
  to_user_id?: number;
  from_department?: string;
  to_department?: string;
  comment?: string;
  created_at: string;
  from_user_name?: string;
  to_user_name?: string;
}

// === Call Types ===

export type CallSource = 'meet' | 'zoom' | 'teams' | 'upload' | 'telegram' | 'google_doc' | 'google_drive' | 'direct_url';

export type ExternalLinkType = 'google_doc' | 'google_drive' | 'direct_media' | 'fireflies' | 'unknown';

export type CallStatus =
  | 'pending'
  | 'connecting'
  | 'recording'
  | 'processing'
  | 'transcribing'
  | 'analyzing'
  | 'done'
  | 'failed';

export interface CallRecording {
  id: number;
  title?: string;
  entity_id?: number;
  owner_id?: number;
  owner_name?: string;
  source_type: CallSource;
  source_url?: string;
  bot_name: string;
  status: CallStatus;
  // Permission fields
  is_mine?: boolean;
  is_shared?: boolean;
  access_level?: 'view' | 'edit' | 'full' | null;
  duration_seconds?: number;
  audio_file_path?: string;
  transcript?: string;
  speakers?: SpeakerSegment[];
  summary?: string;
  action_items?: string[];
  key_points?: string[];
  error_message?: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  processed_at?: string;
  entity_name?: string;
}

export interface SpeakerSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

// === Report Types ===

export type ReportTypeId = 'daily_hr' | 'weekly_summary' | 'daily_calls' | 'weekly_pipeline';
export type DeliveryMethod = 'telegram' | 'email';

export interface ReportSubscription {
  id: number;
  user_id: number;
  report_type: ReportTypeId;
  delivery_method: DeliveryMethod;
  delivery_time: string;
  filters: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

// === Entity Type Configurations ===

export interface EntityTypeInfo {
  id: EntityType;
  name: string;
  namePlural: string;
  description: string;
  icon: string;
  color: string;
  statuses: EntityStatus[];
}

export const ENTITY_TYPES: Record<EntityType, EntityTypeInfo> = {
  candidate: {
    id: 'candidate',
    name: 'Кандидат',
    namePlural: 'Кандидаты',
    description: 'Соискатели на вакансии',
    icon: 'UserCheck',
    color: 'blue',
    statuses: ['new', 'screening', 'interview', 'offer', 'hired', 'rejected']
  },
  client: {
    id: 'client',
    name: 'Клиент',
    namePlural: 'Клиенты',
    description: 'Заказчики и компании-клиенты',
    icon: 'Building',
    color: 'green',
    statuses: ['new', 'active', 'paused', 'churned']
  },
  contractor: {
    id: 'contractor',
    name: 'Подрядчик',
    namePlural: 'Подрядчики',
    description: 'Внешние подрядчики и фрилансеры',
    icon: 'Wrench',
    color: 'orange',
    statuses: ['new', 'active', 'paused', 'ended']
  },
  lead: {
    id: 'lead',
    name: 'Лид',
    namePlural: 'Лиды',
    description: 'Потенциальные клиенты',
    icon: 'Target',
    color: 'purple',
    statuses: ['new', 'negotiation', 'converted', 'rejected']
  },
  partner: {
    id: 'partner',
    name: 'Партнёр',
    namePlural: 'Партнёры',
    description: 'Бизнес-партнёры',
    icon: 'Users',
    color: 'cyan',
    statuses: ['new', 'active', 'paused', 'ended']
  },
  custom: {
    id: 'custom',
    name: 'Другое',
    namePlural: 'Другие',
    description: 'Другой тип контакта',
    icon: 'User',
    color: 'gray',
    statuses: ['new', 'active', 'paused', 'ended']
  }
};

export const STATUS_LABELS: Record<EntityStatus, string> = {
  new: 'Новый',
  screening: 'Скрининг',
  interview: 'Интервью',
  offer: 'Оффер',
  hired: 'Принят',
  rejected: 'Отклонён',
  active: 'Активный',
  paused: 'На паузе',
  churned: 'Ушёл',
  converted: 'Сконвертирован',
  ended: 'Завершён',
  negotiation: 'Переговоры'
};

export const STATUS_COLORS: Record<EntityStatus, string> = {
  new: 'bg-blue-500/20 text-blue-300',
  screening: 'bg-yellow-500/20 text-yellow-300',
  interview: 'bg-purple-500/20 text-purple-300',
  offer: 'bg-green-500/20 text-green-300',
  hired: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-300',
  active: 'bg-green-500/20 text-green-300',
  paused: 'bg-gray-500/20 text-gray-300',
  churned: 'bg-red-500/20 text-red-300',
  converted: 'bg-emerald-500/20 text-emerald-300',
  ended: 'bg-gray-500/20 text-gray-300',
  negotiation: 'bg-yellow-500/20 text-yellow-300'
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  pending: 'Ожидание',
  connecting: 'Подключение',
  recording: 'Запись',
  processing: 'Обработка',
  transcribing: 'Транскрибация',
  analyzing: 'Анализ',
  done: 'Готово',
  failed: 'Ошибка'
};

export const CALL_STATUS_COLORS: Record<CallStatus, string> = {
  pending: 'bg-gray-500/20 text-gray-300',
  connecting: 'bg-yellow-500/20 text-yellow-300',
  recording: 'bg-red-500/20 text-red-300',
  processing: 'bg-blue-500/20 text-blue-300',
  transcribing: 'bg-purple-500/20 text-purple-300',
  analyzing: 'bg-cyan-500/20 text-cyan-300',
  done: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300'
};

// === Vacancy Types ===

export type VacancyStatus = 'draft' | 'open' | 'paused' | 'closed' | 'cancelled';

export type ApplicationStage =
  | 'applied'
  | 'screening'
  | 'phone_screen'
  | 'interview'
  | 'assessment'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export interface Vacancy {
  id: number;
  title: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  status: VacancyStatus;
  priority: number;
  tags: string[];
  extra_data: Record<string, unknown>;
  department_id?: number;
  department_name?: string;
  hiring_manager_id?: number;
  hiring_manager_name?: string;
  created_by?: number;
  published_at?: string;
  closes_at?: string;
  created_at: string;
  updated_at: string;
  applications_count: number;
  stage_counts: Record<string, number>;
}

export interface VacancyApplication {
  id: number;
  vacancy_id: number;
  vacancy_title?: string;
  entity_id: number;
  entity_name?: string;
  entity_type?: EntityType;
  entity_email?: string;
  entity_phone?: string;
  entity_position?: string;
  stage: ApplicationStage;
  stage_order: number;
  rating?: number;
  notes?: string;
  rejection_reason?: string;
  source?: string;
  next_interview_at?: string;
  applied_at: string;
  last_stage_change_at: string;
  updated_at: string;
}

export interface KanbanColumn {
  stage: ApplicationStage;
  title: string;
  applications: VacancyApplication[];
  count: number;
}

export interface KanbanBoard {
  vacancy_id: number;
  vacancy_title: string;
  columns: KanbanColumn[];
  total_count: number;
}

export interface VacancyStats {
  vacancies_by_status: Record<string, number>;
  applications_by_stage: Record<string, number>;
  applications_this_week: number;
}

export const VACANCY_STATUS_LABELS: Record<VacancyStatus, string> = {
  draft: 'Черновик',
  open: 'Открыта',
  paused: 'На паузе',
  closed: 'Закрыта',
  cancelled: 'Отменена'
};

export const VACANCY_STATUS_COLORS: Record<VacancyStatus, string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  open: 'bg-green-500/20 text-green-300',
  paused: 'bg-yellow-500/20 text-yellow-300',
  closed: 'bg-blue-500/20 text-blue-300',
  cancelled: 'bg-red-500/20 text-red-300'
};

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  phone_screen: 'Phone Screen',
  interview: 'Interview',
  assessment: 'Assessment',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
};

export const APPLICATION_STAGE_COLORS: Record<ApplicationStage, string> = {
  applied: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  screening: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  phone_screen: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  interview: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  assessment: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  offer: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  hired: 'bg-green-500/20 text-green-300 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
  withdrawn: 'bg-gray-500/20 text-gray-300 border-gray-500/30'
};

export const EMPLOYMENT_TYPES = [
  { value: 'full-time', label: 'Полная занятость' },
  { value: 'part-time', label: 'Частичная занятость' },
  { value: 'contract', label: 'Контракт' },
  { value: 'remote', label: 'Удалённая работа' },
  { value: 'hybrid', label: 'Гибрид' }
];

export const EXPERIENCE_LEVELS = [
  { value: 'intern', label: 'Стажёр' },
  { value: 'junior', label: 'Junior' },
  { value: 'middle', label: 'Middle' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' }
];

// === Multi-currency Support ===

export const CURRENCIES = [
  { code: 'RUB', symbol: '₽', name: 'Российский рубль' },
  { code: 'USD', symbol: '$', name: 'Доллар США' },
  { code: 'EUR', symbol: '€', name: 'Евро' },
  { code: 'KZT', symbol: '₸', name: 'Казахстанский тенге' },
  { code: 'UAH', symbol: '₴', name: 'Украинская гривна' },
  { code: 'BYN', symbol: 'Br', name: 'Белорусский рубль' },
  { code: 'GEL', symbol: '₾', name: 'Грузинский лари' },
  { code: 'AED', symbol: 'د.إ', name: 'Дирхам ОАЭ' },
  { code: 'TRY', symbol: '₺', name: 'Турецкая лира' },
  { code: 'GBP', symbol: '£', name: 'Фунт стерлингов' },
] as const;

export type CurrencyCode = typeof CURRENCIES[number]['code'];

/**
 * @deprecated Use formatSalary from '@/utils' instead for consistent currency formatting.
 * This function is kept for backwards compatibility and will be removed in a future version.
 */
export const formatSalary = (
  min?: number,
  max?: number,
  currency: CurrencyCode | string = 'RUB'
): string => {
  const curr = CURRENCIES.find(c => c.code === currency);
  const symbol = curr?.symbol || currency;
  const formatter = new Intl.NumberFormat('ru-RU');

  if (min && max) return `${formatter.format(min)} - ${formatter.format(max)} ${symbol}`;
  if (min) return `от ${formatter.format(min)} ${symbol}`;
  if (max) return `до ${formatter.format(max)} ${symbol}`;
  return 'Не указана';
};
