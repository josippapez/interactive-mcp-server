import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/index';

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

/**
 * Fallback polling interval (ms) - only used if SSE events don't arrive.
 * This is a safety net; SSE should handle most updates.
 */
const FALLBACK_POLL_INTERVAL_MS = 10000;

/**
 * Hook to fetch and subscribe to OpenCode conversation messages for a session.
 *
 * Uses SSE events for real-time updates with fallback polling.
 * Supports streaming text deltas for real-time text updates.
 *
 * @param openCodeSessionId - The OpenCode session ID to fetch messages for (null to disable)
 * @param enabled - Whether to enable fetching/subscription (default: true)
 */
export function useConversation(
  openCodeSessionId: string | null,
  enabled = true,
): UseConversationResult {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);

  // Track current session ID to avoid race conditions
  const currentSessionRef = useRef<string | null>(null);
  // Track last SSE event time to detect if SSE is working
  const lastSseEventRef = useRef<number>(0);

  const fetchMessages = useCallback(async () => {
    if (!openCodeSessionId || !enabled) {
      setMessages([]);
      return;
    }

    currentSessionRef.current = openCodeSessionId;
    setIsLoading(true);
    setError(null);

    try {
      const available = await window.api.isConversationAvailable();
      setIsAvailable(available);

      if (!available) {
        setMessages([]);
        setIsLoading(false);
        return;
      }

      const fetched = await window.api.fetchConversationMessages(
        openCodeSessionId,
        100,
      );

      // Only update if this is still the current session
      if (currentSessionRef.current === openCodeSessionId) {
        setMessages(fetched);
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
  }, [openCodeSessionId, enabled]);

  // Fetch messages when session changes
  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  // Subscribe to real-time message events via SSE
  useEffect(() => {
    if (!openCodeSessionId || !enabled) return;

    const handleMessageEvent = (data: {
      type: 'message.created' | 'message.updated' | 'message.completed';
      sessionId: string;
      messageId?: string;
    }) => {
      // Only handle events for our session
      if (data.sessionId !== openCodeSessionId) return;

      // Mark that SSE is working
      lastSseEventRef.current = Date.now();

      // Only re-fetch on message.completed to avoid overwriting streaming deltas
      // For message.created and message.updated, we rely on part events and deltas
      if (data.type === 'message.completed') {
        void fetchMessages();
      }
    };

    const handlePartEvent = (data: {
      type: 'part.added' | 'part.updated';
      sessionId: string;
      messageId?: string;
      part?: ConversationMessagePart;
    }) => {
      // Only handle events for our session
      if (data.sessionId !== openCodeSessionId) return;

      // Mark that SSE is working
      lastSseEventRef.current = Date.now();

      // For part updates, we can optimistically update the local state
      if (data.part && data.messageId) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== data.messageId) return msg;

            const existingPartIndex = msg.parts.findIndex(
              (p) => p.id === data.part!.id,
            );

            if (existingPartIndex >= 0) {
              // Update existing part - but preserve longer text from streaming
              // to avoid overwriting delta-accumulated content
              const existingPart = msg.parts[existingPartIndex];
              const existingText = existingPart.text ?? '';
              const newText = data.part!.text ?? '';

              // Only use the incoming part if it has more text
              // (the final part.updated should have all the text)
              if (newText.length >= existingText.length) {
                const newParts = [...msg.parts];
                newParts[existingPartIndex] = data.part!;
                return { ...msg, parts: newParts };
              }

              // Keep existing part (has more streamed content)
              return msg;
            } else {
              // Add new part
              return { ...msg, parts: [...msg.parts, data.part!] };
            }
          }),
        );
      }
    };

    // Handle streaming text deltas (real-time text updates)
    const handlePartDelta = (data: {
      type: 'part.delta';
      sessionId: string;
      messageId: string;
      partId: string;
      deltaField: string;
      deltaValue: string;
    }) => {
      // Only handle events for our session
      if (data.sessionId !== openCodeSessionId) return;

      // Mark that SSE is working
      lastSseEventRef.current = Date.now();

      // Apply the delta to the appropriate part
      if (data.deltaField === 'text') {
        setMessages((prev) => {
          // Check if message exists
          const msgIndex = prev.findIndex((m) => m.id === data.messageId);

          if (msgIndex === -1) {
            // Message doesn't exist yet - create a placeholder message with the part
            console.log(
              '[useConversation] Creating message for delta:',
              data.messageId,
            );
            const newMessage: ConversationMessage = {
              id: data.messageId,
              sessionId: data.sessionId,
              role: 'assistant',
              createdAt: Date.now(),
              parts: [
                {
                  id: data.partId,
                  type: 'text',
                  text: data.deltaValue,
                },
              ],
            };
            return [...prev, newMessage];
          }

          // Message exists - update it
          const msg = prev[msgIndex];
          const partIndex = msg.parts.findIndex((p) => p.id === data.partId);

          if (partIndex === -1) {
            // Part doesn't exist yet - create it
            console.log(
              '[useConversation] Creating part for delta:',
              data.partId,
            );
            const newParts = [
              ...msg.parts,
              {
                id: data.partId,
                type: 'text' as const,
                text: data.deltaValue,
              },
            ];
            return [
              ...prev.slice(0, msgIndex),
              { ...msg, parts: newParts },
              ...prev.slice(msgIndex + 1),
            ];
          }

          // Part exists - append delta to text
          const part = msg.parts[partIndex];
          const newText = (part.text ?? '') + data.deltaValue;
          const newParts = [
            ...msg.parts.slice(0, partIndex),
            { ...part, text: newText },
            ...msg.parts.slice(partIndex + 1),
          ];
          return [
            ...prev.slice(0, msgIndex),
            { ...msg, parts: newParts },
            ...prev.slice(msgIndex + 1),
          ];
        });
      }
    };

    window.api.onConversationMessageEvent(handleMessageEvent);
    window.api.onConversationPartEvent(handlePartEvent);
    window.api.onConversationPartDelta(handlePartDelta);
  }, [openCodeSessionId, enabled, fetchMessages]);

  // Fallback polling - only runs if SSE events haven't been received recently
  useEffect(() => {
    if (!openCodeSessionId || !enabled || !isAvailable) return;

    const interval = setInterval(() => {
      // Only poll if no SSE event received in the last interval period
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
