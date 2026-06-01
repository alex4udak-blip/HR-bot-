import { Outlet } from 'react-router-dom';
import { useSidebarStore } from '@/factorial/stores/useSidebarStore';
import Sidebar from './Sidebar';
import HelpButton from './HelpButton';
import '../styles/factorial.css';

/**
 * Оболочка модуля Факториал внутри Энцеладуса.
 * Это AppShell клона БЕЗ AI-дровера: слева — Factorial-навигация (Sidebar),
 * справа — контент страниц (Outlet). Высота — h-full (не h-screen!), потому что
 * модуль монтируется внутри скролл-контейнера Энцеладуса (Layout → flex-1 overflow-y-auto).
 */
export default function FactorialShell() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const sidebarWidth = collapsed ? 64 : 240;

  return (
    <div className="factorial-root flex h-full min-h-0 bg-app-bg text-text-primary font-fx-sans">
      <aside
        style={{ width: sidebarWidth }}
        className="shrink-0 h-full transition-all duration-200"
      >
        <Sidebar />
      </aside>

      <main className="flex-1 min-w-0 h-full overflow-y-auto scrollbar-thin">
        <Outlet />
      </main>

      {/* Плавающая кнопка помощи (как в оригинале, правый нижний угол) */}
      <HelpButton />
    </div>
  );
}
