import type { ConversationMessage } from '../../../preload/index';

export const FALLBACK_POLL_INTERVAL_MS = 10000;
export const MESSAGE_EVENT_RECONCILE_DEBOUNCE_MS = 120;
export const SSE_RENDER_PACE_MS = 24;
export const STREAMING_SUPPRESSION_WINDOW_MS = 180;
export const DUPLICATE_EVENT_WINDOW_MS = 250;

const conversationCache = new Map<string, ConversationMessage[]>();
const MAX_CACHE_SIZE = 10;

export function cacheMessages(
  sessionId: string,
  messages: ConversationMessage[],
): void {
  if (
    conversationCache.size >= MAX_CACHE_SIZE &&
    !conversationCache.has(sessionId)
  ) {
    const firstKey = conversationCache.keys().next().value;
    if (firstKey) {
      conversationCache.delete(firstKey);
    }
  }

  conversationCache.set(sessionId, messages);
}

export function getCachedMessages(sessionId: string): ConversationMessage[] {
  return conversationCache.get(sessionId) ?? [];
}

export function applyMessagesWithSessionCache(
  previousMessages: ConversationMessage[],
  update:
    | ConversationMessage[]
    | ((prev: ConversationMessage[]) => ConversationMessage[]),
  sessionId: string | null,
): ConversationMessage[] {
  const nextMessages =
    typeof update === 'function' ? update(previousMessages) : update;

  if (sessionId) {
    cacheMessages(sessionId, nextMessages);
  }

  return nextMessages;
}

export function shouldReconcileMessageEvent(
  eventType:
    | 'message.created'
    | 'message.updated'
    | 'message.completed'
    | 'message.removed',
  lastDeltaAt: number,
  now: number,
): boolean {
  void lastDeltaAt;
  void now;
  return (
    eventType === 'message.completed' ||
    eventType === 'message.removed' ||
    eventType === 'message.created' ||
    eventType === 'message.updated'
  );
}

export function getMessageEventReconcileDelay(
  eventType: 'message.created' | 'message.updated',
  lastDeltaAt: number,
  now: number,
): number {
  const baseDelay = MESSAGE_EVENT_RECONCILE_DEBOUNCE_MS;
  if (eventType === 'message.created' && lastDeltaAt === 0) {
    return baseDelay;
  }

  const hotDeltaDelay = Math.max(
    0,
    STREAMING_SUPPRESSION_WINDOW_MS - (now - lastDeltaAt),
  );
  return Math.max(baseDelay, hotDeltaDelay);
}

export function getMessageEventKey(
  type: string,
  sessionId: string,
  messageId?: string,
): string {
  return `${type}:${sessionId}:${messageId ?? ''}`;
}
