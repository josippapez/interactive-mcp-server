import type { ChannelMessage } from '../../types';
import type { HandlerContext } from './types';
import { findKeyByConnectionId, findPromptTargetKey } from './helpers';

function makeLiveMessageId(prefix: 'question' | 'answer'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function appendUniqueQuestionMessage(
  channelMessages: ChannelMessage[],
  promptMessage: string,
): ChannelMessage[] {
  const lastMessage = channelMessages.at(-1);
  const hasQuestion =
    lastMessage?.kind === 'question' && lastMessage.text === promptMessage;

  if (hasQuestion) {
    return channelMessages;
  }

  return [
    ...channelMessages,
    {
      id: makeLiveMessageId('question'),
      kind: 'question' as const,
      text: promptMessage,
      timestamp: new Date(),
    },
  ];
}

/**
 * Registers IPC listeners for prompt-related events.
 * Handles: onPromptRequest, onPromptClear, onIntensiveChatStart, onIntensiveChatStop
 *
 * Returns a disposer that removes every listener registered here.
 */
export function usePromptHandlers({
  getActiveConnectionId,
  activateRef,
  setNodes,
  selectChannel,
  setClientInfo,
  bufferPrompt,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  // ------------------------------------------------------------------
  // Prompt events — keyed by connectionId
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onPromptRequest((data) => {
      if (data.clientInfo) setClientInfo(data.clientInfo);

      setNodes((prev) => {
        // Route the prompt to the originating agent's own channel.
        const nodeId = findPromptTargetKey(
          prev,
          data.connectionId,
          data.providerSessionId,
        );

        // Diagnostic logging for prompt routing
        const nodeKeys = Array.from(prev.keys());
        const nodeInfos = Array.from(prev.values()).map((n) => ({
          id: n.id,
          providerSessionId: n.providerSessionId,
          connectionId: n.connectionId,
        }));
        window.api.log(
          'info',
          'prompt-routing',
          `[onPromptRequest] promptId=${data.id} connectionId=${data.connectionId} providerSessionId=${data.providerSessionId ?? 'null'} foundNodeId=${nodeId ?? 'null'} nodeKeys=${JSON.stringify(nodeKeys)} nodeInfos=${JSON.stringify(nodeInfos)}`,
        );

        if (!nodeId) {
          // Buffer the prompt for later application when its target node arrives.
          // This handles timing races where the prompt arrives before the
          // session-tree-updated event creates the node.
          window.api.log(
            'warn',
            'prompt-routing',
            `[onPromptRequest] No matching node found — buffering prompt for later. connectionId=${data.connectionId} providerSessionId=${data.providerSessionId ?? 'null'}`,
          );
          bufferPrompt(data);
          return prev;
        }

        const node = prev.get(nodeId)!;

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          prompt: data,
          hasPendingPrompt: true,
          baseDirectory: data.baseDirectory ?? node.baseDirectory,
          channelMessages: appendUniqueQuestionMessage(
            node.channelMessages,
            data.message,
          ),
          unreadCount:
            getActiveConnectionId() === nodeId
              ? node.unreadCount
              : node.unreadCount + 1,
        });

        // Do not auto-switch away from an already selected channel when a
        // prompt arrives in another channel. Auto-focus only when no channel
        // is currently active (initial load / first prompt).
        if (!getActiveConnectionId()) {
          selectChannel(nodeId, 'prompt-received');
          activateRef.current();
        }

        return next;
      });
    }),
  );

  // Clear the prompt UI when a prompt times out (main process sends this).
  disposers.push(
    window.api.onPromptClear?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        // Only clear if it's still the same prompt (guard against races).
        if (node.prompt?.id !== data.id) return prev;

        const nextMessages = [...node.channelMessages];
        if (typeof data.answer === 'string' && data.answer.length > 0) {
          nextMessages.push({
            id: makeLiveMessageId('answer'),
            kind: 'answer' as const,
            text: data.answer,
            timestamp: new Date(),
          });
        }

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          prompt: null,
          hasPendingPrompt: false,
          channelMessages: nextMessages,
        });
        return next;
      });
    }),
  );

  disposers.push(
    window.api.onIntensiveChatStart?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (!nodeId) return prev;
        const next = new Map(prev);
        next.set(nodeId, {
          ...prev.get(nodeId)!,
          activeSession: { id: data.sessionId, title: data.title },
        });
        // Only select if no channel is currently active
        if (!getActiveConnectionId()) {
          selectChannel(nodeId, 'prompt-received');
        }
        activateRef.current();
        return next;
      });
    }),
  );

  disposers.push(
    window.api.onIntensiveChatStop?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (!nodeId) return prev;
        const next = new Map(prev);
        next.set(nodeId, { ...prev.get(nodeId)!, activeSession: null });
        return next;
      });
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
