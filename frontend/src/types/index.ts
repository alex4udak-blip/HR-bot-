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
  top_chats: { id: number; title: string; messages: number }[];
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}
