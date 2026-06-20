import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useCallStore } from '@/stores/callStore';
import { useEntityStore } from '@/stores/entityStore';
import { useChatStore } from '@/stores/chatStore';
import { useFormBadgeStore } from '@/stores/formBadgeStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { logger } from '@/utils/logger';
import { getNotifications } from '@/services/api/notifications';
import type { FormSubmissionPayload } from '@/types/websocket';

/**
 * WebSocket Provider Component
 *
 * Connects to the backend WebSocket and dispatches events to stores.
 * Should be placed inside ProtectedRoute so it only connects when authenticated.
 *
 * Supported events:
 * - call.progress, call.completed, call.failed -> callStore
 * - entity.created, entity.updated, entity.deleted -> entityStore
 * - chat.created, chat.updated, chat.deleted, chat.message -> chatStore
 */
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  // Call store handlers
  const {
    setWebSocketConnected,
    handleCallProgress,
    handleCallCompleted,
    handleCallFailed,
    cleanup: cleanupCallStore
  } = useCallStore();

  // Entity store handlers
  const {
    handleEntityCreated,
    handleEntityUpdated,
    handleEntityDeleted
  } = useEntityStore();

  // Chat store handlers
  const {
    handleChatCreated,
    handleChatUpdated,
    handleChatDeleted,
    handleChatMessage
  } = useChatStore();

  const bumpEntityBadge = useFormBadgeStore((s) => s.bump);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const navigate = useNavigate();

  // Must be stable: an inline fn here makes useWebSocket's `connect` change every
  // render, which (when the WS can't connect) turns reconnects into a render-loop
  // storm that freezes the page. useCallback keeps `connect` stable.
  const onFormSubmission = useCallback(
    (p: FormSubmissionPayload) => {
      // Только бейдж карточки (если WS жив). Всплывающий тост даёт поллинг уведомлений
      // ниже — он надёжнее (WS form.submission на проде не доставляет), и так без дублей.
      bumpEntityBadge(p.entity_id);
    },
    [bumpEntityBadge],
  );

  const { isConnected, status } = useWebSocket({
    // Call events
    onCallProgress: handleCallProgress,
    onCallCompleted: handleCallCompleted,
    onCallFailed: handleCallFailed,
    // Entity events
    onEntityCreated: handleEntityCreated,
    onEntityUpdated: handleEntityUpdated,
    onEntityDeleted: handleEntityDeleted,
    // Chat events
    onChatCreated: handleChatCreated,
    onChatUpdated: handleChatUpdated,
    onChatDeleted: handleChatDeleted,
    onChatMessage: handleChatMessage,
    onFormSubmission,
    // Connection settings
    autoReconnect: true,
    reconnectInterval: 3000,
  });

  // Update store when connection status changes
  useEffect(() => {
    setWebSocketConnected(isConnected);
  }, [isConnected, setWebSocketConnected]);

  // Log connection status for debugging
  useEffect(() => {
    logger.log(`[WebSocketProvider] Status: ${status}, Connected: ${isConnected}`);
  }, [status, isConnected]);

  // Realtime по WebSocket на проде НЕ доставляет form.submission (уведомления в БД
  // создаются, но событие до клиента не доходит). Поэтому popup даём поллингом:
  // счётчик колокольчика обновляем всегда + ВСПЛЫВАЮЩИЙ тост на каждое НОВОЕ
  // уведомление (анкета и пр.), независимо от состояния WS. (Тост из onFormSubmission
  // убран, чтобы не дублить.)
  const lastSeenNotifId = useRef<number>(-1);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const list = await getNotifications();
        if (!alive) return;
        setUnreadCount(list.filter((n) => !n.is_read).length);
        const maxId = list.reduce((m, n) => Math.max(m, n.id), -1);
        const prev = lastSeenNotifId.current;
        lastSeenNotifId.current = Math.max(prev, maxId);
        if (prev < 0) return; // первый прогон — не спамим существующими уведомлениями
        for (const n of list.filter((n) => n.id > prev).sort((a, b) => a.id - b.id)) {
          const m = /entity=(\d+)/.exec(n.link || '');
          if (n.type === 'form_submitted' && m) bumpEntityBadge(parseInt(m[1], 10));
          toast((t) => (
            <span
              onClick={() => { if (n.link) navigate(n.link); toast.dismiss(t.id); }}
              style={{ cursor: 'pointer' }}
            >
              {n.type === 'form_submitted' ? '📋 ' : '🔔 '}{n.message || n.title}
            </span>
          ), { duration: 8000 });
        }
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 25000);
    return () => { alive = false; clearInterval(id); };
  }, [setUnreadCount, bumpEntityBadge, navigate]);

  // Cleanup polling on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      cleanupCallStore();
    };
  }, [cleanupCallStore]);

  return <>{children}</>;
}
