import { create } from 'zustand';
import { getLocalStorage, setLocalStorage } from '@/utils/localStorage';

/**
 * Общий UI-стейт фильтра списка кандидатов в воронке.
 *
 * «Только мои» в СВОИХ воронках — self-фильтр (created_by == self). Живёт в
 * отдельном сторе (а не в локальном useState), чтобы переживать ремоунты при
 * навигации между воронками, и сохраняется в localStorage — выбор держится между
 * сессиями. В ЧУЖИХ воронках (выбран другой рекрутёр) кнопка своя, временная и
 * сюда не пишется — см. RecruiterFunnelsPage.
 *
 * null — пользователь ещё не выбирал: действует умолчание по роли (включена, но
 * выключена у наблюдателя и суперадмина). Ключ сменён на _v2 (2026-09-10), когда
 * кнопку сделали включённой по умолчанию: у многих в старом ключе лежало «false»
 * просто от того, что когда-то пощёлкали, и без сброса у них ничего бы не
 * изменилось. Старый funnel_only_mine больше не читается.
 */
const ONLY_MINE_KEY = 'funnel_only_mine_v2';

interface FunnelFilterState {
  onlyMine: boolean | null;
  setOnlyMine: (value: boolean) => void;
}

export const useFunnelFilterStore = create<FunnelFilterState>((set) => ({
  onlyMine: getLocalStorage<boolean | null>(ONLY_MINE_KEY, null),
  setOnlyMine: (value) => {
    setLocalStorage<boolean>(ONLY_MINE_KEY, value);
    set({ onlyMine: value });
  },
}));
