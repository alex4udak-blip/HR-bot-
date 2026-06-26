import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ClipboardList, X } from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";

// ================================================================
// NOTIF PEEK — анимированная «зазывная» карточка входящего уведомления,
// выезжающая над кнопкой «+» (FAB). Показывает последнее уведомление из
// очереди peeks (стор), мягко пульсирует, авто-сворачивается через ~6с.
// Клик → переход по link уведомления, либо открытие полного поповера
// (onOpenPanel). Монтируется внутри .hf-hr-fab-wrap (position: relative).
// ================================================================

const AUTO_DISMISS_MS = 6000;

export function NotifPeek({ onOpenPanel }: { onOpenPanel?: () => void }) {
  const peeks = useNotificationStore((s) => s.peeks);
  const dismissPeek = useNotificationStore((s) => s.dismissPeek);
  const clearPeeks = useNotificationStore((s) => s.clearPeeks);
  const navigate = useNavigate();

  // Показываем самый свежий peek; «+N» — сколько ещё в очереди под ним.
  const latest = peeks[peeks.length - 1];
  const extra = peeks.length - 1;

  // Авто-сворачивание текущего peek'а.
  useEffect(() => {
    if (!latest) return;
    const t = window.setTimeout(() => dismissPeek(latest.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [latest?.id, dismissPeek]);

  const handleOpen = () => {
    if (!latest) return;
    if (latest.link) navigate(latest.link);
    else onOpenPanel?.();
    clearPeeks();
  };

  const Icon = latest?.type === "form_submitted" ? ClipboardList : Bell;

  return (
    <div className="pointer-events-none absolute bottom-full left-0 right-0 z-[130] mb-3 flex justify-center">
      <AnimatePresence>
        {latest && (
          <motion.button
            key={latest.id}
            type="button"
            onClick={handleOpen}
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 460, damping: 28 }}
            className="pointer-events-auto relative flex w-full max-w-[260px] items-start gap-2 overflow-hidden rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-[var(--hf-white)] px-3 py-2.5 text-left shadow-[0_14px_44px_var(--hf-alpha-300)]"
          >
            {/* Пульсирующий акцент слева — притягивает взгляд. */}
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-[var(--hf-cyan-500)]"
              animate={{ opacity: [0.45, 1, 0.45] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--hf-cyan-50,var(--hf-bg-panel))] text-[var(--hf-cyan-700)]">
              <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--hf-main-500)]">
                {latest.type === "form_submitted" ? "Ответ на анкету" : latest.title}
              </span>
              <span className="mt-0.5 block truncate text-[13px] font-medium leading-snug text-[var(--hf-main-900)]">
                {latest.message || latest.title}
              </span>
            </span>
            {extra > 0 && (
              <span className="ml-1 mt-[1px] inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--hf-red-500)] px-[5px] text-[10px] font-bold leading-none text-[var(--hf-white)]">
                +{extra}
              </span>
            )}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                dismissPeek(latest.id);
              }}
              className="ml-0.5 mt-[1px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--hf-main-400)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-700)]"
              title="Скрыть"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export default NotifPeek;
