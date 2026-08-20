import { useCallback, useEffect, useState } from "react";
import { KeyRound, ListTodo, Bell, Loader2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import api from "@/services/api/client";
import AccessHub from "./AccessHub";
import MyTasks from "./MyTasks";
import Notifications from "./Notifications";

/**
 * Оболочка Mini App: авторизация по initData + нижние вкладки.
 *
 * Вход отличается от веба принципиально — пароля нет, личность подтверждает
 * Telegram подписью initData. Сервер её проверяет и ставит те же httpOnly-куки,
 * что и обычный логин, поэтому весь остальной слой API работает без изменений.
 */

export type Me = { id: number; name: string; email: string; role: string; org_role?: string | null };
type Tab = "access" | "tasks" | "bell";

export default function MiniApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("access");

  const auth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Уже есть валидная кука (переоткрыли приложение) — второй вход не нужен
      try {
        const { data } = await api.get("/auth/me");
        setMe(data);
        return;
      } catch {
        /* не авторизованы — идём обычным путём через initData */
      }

      const initData = (window as any)?.Telegram?.WebApp?.initData;
      if (!initData) {
        setError(
          "Откройте приложение через Telegram — вне мессенджера вход невозможен."
        );
        return;
      }
      const { data } = await api.post("/auth/telegram-webapp", { init_data: initData });
      setMe(data.user);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { auth(); }, [auth]);

  if (loading) {
    return (
      <div className="hf-ma-splash">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="hf-ma-splash hf-ma-splash-error">
        <AlertTriangle size={30} />
        <p>{error || "Не удалось войти"}</p>
        <button className="hf-ma-retry" onClick={auth}>Повторить</button>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; icon: typeof KeyRound }[] = [
    { key: "access", label: "Доступы", icon: KeyRound },
    { key: "tasks", label: "Задачи", icon: ListTodo },
    { key: "bell", label: "События", icon: Bell },
  ];

  return (
    <div className="hf-ma">
      <div className="hf-ma-body">
        {tab === "access" && <AccessHub me={me} />}
        {tab === "tasks" && <MyTasks userId={me.id} />}
        {tab === "bell" && <Notifications />}
      </div>

      <nav className="hf-ma-nav">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={clsx("hf-ma-nav-item", tab === t.key && "hf-ma-nav-item-active")}
              onClick={() => setTab(t.key)}
            >
              <Icon size={19} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
