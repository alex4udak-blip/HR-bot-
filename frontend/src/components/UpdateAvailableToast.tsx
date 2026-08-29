import { useEffect, useRef, useState } from "react";

/**
 * Закрывает оставшуюся дыру в проблеме «после деплоя ничего не поменялось»:
 * index.html на сервере уже отдаётся с no-cache (nginx.conf), а ErrorBoundary
 * уже реактивно перезагружает страницу при ошибке загрузки чанка — но ОБА эти
 * механизма молчат, если вкладка открыта долго и не триггерит ленивую подгрузку
 * нового роута. SPA НИКОГДА сама не перезапрашивает index.html, пока её не
 * перезагрузить — никакой серверный заголовок это не чинит.
 *
 * Здесь — проактивная проверка: периодически (и при возврате на вкладку)
 * сверяем src исполняемого сейчас бандла с тем, что реально отдаёт сервер
 * прямо сейчас. Отличаются → показываем ненавязчивый баннер «Обновить»
 * вместо того, чтобы пользователь гадал и жал Ctrl+Shift+R.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 минут

function extractMainScriptSrc(html: string): string | null {
  const tags = html.match(/<script\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (/type=["']module["']/i.test(tag) && /\bsrc=/i.test(tag)) {
      const m = tag.match(/\bsrc=["']([^"']+)["']/i);
      if (m) return m[1];
    }
  }
  return null;
}

export default function UpdateAvailableToast() {
  const [available, setAvailable] = useState(false);
  const currentSrcRef = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return; // в деве HMR сам живо всё обновляет

    const scriptEl = document.querySelector<HTMLScriptElement>(
      'script[type="module"][src*="/assets/"]',
    );
    currentSrcRef.current = scriptEl?.getAttribute("src") ?? null;
    if (!currentSrcRef.current) return; // не нашли якорь — не рискуем ложным срабатыванием

    const check = async () => {
      if (available) return;
      try {
        const res = await fetch("/", { cache: "no-store" });
        const html = await res.text();
        const freshSrc = extractMainScriptSrc(html);
        if (freshSrc && freshSrc !== currentSrcRef.current) {
          setAvailable(true);
        }
      } catch {
        /* сеть моргнула — не страшно, попробуем на следующем тике */
      }
    };

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    // Частый случай: свернул вкладку на время деплоя, вернулся — не ждать 5 минут.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!available) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999998,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#1b1b1f",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 10px 10px 16px",
        boxShadow: "0 6px 24px rgba(0,0,0,.4)",
        fontSize: 13,
      }}
    >
      <span>Вышло обновление приложения</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#6d5efc",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "7px 14px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Обновить
      </button>
    </div>
  );
}
