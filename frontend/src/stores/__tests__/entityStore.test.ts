import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEntityStore } from '../entityStore';
import * as api from '@/services/api';
import type { Entity, EntityWithRelations } from '@/types';

// Mock the API module
vi.mock('@/services/api', () => ({
  getEntities: vi.fn(),
  getEntity: vi.fn(),
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  deleteEntity: vi.fn(),
  transferEntity: vi.fn(),
}));

describe('entityStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useEntityStore.setState({
      entities: [],
      currentEntity: null,
      loading: false,
      error: null,
      filters: {},
      fetchVersion: 0,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useEntityStore.getState();
      expect(state.entities).toEqual([]);
      expect(state.currentEntity).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.filters).toEqual({});
      expect(state.fetchVersion).toBe(0);
    });
  });

  describe('fetchEntities', () => {
    it('should fetch entities successfully', async () => {
      const mockEntities: Entity[] = [
        {
          id: 1,
          type: 'candidate',
          name: 'John Doe',
          status: 'new',
          tags: [],
          extra_data: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      vi.mocked(api.getEntities).mockResolvedValueOnce(mockEntities);

      await useEntityStore.getState().fetchEntities();

      expect(api.getEntities).toHaveBeenCalledWith({});
      expect(useEntityStore.getState().entities).toEqual(mockEntities);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().error).toBeNull();
    });

    it('should set loading state during fetch', async () => {
      const mockEntities: Entity[] = [];
      vi.mocked(api.getEntities).mockImplementation(
        () =>
          new Promise((resolve) => {
            expect(useEntityStore.getState().loading).toBe(true);
            resolve(mockEntities);
          })
      );

      await useEntityStore.getState().fetchEntities();
    });

    it('should handle fetch error', async () => {
      const errorMessage = 'Failed to fetch entities';
      vi.mocked(api.getEntities).mockRejectedValueOnce(new Error(errorMessage));

      await useEntityStore.getState().fetchEntities();

      expect(useEntityStore.getState().error).toBe(errorMessage);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().entities).toEqual([]);
    });

    it('should apply filters when fetching', async () => {
      const mockEntities: Entity[] = [];
      const filters = { type: 'candidate' as const, status: 'new' as const };

      vi.mocked(api.getEntities).mockResolvedValueOnce(mockEntities);

      useEntityStore.setState({ filters });
      await useEntityStore.getState().fetchEntities();

      expect(api.getEntities).toHaveBeenCalledWith(filters);
    });

    it('should discard stale responses', async () => {
      const entities1: Entity[] = [
        {
          id: 1,
          type: 'candidate',
          name: 'First',
          status: 'new',
          tags: [],
          extra_data: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const entities2: Entity[] = [
        {
          id: 2,
          type: 'candidate',
          name: 'Second',
          status: 'new',
          tags: [],
          extra_data: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      let resolveFirst: (value: Entity[]) => void;
      const firstPromise = new Promise<Entity[]>((resolve) => {
        resolveFirst = resolve;
      });

      vi.mocked(api.getEntities)
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce(entities2);

      // Start first fetch
      const firstFetch = useEntityStore.getState().fetchEntities();

      // Start second fetch before first completes
      const secondFetch = useEntityStore.getState().fetchEntities();

      // Complete second fetch first
      await secondFetch;

      // Complete first fetch (should be discarded)
      resolveFirst!(entities1);
      await firstFetch;

      // Should have second fetch results, not first
      expect(useEntityStore.getState().entities).toEqual(entities2);
    });
  });

  describe('fetchEntity', () => {
    it('should fetch entity successfully', async () => {
      const mockEntity: EntityWithRelations = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      vi.mocked(api.getEntity).mockResolvedValueOnce(mockEntity);

      await useEntityStore.getState().fetchEntity(1);

      expect(api.getEntity).toHaveBeenCalledWith(1);
      expect(useEntityStore.getState().currentEntity).toEqual(mockEntity);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().error).toBeNull();
    });

    it('should handle fetch entity error', async () => {
      const errorMessage = 'Entity not found';
      vi.mocked(api.getEntity).mockRejectedValueOnce(new Error(errorMessage));

      await useEntityStore.getState().fetchEntity(1);

      expect(useEntityStore.getState().error).toBe(errorMessage);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().currentEntity).toBeNull();
    });
  });

  describe('createEntity', () => {
    it('should create entity successfully', async () => {
      const newEntity: Entity = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(api.createEntity).mockResolvedValueOnce(newEntity);

      const result = await useEntityStore.getState().createEntity({
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
      });

      expect(result).toEqual(newEntity);
      expect(useEntityStore.getState().entities).toContainEqual(newEntity);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().error).toBeNull();
    });

    it('should add new entity to the beginning of the list', async () => {
      const existingEntity: Entity = {
        id: 1,
        type: 'candidate',
        name: 'Existing',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const newEntity: Entity = {
        id: 2,
        type: 'candidate',
        name: 'New',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      useEntityStore.setState({ entities: [existingEntity] });
      vi.mocked(api.createEntity).mockResolvedValueOnce(newEntity);

      await useEntityStore.getState().createEntity({
        type: 'candidate',
        name: 'New',
        status: 'new',
      });

      const entities = useEntityStore.getState().entities;
      expect(entities[0]).toEqual(newEntity);
      expect(entities[1]).toEqual(existingEntity);
    });

    it('should handle create entity error', async () => {
      const errorMessage = 'Failed to create entity';
      vi.mocked(api.createEntity).mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        useEntityStore.getState().createEntity({
          type: 'candidate',
          name: 'John Doe',
          status: 'new',
        })
      ).rejects.toThrow(errorMessage);

      expect(useEntityStore.getState().error).toBe(errorMessage);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().entities).toEqual([]);
    });
  });

  describe('updateEntity', () => {
    it('should update entity successfully', async () => {
      const existingEntity: Entity = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const updatedData = { name: 'Jane Doe', status: 'interview' as const };

      useEntityStore.setState({ entities: [existingEntity] });
      vi.mocked(api.updateEntity).mockResolvedValueOnce(updatedData);

      await useEntityStore.getState().updateEntity(1, updatedData);

      const entities = useEntityStore.getState().entities;
      expect(entities[0].name).toBe('Jane Doe');
      expect(entities[0].status).toBe('interview');
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().error).toBeNull();
    });

    it('should update current entity if it matches', async () => {
      const currentEntity: EntityWithRelations = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      const updatedData = { name: 'Jane Doe' };

      useEntityStore.setState({ currentEntity });
      vi.mocked(api.updateEntity).mockResolvedValueOnce(updatedData);

      await useEntityStore.getState().updateEntity(1, updatedData);

      expect(useEntityStore.getState().currentEntity?.name).toBe('Jane Doe');
    });

    it('should handle update entity error', async () => {
      const errorMessage = 'Failed to update entity';
      vi.mocked(api.updateEntity).mockRejectedValueOnce(new Error(errorMessage));

      await expect(useEntityStore.getState().updateEntity(1, {})).rejects.toThrow(errorMessage);

      expect(useEntityStore.getState().error).toBe(errorMessage);
      expect(useEntityStore.getState().loading).toBe(false);
    });
  });

  describe('deleteEntity', () => {
    it('should delete entity successfully', async () => {
      const entity1: Entity = {
        id: 1,
        type: 'candidate',
        name: 'Entity 1',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const entity2: Entity = {
        id: 2,
        type: 'candidate',
        name: 'Entity 2',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      useEntityStore.setState({ entities: [entity1, entity2] });
      vi.mocked(api.deleteEntity).mockResolvedValueOnce(undefined);

      await useEntityStore.getState().deleteEntity(1);

      expect(useEntityStore.getState().entities).toEqual([entity2]);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().error).toBeNull();
    });

    it('should clear current entity if it matches deleted entity', async () => {
      const currentEntity: EntityWithRelations = {
        id: 1,
        type: 'candidate',
        name: 'Entity 1',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      useEntityStore.setState({ currentEntity });
      vi.mocked(api.deleteEntity).mockResolvedValueOnce(undefined);

      await useEntityStore.getState().deleteEntity(1);

      expect(useEntityStore.getState().currentEntity).toBeNull();
    });

    it('should not clear current entity if it does not match deleted entity', async () => {
      const currentEntity: EntityWithRelations = {
        id: 2,
        type: 'candidate',
        name: 'Entity 2',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      useEntityStore.setState({ currentEntity });
      vi.mocked(api.deleteEntity).mockResolvedValueOnce(undefined);

      await useEntityStore.getState().deleteEntity(1);

      expect(useEntityStore.getState().currentEntity).toEqual(currentEntity);
    });

    it('should handle delete entity error', async () => {
      const errorMessage = 'Failed to delete entity';
      vi.mocked(api.deleteEntity).mockRejectedValueOnce(new Error(errorMessage));

      await expect(useEntityStore.getState().deleteEntity(1)).rejects.toThrow(errorMessage);

      expect(useEntityStore.getState().error).toBe(errorMessage);
      expect(useEntityStore.getState().loading).toBe(false);
    });
  });

  describe('transferEntity', () => {
    it('should transfer entity successfully', async () => {
      const mockEntity: EntityWithRelations = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      vi.mocked(api.transferEntity).mockResolvedValueOnce(undefined);
      vi.mocked(api.getEntity).mockResolvedValueOnce(mockEntity);

      await useEntityStore.getState().transferEntity(1, 2, 'Transfer comment');

      expect(api.transferEntity).toHaveBeenCalledWith(1, {
        to_user_id: 2,
        comment: 'Transfer comment',
      });
      expect(api.getEntity).toHaveBeenCalledWith(1);
      expect(useEntityStore.getState().loading).toBe(false);
      expect(useEntityStore.getState().error).toBeNull();
    });

    it('should transfer entity without comment', async () => {
      const mockEntity: EntityWithRelations = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      vi.mocked(api.transferEntity).mockResolvedValueOnce(undefined);
      vi.mocked(api.getEntity).mockResolvedValueOnce(mockEntity);

      await useEntityStore.getState().transferEntity(1, 2);

      expect(api.transferEntity).toHaveBeenCalledWith(1, {
        to_user_id: 2,
        comment: undefined,
      });
    });

    it('should handle transfer entity error', async () => {
      const errorMessage = 'Failed to transfer entity';
      vi.mocked(api.transferEntity).mockRejectedValueOnce(new Error(errorMessage));

      await expect(useEntityStore.getState().transferEntity(1, 2)).rejects.toThrow(errorMessage);

      expect(useEntityStore.getState().error).toBe(errorMessage);
      expect(useEntityStore.getState().loading).toBe(false);
    });
  });

  describe('setFilters', () => {
    it('should set filters and fetch entities', async () => {
      const mockEntities: Entity[] = [];
      vi.mocked(api.getEntities).mockResolvedValueOnce(mockEntities);

      useEntityStore.getState().setFilters({ type: 'candidate' });

      // Wait for async fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useEntityStore.getState().filters).toEqual({ type: 'candidate' });
      expect(api.getEntities).toHaveBeenCalledWith({ type: 'candidate' });
    });

    it('should merge filters with existing filters', async () => {
      const mockEntities: Entity[] = [];
      vi.mocked(api.getEntities).mockResolvedValue(mockEntities);

      useEntityStore.setState({ filters: { type: 'candidate' as const } });

      useEntityStore.getState().setFilters({ status: 'new' as const });

      // Wait for async fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useEntityStore.getState().filters).toEqual({
        type: 'candidate',
        status: 'new',
      });
    });

    it('should override existing filter values', async () => {
      const mockEntities: Entity[] = [];
      vi.mocked(api.getEntities).mockResolvedValue(mockEntities);

      useEntityStore.setState({ filters: { type: 'candidate' as const } });

      useEntityStore.getState().setFilters({ type: 'client' as const });

      // Wait for async fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useEntityStore.getState().filters).toEqual({ type: 'client' });
    });
  });

  describe('clearFilters', () => {
    it('should clear filters and fetch entities', async () => {
      const mockEntities: Entity[] = [];
      vi.mocked(api.getEntities).mockResolvedValueOnce(mockEntities);

      useEntityStore.setState({ filters: { type: 'candidate' as const, status: 'new' as const } });

      useEntityStore.getState().clearFilters();

      // Wait for async fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useEntityStore.getState().filters).toEqual({});
      expect(api.getEntities).toHaveBeenCalledWith({});
    });
  });

  describe('clearCurrentEntity', () => {
    it('should clear current entity', () => {
      const currentEntity: EntityWithRelations = {
        id: 1,
        type: 'candidate',
        name: 'John Doe',
        status: 'new',
        tags: [],
        extra_data: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chats: [],
        calls: [],
        transfers: [],
        analyses: [],
      };

      useEntityStore.setState({ currentEntity });
      useEntityStore.getState().clearCurrentEntity();

      expect(useEntityStore.getState().currentEntity).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error', () => {
      useEntityStore.setState({ error: 'Some error' });
      useEntityStore.getState().clearError();

      expect(useEntityStore.getState().error).toBeNull();
    });
  });
});
