import axios from 'axios';
import type {
  User, Chat, Message, Participant, CriteriaPreset,
  ChatCriteria, AIConversation, AnalysisResult, Stats, AuthResponse,
  Entity, EntityWithRelations, EntityType, EntityStatus,
  CallRecording, CallStatus
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,  // Send cookies with requests (httpOnly cookie authentication)
});

// Response interceptor - redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Cookie is invalid or expired - redirect to login
      // But only if we're not already on the login page (prevents infinite refresh loop)
      if (window.location.pathname !== '/login' && !window.location.pathname.startsWith('/invite')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = async (email: string, password: string): Promise<User> => {
  // Backend returns User directly (cookie is set via Set-Cookie header)
  const { data } = await api.post('/auth/login', { email, password });
  return data;
};

export const register = async (email: string, password: string, name: string): Promise<AuthResponse> => {
  const { data } = await api.post('/auth/register', { email, password, name });
  return data;
};

export const getCurrentUser = async (): Promise<User> => {
  const { data } = await api.get('/auth/me');
  return data;
};

// Users
export const getUsers = async (): Promise<User[]> => {
  const { data } = await api.get('/users');
  return data;
};

export const createUser = async (userData: { email: string; password: string; name: string; role: string }): Promise<User> => {
  const { data } = await api.post('/users', userData);
  return data;
};

export const deleteUser = async (id: number): Promise<void> => {
  await api.delete(`/users/${id}`);
};

// Chats
export const getChats = async (): Promise<Chat[]> => {
  const { data } = await api.get('/chats');
  return data;
};

export const getChat = async (id: number): Promise<Chat> => {
  const { data } = await api.get(`/chats/${id}`);
  return data;
};

export const updateChat = async (id: number, updates: {
  custom_name?: string;
  chat_type?: string;
  entity_id?: number;
  is_active?: boolean;
}): Promise<Chat> => {
  const { data } = await api.patch(`/chats/${id}`, updates);
  return data;
};

export const deleteChat = async (id: number): Promise<void> => {
  await api.delete(`/chats/${id}`);
};

export const getDeletedChats = async (): Promise<Chat[]> => {
  const { data } = await api.get('/chats/deleted/list');
  return data;
};

export const restoreChat = async (id: number): Promise<void> => {
  await api.post(`/chats/${id}/restore`);
};

export const permanentDeleteChat = async (id: number): Promise<void> => {
  await api.delete(`/chats/${id}/permanent`);
};

// Messages
export const getMessages = async (chatId: number, page = 1, limit = 1000, contentType?: string): Promise<Message[]> => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (contentType) params.append('content_type', contentType);
  const { data } = await api.get(`/chats/${chatId}/messages?${params}`);
  return data;
};

export const getParticipants = async (chatId: number): Promise<Participant[]> => {
  const { data } = await api.get(`/chats/${chatId}/participants`);
  return data;
};

export const transcribeMessage = async (messageId: number): Promise<{ success: boolean; transcription: string; message_id: number }> => {
  const { data } = await api.post(`/chats/messages/${messageId}/transcribe`);
  return data;
};

// Criteria
export const getCriteriaPresets = async (): Promise<CriteriaPreset[]> => {
  const { data } = await api.get('/criteria/presets');
  return data;
};

export const createCriteriaPreset = async (preset: Omit<CriteriaPreset, 'id' | 'created_at' | 'created_by'>): Promise<CriteriaPreset> => {
  const { data } = await api.post('/criteria/presets', preset);
  return data;
};

export const deleteCriteriaPreset = async (id: number): Promise<void> => {
  await api.delete(`/criteria/presets/${id}`);
};

export const getChatCriteria = async (chatId: number): Promise<ChatCriteria> => {
  const { data } = await api.get(`/criteria/chats/${chatId}`);
  return data;
};

export const updateChatCriteria = async (chatId: number, criteria: { name: string; description: string; weight: number; category: string }[]): Promise<ChatCriteria> => {
  const { data } = await api.put(`/criteria/chats/${chatId}`, { criteria });
  return data;
};

// AI
export const getAIHistory = async (chatId: number): Promise<AIConversation> => {
  const { data } = await api.get(`/chats/${chatId}/ai/history`);
  return data;
};

export const clearAIHistory = async (chatId: number): Promise<void> => {
  await api.delete(`/chats/${chatId}/ai/history`);
};

export const getAnalysisHistory = async (chatId: number): Promise<AnalysisResult[]> => {
  const { data } = await api.get(`/chats/${chatId}/analysis-history`);
  return data;
};

// Stats
export const getStats = async (): Promise<Stats> => {
  const { data } = await api.get('/stats');
  return data;
};

// Streaming helpers
export const streamAIMessage = async (
  chatId: number,
  message: string,
  onChunk: (chunk: string) => void,
  onDone: () => void
) => {
  const response = await fetch(`/api/chats/${chatId}/ai/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',  // Send cookies with request
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка сервера' }));
    throw new Error(error.detail || 'Ошибка AI');
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          onDone();
        } else {
          try {
            const parsed = JSON.parse(data);
            onChunk(parsed.content);
          } catch {}
        }
      }
    }
  }
};

export const streamQuickAction = async (
  chatId: number,
  action: string,
  onChunk: (chunk: string) => void,
  onDone: () => void
) => {
  const response = await fetch(`/api/chats/${chatId}/ai/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',  // Send cookies with request
    body: JSON.stringify({ quick_action: action }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка сервера' }));
    throw new Error(error.detail || 'Ошибка AI');
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          onDone();
        } else {
          try {
            const parsed = JSON.parse(data);
            onChunk(parsed.content);
          } catch {}
        }
      }
    }
  }
};

export const downloadReport = async (chatId: number, reportType: string, format: string): Promise<Blob> => {
  const response = await fetch(`/api/chats/${chatId}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',  // Send cookies with request
    body: JSON.stringify({ report_type: reportType, format }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
};

// Import Telegram history
export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  total_errors: number;
}

// Generate UUID for import tracking
const generateImportId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const importTelegramHistory = async (
  chatId: number,
  file: File,
  autoProcess: boolean = false,
  importId?: string
): Promise<ImportResult> => {
  const formData = new FormData();
  formData.append('file', file);

  let url = `/api/chats/${chatId}/import?auto_process=${autoProcess}`;
  if (importId) {
    url += `&import_id=${importId}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',  // Send cookies with request
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка импорта' }));
    throw new Error(error.detail || 'Ошибка импорта');
  }

  return response.json();
};

// Import progress tracking
export interface ImportProgress {
  status: 'starting' | 'processing' | 'completed' | 'error' | 'not_found';
  phase?: 'reading_file' | 'importing' | 'processing_media' | 'done';
  current: number;
  total: number;
  imported: number;
  skipped: number;
  current_file?: string | null;
  error?: string;
}

export const getImportProgress = async (chatId: number, importId: string): Promise<ImportProgress> => {
  const response = await fetch(`/api/chats/${chatId}/import/progress/${importId}`, {
    credentials: 'include',  // Send cookies with request
  });
  return response.json();
};

export { generateImportId };

// Cleanup badly imported messages
export interface CleanupResult {
  success: boolean;
  deleted: number;
  mode?: string;
}

export type CleanupMode = 'bad' | 'today' | 'all_imported' | 'all' | 'clear_all' | 'duplicates';

export const cleanupBadImport = async (chatId: number, mode: CleanupMode = 'bad'): Promise<CleanupResult> => {
  const response = await fetch(`/api/chats/${chatId}/import/cleanup?mode=${mode}`, {
    method: 'DELETE',
    credentials: 'include',  // Send cookies with request
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка очистки' }));
    throw new Error(error.detail || 'Ошибка очистки');
  }

  return response.json();
};

// Bulk transcribe all untranscribed media
export interface TranscribeAllResult {
  success: boolean;
  transcribed: number;
  total_found: number;
  errors: number;
}

export const transcribeAllMedia = async (chatId: number): Promise<TranscribeAllResult> => {
  const response = await fetch(`/api/chats/${chatId}/transcribe-all`, {
    method: 'POST',
    credentials: 'include',  // Send cookies with request
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка транскрипции' }));
    throw new Error(error.detail || 'Ошибка транскрипции');
  }

  return response.json();
};

export interface RepairVideoResult {
  repaired: number;
  total: number;
  message?: string;
}

export const repairVideoNotes = async (chatId: number, file: File): Promise<RepairVideoResult> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`/api/chats/${chatId}/repair-video-notes`, {
    method: 'POST',
    credentials: 'include',  // Send cookies with request
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка восстановления видео' }));
    throw new Error(error.detail || 'Ошибка восстановления видео');
  }

  return response.json();
};

// === ENTITIES ===

export type OwnershipFilter = 'all' | 'mine' | 'shared';

export const getEntities = async (params?: {
  type?: EntityType;
  status?: EntityStatus;
  search?: string;
  tags?: string;
  ownership?: OwnershipFilter;
  department_id?: number;
  limit?: number;
  offset?: number;
}): Promise<Entity[]> => {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.set(key, String(value));
    });
  }
  const { data } = await api.get(`/entities?${searchParams}`);
  return data;
};

export const getEntity = async (id: number): Promise<EntityWithRelations> => {
  const { data } = await api.get(`/entities/${id}`);
  return data;
};

export const createEntity = async (entityData: {
  type: EntityType;
  name: string;
  status?: EntityStatus;
  phone?: string;
  email?: string;
  telegram_user_id?: number;
  company?: string;
  position?: string;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number;
}): Promise<Entity> => {
  const { data } = await api.post('/entities', entityData);
  return data;
};

export const updateEntity = async (id: number, updates: {
  name?: string;
  status?: EntityStatus;
  phone?: string;
  email?: string;
  company?: string;
  position?: string;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number | null;
}): Promise<Entity> => {
  const { data } = await api.put(`/entities/${id}`, updates);
  return data;
};

export const deleteEntity = async (id: number): Promise<void> => {
  await api.delete(`/entities/${id}`);
};

export const transferEntity = async (entityId: number, data: {
  to_user_id: number;
  to_department_id?: number;
  comment?: string;
}): Promise<{ success: boolean; transfer_id: number }> => {
  const response = await api.post(`/entities/${entityId}/transfer`, data);
  return response.data;
};

export const linkChatToEntity = async (entityId: number, chatId: number): Promise<void> => {
  await api.post(`/entities/${entityId}/link-chat/${chatId}`);
};

export const unlinkChatFromEntity = async (entityId: number, chatId: number): Promise<void> => {
  await api.delete(`/entities/${entityId}/unlink-chat/${chatId}`);
};

export const getEntityStatsByType = async (): Promise<Record<string, number>> => {
  const { data } = await api.get('/entities/stats/by-type');
  return data;
};

export const getEntityStatsByStatus = async (type?: EntityType): Promise<Record<string, number>> => {
  const params = type ? `?type=${type}` : '';
  const { data } = await api.get(`/entities/stats/by-status${params}`);
  return data;
};

// === CALLS ===

export const getCalls = async (params?: {
  entity_id?: number;
  status?: CallStatus;
  limit?: number;
  offset?: number;
}): Promise<CallRecording[]> => {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.set(key, String(value));
    });
  }
  const { data } = await api.get(`/calls?${searchParams}`);
  return data;
};

export const getCall = async (id: number): Promise<CallRecording> => {
  const { data } = await api.get(`/calls/${id}`);
  return data;
};

export const uploadCallRecording = async (
  file: File,
  entityId?: number
): Promise<{ id: number; status: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  if (entityId) {
    formData.append('entity_id', String(entityId));
  }

  const response = await fetch('/api/calls/upload', {
    method: 'POST',
    credentials: 'include',  // Send cookies with request
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Upload error' }));
    throw new Error(error.detail || 'Upload failed');
  }

  return response.json();
};

export const startCallBot = async (data: {
  source_url: string;
  bot_name?: string;
  entity_id?: number;
}): Promise<{ id: number; status: string }> => {
  const response = await api.post('/calls/start-bot', data);
  return response.data;
};

export const getCallStatus = async (
  id: number,
  signal?: AbortSignal
): Promise<{
  status: CallStatus;
  duration_seconds?: number;
  error_message?: string;
}> => {
  const { data } = await api.get(`/calls/${id}/status`, { signal });
  return data;
};

export const stopCallRecording = async (id: number): Promise<void> => {
  await api.post(`/calls/${id}/stop`);
};

export const deleteCall = async (id: number): Promise<void> => {
  await api.delete(`/calls/${id}`);
};

export const linkCallToEntity = async (callId: number, entityId: number): Promise<void> => {
  await api.post(`/calls/${callId}/link-entity/${entityId}`);
};

export const reprocessCall = async (id: number): Promise<{ success: boolean; status: string }> => {
  const { data } = await api.post(`/calls/${id}/reprocess`);
  return data;
};

export const updateCall = async (
  id: number,
  data: { title?: string; entity_id?: number }
): Promise<{ id: number; title?: string; entity_id?: number; entity_name?: string; success: boolean }> => {
  const { data: result } = await api.patch(`/calls/${id}`, data);
  return result;
};


// === EXTERNAL LINKS ===

export type ExternalLinkType = 'google_doc' | 'google_sheet' | 'google_form' | 'google_drive' | 'direct_media' | 'fireflies' | 'unknown';

export interface DetectLinkTypeResponse {
  url: string;
  link_type: ExternalLinkType;
  can_process: boolean;
  message?: string;
}

export interface ProcessURLResponse {
  call_id: number;
  status: string;
  message: string;
}

export const detectExternalLinkType = async (url: string): Promise<DetectLinkTypeResponse> => {
  const { data } = await api.get(`/external/detect-type?url=${encodeURIComponent(url)}`);
  return data;
};

export const processExternalURL = async (data: {
  url: string;
  title?: string;
  entity_id?: number;
}): Promise<ProcessURLResponse> => {
  const { data: result } = await api.post('/external/process-url', data);
  return result;
};

export const getExternalProcessingStatus = async (callId: number): Promise<{
  id: number;
  status: string;
  progress: number;
  progress_stage: string;
  error_message?: string;
  title?: string;
}> => {
  const { data } = await api.get(`/external/status/${callId}`);
  return data;
};

export const getSupportedExternalTypes = async (): Promise<{
  supported_types: Array<{
    type: string;
    description: string;
    examples: string[];
  }>;
}> => {
  const { data } = await api.get('/external/supported-types');
  return data;
};


// === ORGANIZATIONS ===

export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: number;
  name: string;
  slug: string;
  members_count: number;
  my_role?: OrgRole;
}

export interface OrgMember {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  role: OrgRole;
  invited_by_name?: string;
  created_at: string;
}

export interface InviteMemberRequest {
  email: string;
  name: string;
  password: string;
  role?: OrgRole;
  department_ids?: number[];
  department_role?: DeptRole;
}

export const getCurrentOrganization = async (): Promise<Organization> => {
  const { data } = await api.get('/organizations/current');
  return data;
};

export const getOrgMembers = async (): Promise<OrgMember[]> => {
  const { data } = await api.get('/organizations/current/members');
  return data;
};

export const inviteMember = async (data: InviteMemberRequest): Promise<OrgMember> => {
  const { data: result } = await api.post('/organizations/current/members', data);
  return result;
};

export const updateMemberRole = async (userId: number, role: OrgRole): Promise<{ success: boolean }> => {
  const { data } = await api.patch(`/organizations/current/members/${userId}/role`, { role });
  return data;
};

export const removeMember = async (userId: number): Promise<{ success: boolean }> => {
  const { data } = await api.delete(`/organizations/current/members/${userId}`);
  return data;
};

export const getMyOrgRole = async (): Promise<{ role: OrgRole }> => {
  const { data } = await api.get('/organizations/current/my-role');
  return data;
};


// === SHARING ===

export type ResourceType = 'chat' | 'entity' | 'call';
export type AccessLevel = 'view' | 'edit' | 'full';

export interface ShareRequest {
  resource_type: ResourceType;
  resource_id: number;
  shared_with_id: number;
  access_level?: AccessLevel;
  note?: string;
  expires_at?: string;
}

export interface ShareResponse {
  id: number;
  resource_type: ResourceType;
  resource_id: number;
  resource_name?: string;
  shared_by_id: number;
  shared_by_name: string;
  shared_with_id: number;
  shared_with_name: string;
  access_level: AccessLevel;
  note?: string;
  expires_at?: string;
  created_at: string;
}

export interface UserSimple {
  id: number;
  name: string;
  email: string;
  org_role?: string;
  department_id?: number;
  department_name?: string;
  department_role?: string;
}

export const shareResource = async (data: ShareRequest): Promise<ShareResponse> => {
  const { data: result } = await api.post('/sharing', data);
  return result;
};

export const revokeShare = async (shareId: number): Promise<{ success: boolean }> => {
  const { data } = await api.delete(`/sharing/${shareId}`);
  return data;
};

export const getMyShares = async (resourceType?: ResourceType): Promise<ShareResponse[]> => {
  const params = resourceType ? `?resource_type=${resourceType}` : '';
  const { data } = await api.get(`/sharing/my-shares${params}`);
  return data;
};

export const getSharedWithMe = async (resourceType?: ResourceType): Promise<ShareResponse[]> => {
  const params = resourceType ? `?resource_type=${resourceType}` : '';
  const { data } = await api.get(`/sharing/shared-with-me${params}`);
  return data;
};

export const getResourceShares = async (resourceType: ResourceType, resourceId: number): Promise<ShareResponse[]> => {
  const { data } = await api.get(`/sharing/resource/${resourceType}/${resourceId}`);
  return data;
};

export const getSharableUsers = async (): Promise<UserSimple[]> => {
  const { data } = await api.get('/sharing/users');
  return data;
};

// === CONVENIENCE METHODS FOR SHARING ===

export const shareChat = async (
  chatId: number,
  userId: number,
  accessLevel: AccessLevel = 'view',
  note?: string
): Promise<ShareResponse> => {
  return shareResource({
    resource_type: 'chat',
    resource_id: chatId,
    shared_with_id: userId,
    access_level: accessLevel,
    note
  });
};

export const shareCall = async (
  callId: number,
  userId: number,
  accessLevel: AccessLevel = 'view',
  note?: string
): Promise<ShareResponse> => {
  return shareResource({
    resource_type: 'call',
    resource_id: callId,
    shared_with_id: userId,
    access_level: accessLevel,
    note
  });
};

export const shareEntity = async (
  entityId: number,
  userId: number,
  accessLevel: AccessLevel = 'view',
  note?: string
): Promise<ShareResponse> => {
  return shareResource({
    resource_type: 'entity',
    resource_id: entityId,
    shared_with_id: userId,
    access_level: accessLevel,
    note
  });
};

// === DEPARTMENTS ===

export type DeptRole = 'lead' | 'member';

export interface Department {
  id: number;
  name: string;
  description?: string;
  color?: string;
  is_active: boolean;
  parent_id?: number;
  parent_name?: string;
  members_count: number;
  entities_count: number;
  children_count: number;
  created_at: string;
}

export interface DepartmentMember {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  role: DeptRole;
  created_at: string;
}

export const getDepartments = async (parentId?: number | null): Promise<Department[]> => {
  const params: Record<string, string> = {};
  // parentId = undefined -> get top-level (default)
  // parentId = null -> same as undefined
  // parentId = -1 -> get all departments
  // parentId = number -> get children of that department
  if (parentId !== undefined && parentId !== null) {
    params.parent_id = String(parentId);
  }
  const { data } = await api.get('/departments', { params });
  return data;
};

export const getDepartment = async (id: number): Promise<Department> => {
  const { data } = await api.get(`/departments/${id}`);
  return data;
};

export const createDepartment = async (dept: {
  name: string;
  description?: string;
  color?: string;
  parent_id?: number;
}): Promise<Department> => {
  const { data } = await api.post('/departments', dept);
  return data;
};

export const updateDepartment = async (id: number, updates: {
  name?: string;
  description?: string;
  color?: string;
  is_active?: boolean;
}): Promise<Department> => {
  const { data } = await api.patch(`/departments/${id}`, updates);
  return data;
};

export const deleteDepartment = async (id: number): Promise<void> => {
  await api.delete(`/departments/${id}`);
};

export const getDepartmentMembers = async (departmentId: number): Promise<DepartmentMember[]> => {
  const { data } = await api.get(`/departments/${departmentId}/members`);
  return data;
};

export const addDepartmentMember = async (departmentId: number, data: {
  user_id: number;
  role?: DeptRole;
}): Promise<DepartmentMember> => {
  const { data: result } = await api.post(`/departments/${departmentId}/members`, data);
  return result;
};

export const updateDepartmentMember = async (departmentId: number, userId: number, role: DeptRole): Promise<DepartmentMember> => {
  const { data } = await api.patch(`/departments/${departmentId}/members/${userId}`, { role });
  return data;
};

export const removeDepartmentMember = async (departmentId: number, userId: number): Promise<void> => {
  await api.delete(`/departments/${departmentId}/members/${userId}`);
};

export const getMyDepartments = async (): Promise<Department[]> => {
  const { data } = await api.get('/departments/my/departments');
  return data;
};


// === INVITATIONS ===

export interface Invitation {
  id: number;
  token: string;
  email?: string;
  name?: string;
  org_role: OrgRole;
  department_ids: { id: number; role: DeptRole }[];
  invited_by_name?: string;
  expires_at?: string;
  used_at?: string;
  used_by_name?: string;
  created_at: string;
  invitation_url: string;
}

export interface InvitationValidation {
  valid: boolean;
  expired: boolean;
  used: boolean;
  email?: string;
  name?: string;
  org_name?: string;
  org_role: string;
}

export interface AcceptInvitationRequest {
  email: string;
  name: string;
  password: string;
}

export interface AcceptInvitationResponse {
  success: boolean;
  access_token: string;
  user_id: number;
  telegram_bind_url?: string;
}

export const createInvitation = async (data: {
  email?: string;
  name?: string;
  org_role?: OrgRole;
  department_ids?: { id: number; role: DeptRole }[];
  expires_in_days?: number;
}): Promise<Invitation> => {
  const { data: result } = await api.post('/invitations', data);
  return result;
};

export const getInvitations = async (includeUsed: boolean = false): Promise<Invitation[]> => {
  const { data } = await api.get(`/invitations?include_used=${includeUsed}`);
  return data;
};

export const validateInvitation = async (token: string): Promise<InvitationValidation> => {
  const { data } = await api.get(`/invitations/validate/${token}`);
  return data;
};

export const acceptInvitation = async (token: string, data: AcceptInvitationRequest): Promise<AcceptInvitationResponse> => {
  const { data: result } = await api.post(`/invitations/accept/${token}`, data);
  return result;
};

export const revokeInvitation = async (id: number): Promise<{ success: boolean }> => {
  const { data } = await api.delete(`/invitations/${id}`);
  return data;
};

export default api;
