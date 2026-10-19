/**
 * Плашка «Вышло обновление» (19.10.2026): вкладку держат открытой днями, и
 * исправления не доходят до человека, пока он сам не перезагрузит страницу.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import UpdateBanner from '@/components/app/UpdateBanner';
import { currentBuildId, extractBuildId, isNewBuild, isSnoozed, snooze, UPDATE_SNOOZE_MS } from '@/utils/appVersion';

const OLD = '/assets/index-OldHash1.js';
const NEW = '/assets/index-NewHash2.js';

function setLoadedBuild(src: string | null) {
  document.querySelectorAll('script[data-test-build]').forEach((s) => s.remove());
  if (!src) return;
  const s = document.createElement('script');
  s.type = 'module';
  s.setAttribute('src', src);
  s.setAttribute('data-test-build', '1');
  document.head.appendChild(s);
}

function serverServes(src: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(`<html><script type="module" crossorigin src="${src}"></script></html>`),
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom без хранилища */
  }
});

afterEach(() => {
  cleanup();
  setLoadedBuild(null);
  vi.unstubAllGlobals();
});

describe('версия сборки', () => {
  it('берётся из главного скрипта', () => {
    setLoadedBuild(OLD);
    expect(currentBuildId()).toBe(OLD);
    expect(extractBuildId(`<script type="module" crossorigin src="${NEW}"></script>`)).toBe(NEW);
  });

  it('на dev-сервере (хеша нет) обновлений не ищем', () => {
    setLoadedBuild('/src/main.tsx');
    expect(currentBuildId()).toBeNull();
    expect(isNewBuild(null, NEW)).toBe(false);
  });

  it('«Позже» откладывает только эту сборку и только на два часа', () => {
    const now = 1_000_000;
    snooze(NEW, now);
    expect(isSnoozed(NEW, now + 1000)).toBe(true);
    expect(isSnoozed('/assets/index-Newer3.js', now + 1000)).toBe(false);
    expect(isSnoozed(NEW, now + UPDATE_SNOOZE_MS + 1)).toBe(false);
  });
});

describe('плашка', () => {
  async function mountAndFocus() {
    render(<UpdateBanner />);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
  }

  it('на сервере новая сборка — показываем «Обновить»', async () => {
    setLoadedBuild(OLD);
    vi.stubGlobal('fetch', serverServes(NEW));
    await mountAndFocus();
    expect(await screen.findByText('Вышло обновление Enceladus.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeTruthy();
  });

  it('сборка та же — плашки нет', async () => {
    setLoadedBuild(OLD);
    const fetchMock = serverServes(OLD);
    vi.stubGlobal('fetch', fetchMock);
    await mountAndFocus();
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.queryByText('Вышло обновление Enceladus.')).toBeNull();
  });

  it('«Позже» прячет плашку', async () => {
    setLoadedBuild(OLD);
    vi.stubGlobal('fetch', serverServes(NEW));
    await mountAndFocus();
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить позже' }));
    expect(screen.queryByText('Вышло обновление Enceladus.')).toBeNull();
    expect(isSnoozed(NEW)).toBe(true);
  });

  it('нет сети — тихо, без плашки и без ошибок', async () => {
    setLoadedBuild(OLD);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await mountAndFocus();
    expect(screen.queryByText('Вышло обновление Enceladus.')).toBeNull();
  });
});
