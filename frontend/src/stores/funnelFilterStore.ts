import { create } from 'zustand';

/**
 * Общий UI-стейт фильтра списка кандидатов в воронке.
 *
 * Нужен, чтобы чекбокс «Только мои» (быстрый self-фильтр суперадмина поверх
 * дефолта «видеть всех») мог жить в РАЗНЫХ компонентах одновременно — и в
 * шапке списка на странице воронки (RecruiterFunnelsPage), и в глобальном
 * сайдбаре (Layout) — оставаясь синхронным. Демо-вариант: два места сразу,
 * чтобы выбрать, где лучше.
 */
interface FunnelFilterState {
  onlyMine: boolean;
  setOnlyMine: (value: boolean) => void;
}

export const useFunnelFilterStore = create<FunnelFilterState>((set) => ({
  onlyMine: false,
  setOnlyMine: (value) => set({ onlyMine: value }),
}));
