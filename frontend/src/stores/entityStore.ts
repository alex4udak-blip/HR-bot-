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
  department_id?: number;
}

interface TypeCounts {
  all: number;
  candidate: number;
  client: number;
  contractor: number;
  lead: number;
  partner: number;
  custom: number;
}

interface EntityState {
  entities: Entity[];
  currentEntity: EntityWithRelations | null;
  loading: boolean;
  error: string | null;
  filters: EntityFilters;
  fetchVersion: number; // Track request version to discard stale responses
  typeCounts: TypeCounts; // Counts for each type (not affected by type filter)

  // Actions
  fetchEntities: () => Promise<void>;
  fetchTypeCounts: () => Promise<void>;
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

const initialTypeCounts: TypeCounts = {
  all: 0,
  candidate: 0,
  client: 0,
  contractor: 0,
  lead: 0,
  partner: 0,
  custom: 0,
};

export const useEntityStore = create<EntityState>((set, get) => ({
  entities: [],
  currentEntity: null,
  loading: false,
  error: null,
  filters: {},
  fetchVersion: 0,
  typeCounts: initialTypeCounts,

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

  // Fetch counts without type filter to get accurate totals
  fetchTypeCounts: async () => {
    try {
      const { filters } = get();
      // Fetch all entities without type filter to count
      const allEntities = await api.getEntities({
        ownership: filters.ownership,
        department_id: filters.department_id,
        search: filters.search,
        // Explicitly NOT passing type filter
      });

      // Count by type
      const counts: TypeCounts = {
        all: allEntities.length,
        candidate: 0,
        client: 0,
        contractor: 0,
        lead: 0,
        partner: 0,
        custom: 0,
      };

      for (const entity of allEntities) {
        if (entity.type in counts) {
          counts[entity.type as keyof Omit<TypeCounts, 'all'>]++;
        }
      }

      set({ typeCounts: counts });
    } catch (err) {
      console.error('Failed to fetch type counts:', err);
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
    const oldFilters = get().filters;
    set((state) => ({ filters: { ...state.filters, ...filters } }));
    get().fetchEntities();

    // Refetch type counts if ownership, department, or search changed (not type)
    const countsAffectingFiltersChanged =
      filters.ownership !== undefined ||
      filters.department_id !== undefined ||
      filters.search !== undefined ||
      // Also refetch if type filter is being cleared (going back to 'all')
      (filters.type === undefined && oldFilters.type !== undefined);

    if (countsAffectingFiltersChanged) {
      get().fetchTypeCounts();
    }
  },

  clearFilters: () => {
    set({ filters: {} });
    get().fetchEntities();
    get().fetchTypeCounts();
  },

  clearCurrentEntity: () => set({ currentEntity: null }),

  clearError: () => set({ error: null })
}));
