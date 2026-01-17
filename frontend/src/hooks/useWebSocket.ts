import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { logger } from '@/utils/logger';
import type {
  WebSocketStatus,
  WebSocketMessage,
  WebSocketPayload,
  UseWebSocketOptions,
  CallProgressPayload,
  CallCompletedPayload,
  CallFailedPayload,
  EntityDeletedPayload,
  ChatDeletedPayload,
  EntityCreatedPayload,
  EntityUpdatedPayload,
  ChatCreatedPayload,
  ChatUpdatedPayload,
  ChatMessagePayload
} from '@/types/websocket';

// Re-export types for backwards compatibility
export type { WebSocketStatus };
export type { CallProgressPayload as CallProgressEvent };
export type { CallCompletedPayload as CallCompletedEvent };
export type { CallFailedPayload as CallFailedEvent };

// Re-export WebSocketEvent for backwards compatibility
export interface WebSocketEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onCallProgress,
    onCallCompleted,
    onCallFailed,
    onEntityCreated,
    onEntityUpdated,
    onEntityDeleted,
    onChatCreated,
    onChatUpdated,
    onChatDeleted,
    onChatMessage,
    autoReconnect = true,
    reconnectInterval = 3000,
  } = options;

  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isManualClose = useRef(false);

  const { user } = useAuthStore();

  const connect = useCallback(() => {
    // Don't connect if no user is logged in
    if (!user) {
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      isManualClose.current = true;
      wsRef.current.close();
    }

    setStatus('connecting');
    setError(null);
    isManualClose.current = false;

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // Token is in httpOnly cookie, so we need to get it from a special endpoint
    // For now, we'll use the cookie-based auth - backend will read cookie from WebSocket handshake
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.log('[WebSocket] Connected');
        setStatus('connected');
        setError(null);
      };

      ws.onclose = (event) => {
        logger.log('[WebSocket] Disconnected:', event.code, event.reason);
        wsRef.current = null;

        if (isManualClose.current) {
          setStatus('disconnected');
          return;
        }

        // Auto-reconnect if enabled and not manually closed
        if (autoReconnect && user) {
          setStatus('reconnecting');
          reconnectTimeoutRef.current = setTimeout(() => {
            logger.log('[WebSocket] Attempting to reconnect...');
            connect();
          }, reconnectInterval);
        } else {
          setStatus('disconnected');
        }
      };

      ws.onerror = (event) => {
        logger.error('[WebSocket] Error:', event);
        setError(new Error('WebSocket connection error'));
        setStatus('error');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketMessage<WebSocketPayload>;
          logger.log('[WebSocket] Message:', data.type, data.payload);

          // Handle different event types
          switch (data.type) {
            case 'ping':
              // Ignore ping events
              break;

            case 'call.progress':
              onCallProgress?.(data.payload as CallProgressPayload);
              break;

            case 'call.completed':
              onCallCompleted?.(data.payload as CallCompletedPayload);
              break;

            case 'call.failed':
              onCallFailed?.(data.payload as CallFailedPayload);
              break;

            case 'entity.created':
              onEntityCreated?.(data.payload as EntityCreatedPayload);
              break;

            case 'entity.updated':
              onEntityUpdated?.(data.payload as EntityUpdatedPayload);
              break;

            case 'entity.deleted':
              onEntityDeleted?.(data.payload as EntityDeletedPayload);
              break;

            case 'chat.created':
              onChatCreated?.(data.payload as ChatCreatedPayload);
              break;

            case 'chat.updated':
              onChatUpdated?.(data.payload as ChatUpdatedPayload);
              break;

            case 'chat.deleted':
              onChatDeleted?.(data.payload as ChatDeletedPayload);
              break;

            case 'chat.message':
              onChatMessage?.(data.payload as ChatMessagePayload);
              break;

            default:
              logger.log('[WebSocket] Unknown event type:', data.type);
          }
        } catch (err) {
          logger.error('[WebSocket] Failed to parse message:', err);
        }
      };
    } catch (err) {
      logger.error('[WebSocket] Failed to create connection:', err);
      setError(err instanceof Error ? err : new Error('Failed to connect'));
      setStatus('error');
    }
  }, [user, autoReconnect, reconnectInterval, onCallProgress, onCallCompleted, onCallFailed, onEntityCreated, onEntityUpdated, onEntityDeleted, onChatCreated, onChatUpdated, onChatDeleted, onChatMessage]);

  const disconnect = useCallback(() => {
    isManualClose.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  // Connect when user logs in, disconnect when logs out
  useEffect(() => {
    if (user) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [user, connect, disconnect]);

  return {
    status,
    isConnected: status === 'connected',
    error,
    connect,
    disconnect,
  };
}
