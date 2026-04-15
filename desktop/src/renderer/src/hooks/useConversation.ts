import { useState, useEffect, useCallback, useRef } from 'react';
import type { ConversationMessage } from '../../../preload/index';
import { createDeltaBatcher } from './delta-batcher';
import { createReconcileScheduler } from './useConversation-fetch';
import {
  createCompactedHandler,
  createMessageEventHandler,
  createPartDeltaHandler,
  createPartEventHandler,
} from './useConversation-handlers';
import {
  applyMessagesWithSessionCache,
  FALLBACK_POLL_INTERVAL_MS,
  getCachedMessages,
  SSE_RENDER_PACE_MS,
  shouldReconcileMessageEvent,
} from './useConversation-pacing';

type UseConversationResult = {
  /** All conversation messages for this session */
  messages: ConversationMessage[];
  /** Whether initial fetch is in progress */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Manually refresh messages */
  refresh: () => Promise<void>;
  /** Whether the conversation provider is available */
  isAvailable: boolean;
};

export function useConversation(
  openCodeSessionId: string | null,
  enabled = true,
): UseConversationResult {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => {
    if (openCodeSessionId && enabled) {
      return getCachedMessages(openCodeSessionId);
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);

  const setMessagesAndCache = useCallback(
    (
      update:
        | ConversationMessage[]
        | ((prev: ConversationMessage[]) => ConversationMessage[]),
    ) => {
      setMessages((prev) =>
        applyMessagesWithSessionCache(prev, update, openCodeSessionId),
      );
    },
    [openCodeSessionId],
  );

  const currentSessionRef = useRef<string | null>(null);
  const lastSseEventRef = useRef<number>(0);
  const lastDeltaAtRef = useRef<number>(0);
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageEventRef = useRef<{
    key: string;
    timestamp: number;
  } | null>(null);

  const scheduleReconcileFetchRef = useRef<
    ((delayMs: number, flush: () => void) => void) | null
  >(null);

  const clearReconcileTimer = useCallback(() => {
    if (!reconcileTimerRef.current) return;
    clearTimeout(reconcileTimerRef.current);
    reconcileTimerRef.current = null;
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!openCodeSessionId || !enabled) {
      setMessagesAndCache([]);
      return;
    }

    currentSessionRef.current = openCodeSessionId;

    const cached = getCachedMessages(openCodeSessionId);
    if (cached && cached.length > 0) {
      setMessagesAndCache(cached);
    }

    setIsLoading(true);
    setError(null);

    try {
      const available = await window.api.isConversationAvailable();
      setIsAvailable(available);

      if (!available) {
        setMessagesAndCache([]);
        setIsLoading(false);
        return;
      }

      const fetched = await window.api.fetchConversationMessages(
        openCodeSessionId,
        100,
      );

      // Only update if this is still the current session
      if (currentSessionRef.current === openCodeSessionId) {
        setMessagesAndCache(fetched);
      }
    } catch (err) {
      if (currentSessionRef.current === openCodeSessionId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentSessionRef.current === openCodeSessionId) {
        setIsLoading(false);
      }
    }
  }, [openCodeSessionId, enabled, setMessagesAndCache]);

  const scheduleReconcileFetch = useCallback(
    createReconcileScheduler(
      clearReconcileTimer,
      (timer) => {
        reconcileTimerRef.current = timer;
      },
      fetchMessages,
    ),
    [clearReconcileTimer, fetchMessages],
  );

  scheduleReconcileFetchRef.current = scheduleReconcileFetch;

  useEffect(() => {
    if (openCodeSessionId && enabled) {
      const cached = getCachedMessages(openCodeSessionId);
      if (cached.length > 0) {
        setMessagesAndCache(cached);
      }
    }
    void fetchMessages();
  }, [fetchMessages, openCodeSessionId, enabled, setMessagesAndCache]);

  useEffect(() => {
    if (!openCodeSessionId || !enabled) return;

    const batcher = createDeltaBatcher(setMessagesAndCache, {
      paceMs: SSE_RENDER_PACE_MS,
    });

    const handleMessageEvent = createMessageEventHandler({
      openCodeSessionId,
      lastSseEventRef,
      lastDeltaAtRef,
      lastMessageEventRef,
      clearReconcileTimer,
      batcher,
      fetchMessages,
      setMessagesAndCache,
      scheduleReconcileFetch: (delayMs, flush) =>
        scheduleReconcileFetchRef.current?.(delayMs, flush),
    });
    const handlePartEvent = createPartEventHandler({
      openCodeSessionId,
      lastSseEventRef,
      batcher,
      setMessagesAndCache,
    });
    const handlePartDelta = createPartDeltaHandler({
      openCodeSessionId,
      lastSseEventRef,
      lastDeltaAtRef,
      batcher,
    });
    const handleCompacted = createCompactedHandler({
      openCodeSessionId,
      lastSseEventRef,
      clearReconcileTimer,
      batcher,
      fetchMessages,
    });

    const cleanupMessageEvent =
      window.api.onConversationMessageEvent(handleMessageEvent);
    const cleanupPartEvent =
      window.api.onConversationPartEvent(handlePartEvent);
    const cleanupPartDelta =
      window.api.onConversationPartDelta(handlePartDelta);
    const cleanupCompacted = window.api.onSessionCompacted(handleCompacted);

    return () => {
      clearReconcileTimer();
      batcher.dispose();
      cleanupMessageEvent();
      cleanupPartEvent();
      cleanupPartDelta();
      cleanupCompacted();
    };
  }, [openCodeSessionId, enabled, fetchMessages, setMessagesAndCache]);

  useEffect(() => {
    if (!openCodeSessionId || !enabled || !isAvailable) return;

    const interval = setInterval(() => {
      const timeSinceLastSse = Date.now() - lastSseEventRef.current;
      if (timeSinceLastSse > FALLBACK_POLL_INTERVAL_MS) {
        void fetchMessages();
      }
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [openCodeSessionId, enabled, isAvailable, fetchMessages]);

  return {
    messages,
    isLoading,
    error,
    refresh: fetchMessages,
    isAvailable,
  };
}

export const __useConversationTestUtils = {
  shouldReconcileMessageEvent,
};
