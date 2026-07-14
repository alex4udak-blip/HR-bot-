import { create } from 'zustand';

/**
 * Общий UI-стейт фильтра списка кандидатов в воронке.
 *
 * Чекбокс «Только мои» — быстрый self-фильтр суперадмина поверх дефолта
 * «видеть всех» (created_by == self). Живёт в отдельном сторе, а не в локальном
 * useState страницы воронки, чтобы состояние переживало ремоунты страницы при
 * навигации между воронками и не сбрасывалось.
 */
interface FunnelFilterState {
  onlyMine: boolean;
  setOnlyMine: (value: boolean) => void;
}

export const useFunnelFilterStore = create<FunnelFilterState>((set) => ({
  onlyMine: false,
  setOnlyMine: (value) => set({ onlyMine: value }),
}));
