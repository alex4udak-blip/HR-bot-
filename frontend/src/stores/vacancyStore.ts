import { create } from 'zustand';
import type { Vacancy, VacancyStatus, VacancyApplication, ApplicationStage, KanbanBoard, VacancyStats } from '@/types';
import * as api from '@/services/api';

interface VacancyFilters {
  status?: VacancyStatus;
  department_id?: number;
  search?: string;
}

interface VacancyState {
  // Vacancies list
  vacancies: Vacancy[];
  currentVacancy: Vacancy | null;
  loading: boolean;
  error: string | null;
  filters: VacancyFilters;

  // Kanban board
  kanbanBoard: KanbanBoard | null;
  kanbanLoading: boolean;

  // Stats
  stats: VacancyStats | null;

  // Selected applications (for bulk operations)
  selectedApplicationIds: number[];

  // Actions - Vacancies
  fetchVacancies: () => Promise<void>;
  fetchVacancy: (id: number) => Promise<void>;
  createVacancy: (data: api.VacancyCreate) => Promise<Vacancy>;
  updateVacancy: (id: number, data: api.VacancyUpdate) => Promise<void>;
  deleteVacancy: (id: number) => Promise<void>;
  setFilters: (filters: Partial<VacancyFilters>) => void;
  clearFilters: () => void;
  clearCurrentVacancy: () => void;

  // Actions - Kanban
  fetchKanbanBoard: (vacancyId: number) => Promise<void>;
  moveApplication: (applicationId: number, newStage: ApplicationStage) => Promise<void>;
  bulkMoveApplications: (stage: ApplicationStage) => Promise<void>;

  // Actions - Applications
  addCandidateToVacancy: (vacancyId: number, entityId: number, source?: string) => Promise<VacancyApplication>;
  updateApplication: (applicationId: number, data: api.ApplicationUpdate) => Promise<void>;
  removeApplication: (applicationId: number) => Promise<void>;

  // Actions - Selection
  toggleApplicationSelection: (applicationId: number) => void;
  selectAllInStage: (stage: ApplicationStage) => void;
  clearSelection: () => void;

  // Actions - Stats
  fetchStats: () => Promise<void>;

  // Utility
  clearError: () => void;
}

export const useVacancyStore = create<VacancyState>((set, get) => ({
  vacancies: [],
  currentVacancy: null,
  loading: false,
  error: null,
  filters: {},
  kanbanBoard: null,
  kanbanLoading: false,
  stats: null,
  selectedApplicationIds: [],

  // === VACANCIES ===

  fetchVacancies: async () => {
    set({ loading: true, error: null });
    try {
      const vacancies = await api.getVacancies(get().filters);
      set({ vacancies, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch vacancies';
      set({ error: message, loading: false });
    }
  },

  fetchVacancy: async (id) => {
    set({ loading: true, error: null });
    try {
      const vacancy = await api.getVacancy(id);
      set({ currentVacancy: vacancy, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch vacancy';
      set({ error: message, loading: false });
    }
  },

  createVacancy: async (data) => {
    set({ loading: true, error: null });
    try {
      const vacancy = await api.createVacancy(data);
      set((state) => ({
        vacancies: [vacancy, ...state.vacancies],
        loading: false
      }));
      return vacancy;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create vacancy';
      set({ error: message, loading: false });
      throw err;
    }
  },

  updateVacancy: async (id, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await api.updateVacancy(id, data);
      set((state) => ({
        vacancies: state.vacancies.map((v) => (v.id === id ? updated : v)),
        currentVacancy: state.currentVacancy?.id === id ? updated : state.currentVacancy,
        loading: false
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update vacancy';
      set({ error: message, loading: false });
      throw err;
    }
  },

  deleteVacancy: async (id) => {
    set({ loading: true, error: null });
    try {
      await api.deleteVacancy(id);
      set((state) => ({
        vacancies: state.vacancies.filter((v) => v.id !== id),
        currentVacancy: state.currentVacancy?.id === id ? null : state.currentVacancy,
        loading: false
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete vacancy';
      set({ error: message, loading: false });
      throw err;
    }
  },

  setFilters: (filters) => {
    set((state) => ({
      filters: { ...state.filters, ...filters }
    }));
  },

  clearFilters: () => {
    set({ filters: {} });
  },

  clearCurrentVacancy: () => {
    set({ currentVacancy: null });
  },

  // === KANBAN BOARD ===

  fetchKanbanBoard: async (vacancyId) => {
    set({ kanbanLoading: true, error: null });
    try {
      const board = await api.getKanbanBoard(vacancyId);
      set({ kanbanBoard: board, kanbanLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch Kanban board';
      set({ error: message, kanbanLoading: false });
    }
  },

  moveApplication: async (applicationId, newStage) => {
    const { kanbanBoard } = get();
    if (!kanbanBoard) return;

    // Optimistic update
    const updatedBoard = { ...kanbanBoard };
    let movedApp: VacancyApplication | null = null;

    // Find and remove from current column
    for (const column of updatedBoard.columns) {
      const appIndex = column.applications.findIndex((a) => a.id === applicationId);
      if (appIndex !== -1) {
        movedApp = column.applications[appIndex];
        column.applications.splice(appIndex, 1);
        column.count--;
        break;
      }
    }

    // Add to new column
    if (movedApp) {
      const targetColumn = updatedBoard.columns.find((c) => c.stage === newStage);
      if (targetColumn) {
        movedApp.stage = newStage;
        targetColumn.applications.push(movedApp);
        targetColumn.count++;
      }
    }

    set({ kanbanBoard: updatedBoard });

    try {
      await api.updateApplication(applicationId, { stage: newStage });
    } catch (err) {
      // Revert on error
      get().fetchKanbanBoard(kanbanBoard.vacancy_id);
      const message = err instanceof Error ? err.message : 'Failed to move application';
      set({ error: message });
    }
  },

  bulkMoveApplications: async (stage) => {
    const { selectedApplicationIds, kanbanBoard } = get();
    if (selectedApplicationIds.length === 0 || !kanbanBoard) return;

    try {
      await api.bulkMoveApplications(selectedApplicationIds, stage);
      set({ selectedApplicationIds: [] });
      // Refresh board
      get().fetchKanbanBoard(kanbanBoard.vacancy_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to move applications';
      set({ error: message });
    }
  },

  // === APPLICATIONS ===

  addCandidateToVacancy: async (vacancyId, entityId, source) => {
    try {
      const application = await api.createApplication(vacancyId, {
        vacancy_id: vacancyId,
        entity_id: entityId,
        source
      });

      // Refresh kanban if viewing this vacancy
      const { kanbanBoard } = get();
      if (kanbanBoard?.vacancy_id === vacancyId) {
        get().fetchKanbanBoard(vacancyId);
      }

      // Update vacancy applications count
      set((state) => ({
        vacancies: state.vacancies.map((v) =>
          v.id === vacancyId
            ? { ...v, applications_count: v.applications_count + 1 }
            : v
        ),
        currentVacancy:
          state.currentVacancy?.id === vacancyId
            ? { ...state.currentVacancy, applications_count: state.currentVacancy.applications_count + 1 }
            : state.currentVacancy
      }));

      return application;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add candidate';
      set({ error: message });
      throw err;
    }
  },

  updateApplication: async (applicationId, data) => {
    try {
      await api.updateApplication(applicationId, data);

      // Update in kanban board if present
      const { kanbanBoard } = get();
      if (kanbanBoard) {
        const updatedBoard = { ...kanbanBoard };
        for (const column of updatedBoard.columns) {
          const app = column.applications.find((a) => a.id === applicationId);
          if (app) {
            Object.assign(app, data);
            break;
          }
        }
        set({ kanbanBoard: updatedBoard });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update application';
      set({ error: message });
      throw err;
    }
  },

  removeApplication: async (applicationId) => {
    const { kanbanBoard } = get();

    try {
      await api.deleteApplication(applicationId);

      // Remove from kanban board
      if (kanbanBoard) {
        const updatedBoard = { ...kanbanBoard };
        for (const column of updatedBoard.columns) {
          const appIndex = column.applications.findIndex((a) => a.id === applicationId);
          if (appIndex !== -1) {
            column.applications.splice(appIndex, 1);
            column.count--;
            updatedBoard.total_count--;
            break;
          }
        }
        set({ kanbanBoard: updatedBoard });
      }

      // Update vacancy applications count
      if (kanbanBoard) {
        set((state) => ({
          vacancies: state.vacancies.map((v) =>
            v.id === kanbanBoard.vacancy_id
              ? { ...v, applications_count: Math.max(0, v.applications_count - 1) }
              : v
          )
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove application';
      set({ error: message });
      throw err;
    }
  },

  // === SELECTION ===

  toggleApplicationSelection: (applicationId) => {
    set((state) => {
      const isSelected = state.selectedApplicationIds.includes(applicationId);
      return {
        selectedApplicationIds: isSelected
          ? state.selectedApplicationIds.filter((id) => id !== applicationId)
          : [...state.selectedApplicationIds, applicationId]
      };
    });
  },

  selectAllInStage: (stage) => {
    const { kanbanBoard } = get();
    if (!kanbanBoard) return;

    const column = kanbanBoard.columns.find((c) => c.stage === stage);
    if (column) {
      set({
        selectedApplicationIds: column.applications.map((a) => a.id)
      });
    }
  },

  clearSelection: () => {
    set({ selectedApplicationIds: [] });
  },

  // === STATS ===

  fetchStats: async () => {
    try {
      const stats = await api.getVacancyStats();
      set({ stats });
    } catch (err) {
      console.error('Failed to fetch vacancy stats:', err);
    }
  },

  // === UTILITY ===

  clearError: () => {
    set({ error: null });
  }
}));
