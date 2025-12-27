import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface WebSocketEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface CallProgressEvent {
  id: number;
  progress: number;
  progress_stage: string;
  status: string;
}

export interface CallCompletedEvent {
  id: number;
  title: string;
  status: 'done';
  has_summary: boolean;
  has_transcript: boolean;
  duration_seconds?: number;
  speaker_stats?: Record<string, unknown>;
  progress: number;
  progress_stage: string;
}

export interface CallFailedEvent {
  id: number;
  status: 'failed';
  error_message: string;
  progress: number;
  progress_stage: string;
}

interface UseWebSocketOptions {
  onCallProgress?: (data: CallProgressEvent) => void;
  onCallCompleted?: (data: CallCompletedEvent) => void;
  onCallFailed?: (data: CallFailedEvent) => void;
  onEntityCreated?: (data: Record<string, unknown>) => void;
  onEntityUpdated?: (data: Record<string, unknown>) => void;
  onEntityDeleted?: (data: { id: number }) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onCallProgress,
    onCallCompleted,
    onCallFailed,
    onEntityCreated,
    onEntityUpdated,
    onEntityDeleted,
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
        console.log('[WebSocket] Connected');
        setStatus('connected');
        setError(null);
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        wsRef.current = null;

        if (isManualClose.current) {
          setStatus('disconnected');
          return;
        }

        // Auto-reconnect if enabled and not manually closed
        if (autoReconnect && user) {
          setStatus('reconnecting');
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[WebSocket] Attempting to reconnect...');
            connect();
          }, reconnectInterval);
        } else {
          setStatus('disconnected');
        }
      };

      ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event);
        setError(new Error('WebSocket connection error'));
        setStatus('error');
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketEvent = JSON.parse(event.data);
          console.log('[WebSocket] Message:', data.type, data.payload);

          // Handle different event types
          switch (data.type) {
            case 'ping':
              // Ignore ping events
              break;

            case 'call.progress':
              onCallProgress?.(data.payload as unknown as CallProgressEvent);
              break;

            case 'call.completed':
              onCallCompleted?.(data.payload as unknown as CallCompletedEvent);
              break;

            case 'call.failed':
              onCallFailed?.(data.payload as unknown as CallFailedEvent);
              break;

            case 'entity.created':
              onEntityCreated?.(data.payload);
              break;

            case 'entity.updated':
              onEntityUpdated?.(data.payload);
              break;

            case 'entity.deleted':
              onEntityDeleted?.(data.payload as unknown as { id: number });
              break;

            default:
              console.log('[WebSocket] Unknown event type:', data.type);
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };
    } catch (err) {
      console.error('[WebSocket] Failed to create connection:', err);
      setError(err instanceof Error ? err : new Error('Failed to connect'));
      setStatus('error');
    }
  }, [user, autoReconnect, reconnectInterval, onCallProgress, onCallCompleted, onCallFailed, onEntityCreated, onEntityUpdated, onEntityDeleted]);

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
