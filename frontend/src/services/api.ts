import axios from 'axios';
import type {
  User, Chat, Message, Participant, CriteriaPreset,
  ChatCriteria, AIConversation, AnalysisResult, Stats, AuthResponse
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = async (email: string, password: string): Promise<AuthResponse> => {
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
export const getMessages = async (chatId: number, page = 1, limit = 50, contentType?: string): Promise<Message[]> => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (contentType) params.append('content_type', contentType);
  const { data } = await api.get(`/chats/${chatId}/messages?${params}`);
  return data;
};

export const getParticipants = async (chatId: number): Promise<Participant[]> => {
  const { data } = await api.get(`/chats/${chatId}/participants`);
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
  const token = localStorage.getItem('token');
  const response = await fetch(`/api/chats/${chatId}/ai/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });

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
  const token = localStorage.getItem('token');
  const response = await fetch(`/api/chats/${chatId}/ai/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ quick_action: action }),
  });

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
  const token = localStorage.getItem('token');
  const response = await fetch(`/api/chats/${chatId}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ report_type: reportType, format }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
};

export default api;
