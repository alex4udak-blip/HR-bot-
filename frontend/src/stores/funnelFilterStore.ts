import { create } from 'zustand';
import { getLocalStorage, setLocalStorage } from '@/utils/localStorage';

/**
 * Общий UI-стейт фильтра списка кандидатов в воронке.
 *
 * Чекбокс «Только мои» — self-фильтр (created_by == self) для ЛЮБОГО рекрутёра
 * поверх общей воронки «Видна коллегам». Живёт в отдельном сторе (а не в локальном
 * useState), чтобы переживать ремоунты при навигации между воронками, и
 * сохраняется в localStorage — чтобы выбор рекрутёра держался между сессиями
 * (просили: «нужно, чтобы были только мои»).
 */
const ONLY_MINE_KEY = 'funnel_only_mine';

interface FunnelFilterState {
  onlyMine: boolean;
  setOnlyMine: (value: boolean) => void;
}

export const useFunnelFilterStore = create<FunnelFilterState>((set) => ({
  onlyMine: getLocalStorage<boolean>(ONLY_MINE_KEY, false),
  setOnlyMine: (value) => {
    setLocalStorage<boolean>(ONLY_MINE_KEY, value);
    set({ onlyMine: value });
  },
}));
