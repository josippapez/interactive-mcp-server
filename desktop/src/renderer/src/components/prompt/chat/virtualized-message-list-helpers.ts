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
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.source === 'conversation' && message.role === 'assistant') {
      return message.id;
    }
  }

  return null;
}

export function useSeenMessageIds(messages: UnifiedMessage[]): Set<string> {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const prevMessageCountRef = useRef(0);
  const currentIds = useMemo(
    () => new Set(messages.map((m) => m.id)),
    [messages],
  );

  const newMessageIds = useMemo(() => {
    const newIds = new Set<string>();
    if (messages.length > prevMessageCountRef.current) {
      for (const id of currentIds) {
        if (!seenIdsRef.current.has(id)) {
          newIds.add(id);
        }
      }
    }
    return newIds;
  }, [currentIds, messages.length]);

  useEffect(() => {
    prevMessageCountRef.current = messages.length;
    for (const id of currentIds) {
      seenIdsRef.current.add(id);
    }
  }, [currentIds, messages.length]);

  return newMessageIds;
}
