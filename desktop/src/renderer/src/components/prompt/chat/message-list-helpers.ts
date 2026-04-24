import { useEffect, useMemo, useRef } from 'react';
import type { UnifiedMessage } from '../../../types/unified-message';

const BOTTOM_SCROLL_EPSILON_PX = 2;

export function scrollContainerToBottom(container: HTMLDivElement): void {
  const targetTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight,
  );
  if (Math.abs(container.scrollTop - targetTop) <= BOTTOM_SCROLL_EPSILON_PX) {
    return;
  }

  container.scrollTop = targetTop;
}

export function getStreamingMessageId(
  messages: UnifiedMessage[],
  isBusy: boolean,
): string | null {
  if (!isBusy) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.source === 'conversation' && message.role === 'assistant') {
      return message.id;
    }
  }

  return null;
}

/**
 * Tracks which message IDs are "new" (just arrived at the tail) vs already
 * seen (present on first mount or previously observed). The returned Set is
 * consumed by MessageItem to trigger the `msg-enter` fade-in animation.
 *
 * Correctness contract:
 *   - On first mount, ALL current message IDs are considered "already seen",
 *     so opening a channel with 200 historical messages does NOT flash every
 *     message as new.
 *   - On subsequent updates, an ID is flagged as new ONLY if:
 *       1. It was not present before, AND
 *       2. It is positioned at the tail (index >= previous length).
 *     This rules out prepended backfill (loading older messages) from
 *     replaying the enter animation on historical content.
 *   - Once an ID has been seen it's remembered permanently, so a row that
 *     unmounts and remounts does not re-animate.
 */
export function useSeenMessageIds(messages: UnifiedMessage[]): Set<string> {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);
  const prevMessageCountRef = useRef(0);

  const newMessageIds = useMemo(() => {
    const newIds = new Set<string>();

    // First render: seed the "seen" set with all existing IDs so we don't
    // flash the enter animation on pre-existing history.
    if (!hasInitializedRef.current) {
      return newIds;
    }

    // Only consider IDs at the tail (positions >= previous length) as new.
    // Prepended backfill grows `messages.length` without adding to the tail,
    // so those IDs stay unflagged.
    const prevCount = prevMessageCountRef.current;
    if (messages.length > prevCount) {
      for (let i = prevCount; i < messages.length; i += 1) {
        const msg = messages[i];
        if (!msg) continue;
        if (!seenIdsRef.current.has(msg.id)) {
          newIds.add(msg.id);
        }
      }
    }
    return newIds;
  }, [messages]);

  useEffect(() => {
    hasInitializedRef.current = true;
    prevMessageCountRef.current = messages.length;
    for (const msg of messages) {
      seenIdsRef.current.add(msg.id);
    }
  }, [messages]);

  return newMessageIds;
}
