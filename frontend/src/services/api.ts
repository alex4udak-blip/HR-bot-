import axios, { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type {
  User, Chat, Message, Participant, CriteriaPreset,
  ChatCriteria, EntityCriteria, AIConversation, AnalysisResult, Stats, AuthResponse,
  Entity, EntityWithRelations, EntityType, EntityStatus,
  CallRecording, CallStatus,
  Vacancy, VacancyStatus, VacancyApplication, ApplicationStage, KanbanBoard, VacancyStats,
  Session, RefreshTokenResponse
} from '@/types';

// ============================================================
// REFRESH TOKEN MANAGEMENT
// ============================================================

/**
 * Flag to indicate if a token refresh is currently in progress
 */
let isRefreshing = false;

/**
 * Queue of requests waiting for token refresh to complete
 */
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
  config: InternalAxiosRequestConfig;
}> = [];

/**
 * Process the queue of failed requests after token refresh
 */
const processQueue = (error: Error | null): void => {
  failedQueue.forEach(({ resolve, reject, config }) => {
    if (error) {
      reject(error);
    } else {
      // Retry the request
      resolve(api(config));
    }
  });
  failedQueue = [];
};

/**
 * Silently attempt to refresh the access token
 * Returns true if successful, false otherwise
 */
const attemptTokenRefresh = async (): Promise<boolean> => {
  try {
    const response = await axios.post('/api/auth/refresh', {}, {
      withCredentials: true, // Send cookies
    });
    return response.status === 200;
  } catch {
    return false;
  }
};

/**
 * Redirect to login page (used after refresh token failure)
 */
const redirectToLogin = (): void => {
  // Clear any stored state before redirecting
  if (window.location.pathname !== '/login' && !window.location.pathname.startsWith('/invite')) {
    window.location.href = '/login';
  }
};

// API Configuration
const API_TIMEOUT = 30000; // 30 seconds
const MUTATION_DEBOUNCE_MS = 300; // Debounce time for mutation requests

// ============================================================
// REQUEST DEDUPLICATION & DEBOUNCE SYSTEM
// ============================================================

/**
 * Map to store pending GET requests for deduplication
 * Key: method + url + serialized params
 * Value: Promise of the request
 */
const pendingRequests = new Map<string, Promise<AxiosResponse>>();

/**
 * Map to store active AbortControllers for streaming requests
 * Key: unique request identifier
 * Value: AbortController instance
 */
const activeStreamControllers = new Map<string, AbortController>();

/**
 * Map to track last mutation timestamps for debouncing
 * Key: method + url
 * Value: timestamp of last mutation
 */
const mutationTimestamps = new Map<string, number>();

/**
 * Generate a unique key for request deduplication
 */
const generateRequestKey = (
  method: string,
  url: string,
  params?: Record<string, unknown>
): string => {
  const sortedParams = params ? JSON.stringify(params, Object.keys(params).sort()) : '';
  return `${method.toUpperCase()}:${url}:${sortedParams}`;
};

/**
 * Check if a mutation request should be debounced (prevent double-click)
 * Returns true if the request should proceed, false if it should be blocked
 */
const shouldAllowMutation = (method: string, url: string): boolean => {
  const key = `${method.toUpperCase()}:${url}`;
  const now = Date.now();
  const lastTimestamp = mutationTimestamps.get(key);

  if (lastTimestamp && now - lastTimestamp < MUTATION_DEBOUNCE_MS) {
    console.warn(`Mutation debounced: ${method.toUpperCase()} ${url} (too fast, ${now - lastTimestamp}ms since last request)`);
    return false;
  }

  mutationTimestamps.set(key, now);
  return true;
};

/**
 * Cleanup old mutation timestamps periodically (prevent memory leaks)
 */
const cleanupMutationTimestamps = () => {
  const now = Date.now();
  const staleThreshold = 60000; // 1 minute

  mutationTimestamps.forEach((timestamp, key) => {
    if (now - timestamp > staleThreshold) {
      mutationTimestamps.delete(key);
    }
  });
};

// Run cleanup every 5 minutes
setInterval(cleanupMutationTimestamps, 300000);

/**
 * Wrapper for GET requests with deduplication
 * If the same request is already in flight, returns the existing Promise
 */
const deduplicatedGet = async <T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> => {
  const requestKey = generateRequestKey('GET', url, config?.params);

  // Check if identical request is already in flight
  const pendingRequest = pendingRequests.get(requestKey);
  if (pendingRequest) {
    console.debug(`Request deduplicated: GET ${url}`);
    return pendingRequest as Promise<AxiosResponse<T>>;
  }

  // Create new request and store it
  const requestPromise = api.get<T>(url, config);
  pendingRequests.set(requestKey, requestPromise as Promise<AxiosResponse>);

  try {
    const response = await requestPromise;
    return response;
  } finally {
    // Remove from pending requests after completion (success or error)
    pendingRequests.delete(requestKey);
  }
};

/**
 * Wrapper for mutation requests with debounce protection
 * Throws error if request is too fast (double-click protection)
 */
const debouncedMutation = async <T>(
  method: 'post' | 'put' | 'patch' | 'delete',
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> => {
  if (!shouldAllowMutation(method, url)) {
    throw new Error('Request debounced: too many rapid requests');
  }

  switch (method) {
    case 'post':
      return api.post<T>(url, data, config);
    case 'put':
      return api.put<T>(url, data, config);
    case 'patch':
      return api.patch<T>(url, data, config);
    case 'delete':
      return api.delete<T>(url, config);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
};

/**
 * Create an AbortController for a streaming request
 * Returns the controller and a cleanup function
 */
export const createStreamController = (streamId: string): {
  controller: AbortController;
  cleanup: () => void;
} => {
  // Abort any existing stream with the same ID
  const existingController = activeStreamControllers.get(streamId);
  if (existingController) {
    existingController.abort();
    activeStreamControllers.delete(streamId);
  }

  const controller = new AbortController();
  activeStreamControllers.set(streamId, controller);

  const cleanup = () => {
    controller.abort();
    activeStreamControllers.delete(streamId);
  };

  return { controller, cleanup };
};

/**
 * Abort all active streaming requests (useful for cleanup)
 */
export const abortAllStreams = (): void => {
  activeStreamControllers.forEach((controller, streamId) => {
    console.debug(`Aborting stream: ${streamId}`);
    controller.abort();
  });
  activeStreamControllers.clear();
};

/**
 * Get the count of pending requests (for debugging/monitoring)
 */
export const getPendingRequestsCount = (): number => pendingRequests.size;

/**
 * Get the count of active streams (for debugging/monitoring)
 */
export const getActiveStreamsCount = (): number => activeStreamControllers.size;

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,  // Send cookies with requests (httpOnly cookie authentication)
  timeout: API_TIMEOUT,   // Request timeout
});

// Request interceptor - add retry metadata
api.interceptors.request.use(
  (config) => {
    // Add request timestamp for debugging
    (config as AxiosRequestConfig & { metadata?: { startTime: number } }).metadata = { startTime: Date.now() };
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors with automatic token refresh
api.interceptors.response.use(
  (response) => {
    // Log slow requests in development
    const config = response.config as AxiosRequestConfig & { metadata?: { startTime: number } };
    if (config.metadata?.startTime) {
      const duration = Date.now() - config.metadata.startTime;
      if (duration > 5000) {
        console.warn(`Slow API request: ${config.method?.toUpperCase()} ${config.url} took ${duration}ms`);
      }
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _skipRefresh?: boolean };

    // Handle 401 - Unauthorized (token expired or invalid)
    if (error.response?.status === 401) {
      // Skip refresh logic for certain endpoints
      const skipRefreshUrls = ['/auth/login', '/auth/refresh', '/auth/logout', '/invitations/validate', '/invitations/accept'];
      const shouldSkipRefresh = originalRequest._skipRefresh ||
        skipRefreshUrls.some(url => originalRequest.url?.includes(url));

      // Skip refresh if on login/invite page
      const isAuthPage = window.location.pathname === '/login' || window.location.pathname.startsWith('/invite');

      if (shouldSkipRefresh || isAuthPage) {
        return Promise.reject(error);
      }

      // If this request has already been retried, redirect to login
      if (originalRequest._retry) {
        redirectToLogin();
        return Promise.reject(error);
      }

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      // Mark that we're refreshing
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Attempt to refresh the token (silently, no error shown to user)
        const refreshSuccess = await attemptTokenRefresh();

        if (refreshSuccess) {
          // Token refreshed successfully, process queued requests and retry original
          processQueue(null);
          return api(originalRequest);
        } else {
          // Refresh failed - redirect to login
          processQueue(new Error('Token refresh failed'));
          redirectToLogin();
          return Promise.reject(error);
        }
      } catch (refreshError) {
        // Refresh threw an error - redirect to login
        processQueue(refreshError instanceof Error ? refreshError : new Error('Token refresh failed'));
        redirectToLogin();
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle 403 - permission denied
    if (error.response?.status === 403) {
      console.error('Permission denied:', error.config?.url);
    }

    // Handle timeout
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout:', error.config?.url);
    }

    return Promise.reject(error);
  }
);

// Auth (no deduplication for auth - always fresh)
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
  // Use deduplication for getCurrentUser as it's called frequently
  const { data } = await deduplicatedGet<User>('/auth/me');
  return data;
};

/**
 * Refresh the access token using the refresh token stored in httpOnly cookie.
 * This is called automatically by the interceptor on 401 errors.
 * @returns RefreshTokenResponse with success status
 */
export const refreshToken = async (): Promise<RefreshTokenResponse> => {
  const { data } = await api.post<RefreshTokenResponse>('/auth/refresh', {});
  return data;
};

/**
 * Logout from all devices by invalidating all refresh tokens.
 * This will force re-login on all devices.
 */
export const logoutAllDevices = async (): Promise<{ success: boolean; sessions_revoked: number }> => {
  const { data } = await api.post<{ success: boolean; sessions_revoked: number }>('/auth/logout-all', {});
  return data;
};

/**
 * Get all active sessions for the current user.
 * @returns List of active sessions with device info and last activity
 */
export const getSessions = async (): Promise<Session[]> => {
  const { data } = await deduplicatedGet<Session[]>('/auth/sessions');
  return data;
};

/**
 * Revoke a specific session by its ID.
 * @param sessionId - The ID of the session to revoke
 */
export const revokeSession = async (sessionId: string): Promise<{ success: boolean }> => {
  const { data } = await api.delete<{ success: boolean }>(`/auth/sessions/${sessionId}`);
  return data;
};

// Users
export const getUsers = async (): Promise<User[]> => {
  const { data } = await deduplicatedGet<User[]>('/users');
  return data;
};

export const createUser = async (userData: { email: string; password: string; name: string; role: string }): Promise<User> => {
  const { data } = await debouncedMutation<User>('post', '/users', userData);
  return data;
};

export const deleteUser = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/users/${id}`);
};

export interface PasswordResetResponse {
  message: string;
  temporary_password: string;
  user_email: string;
}

export const adminResetPassword = async (userId: number, newPassword?: string): Promise<PasswordResetResponse> => {
  const { data } = await api.post(`/admin/users/${userId}/reset-password`,
    newPassword ? { new_password: newPassword } : {}
  );
  return data;
};

export const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  await api.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword
  });
};

export interface UserProfileUpdate {
  name?: string;
  telegram_username?: string;
  additional_emails?: string[];
  additional_telegram_usernames?: string[];
}

export const updateUserProfile = async (data: UserProfileUpdate): Promise<User> => {
  const { data: user } = await api.patch('/users/me/profile', data);
  return user;
};

// Chats
export const getChats = async (): Promise<Chat[]> => {
  const { data } = await deduplicatedGet<Chat[]>('/chats');
  return data;
};

export const getChat = async (id: number): Promise<Chat> => {
  const { data } = await deduplicatedGet<Chat>(`/chats/${id}`);
  return data;
};

export const updateChat = async (id: number, updates: {
  custom_name?: string;
  chat_type?: string;
  entity_id?: number;
  is_active?: boolean;
}): Promise<Chat> => {
  const { data } = await debouncedMutation<Chat>('patch', `/chats/${id}`, updates);
  return data;
};

export const deleteChat = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/chats/${id}`);
};

export const getDeletedChats = async (): Promise<Chat[]> => {
  const { data } = await deduplicatedGet<Chat[]>('/chats/deleted/list');
  return data;
};

export const restoreChat = async (id: number): Promise<void> => {
  await debouncedMutation<void>('post', `/chats/${id}/restore`);
};

export const permanentDeleteChat = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/chats/${id}/permanent`);
};

// Messages
export const getMessages = async (chatId: number, page = 1, limit = 1000, contentType?: string): Promise<Message[]> => {
  const params: Record<string, string> = { page: String(page), limit: String(limit) };
  if (contentType) params.content_type = contentType;
  const { data } = await deduplicatedGet<Message[]>(`/chats/${chatId}/messages`, { params });
  return data;
};

export const getParticipants = async (chatId: number): Promise<Participant[]> => {
  const { data } = await deduplicatedGet<Participant[]>(`/chats/${chatId}/participants`);
  return data;
};

export const transcribeMessage = async (messageId: number): Promise<{ success: boolean; transcription: string; message_id: number }> => {
  const { data } = await debouncedMutation<{ success: boolean; transcription: string; message_id: number }>('post', `/chats/messages/${messageId}/transcribe`);
  return data;
};

// Criteria
export const getCriteriaPresets = async (): Promise<CriteriaPreset[]> => {
  const { data } = await deduplicatedGet<CriteriaPreset[]>('/criteria/presets');
  return data;
};

export const createCriteriaPreset = async (preset: Omit<CriteriaPreset, 'id' | 'created_at' | 'created_by'>): Promise<CriteriaPreset> => {
  const { data } = await debouncedMutation<CriteriaPreset>('post', '/criteria/presets', preset);
  return data;
};

export const deleteCriteriaPreset = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/criteria/presets/${id}`);
};

export const getChatCriteria = async (chatId: number): Promise<ChatCriteria> => {
  const { data } = await deduplicatedGet<ChatCriteria>(`/criteria/chats/${chatId}`);
  return data;
};

export const updateChatCriteria = async (chatId: number, criteria: { name: string; description: string; weight: number; category: string }[]): Promise<ChatCriteria> => {
  const { data } = await debouncedMutation<ChatCriteria>('put', `/criteria/chats/${chatId}`, { criteria });
  return data;
};

// Default criteria by chat type
export interface DefaultCriteriaResponse {
  chat_type: string;
  criteria: { name: string; description: string; weight: number; category: string }[];
  is_custom: boolean;
  preset_id: number | null;
}

export const getDefaultCriteria = async (chatType: string): Promise<DefaultCriteriaResponse> => {
  const { data } = await deduplicatedGet<DefaultCriteriaResponse>(`/criteria/defaults/${chatType}`);
  return data;
};

export const setDefaultCriteria = async (
  chatType: string,
  criteria: { name: string; description: string; weight: number; category: string }[]
): Promise<DefaultCriteriaResponse> => {
  const { data } = await debouncedMutation<DefaultCriteriaResponse>('put', `/criteria/defaults/${chatType}`, { criteria });
  return data;
};

export const resetDefaultCriteria = async (chatType: string): Promise<void> => {
  await debouncedMutation<void>('delete', `/criteria/defaults/${chatType}`);
};

export const seedUniversalPresets = async (): Promise<{ message: string; created: string[] }> => {
  const { data } = await debouncedMutation<{ message: string; created: string[] }>('post', '/criteria/presets/seed-universal');
  return data;
};

// AI
export const getAIHistory = async (chatId: number): Promise<AIConversation> => {
  const { data } = await deduplicatedGet<AIConversation>(`/chats/${chatId}/ai/history`);
  return data;
};

export const clearAIHistory = async (chatId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/chats/${chatId}/ai/history`);
};

export const getAnalysisHistory = async (chatId: number): Promise<AnalysisResult[]> => {
  const { data } = await deduplicatedGet<AnalysisResult[]>(`/chats/${chatId}/analysis-history`);
  return data;
};

// Stats
export const getStats = async (): Promise<Stats> => {
  const { data } = await deduplicatedGet<Stats>('/stats');
  return data;
};

// Streaming helpers with AbortController support

export interface StreamOptions {
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

/**
 * Internal helper to process SSE stream
 */
const processSSEStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  signal?: AbortSignal
): Promise<void> => {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            onDone();
          } else {
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                onChunk(parsed.content);
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      if (data === '[DONE]') {
        onDone();
      } else {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            onChunk(parsed.content);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};

/**
 * Stream AI message with AbortController support
 * Returns a cleanup function to abort the request
 */
export const streamAIMessage = async (
  chatId: number,
  message: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  signal?: AbortSignal
): Promise<() => void> => {
  const streamId = `ai-message-${chatId}-${Date.now()}`;
  const { controller, cleanup } = createStreamController(streamId);

  // Use provided signal or create our own
  const effectiveSignal = signal || controller.signal;

  try {
    const response = await fetch(`/api/chats/${chatId}/ai/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ message }),
      signal: effectiveSignal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка сервера' }));
      throw new Error(error.detail || 'Ошибка AI');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      cleanup();
      return cleanup;
    }

    // Process stream in background
    processSSEStream(reader, onChunk, onDone, effectiveSignal)
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Stream processing error:', error);
        }
      })
      .finally(cleanup);

    return cleanup;
  } catch (error) {
    cleanup();
    if ((error as Error).name === 'AbortError') {
      console.debug('AI message stream aborted');
      return cleanup;
    }
    throw error;
  }
};

/**
 * Stream quick action with AbortController support
 * Returns a cleanup function to abort the request
 */
export const streamQuickAction = async (
  chatId: number,
  action: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  signal?: AbortSignal
): Promise<() => void> => {
  const streamId = `quick-action-${chatId}-${action}-${Date.now()}`;
  const { controller, cleanup } = createStreamController(streamId);

  // Use provided signal or create our own
  const effectiveSignal = signal || controller.signal;

  try {
    const response = await fetch(`/api/chats/${chatId}/ai/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ quick_action: action }),
      signal: effectiveSignal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка сервера' }));
      throw new Error(error.detail || 'Ошибка AI');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      cleanup();
      return cleanup;
    }

    // Process stream in background
    processSSEStream(reader, onChunk, onDone, effectiveSignal)
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Stream processing error:', error);
        }
      })
      .finally(cleanup);

    return cleanup;
  } catch (error) {
    cleanup();
    if ((error as Error).name === 'AbortError') {
      console.debug('Quick action stream aborted');
      return cleanup;
    }
    throw error;
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
  const searchParams: Record<string, string> = {};
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams[key] = String(value);
    });
  }
  const { data } = await deduplicatedGet<Entity[]>('/entities', { params: searchParams });
  return data;
};

export const getEntity = async (id: number): Promise<EntityWithRelations> => {
  const { data } = await deduplicatedGet<EntityWithRelations>(`/entities/${id}`);
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
  const { data } = await debouncedMutation<Entity>('post', '/entities', entityData);
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
  const { data } = await debouncedMutation<Entity>('put', `/entities/${id}`, updates);
  return data;
};

export const deleteEntity = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/entities/${id}`);
};

export const transferEntity = async (entityId: number, transferData: {
  to_user_id: number;
  to_department_id?: number;
  comment?: string;
}): Promise<{ success: boolean; transfer_id: number }> => {
  const { data } = await debouncedMutation<{ success: boolean; transfer_id: number }>('post', `/entities/${entityId}/transfer`, transferData);
  return data;
};

export const linkChatToEntity = async (entityId: number, chatId: number): Promise<void> => {
  await debouncedMutation<void>('post', `/entities/${entityId}/link-chat/${chatId}`);
};

export const unlinkChatFromEntity = async (entityId: number, chatId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/entities/${entityId}/unlink-chat/${chatId}`);
};

// === RED FLAGS ANALYSIS ===

export interface RedFlag {
  type: string;
  type_label: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
  evidence?: string;
}

export interface RedFlagsAnalysis {
  flags: RedFlag[];
  risk_score: number;
  summary: string;
  flags_count: number;
  high_severity_count: number;
  medium_severity_count: number;
  low_severity_count: number;
}

export interface RiskScoreResponse {
  entity_id: number;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
}

/**
 * Get full red flags analysis for an entity.
 * Includes AI analysis of communications.
 */
export const getEntityRedFlags = async (
  entityId: number,
  vacancyId?: number
): Promise<RedFlagsAnalysis> => {
  const params = vacancyId ? { vacancy_id: vacancyId } : undefined;
  const { data } = await deduplicatedGet<RedFlagsAnalysis>(`/entities/${entityId}/red-flags`, { params });
  return data;
};

/**
 * Get quick risk score for an entity (0-100).
 * Fast calculation without AI analysis.
 */
export const getEntityRiskScore = async (entityId: number): Promise<RiskScoreResponse> => {
  const { data } = await deduplicatedGet<RiskScoreResponse>(`/entities/${entityId}/risk-score`);
  return data;
};

export const getEntityStatsByType = async (): Promise<Record<string, number>> => {
  const { data } = await deduplicatedGet<Record<string, number>>('/entities/stats/by-type');
  return data;
};

export const getEntityStatsByStatus = async (type?: EntityType): Promise<Record<string, number>> => {
  const params = type ? { type } : undefined;
  const { data } = await deduplicatedGet<Record<string, number>>('/entities/stats/by-status', { params });
  return data;
};

// === SMART SEARCH ===

export interface SmartSearchResult {
  id: number;
  type: EntityType;
  name: string;
  status: EntityStatus;
  phone?: string;
  email?: string;
  company?: string;
  position?: string;
  tags: string[];
  extra_data: Record<string, unknown>;
  department_id?: number;
  department_name?: string;
  created_at: string;
  updated_at: string;
  relevance_score: number;
  expected_salary_min?: number;
  expected_salary_max?: number;
  expected_salary_currency?: string;
  ai_summary?: string;
}

export interface SmartSearchResponse {
  results: SmartSearchResult[];
  total: number;
  parsed_query: Record<string, unknown>;
  offset: number;
  limit: number;
}

export interface SmartSearchParams {
  query: string;
  type?: EntityType;
  limit?: number;
  offset?: number;
}

/**
 * Smart search for entities with AI-powered natural language understanding.
 *
 * Examples:
 * - "Python developers with 3+ years experience"
 * - "Frontend React salary up to 200000"
 * - "Moscow Java senior"
 *
 * @param params Search parameters including query string and optional filters
 * @returns Search results with relevance scores and parsed query info
 */
export const smartSearch = async (params: SmartSearchParams): Promise<SmartSearchResponse> => {
  const searchParams: Record<string, string> = {
    query: params.query,
  };
  if (params.type) searchParams.type = params.type;
  if (params.limit !== undefined) searchParams.limit = String(params.limit);
  if (params.offset !== undefined) searchParams.offset = String(params.offset);

  const { data } = await deduplicatedGet<SmartSearchResponse>('/entities/search', { params: searchParams });
  return data;
};

// Entity Criteria
export const getEntityCriteria = async (entityId: number): Promise<EntityCriteria> => {
  const { data } = await deduplicatedGet<EntityCriteria>(`/criteria/entities/${entityId}`);
  return data;
};

export const updateEntityCriteria = async (entityId: number, criteria: { name: string; description: string; weight: number; category: string }[]): Promise<EntityCriteria> => {
  const { data } = await debouncedMutation<EntityCriteria>('put', `/criteria/entities/${entityId}`, { criteria });
  return data;
};

// Default criteria by entity type
export interface EntityDefaultCriteriaResponse {
  entity_type: string;
  criteria: { name: string; description: string; weight: number; category: string }[];
  is_custom: boolean;
  preset_id: number | null;
}

export const getEntityDefaultCriteria = async (entityType: string): Promise<EntityDefaultCriteriaResponse> => {
  const { data } = await deduplicatedGet<EntityDefaultCriteriaResponse>(`/criteria/entity-defaults/${entityType}`);
  return data;
};

export const setEntityDefaultCriteria = async (
  entityType: string,
  criteria: { name: string; description: string; weight: number; category: string }[]
): Promise<EntityDefaultCriteriaResponse> => {
  const { data } = await debouncedMutation<EntityDefaultCriteriaResponse>('put', `/criteria/entity-defaults/${entityType}`, { criteria });
  return data;
};

// Entity Report Download
export const downloadEntityReport = async (entityId: number, reportType: string, format: string): Promise<Blob> => {
  const response = await fetch(`/api/entities/${entityId}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ report_type: reportType, format }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
};

// === SIMILAR CANDIDATES & DUPLICATES ===

export interface SimilarCandidateResult {
  entity_id: number;
  entity_name: string;
  similarity_score: number;
  common_skills: string[];
  similar_experience: boolean;
  similar_salary: boolean;
  similar_location: boolean;
  match_reasons: string[];
}

export interface DuplicateCandidateResult {
  entity_id: number;
  entity_name: string;
  confidence: number;
  match_reasons: string[];
  matched_fields: Record<string, string[]>;
}

export interface MergeEntitiesResponse {
  success: boolean;
  message: string;
  merged_entity_id: number;
  deleted_entity_id: number;
}

/**
 * Get similar candidates for an entity.
 *
 * Searches by:
 * - Skills (50% weight)
 * - Work experience (20% weight)
 * - Salary expectations (15% weight)
 * - Location (15% weight)
 *
 * @param entityId ID of the source candidate
 * @param limit Maximum number of results (1-50)
 * @returns List of similar candidates sorted by similarity_score descending
 */
export const getSimilarCandidates = async (
  entityId: number,
  limit: number = 10
): Promise<SimilarCandidateResult[]> => {
  const { data } = await deduplicatedGet<SimilarCandidateResult[]>(
    `/entities/${entityId}/similar`,
    { params: { limit: String(limit) } }
  );
  return data;
};

/**
 * Get possible duplicates for an entity.
 *
 * Checks:
 * - Name (with transliteration support Rus<->Eng)
 * - Email
 * - Phone
 * - Skills + company combination
 *
 * @param entityId ID of the entity to check
 * @returns List of possible duplicates with confidence scores
 */
export const getDuplicateCandidates = async (
  entityId: number
): Promise<DuplicateCandidateResult[]> => {
  const { data } = await deduplicatedGet<DuplicateCandidateResult[]>(
    `/entities/${entityId}/duplicates`
  );
  return data;
};

/**
 * Merge two entities (duplicates).
 *
 * The target entity remains, source entity is deleted.
 * All related data (chats, calls, analyses) is transferred to target.
 *
 * @param targetEntityId ID of entity to keep
 * @param sourceEntityId ID of entity to merge and delete
 * @param keepSourceData If true, source data has priority on conflicts
 * @returns Merge operation result
 */
export const mergeEntities = async (
  targetEntityId: number,
  sourceEntityId: number,
  keepSourceData: boolean = false
): Promise<MergeEntitiesResponse> => {
  const { data } = await debouncedMutation<MergeEntitiesResponse>(
    'post',
    `/entities/${targetEntityId}/merge`,
    { source_entity_id: sourceEntityId, keep_source_data: keepSourceData }
  );
  return data;
};

/**
 * Compare two candidates.
 *
 * @param entityId ID of first candidate
 * @param otherEntityId ID of second candidate
 * @returns Comparison result with similarity score
 */
export const compareCandidates = async (
  entityId: number,
  otherEntityId: number
): Promise<SimilarCandidateResult> => {
  const { data } = await deduplicatedGet<SimilarCandidateResult>(
    `/entities/${entityId}/compare/${otherEntityId}`
  );
  return data;
};

// === CALLS ===

export const getCalls = async (params?: {
  entity_id?: number;
  status?: CallStatus;
  limit?: number;
  offset?: number;
}): Promise<CallRecording[]> => {
  const searchParams: Record<string, string> = {};
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams[key] = String(value);
    });
  }
  const { data } = await deduplicatedGet<CallRecording[]>('/calls', { params: searchParams });
  return data;
};

export const getCall = async (id: number): Promise<CallRecording> => {
  const { data } = await deduplicatedGet<CallRecording>(`/calls/${id}`);
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

export const startCallBot = async (botData: {
  source_url: string;
  bot_name?: string;
  entity_id?: number;
}): Promise<{ id: number; status: string }> => {
  const { data } = await debouncedMutation<{ id: number; status: string }>('post', '/calls/start-bot', botData);
  return data;
};

export const getCallStatus = async (
  id: number,
  signal?: AbortSignal
): Promise<{
  status: CallStatus;
  duration_seconds?: number;
  error_message?: string;
  progress?: number;
  progress_stage?: string;
}> => {
  // Don't deduplicate status calls - they need fresh data each time
  const { data } = await api.get(`/calls/${id}/status`, { signal });
  return data;
};

export const stopCallRecording = async (id: number): Promise<void> => {
  await debouncedMutation<void>('post', `/calls/${id}/stop`);
};

export const deleteCall = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/calls/${id}`);
};

export const linkCallToEntity = async (callId: number, entityId: number): Promise<void> => {
  await debouncedMutation<void>('post', `/calls/${callId}/link-entity/${entityId}`);
};

export const reprocessCall = async (id: number): Promise<{ success: boolean; status: string }> => {
  const { data } = await debouncedMutation<{ success: boolean; status: string }>('post', `/calls/${id}/reprocess`);
  return data;
};

export const updateCall = async (
  id: number,
  callData: { title?: string; entity_id?: number }
): Promise<{ id: number; title?: string; entity_id?: number; entity_name?: string; success: boolean }> => {
  const { data } = await debouncedMutation<{ id: number; title?: string; entity_id?: number; entity_name?: string; success: boolean }>('patch', `/calls/${id}`, callData);
  return data;
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
  const { data } = await deduplicatedGet<DetectLinkTypeResponse>('/external/detect-type', { params: { url } });
  return data;
};

export const processExternalURL = async (urlData: {
  url: string;
  title?: string;
  entity_id?: number;
}): Promise<ProcessURLResponse> => {
  const { data } = await debouncedMutation<ProcessURLResponse>('post', '/external/process-url', urlData);
  return data;
};

export const getExternalProcessingStatus = async (callId: number): Promise<{
  id: number;
  status: string;
  progress: number;
  progress_stage: string;
  error_message?: string;
  title?: string;
}> => {
  // Don't deduplicate status calls - they need fresh data each time
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
  const { data } = await deduplicatedGet<{
    supported_types: Array<{
      type: string;
      description: string;
      examples: string[];
    }>;
  }>('/external/supported-types');
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
  custom_role_id?: number;
  custom_role_name?: string;
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
  const { data } = await deduplicatedGet<Organization>('/organizations/current');
  return data;
};

export const getOrgMembers = async (): Promise<OrgMember[]> => {
  const { data } = await deduplicatedGet<OrgMember[]>('/organizations/current/members');
  return data;
};

export const inviteMember = async (memberData: InviteMemberRequest): Promise<OrgMember> => {
  const { data } = await debouncedMutation<OrgMember>('post', '/organizations/current/members', memberData);
  return data;
};

export const updateMemberRole = async (userId: number, role: OrgRole): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>('patch', `/organizations/current/members/${userId}/role`, { role });
  return data;
};

export const removeMember = async (userId: number): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>('delete', `/organizations/current/members/${userId}`);
  return data;
};

export const getMyOrgRole = async (): Promise<{ role: OrgRole }> => {
  const { data } = await deduplicatedGet<{ role: OrgRole }>('/organizations/current/my-role');
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

export const shareResource = async (shareData: ShareRequest): Promise<ShareResponse> => {
  const { data } = await debouncedMutation<ShareResponse>('post', '/sharing', shareData);
  return data;
};

export const revokeShare = async (shareId: number): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>('delete', `/sharing/${shareId}`);
  return data;
};

export const getMyShares = async (resourceType?: ResourceType): Promise<ShareResponse[]> => {
  const params = resourceType ? { resource_type: resourceType } : undefined;
  const { data } = await deduplicatedGet<ShareResponse[]>('/sharing/my-shares', { params });
  return data;
};

export const getSharedWithMe = async (resourceType?: ResourceType): Promise<ShareResponse[]> => {
  const params = resourceType ? { resource_type: resourceType } : undefined;
  const { data } = await deduplicatedGet<ShareResponse[]>('/sharing/shared-with-me', { params });
  return data;
};

export const getResourceShares = async (resourceType: ResourceType, resourceId: number): Promise<ShareResponse[]> => {
  const { data } = await deduplicatedGet<ShareResponse[]>(`/sharing/resource/${resourceType}/${resourceId}`);
  return data;
};

export const getSharableUsers = async (): Promise<UserSimple[]> => {
  const { data } = await deduplicatedGet<UserSimple[]>('/sharing/users');
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

export type DeptRole = 'lead' | 'sub_admin' | 'member';

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
  const { data } = await deduplicatedGet<Department[]>('/departments', { params });
  return data;
};

export const getDepartment = async (id: number): Promise<Department> => {
  const { data } = await deduplicatedGet<Department>(`/departments/${id}`);
  return data;
};

export const createDepartment = async (dept: {
  name: string;
  description?: string;
  color?: string;
  parent_id?: number;
}): Promise<Department> => {
  const { data } = await debouncedMutation<Department>('post', '/departments', dept);
  return data;
};

export const updateDepartment = async (id: number, updates: {
  name?: string;
  description?: string;
  color?: string;
  is_active?: boolean;
}): Promise<Department> => {
  const { data } = await debouncedMutation<Department>('patch', `/departments/${id}`, updates);
  return data;
};

export const deleteDepartment = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/departments/${id}`);
};

export const getDepartmentMembers = async (departmentId: number): Promise<DepartmentMember[]> => {
  const { data } = await deduplicatedGet<DepartmentMember[]>(`/departments/${departmentId}/members`);
  return data;
};

export const addDepartmentMember = async (departmentId: number, memberData: {
  user_id: number;
  role?: DeptRole;
}): Promise<DepartmentMember> => {
  const { data } = await debouncedMutation<DepartmentMember>('post', `/departments/${departmentId}/members`, memberData);
  return data;
};

export const updateDepartmentMember = async (departmentId: number, userId: number, role: DeptRole): Promise<DepartmentMember> => {
  const { data } = await debouncedMutation<DepartmentMember>('patch', `/departments/${departmentId}/members/${userId}`, { role });
  return data;
};

export const removeDepartmentMember = async (departmentId: number, userId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/departments/${departmentId}/members/${userId}`);
};

export const getMyDepartments = async (): Promise<Department[]> => {
  const { data } = await deduplicatedGet<Department[]>('/departments/my/departments');
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

export const createInvitation = async (inviteData: {
  email?: string;
  name?: string;
  org_role?: OrgRole;
  department_ids?: { id: number; role: DeptRole }[];
  expires_in_days?: number;
}): Promise<Invitation> => {
  const { data } = await debouncedMutation<Invitation>('post', '/invitations', inviteData);
  return data;
};

export const getInvitations = async (includeUsed: boolean = false): Promise<Invitation[]> => {
  const { data } = await deduplicatedGet<Invitation[]>('/invitations', { params: { include_used: includeUsed } });
  return data;
};

export const validateInvitation = async (token: string): Promise<InvitationValidation> => {
  const { data } = await deduplicatedGet<InvitationValidation>(`/invitations/validate/${token}`);
  return data;
};

export const acceptInvitation = async (token: string, acceptData: AcceptInvitationRequest): Promise<AcceptInvitationResponse> => {
  const { data } = await debouncedMutation<AcceptInvitationResponse>('post', `/invitations/accept/${token}`, acceptData);
  return data;
};

export const revokeInvitation = async (id: number): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>('delete', `/invitations/${id}`);
  return data;
};

// Custom Roles API (Superadmin only)
export interface CustomRole {
  id: number;
  name: string;
  description?: string;
  base_role: 'owner' | 'admin' | 'sub_admin' | 'member';
  org_id?: number;
  created_by?: number;
  created_at: string;
  is_active: boolean;
  permission_overrides?: PermissionOverride[];
}

export interface PermissionOverride {
  id: number;
  role_id: number;
  permission: string;
  allowed: boolean;
}

export interface PermissionAuditLog {
  id: number;
  changed_by?: number;
  role_id?: number;
  action: string;
  permission?: string;
  old_value?: boolean;
  new_value?: boolean;
  details?: Record<string, unknown>;
  created_at: string;
}

export const getCustomRoles = async (): Promise<CustomRole[]> => {
  const { data } = await deduplicatedGet<CustomRole[]>('/admin/custom-roles');
  return data;
};

export const getCustomRole = async (id: number): Promise<CustomRole> => {
  const { data } = await deduplicatedGet<CustomRole>(`/admin/custom-roles/${id}`);
  return data;
};

export const createCustomRole = async (roleData: {
  name: string;
  description?: string;
  base_role: string;
  org_id?: number;
}): Promise<CustomRole> => {
  const { data } = await debouncedMutation<CustomRole>('post', '/admin/custom-roles', roleData);
  return data;
};

export const updateCustomRole = async (id: number, updates: {
  name?: string;
  description?: string;
  is_active?: boolean;
}): Promise<CustomRole> => {
  const { data } = await debouncedMutation<CustomRole>('patch', `/admin/custom-roles/${id}`, updates);
  return data;
};

export const deleteCustomRole = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/admin/custom-roles/${id}`);
};

export const setRolePermission = async (roleId: number, permission: string, allowed: boolean): Promise<PermissionOverride> => {
  const { data } = await debouncedMutation<PermissionOverride>('post', `/admin/custom-roles/${roleId}/permissions`, { permission, allowed });
  return data;
};

export const removeRolePermission = async (roleId: number, permission: string): Promise<void> => {
  await debouncedMutation<void>('delete', `/admin/custom-roles/${roleId}/permissions/${permission}`);
};

export const assignCustomRole = async (roleId: number, userId: number): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>('post', `/admin/custom-roles/${roleId}/assign/${userId}`);
  return data;
};

export const unassignCustomRole = async (roleId: number, userId: number): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>('delete', `/admin/custom-roles/${roleId}/assign/${userId}`);
  return data;
};

export const getPermissionAuditLogs = async (params?: {
  role_id?: number;
  limit?: number;
  offset?: number;
}): Promise<PermissionAuditLog[]> => {
  const { data } = await deduplicatedGet<PermissionAuditLog[]>('/admin/permission-audit-logs', { params });
  return data;
};

// User Effective Permissions API
export interface EffectivePermissions {
  permissions: Record<string, boolean>;
  source: 'custom_role' | 'org_role' | 'default';
  custom_role_id: number | null;
  custom_role_name: string | null;
  base_role: string;
}

export interface MenuItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  required_permission?: string;
  required_feature?: string;  // Feature that must be available to show this item
  superadmin_only: boolean;
}

export interface MenuConfig {
  items: MenuItem[];
}

export interface UserFeatures {
  features: string[];
}

export const getMyPermissions = async (): Promise<EffectivePermissions> => {
  const { data } = await deduplicatedGet<EffectivePermissions>('/admin/me/permissions');
  return data;
};

export const getMyMenu = async (): Promise<MenuConfig> => {
  const { data } = await deduplicatedGet<MenuConfig>('/admin/me/menu');
  return data;
};

export const getMyFeatures = async (): Promise<UserFeatures> => {
  const { data } = await deduplicatedGet<UserFeatures>('/admin/me/features');
  return data;
};


// === CURRENCY ===

export interface ExchangeRatesResponse {
  rates: Record<string, number>;
  base_currency: string;
  last_updated: string | null;
  is_fallback: boolean;
  supported_currencies: string[];
}

export interface CurrencyConversionRequest {
  amount: number;
  from_currency: string;
  to_currency: string;
}

export interface CurrencyConversionResponse {
  original_amount: number;
  from_currency: string;
  to_currency: string;
  converted_amount: number;
  rate: number;
}

export interface SupportedCurrency {
  code: string;
  name: string;
  symbol: string;
}

export interface SupportedCurrenciesResponse {
  currencies: SupportedCurrency[];
  default_base: string;
}

/**
 * Get exchange rates for all supported currencies.
 * @param base - Base currency for rates (default: RUB)
 * @param refresh - Force refresh from API (bypass cache)
 * @returns Exchange rates relative to base currency
 */
export const getExchangeRates = async (
  base: string = 'RUB',
  refresh: boolean = false
): Promise<ExchangeRatesResponse> => {
  const params: Record<string, string> = { base };
  if (refresh) params.refresh = 'true';
  const { data } = await deduplicatedGet<ExchangeRatesResponse>('/currency/rates', { params });
  return data;
};

/**
 * Convert an amount between currencies using the API.
 * @param request - Conversion request with amount and currencies
 * @returns Converted amount and rate
 */
export const convertCurrencyApi = async (
  request: CurrencyConversionRequest
): Promise<CurrencyConversionResponse> => {
  // Currency conversion can be called frequently, no debounce needed
  const { data } = await api.post('/currency/convert', request);
  return data;
};

/**
 * Get list of supported currencies.
 * @returns List of supported currencies with names and symbols
 */
export const getSupportedCurrencies = async (): Promise<SupportedCurrenciesResponse> => {
  const { data } = await deduplicatedGet<SupportedCurrenciesResponse>('/currency/supported');
  return data;
};


// === VACANCIES ===

export interface VacancyFilters {
  status?: VacancyStatus;
  department_id?: number;
  search?: string;
  skip?: number;
  limit?: number;
}

export interface VacancyCreate {
  title: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  status?: VacancyStatus;
  priority?: number;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number;
  hiring_manager_id?: number;
  closes_at?: string;
}

export interface VacancyUpdate {
  title?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  status?: VacancyStatus;
  priority?: number;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number;
  hiring_manager_id?: number;
  closes_at?: string;
}

export interface ApplicationCreate {
  vacancy_id: number;
  entity_id: number;
  stage?: ApplicationStage;
  rating?: number;
  notes?: string;
  source?: string;
}

export interface ApplicationUpdate {
  stage?: ApplicationStage;
  stage_order?: number;
  rating?: number;
  notes?: string;
  rejection_reason?: string;
  next_interview_at?: string;
}

export const getVacancies = async (filters?: VacancyFilters): Promise<Vacancy[]> => {
  const params: Record<string, string> = {};
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params[key] = String(value);
    });
  }
  const { data } = await deduplicatedGet<Vacancy[]>('/vacancies', { params });
  return data;
};

export const getVacancy = async (id: number): Promise<Vacancy> => {
  const { data } = await deduplicatedGet<Vacancy>(`/vacancies/${id}`);
  return data;
};

export const createVacancy = async (vacancyData: VacancyCreate): Promise<Vacancy> => {
  const { data } = await debouncedMutation<Vacancy>('post', '/vacancies', vacancyData);
  return data;
};

export const updateVacancy = async (id: number, updates: VacancyUpdate): Promise<Vacancy> => {
  const { data } = await debouncedMutation<Vacancy>('put', `/vacancies/${id}`, updates);
  return data;
};

export const deleteVacancy = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/vacancies/${id}`);
};

// Vacancy Applications
export const getApplications = async (vacancyId: number, stage?: ApplicationStage): Promise<VacancyApplication[]> => {
  const params = stage ? { stage } : undefined;
  const { data } = await deduplicatedGet<VacancyApplication[]>(`/vacancies/${vacancyId}/applications`, { params });
  return data;
};

export const createApplication = async (vacancyId: number, applicationData: ApplicationCreate): Promise<VacancyApplication> => {
  const { data } = await debouncedMutation<VacancyApplication>('post', `/vacancies/${vacancyId}/applications`, applicationData);
  return data;
};

export const updateApplication = async (applicationId: number, updates: ApplicationUpdate): Promise<VacancyApplication> => {
  const { data } = await debouncedMutation<VacancyApplication>('put', `/vacancies/applications/${applicationId}`, updates);
  return data;
};

export const deleteApplication = async (applicationId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/vacancies/applications/${applicationId}`);
};

// Kanban Board
export const getKanbanBoard = async (vacancyId: number): Promise<KanbanBoard> => {
  const { data } = await deduplicatedGet<KanbanBoard>(`/vacancies/${vacancyId}/kanban`);
  return data;
};

export const bulkMoveApplications = async (applicationIds: number[], stage: ApplicationStage): Promise<VacancyApplication[]> => {
  const { data } = await debouncedMutation<VacancyApplication[]>('post', '/vacancies/applications/bulk-move', {
    application_ids: applicationIds,
    stage
  });
  return data;
};

// Vacancy Stats
export const getVacancyStats = async (): Promise<VacancyStats> => {
  const { data } = await deduplicatedGet<VacancyStats>('/vacancies/stats/overview');
  return data;
};

// Entity-Vacancy integration
export const getEntityVacancies = async (entityId: number): Promise<VacancyApplication[]> => {
  const { data } = await deduplicatedGet<VacancyApplication[]>(`/entities/${entityId}/vacancies`);
  return data;
};

export const applyEntityToVacancy = async (
  entityId: number,
  vacancyId: number,
  source?: string
): Promise<VacancyApplication> => {
  const { data } = await debouncedMutation<VacancyApplication>('post', `/entities/${entityId}/apply-to-vacancy`, {
    vacancy_id: vacancyId,
    source
  });
  return data;
};

// === Vacancy Recommendations ===

import type { VacancyRecommendation, CandidateMatch, NotifyCandidatesResponse } from '@/types';

export const getRecommendedVacancies = async (
  entityId: number,
  limit: number = 5
): Promise<VacancyRecommendation[]> => {
  const { data } = await deduplicatedGet<VacancyRecommendation[]>(
    `/entities/${entityId}/recommended-vacancies`,
    { params: { limit } }
  );
  return data;
};

export const autoApplyToVacancy = async (
  entityId: number,
  vacancyId: number
): Promise<{ id: number; vacancy_id: number; entity_id: number; stage: string; message: string }> => {
  const { data } = await debouncedMutation<{ id: number; vacancy_id: number; entity_id: number; stage: string; message: string }>('post', `/entities/${entityId}/auto-apply/${vacancyId}`);
  return data;
};

export const getMatchingCandidates = async (
  vacancyId: number,
  options?: { limit?: number; minScore?: number; excludeApplied?: boolean }
): Promise<CandidateMatch[]> => {
  const params: Record<string, string | number | boolean> = {};
  if (options?.limit) params.limit = options.limit;
  if (options?.minScore !== undefined) params.min_score = options.minScore;
  if (options?.excludeApplied !== undefined) params.exclude_applied = options.excludeApplied;

  const { data } = await deduplicatedGet<CandidateMatch[]>(
    `/vacancies/${vacancyId}/matching-candidates`,
    { params }
  );
  return data;
};

export const notifyMatchingCandidates = async (
  vacancyId: number,
  options?: { minScore?: number; limit?: number }
): Promise<NotifyCandidatesResponse> => {
  const params: Record<string, string | number> = {};
  if (options?.minScore !== undefined) params.min_score = options.minScore;
  if (options?.limit) params.limit = options.limit;

  const { data } = await debouncedMutation<NotifyCandidatesResponse>(
    'post',
    `/vacancies/${vacancyId}/notify-candidates`,
    undefined,
    { params }
  );
  return data;
};

interface InviteCandidateResponse {
  id: number;
  vacancy_id: number;
  vacancy_title: string;
  entity_id: number;
  entity_name: string;
  stage: string;
  message: string;
}

export const inviteCandidateToVacancy = async (
  vacancyId: number,
  entityId: number,
  stage?: string,
  notes?: string
): Promise<InviteCandidateResponse> => {
  const params: Record<string, string> = {};
  if (stage) params.stage = stage;
  if (notes) params.notes = notes;

  const { data } = await debouncedMutation<InviteCandidateResponse>(
    'post',
    `/vacancies/${vacancyId}/invite-candidate/${entityId}`,
    undefined,
    { params }
  );
  return data;
};

// Entity files
export interface EntityFile {
  id: number;
  entity_id: number;
  file_type: 'resume' | 'cover_letter' | 'test_assignment' | 'certificate' | 'portfolio' | 'other';
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  description?: string;
  uploaded_by?: number;
  created_at: string;
}

export const getEntityFiles = async (entityId: number): Promise<EntityFile[]> => {
  const { data } = await deduplicatedGet<EntityFile[]>(`/entities/${entityId}/files`);
  return data;
};

export const uploadEntityFile = async (
  entityId: number,
  file: File,
  fileType: string,
  description?: string
): Promise<EntityFile> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('file_type', fileType);
  if (description) formData.append('description', description);

  const { data } = await api.post(`/entities/${entityId}/files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

export const deleteEntityFile = async (entityId: number, fileId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/entities/${entityId}/files/${fileId}`);
};

export const downloadEntityFile = async (entityId: number, fileId: number): Promise<Blob> => {
  const response = await fetch(`/api/entities/${entityId}/files/${fileId}/download`, {
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
};

// === AI SCORING API ===

import type {
  CalculateScoreRequest,
  CalculateScoreResponse,
  EntityScoreResult,
  BestMatchesRequest,
  BestMatchesResponse,
  MatchingVacanciesRequest,
  MatchingVacanciesResponse
} from '@/types';

/**
 * Calculate AI compatibility score between a candidate and vacancy.
 * @param request - Entity ID and Vacancy ID
 * @returns Detailed compatibility score
 */
export const calculateCompatibilityScore = async (
  request: CalculateScoreRequest
): Promise<CalculateScoreResponse> => {
  const { data } = await debouncedMutation<CalculateScoreResponse>(
    'post',
    '/scoring/calculate',
    request
  );
  return data;
};

/**
 * Find best matching candidates for a vacancy.
 * @param vacancyId - Vacancy ID
 * @param request - Limit and filter options
 * @returns List of top matching candidates with scores
 */
export const findBestMatchesForVacancy = async (
  vacancyId: number,
  request: BestMatchesRequest = {}
): Promise<BestMatchesResponse> => {
  const { data } = await debouncedMutation<BestMatchesResponse>(
    'post',
    `/scoring/vacancy/${vacancyId}/matches`,
    request
  );
  return data;
};

/**
 * Find matching vacancies for a candidate.
 * @param entityId - Entity (candidate) ID
 * @param request - Limit and filter options
 * @returns List of matching vacancies with scores
 */
export const findMatchingVacanciesForEntity = async (
  entityId: number,
  request: MatchingVacanciesRequest = {}
): Promise<MatchingVacanciesResponse> => {
  const { data } = await debouncedMutation<MatchingVacanciesResponse>(
    'post',
    `/scoring/entity/${entityId}/vacancies`,
    request
  );
  return data;
};

/**
 * Get compatibility score for an application.
 * @param applicationId - Application ID
 * @param recalculate - Force recalculation
 * @returns Compatibility score
 */
export const getApplicationScore = async (
  applicationId: number,
  recalculate: boolean = false
): Promise<CalculateScoreResponse> => {
  const { data } = await deduplicatedGet<CalculateScoreResponse>(
    `/scoring/application/${applicationId}`,
    { params: { recalculate } }
  );
  return data;
};

/**
 * Recalculate compatibility score for an application.
 * @param applicationId - Application ID
 * @returns Updated compatibility score
 */
export const recalculateApplicationScore = async (
  applicationId: number
): Promise<CalculateScoreResponse> => {
  const { data } = await debouncedMutation<CalculateScoreResponse>(
    'post',
    `/scoring/application/${applicationId}/recalculate`,
    {}
  );
  return data;
};

/**
 * Bulk calculate compatibility scores for multiple candidates against a vacancy.
 * @param vacancyId - Vacancy ID
 * @param entityIds - List of entity IDs to score
 * @returns List of entity scores
 */
export const bulkCalculateScores = async (
  vacancyId: number,
  entityIds: number[]
): Promise<EntityScoreResult[]> => {
  const params = new URLSearchParams();
  params.append('vacancy_id', String(vacancyId));
  entityIds.forEach(id => params.append('entity_ids', String(id)));

  const { data } = await debouncedMutation<EntityScoreResult[]>(
    'post',
    `/scoring/bulk?${params.toString()}`,
    {}
  );
  return data;
};

// === PARSER API ===

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  telegram?: string;
  position?: string;
  company?: string;
  experience_years?: number;
  skills: string[];
  salary_min?: number;
  salary_max?: number;
  salary_currency: string;
  location?: string;
  summary?: string;
  source_url?: string;
}

export interface ParsedVacancy {
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
  company_name?: string;
  source_url?: string;
}

// Response wrapper from parser API
interface ParseResponse<T> {
  success: boolean;
  data?: T;
  source?: string;
  error?: string;
}

export const parseResumeFromUrl = async (url: string): Promise<ParsedResume> => {
  const { data: response } = await debouncedMutation<ParseResponse<ParsedResume>>('post', '/parser/resume/url', { url });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Ошибка парсинга резюме');
  }
  return response.data;
};

export const parseResumeFromFile = async (file: File): Promise<ParsedResume> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data: response } = await api.post<ParseResponse<ParsedResume>>('/parser/resume/file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Ошибка парсинга файла');
  }
  return response.data;
};

export const parseVacancyFromUrl = async (url: string): Promise<ParsedVacancy> => {
  const { data: response } = await debouncedMutation<ParseResponse<ParsedVacancy>>('post', '/parser/vacancy/url', { url });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Ошибка парсинга вакансии');
  }
  return response.data;
};

/**
 * Result for a single resume in bulk import
 */
export interface BulkImportResult {
  filename: string;
  success: boolean;
  entity_id?: number;
  entity_name?: string;
  error?: string;
}

/**
 * Response from bulk resume import
 */
export interface BulkImportResponse {
  success: boolean;
  total_files: number;
  successful: number;
  failed: number;
  results: BulkImportResult[];
  error?: string;
}

/**
 * Bulk import resumes from a ZIP file.
 * Each resume will be parsed using AI and a candidate entity will be created.
 * @param file - ZIP file containing resume files (PDF, DOC, DOCX)
 * @returns Import results for each file
 */
export const bulkImportResumes = async (file: File): Promise<BulkImportResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<BulkImportResponse>('/parser/resume/bulk-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

/**
 * Response from creating entity from resume
 */
export interface CreateEntityFromResumeResponse {
  entity_id: number;
  parsed_data: ParsedResume;
  message: string;
}

/**
 * Create a new candidate entity from uploaded resume file.
 * This will parse the resume and create an entity in one step.
 * @param file - Resume file (PDF, DOC, DOCX)
 * @returns Created entity ID and parsed data
 */
export const createEntityFromResume = async (file: File): Promise<CreateEntityFromResumeResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/parser/resume/create-entity', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

// === FEATURE ACCESS CONTROL ===

export interface FeatureSetting {
  id: number;
  feature_name: string;
  enabled: boolean;
  department_id: number | null;
  department_name: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FeatureSettingsResponse {
  features: FeatureSetting[];
  available_features: string[];
  restricted_features: string[];
}

export interface UserFeaturesResponse {
  features: string[];
}

export interface SetFeatureAccessRequest {
  department_ids?: number[] | null;
  enabled: boolean;
}

export const getFeatureSettings = async (): Promise<FeatureSettingsResponse> => {
  const { data } = await deduplicatedGet<FeatureSettingsResponse>('/admin/features');
  return data;
};

export const setFeatureAccess = async (
  featureName: string,
  request: SetFeatureAccessRequest
): Promise<FeatureSettingsResponse> => {
  const { data } = await debouncedMutation<FeatureSettingsResponse>('put', `/admin/features/${featureName}`, request);
  return data;
};

export const deleteFeatureSetting = async (
  featureName: string,
  departmentId?: number | null
): Promise<{ success: boolean }> => {
  const params = departmentId !== undefined && departmentId !== null
    ? `?department_id=${departmentId}`
    : '';
  const { data } = await debouncedMutation<{ success: boolean }>('delete', `/admin/features/${featureName}${params}`);
  return data;
};

// Feature Audit Logs
export interface FeatureAuditLog {
  id: number;
  org_id: number;
  changed_by: number | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  feature_name: string;
  action: string;  // 'enable', 'disable', 'delete'
  department_id: number | null;
  department_name: string | null;
  old_value: boolean | null;
  new_value: boolean | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export const getFeatureAuditLogs = async (params?: {
  feature_name?: string;
  limit?: number;
  offset?: number;
}): Promise<FeatureAuditLog[]> => {
  const { data } = await deduplicatedGet<FeatureAuditLog[]>('/admin/features/audit-logs', { params });
  return data;
};

// === GLOBAL SEARCH (Command Palette) ===

export interface GlobalSearchCandidate {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  company?: string;
  status: string;
  relevance_score: number;
}

export interface GlobalSearchVacancy {
  id: number;
  title: string;
  status: string;
  location?: string;
  department_name?: string;
  relevance_score: number;
}

export interface GlobalSearchResult {
  type: 'candidate' | 'vacancy';
  id: number;
  title: string;
  subtitle?: string;
  relevance_score: number;
}

export interface GlobalSearchResponse {
  candidates: GlobalSearchCandidate[];
  vacancies: GlobalSearchVacancy[];
  total: number;
}

/**
 * Global search for Command Palette.
 * Searches across candidates and vacancies.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results per category (default: 5)
 * @returns Search results grouped by type
 */
export const globalSearch = async (
  query: string,
  limit: number = 5
): Promise<GlobalSearchResponse> => {
  const { data } = await deduplicatedGet<GlobalSearchResponse>('/search/global', {
    params: { query, limit: String(limit) }
  });
  return data;
};

export default api;
