import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../../types';
import {
  resolveInteractiveMessageTarget,
  resolveTargetBySessionId,
} from '../../store/message-dispatch';
import type { ModelOverride } from '../useProviderInjection';
import { getActiveChannelIdSnapshot } from '../../store/channel-selection';
import { appendChannelMessage } from './channel-message-state';

/**
 * Persist message handler diagnostics to the main-process log file.
 */
function logHandler(
  fn: string,
  event: string,
  details: Record<string, unknown>,
  sessionId?: string | null,
): void {
  const message = `${fn}: ${event} ${JSON.stringify(details)}`;
  // Log to file via IPC for persistent diagnostics (guard for test environment)
  if (typeof window !== 'undefined' && window.api?.log) {
    window.api.log('info', 'message-handlers', message, sessionId);
  }
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
    agent?: string,
  ) => Promise<void>;
}

export function useMessageHandlers({
  nodesRef,
  setNodes,
  inject,
}: MessageHandlersOptions) {
  const appendOutboundMessage = useCallback(
    (
      target: NonNullable<ReturnType<typeof resolveTargetBySessionId>>,
      outboundId: string,
      message: string,
      attachments?: Attachment[],
    ) => {
      setNodes((prev) => {
        const key = target.nodeKey;
        if (!key) return prev;
        const node = prev.get(key);
        if (
          !node ||
          node.channelMessages.some((item) => item.id === outboundId)
        ) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, {
          ...node,
          channelMessages: appendChannelMessage(node.channelMessages, {
            id: outboundId,
            kind: 'outbound' as const,
            text: message,
            timestamp: new Date(),
            attachments,
          }),
        });
        return next;
      });
    },
    [setNodes],
  );

  const handleQueueSessionMessageForSession = useCallback(
    (sessionId: string, message: string, attachments?: Attachment[]) => {
      const target = resolveTargetBySessionId(nodesRef.current, sessionId);

      logHandler(
        'handleQueueSessionMessageForSession',
        'called',
        {
          sessionId,
          resolvedSessionId: target?.sessionId ?? sessionId,
          nodeKey: target?.nodeKey,
          messageLength: message.length,
        },
        target?.sessionId ?? sessionId,
      );

      if (!target) {
        logHandler(
          'handleQueueSessionMessageForSession',
          'target-not-found',
          {
            sessionId,
            nodesCount: nodesRef.current.size,
          },
          sessionId,
        );
        return;
      }

      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.api.queueSessionMessage(target.sessionId, message);
      appendOutboundMessage(target, outboundId, message, attachments);
      void inject(target.sessionId, outboundId, message, attachments);
    },
    [appendOutboundMessage, inject, nodesRef],
  );

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

      logHandler(
        'handleQueueSessionMessage',
        'called',
        {
          activeChannelId,
          sessionId,
          resolvedSessionId: target?.sessionId ?? sessionId,
          resolvedVia: target?.resolvedVia ?? 'fallback',
          nodeKey: target?.nodeKey,
          messageLength: message.length,
        },
        target?.sessionId ?? sessionId,
      );

      if (!target) {
        logHandler(
          'handleQueueSessionMessage',
          'no-active-target',
          {
            sessionId,
            nodesCount: nodesRef.current.size,
          },
          sessionId,
        );
        return;
      }

      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      window.api.queueSessionMessage(target.sessionId, message);
      appendOutboundMessage(target, outboundId, message, attachments);
      void inject(target.sessionId, outboundId, message, attachments);
    },
    [appendOutboundMessage, inject, nodesRef],
  );

  const handleInjectWithReplyForSession = useCallback(
    (
      sessionId: string,
      message: string,
      attachments?: Attachment[],
      modelOverride?: ModelOverride,
      agent?: string,
    ) => {
      const target = resolveTargetBySessionId(nodesRef.current, sessionId);

      logHandler(
        'handleInjectWithReplyForSession',
        'called',
        {
          sessionId,
          resolvedSessionId: target?.sessionId ?? sessionId,
          nodeKey: target?.nodeKey,
          nodeTitle: target?.node?.title,
          messageLength: message.length,
          attachmentsCount: attachments?.length ?? 0,
          hasModelOverride: !!modelOverride,
          modelOverride: modelOverride
            ? {
                providerId: modelOverride.providerId,
                modelId: modelOverride.modelId,
                variant: modelOverride.variant ?? '(default)',
              }
            : null,
          agent: agent ?? '(none)',
        },
        target?.sessionId ?? sessionId,
      );

      if (!target) {
        logHandler(
          'handleInjectWithReplyForSession',
          'target-not-found',
          {
            sessionId,
            nodesCount: nodesRef.current.size,
          },
          sessionId,
        );
        return;
      }

      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      appendOutboundMessage(target, outboundId, message, attachments);
      void inject(
        target.sessionId,
        outboundId,
        message,
        attachments,
        false,
        modelOverride,
        agent,
      );
    },
    [appendOutboundMessage, inject, nodesRef],
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
      /**
       * Optional per-message OpenCode agent override (e.g. 'plan',
       * 'docs-maintainer'). Whitespace-only or empty values fall back to
       * the session's default agent. The override is ephemeral.
       */
      agent?: string,
    ) => {
      const activeChannelId = getActiveChannelIdSnapshot();
      // Interactive sends must always follow the currently selected channel.
      // The requested sessionId is only a fallback when no channel is selected.
      const target = resolveInteractiveMessageTarget(
        nodesRef.current,
        activeChannelId,
        sessionId,
      );

      logHandler(
        'handleInjectWithReply',
        'called',
        {
          activeChannelId,
          sessionId,
          resolvedSessionId: target?.sessionId ?? sessionId,
          resolvedVia: target?.resolvedVia ?? 'fallback',
          nodeKey: target?.nodeKey,
          nodeTitle: target?.node?.title,
          messageLength: message.length,
          attachmentsCount: attachments?.length ?? 0,
          hasModelOverride: !!modelOverride,
          modelOverride: modelOverride
            ? {
                providerId: modelOverride.providerId,
                modelId: modelOverride.modelId,
                variant: modelOverride.variant ?? '(default)',
              }
            : null,
          agent: agent ?? '(none)',
        },
        target?.sessionId ?? sessionId,
      );

      if (!target) {
        logHandler(
          'handleInjectWithReply',
          'no-active-target',
          {
            sessionId,
            nodesCount: nodesRef.current.size,
          },
          sessionId,
        );
        return;
      }

      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      appendOutboundMessage(target, outboundId, message, attachments);
      void inject(
        target.sessionId,
        outboundId,
        message,
        attachments,
        false,
        modelOverride,
        agent,
      );
    },
    [appendOutboundMessage, inject, nodesRef],
  );

  const handleClearChannelMessages = useCallback((sessionId: string) => {
    void window.api.clearSessionChannelMessages(sessionId);
  }, []);

  return {
    handleQueueSessionMessage,
    handleQueueSessionMessageForSession,
    handleInjectWithReply,
    handleInjectWithReplyForSession,
    handleClearChannelMessages,
  };
}
