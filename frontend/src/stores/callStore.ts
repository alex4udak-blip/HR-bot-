import { create } from 'zustand';
import type { CallRecording, CallStatus } from '@/types';
import * as api from '@/services/api';

interface ActiveRecording {
  id: number;
  status: CallStatus;
  duration: number;
  error?: string;
}

interface CallState {
  calls: CallRecording[];
  currentCall: CallRecording | null;
  activeRecording: ActiveRecording | null;
  loading: boolean;
  error: string | null;
  pollingInterval: ReturnType<typeof setInterval> | null;

  // Actions
  fetchCalls: (entityId?: number) => Promise<void>;
  fetchCall: (id: number) => Promise<void>;
  uploadCall: (file: File, entityId?: number) => Promise<number>;
  startBot: (url: string, botName: string, entityId?: number) => Promise<number>;
  stopRecording: () => Promise<void>;
  deleteCall: (id: number) => Promise<void>;
  reprocessCall: (id: number) => Promise<void>;
  updateCall: (id: number, data: { title?: string; entity_id?: number }) => Promise<void>;
  pollStatus: (id: number) => void;
  stopPolling: () => void;
  clearActiveRecording: () => void;
  clearError: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  calls: [],
  currentCall: null,
  activeRecording: null,
  loading: false,
  error: null,
  pollingInterval: null,

  fetchCalls: async (entityId) => {
    set({ loading: true, error: null });
    try {
      const calls = await api.getCalls({ entity_id: entityId });
      set({ calls, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch calls';
      set({ error: message, loading: false });
    }
  },

  fetchCall: async (id) => {
    set({ loading: true, error: null });
    try {
      const call = await api.getCall(id);
      set({ currentCall: call, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch call';
      set({ error: message, loading: false });
    }
  },

  uploadCall: async (file, entityId) => {
    set({ loading: true, error: null });
    try {
      const result = await api.uploadCallRecording(file, entityId);
      set({
        activeRecording: { id: result.id, status: 'processing' as CallStatus, duration: 0 },
        loading: false
      });
      get().pollStatus(result.id);
      return result.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload call';
      set({ error: message, loading: false });
      throw err;
    }
  },

  startBot: async (url, botName, entityId) => {
    set({ loading: true, error: null });
    try {
      const result = await api.startCallBot({ source_url: url, bot_name: botName, entity_id: entityId });
      set({
        activeRecording: { id: result.id, status: (result.status || 'recording') as CallStatus, duration: 0 },
        loading: false
      });
      get().pollStatus(result.id);
      // Also fetch the full call to update currentCall
      get().fetchCall(result.id);
      return result.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording bot';
      set({ error: message, loading: false });
      throw err;
    }
  },

  stopRecording: async () => {
    const { activeRecording } = get();
    if (!activeRecording) return;

    try {
      await api.stopCallRecording(activeRecording.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop recording';
      set({ error: message });
    }
  },

  deleteCall: async (id) => {
    set({ loading: true, error: null });
    try {
      await api.deleteCall(id);
      set((state) => ({
        calls: state.calls.filter((c) => c.id !== id),
        currentCall: state.currentCall?.id === id ? null : state.currentCall,
        loading: false
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete call';
      set({ error: message, loading: false });
      throw err;
    }
  },

  reprocessCall: async (id) => {
    set({ loading: true, error: null });
    try {
      await api.reprocessCall(id);
      set({
        activeRecording: { id, status: 'processing' as CallStatus, duration: 0 },
        loading: false
      });
      get().pollStatus(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reprocess call';
      set({ error: message, loading: false });
      throw err;
    }
  },

  updateCall: async (id, data) => {
    set({ loading: true, error: null });
    try {
      const result = await api.updateCall(id, data);
      // Update current call if it matches
      set((state) => ({
        currentCall: state.currentCall?.id === id
          ? { ...state.currentCall, title: result.title, entity_id: result.entity_id, entity_name: result.entity_name }
          : state.currentCall,
        calls: state.calls.map((c) =>
          c.id === id ? { ...c, title: result.title, entity_id: result.entity_id, entity_name: result.entity_name } : c
        ),
        loading: false
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update call';
      set({ error: message, loading: false });
      throw err;
    }
  },

  pollStatus: (id) => {
    // Clear any existing polling
    get().stopPolling();

    const interval = setInterval(async () => {
      try {
        const status = await api.getCallStatus(id);

        const prevStatus = get().activeRecording?.status;
        set({
          activeRecording: {
            id,
            status: status.status,
            duration: status.duration_seconds || 0,
            error: status.error_message
          }
        });

        // If status changed, also refetch the full call data
        if (prevStatus !== status.status) {
          get().fetchCall(id);
        }

        // Stop polling when done or failed
        if (status.status === 'done' || status.status === 'failed') {
          get().stopPolling();
          // Refresh calls list and current call
          get().fetchCalls();
          get().fetchCall(id);
        }
      } catch {
        get().stopPolling();
      }
    }, 3000); // Poll every 3 seconds

    set({ pollingInterval: interval });
  },

  stopPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval) {
      clearInterval(pollingInterval);
      set({ pollingInterval: null });
    }
  },

  clearActiveRecording: () => {
    get().stopPolling();
    set({ activeRecording: null });
  },

  clearError: () => set({ error: null })
}));
