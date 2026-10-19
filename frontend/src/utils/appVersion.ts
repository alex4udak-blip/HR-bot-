/**
 * «Вышло обновление» в уже открытой вкладке (19.10.2026).
 *
 * Эльвира: «я не всегда знаю, когда у нас что-то чинится… так отваливается и то,
 * что должно работать». Кэш тут ни при чём: index.html отдаётся с no-store, и
 * обычный F5 всегда берёт свежую сборку. Но вкладку держат открытой днями, и
 * исправление до человека не доходит, пока он сам не перезагрузит страницу.
 *
 * Версия сборки — имя главного скрипта `/assets/index-<хеш>.js`: Vite меняет
 * хеш на каждую сборку с изменениями. Сравниваем то, с чем вкладка загрузилась,
 * с тем, что сейчас отдаёт сервер.
 */

const BUILD_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

/** С какой сборкой загружена вкладка. null — dev-сервер (там хеша нет). */
export function currentBuildId(doc: Document = document): string | null {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const s of scripts) {
    const m = (s.getAttribute('src') || '').match(BUILD_RE);
    if (m) return m[0];
  }
  return null;
}

/** Какая сборка сейчас на сервере — из текста index.html. */
export function extractBuildId(html: string): string | null {
  const m = html.match(BUILD_RE);
  return m ? m[0] : null;
}

export function isNewBuild(current: string | null, latest: string | null): boolean {
  return !!current && !!latest && current !== latest;
}

const SNOOZE_KEY = 'enceladus.update_snoozed';
/** «Позже» — на два часа: напомнить стоит, надоедать нельзя (владелец, 19.10.2026). */
export const UPDATE_SNOOZE_MS = 2 * 60 * 60 * 1000;

/** Отложено ли напоминание об ЭТОЙ сборке. Новая сборка показывается сразу. */
export function isSnoozed(build: string, now = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const { build: b, until } = JSON.parse(raw) as { build?: string; until?: number };
    return b === build && typeof until === 'number' && now < until;
  } catch {
    return false;
  }
}

export function snooze(build: string, now = Date.now()): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ build, until: now + UPDATE_SNOOZE_MS }));
  } catch {
    /* без хранилища плашка просто вернётся при следующей проверке */
  }
}
