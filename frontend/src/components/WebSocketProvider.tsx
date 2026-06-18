import { useEffect, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useCallStore } from '@/stores/callStore';
import { useEntityStore } from '@/stores/entityStore';
import { useChatStore } from '@/stores/chatStore';
import { useFormBadgeStore } from '@/stores/formBadgeStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { logger } from '@/utils/logger';
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
  const bumpUnread = useNotificationStore((s) => s.bumpUnread);

  // Must be stable: an inline fn here makes useWebSocket's `connect` change every
  // render, which (when the WS can't connect) turns reconnects into a render-loop
  // storm that freezes the page. useCallback keeps `connect` stable.
  const onFormSubmission = useCallback(
    (p: FormSubmissionPayload) => {
      bumpEntityBadge(p.entity_id);
      bumpUnread();
    },
    [bumpEntityBadge, bumpUnread],
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

  // Cleanup polling on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      cleanupCallStore();
    };
  }, [cleanupCallStore]);

  return <>{children}</>;
}
