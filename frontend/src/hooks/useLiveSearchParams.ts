import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { NavigateOptions } from 'react-router-dom';

/**
 * `useSearchParams`, у которого функциональная правка строится от ЖИВОГО адреса.
 *
 * react-router отдаёт в `setSearchParams(prev => …)` адрес С ПРОШЛОЙ ОТРИСОВКИ.
 * Две правки подряд в одном такте — и вторая затирает первую. Так на «Все
 * кандидаты» терялась вкладка этапа: клик писал ?stage=, следом зеркало открытой
 * карточки писало ?entity= от старого снимка, этап пропадал из адреса, и после
 * F5 открывалась вкладка «Все» (Мария, 14.10.2026: «при обновлении страницы
 * остаёмся на той же странице»).
 */
export function useLiveSearchParams() {
  const [searchParams, setSearchParamsRaw] = useSearchParams();
  const setSearchParams = useCallback(
    (
      next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
      opts?: NavigateOptions,
    ) =>
      setSearchParamsRaw(
        typeof next === 'function'
          ? () => next(new URLSearchParams(window.location.search))
          : next,
        opts,
      ),
    [setSearchParamsRaw],
  );
  return [searchParams, setSearchParams] as const;
}
