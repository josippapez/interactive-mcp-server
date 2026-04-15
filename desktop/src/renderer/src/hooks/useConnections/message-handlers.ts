import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../../types';
import { findKeyByConnectionId } from '../useIpcListeners';
import { resolveInteractiveMessageTarget } from '../../store/message-dispatch';
import type { ModelOverride } from '../useProviderInjection';
import { getActiveChannelIdSnapshot } from '../../store/channel-selection';

/**
 * Log message handler events to both console and the main process log file.
 */
function logHandler(
  fn: string,
  event: string,
  details: Record<string, unknown>,
): void {
  const message = `${fn}: ${event} ${JSON.stringify(details)}`;
  // Log to file via IPC for persistent diagnostics (guard for test environment)
  if (typeof window !== 'undefined' && window.api?.log) {
    window.api.log('info', 'message-handlers', message);
  }
  console.log(`[message-handlers] ${fn}:`, event, details);
}

interface MessageHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
  inject: (
    sessionId: string,
    outboundId: string,
    message: string,
    attachments?: Attachment[],
    noReply?: boolean,
    modelOverride?: ModelOverride,
  ) => Promise<void>;
}

export function useMessageHandlers({
  nodesRef,
  setNodes,
  inject,
}: MessageHandlersOptions) {
  const handleQueueSessionMessage = useCallback(
    (sessionId: string, message: string, attachments?: Attachment[]) => {
      const activeChannelId = getActiveChannelIdSnapshot();
      // Interactive sends must always follow the currently selected channel.
      // The requested sessionId is only a fallback when no channel is selected.
      const target = resolveInteractiveMessageTarget(
        nodesRef.current,
        activeChannelId,
        sessionId,
      );

      logHandler('handleQueueSessionMessage', 'called', {
        activeChannelId,
        sessionId,
        resolvedSessionId: target?.sessionId ?? sessionId,
        resolvedVia: target?.resolvedVia ?? 'fallback',
        nodeKey: target?.nodeKey,
        messageLength: message.length,
      });

      if (!target) {
        logHandler('handleQueueSessionMessage', 'no-active-target', {
          sessionId,
          nodesCount: nodesRef.current.size,
        });
        return;
      }

      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Always queue in SQLite for VS Code extension polling
      // Use the resolved session ID if available, fallback to provided sessionId
      window.api.queueSessionMessage(target.sessionId, message);

      // Update the UI with the outbound message
      setNodes((prev) => {
        const key =
          target.nodeKey ?? findKeyByConnectionId(prev, sessionId, sessionId);
        if (!key) return prev;
        const node = prev.get(key)!;
        if (node.channelMessages.some((m) => m.id === outboundId)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, {
          ...node,
          channelMessages: [
            ...node.channelMessages,
            {
              id: outboundId,
              kind: 'outbound' as const,
              text: message,
              timestamp: new Date(),
              attachments,
            },
          ],
        });
        return next;
      });

      void inject(target.sessionId, outboundId, message, attachments);
    },
    [nodesRef, setNodes, inject],
  );

  /**
   * Send a message with noReply=false to trigger an agent response.
   * This bypasses the SQLite queue and directly injects via the OpenCode API.
   */
  const handleInjectWithReply = useCallback(
    (
      sessionId: string,
      message: string,
      attachments?: Attachment[],
      modelOverride?: ModelOverride,
    ) => {
      const activeChannelId = getActiveChannelIdSnapshot();
      // Interactive sends must always follow the currently selected channel.
      // The requested sessionId is only a fallback when no channel is selected.
      const target = resolveInteractiveMessageTarget(
        nodesRef.current,
        activeChannelId,
        sessionId,
      );

      logHandler('handleInjectWithReply', 'called', {
        activeChannelId,
        sessionId,
        resolvedSessionId: target?.sessionId ?? sessionId,
        resolvedVia: target?.resolvedVia ?? 'fallback',
        nodeKey: target?.nodeKey,
        nodeTitle: target?.node?.title,
        messageLength: message.length,
        attachmentsCount: attachments?.length ?? 0,
        hasModelOverride: !!modelOverride,
      });

      if (!target) {
        logHandler('handleInjectWithReply', 'no-active-target', {
          sessionId,
          nodesCount: nodesRef.current.size,
        });
        return;
      }

      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Add outbound message to UI immediately using resolved target
      setNodes((prev) => {
        const key =
          target.nodeKey ?? findKeyByConnectionId(prev, sessionId, sessionId);
        if (!key) {
          logHandler('handleInjectWithReply', 'CRITICAL-key-null', {
            sessionId,
            outboundId,
            nodesCount: prev.size,
          });
          return prev;
        }
        const node = prev.get(key)!;
        if (node.channelMessages.some((m) => m.id === outboundId)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, {
          ...node,
          channelMessages: [
            ...node.channelMessages,
            {
              id: outboundId,
              kind: 'outbound' as const,
              text: message,
              timestamp: new Date(),
              attachments,
            },
          ],
        });
        logHandler('handleInjectWithReply', 'message-added', {
          key,
          outboundId,
          newMessagesCount: node.channelMessages.length + 1,
        });
        return next;
      });

      // Inject with noReply=false to trigger agent response
      // Use the resolved session ID for correct routing
      void inject(
        target.sessionId,
        outboundId,
        message,
        attachments,
        false,
        modelOverride,
      );
    },
    [nodesRef, setNodes, inject],
  );

  const handleClearChannelMessages = useCallback((sessionId: string) => {
    void window.api.clearSessionChannelMessages(sessionId);
  }, []);

  return {
    handleQueueSessionMessage,
    handleInjectWithReply,
    handleClearChannelMessages,
  };
}
