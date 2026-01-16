/**
 * WebSocket event types and payloads
 */

import type { Entity, Chat } from './index';

// ============================================
// Base WebSocket Event Types
// ============================================

export type WebSocketEventType =
  | 'ping'
  | 'call.progress'
  | 'call.completed'
  | 'call.failed'
  | 'entity.created'
  | 'entity.updated'
  | 'entity.deleted'
  | 'chat.created'
  | 'chat.updated'
  | 'chat.deleted'
  | 'chat.message';

// ============================================
// Call Event Payloads
// ============================================

export interface CallProgressPayload {
  id: number;
  progress: number;
  progress_stage: string;
  status: string;
}

export interface CallCompletedPayload {
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

export interface CallFailedPayload {
  id: number;
  status: 'failed';
  error_message: string;
  progress: number;
  progress_stage: string;
}

// ============================================
// Entity Event Payloads
// ============================================

/**
 * Payload for entity.created event
 * Contains full Entity object
 */
export type EntityCreatedPayload = Entity;

/**
 * Payload for entity.updated event
 * Contains full Entity object with updated fields
 */
export type EntityUpdatedPayload = Entity;

/**
 * Payload for entity.deleted event
 */
export interface EntityDeletedPayload {
  id: number;
}

// ============================================
// Chat Event Payloads
// ============================================

/**
 * Payload for chat.created event
 * Contains full Chat object
 */
export type ChatCreatedPayload = Chat;

/**
 * Payload for chat.updated event
 * Contains full Chat object with updated fields
 */
export type ChatUpdatedPayload = Chat;

/**
 * Payload for chat.deleted event
 */
export interface ChatDeletedPayload {
  id: number;
}

/**
 * Payload for chat.message event
 * Sent when a new message is added to a chat
 */
export interface ChatMessagePayload {
  chat_id: number;
  message_count?: number;
}

// ============================================
// WebSocket Event Union Types
// ============================================

export type WebSocketPayload =
  | CallProgressPayload
  | CallCompletedPayload
  | CallFailedPayload
  | EntityCreatedPayload
  | EntityUpdatedPayload
  | EntityDeletedPayload
  | ChatCreatedPayload
  | ChatUpdatedPayload
  | ChatDeletedPayload
  | ChatMessagePayload;

// ============================================
// WebSocket Event Structure
// ============================================

export interface WebSocketMessage<T extends WebSocketPayload = WebSocketPayload> {
  type: WebSocketEventType;
  payload: T;
  timestamp: string;
}

// Specific typed messages
export type CallProgressMessage = WebSocketMessage<CallProgressPayload>;
export type CallCompletedMessage = WebSocketMessage<CallCompletedPayload>;
export type CallFailedMessage = WebSocketMessage<CallFailedPayload>;
export type EntityCreatedMessage = WebSocketMessage<EntityCreatedPayload>;
export type EntityUpdatedMessage = WebSocketMessage<EntityUpdatedPayload>;
export type EntityDeletedMessage = WebSocketMessage<EntityDeletedPayload>;
export type ChatCreatedMessage = WebSocketMessage<ChatCreatedPayload>;
export type ChatUpdatedMessage = WebSocketMessage<ChatUpdatedPayload>;
export type ChatDeletedMessage = WebSocketMessage<ChatDeletedPayload>;
export type ChatMessageMessage = WebSocketMessage<ChatMessagePayload>;

// ============================================
// WebSocket Hook Options Types
// ============================================

export interface WebSocketEventHandlers {
  onCallProgress?: (data: CallProgressPayload) => void;
  onCallCompleted?: (data: CallCompletedPayload) => void;
  onCallFailed?: (data: CallFailedPayload) => void;
  onEntityCreated?: (data: EntityCreatedPayload) => void;
  onEntityUpdated?: (data: EntityUpdatedPayload) => void;
  onEntityDeleted?: (data: EntityDeletedPayload) => void;
  onChatCreated?: (data: ChatCreatedPayload) => void;
  onChatUpdated?: (data: ChatUpdatedPayload) => void;
  onChatDeleted?: (data: ChatDeletedPayload) => void;
  onChatMessage?: (data: ChatMessagePayload) => void;
}

export interface WebSocketConnectionOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export type UseWebSocketOptions = WebSocketEventHandlers & WebSocketConnectionOptions;

// ============================================
// WebSocket Status Type
// ============================================

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';
