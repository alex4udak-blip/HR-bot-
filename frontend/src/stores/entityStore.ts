import { create } from 'zustand';
import type { Entity, EntityType, EntityStatus, EntityWithRelations } from '@/types';
import * as api from '@/services/api';
import type { OwnershipFilter } from '@/services/api';

interface EntityFilters {
  type?: EntityType;
  status?: EntityStatus;
  search?: string;
  tags?: string;
  ownership?: OwnershipFilter;
}

interface EntityState {
  entities: Entity[];
  currentEntity: EntityWithRelations | null;
  loading: boolean;
  error: string | null;
  filters: EntityFilters;
  fetchVersion: number; // Track request version to discard stale responses

  // Actions
  fetchEntities: () => Promise<void>;
  fetchEntity: (id: number) => Promise<void>;
  createEntity: (data: Parameters<typeof api.createEntity>[0]) => Promise<Entity>;
  updateEntity: (id: number, data: Parameters<typeof api.updateEntity>[1]) => Promise<void>;
  deleteEntity: (id: number) => Promise<void>;
  transferEntity: (entityId: number, toUserId: number, comment?: string) => Promise<void>;
  setFilters: (filters: Partial<EntityFilters>) => void;
  clearFilters: () => void;
  clearCurrentEntity: () => void;
  clearError: () => void;
}

export const useEntityStore = create<EntityState>((set, get) => ({
  entities: [],
  currentEntity: null,
  loading: false,
  error: null,
  filters: {},
  fetchVersion: 0,

  fetchEntities: async () => {
    // Increment version to track this request
    const version = get().fetchVersion + 1;
    set({ loading: true, error: null, fetchVersion: version });
    try {
      const entities = await api.getEntities(get().filters);
      // Only update if this is still the latest request
      if (get().fetchVersion === version) {
        set({ entities, loading: false });
      }
    } catch (err) {
      // Only update error if this is still the latest request
      if (get().fetchVersion === version) {
        const message = err instanceof Error ? err.message : 'Failed to fetch entities';
        set({ error: message, loading: false });
      }
    }
  },

  fetchEntity: async (id) => {
    set({ loading: true, error: null });
    try {
      const entity = await api.getEntity(id);
      set({ currentEntity: entity, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch entity';
      set({ error: message, loading: false });
    }
  },

  createEntity: async (data) => {
    set({ loading: true, error: null });
    try {
      const entity = await api.createEntity(data);
      set((state) => ({
        entities: [entity, ...state.entities],
        loading: false
      }));
      return entity;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create entity';
      set({ error: message, loading: false });
      throw err;
    }
  },

  updateEntity: async (id, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await api.updateEntity(id, data);
      set((state) => ({
        entities: state.entities.map((e) => (e.id === id ? { ...e, ...updated } : e)),
        currentEntity:
          state.currentEntity?.id === id
            ? { ...state.currentEntity, ...updated }
            : state.currentEntity,
        loading: false
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update entity';
      set({ error: message, loading: false });
      throw err;
    }
  },

  deleteEntity: async (id) => {
    set({ loading: true, error: null });
    try {
      await api.deleteEntity(id);
      set((state) => ({
        entities: state.entities.filter((e) => e.id !== id),
        currentEntity: state.currentEntity?.id === id ? null : state.currentEntity,
        loading: false
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete entity';
      set({ error: message, loading: false });
      throw err;
    }
  },

  transferEntity: async (entityId, toUserId, comment) => {
    set({ loading: true, error: null });
    try {
      await api.transferEntity(entityId, { to_user_id: toUserId, comment });
      // Refresh entity to get updated transfers (fetchEntity sets loading: false)
      await get().fetchEntity(entityId);
      set({ loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to transfer entity';
      set({ error: message, loading: false });
      throw err;
    }
  },

  setFilters: (filters) => {
    set((state) => ({ filters: { ...state.filters, ...filters } }));
    get().fetchEntities();
  },

  clearFilters: () => {
    set({ filters: {} });
    get().fetchEntities();
  },

  clearCurrentEntity: () => set({ currentEntity: null }),

  clearError: () => set({ error: null })
}));
