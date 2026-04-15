import { useState, useEffect, useRef } from 'react';
import { useSetSessionBaseModel } from '../store/session-models';

type SessionModelState = {
  modelId: string | null;
  providerId: string | null;
};

/**
 * Hook to fetch the model ID for an OpenCode session.
 *
 * This fetches the model ID once when the session becomes active,
 * extracting it from the most recent assistant message. The model ID
 * doesn't change during a session, so we don't need to poll.
 *
 * @param openCodeSessionId - The OpenCode session ID (null to disable)
 * @param isOpenCodeSession - Whether this is an OpenCode session
 */
export function useSessionModelId(
  openCodeSessionId: string | null,
  isOpenCodeSession: boolean,
): SessionModelState {
  const setSessionBaseModel = useSetSessionBaseModel();
  const [state, setState] = useState<SessionModelState>({
    modelId: null,
    providerId: null,
  });
  const fetchedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip if not an OpenCode session or no session ID
    if (!isOpenCodeSession || !openCodeSessionId) {
      setState({ modelId: null, providerId: null });
      fetchedSessionRef.current = null;
      return;
    }

    // Skip if we already fetched for this session
    if (fetchedSessionRef.current === openCodeSessionId) {
      return;
    }

    let cancelled = false;

    const fetchModelId = async () => {
      try {
        // Check if conversation provider is available
        const available = await window.api.isConversationAvailable();
        if (!available || cancelled) return;

        // Fetch just a few messages to get the model ID
        const messages = await window.api.fetchConversationMessages(
          openCodeSessionId,
          10, // Only need a few to find an assistant message
        );

        if (cancelled) return;

        // Find the most recent assistant message with a modelId
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === 'assistant' && msg.modelId) {
            setSessionBaseModel(
              openCodeSessionId,
              msg.modelId,
              msg.providerId ?? null,
            );
            setState({
              modelId: msg.modelId,
              providerId: msg.providerId ?? null,
            });
            fetchedSessionRef.current = openCodeSessionId;
            return;
          }
        }

        // No model ID found yet - mark as fetched but null
        // We'll try again via SSE events when new messages arrive
        fetchedSessionRef.current = openCodeSessionId;
      } catch (err) {
        console.warn('[useSessionModelId] Error fetching model ID:', err);
      }
    };

    void fetchModelId();

    // Listen for new messages that might contain the model ID
    const handleMessageEvent = (data: {
      type: 'message.created' | 'message.updated' | 'message.completed';
      sessionId: string;
    }) => {
      if (data.sessionId !== openCodeSessionId) return;
      if (fetchedSessionRef.current === openCodeSessionId && state.modelId)
        return;

      // Re-fetch to get the model ID from the new message
      void fetchModelId();
    };

    const cleanupMessageEvent =
      window.api.onConversationMessageEvent(handleMessageEvent);

    return () => {
      cancelled = true;
      cleanupMessageEvent();
    };
  }, [
    openCodeSessionId,
    isOpenCodeSession,
    setSessionBaseModel,
    state.modelId,
  ]);

  return state;
}
