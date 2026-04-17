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
  providerSessionId: string | null,
  enabled = true,
): UseConversationResult {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => {
    if (providerSessionId && enabled) {
      return getCachedMessages(providerSessionId);
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
        applyMessagesWithSessionCache(prev, update, providerSessionId),
      );
    },
    [providerSessionId],
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
    if (!providerSessionId || !enabled) {
      setMessagesAndCache([]);
      return;
    }

    currentSessionRef.current = providerSessionId;

    const cached = getCachedMessages(providerSessionId);
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
        providerSessionId,
        100,
      );

      // Only update if this is still the current session
      if (currentSessionRef.current === providerSessionId) {
        setMessagesAndCache(fetched);
      }
    } catch (err) {
      if (currentSessionRef.current === providerSessionId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentSessionRef.current === providerSessionId) {
        setIsLoading(false);
      }
    }
  }, [providerSessionId, enabled, setMessagesAndCache]);

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
    if (providerSessionId && enabled) {
      const cached = getCachedMessages(providerSessionId);
      if (cached.length > 0) {
        setMessagesAndCache(cached);
      }
    }
    void fetchMessages();
  }, [fetchMessages, providerSessionId, enabled, setMessagesAndCache]);

  useEffect(() => {
    if (!providerSessionId || !enabled) return;

    const batcher = createDeltaBatcher(setMessagesAndCache, {
      paceMs: SSE_RENDER_PACE_MS,
    });

    const handleMessageEvent = createMessageEventHandler({
      providerSessionId,
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
      providerSessionId,
      lastSseEventRef,
      batcher,
      setMessagesAndCache,
    });
    const handlePartDelta = createPartDeltaHandler({
      providerSessionId,
      lastSseEventRef,
      lastDeltaAtRef,
      batcher,
    });
    const handleCompacted = createCompactedHandler({
      providerSessionId,
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
  }, [providerSessionId, enabled, fetchMessages, setMessagesAndCache]);

  useEffect(() => {
    if (!providerSessionId || !enabled || !isAvailable) return;

    const interval = setInterval(() => {
      const timeSinceLastSse = Date.now() - lastSseEventRef.current;
      if (timeSinceLastSse > FALLBACK_POLL_INTERVAL_MS) {
        void fetchMessages();
      }
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [providerSessionId, enabled, isAvailable, fetchMessages]);

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
