export interface User {
  id: number;
  email: string;
  name: string;
  role: 'superadmin' | 'admin';
  telegram_id?: number;
  telegram_username?: string;
  created_at: string;
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
  is_active: boolean;
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
  category: 'basic' | 'red_flags' | 'green_flags';
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
  company?: string;
  position?: string;
  tags: string[];
  extra_data: Record<string, unknown>;
  created_by?: number;
  created_at: string;
  updated_at: string;
  chats_count?: number;
  calls_count?: number;
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

export type CallSource = 'meet' | 'zoom' | 'upload' | 'telegram';

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
  entity_id?: number;
  owner_id?: number;
  source_type: CallSource;
  source_url?: string;
  bot_name: string;
  status: CallStatus;
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
    name: 'Candidate',
    namePlural: 'Candidates',
    description: 'Job candidates and applicants',
    icon: 'UserCheck',
    color: 'blue',
    statuses: ['new', 'screening', 'interview', 'offer', 'hired', 'rejected']
  },
  client: {
    id: 'client',
    name: 'Client',
    namePlural: 'Clients',
    description: 'Business clients and customers',
    icon: 'Building',
    color: 'green',
    statuses: ['new', 'active', 'paused', 'churned']
  },
  contractor: {
    id: 'contractor',
    name: 'Contractor',
    namePlural: 'Contractors',
    description: 'External contractors and freelancers',
    icon: 'Wrench',
    color: 'orange',
    statuses: ['new', 'active', 'paused', 'ended']
  },
  lead: {
    id: 'lead',
    name: 'Lead',
    namePlural: 'Leads',
    description: 'Sales leads and prospects',
    icon: 'Target',
    color: 'purple',
    statuses: ['new', 'negotiation', 'converted', 'rejected']
  },
  partner: {
    id: 'partner',
    name: 'Partner',
    namePlural: 'Partners',
    description: 'Business partners',
    icon: 'Handshake',
    color: 'cyan',
    statuses: ['new', 'active', 'paused', 'ended']
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    namePlural: 'Custom',
    description: 'Custom entity type',
    icon: 'User',
    color: 'gray',
    statuses: ['new', 'active', 'paused', 'ended']
  }
};

export const STATUS_LABELS: Record<EntityStatus, string> = {
  new: 'New',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  active: 'Active',
  paused: 'Paused',
  churned: 'Churned',
  converted: 'Converted',
  ended: 'Ended',
  negotiation: 'Negotiation'
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
  pending: 'Pending',
  connecting: 'Connecting',
  recording: 'Recording',
  processing: 'Processing',
  transcribing: 'Transcribing',
  analyzing: 'Analyzing',
  done: 'Done',
  failed: 'Failed'
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
