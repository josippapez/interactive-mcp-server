import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../../types';
import { getActiveChannelIdSnapshot } from '../../store/channel-selection';
import { resolvePromptTarget } from '../../store/message-dispatch';

interface PromptHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
}

export function usePromptHandlers({
  nodesRef,
  setNodes,
}: PromptHandlersOptions) {
  const ensureQuestionMessage = (node: SessionNode, promptMessage: string) => {
    const hasQuestion = node.channelMessages.some(
      (message) =>
        message.kind === 'question' && message.text === promptMessage,
    );

    if (hasQuestion) {
      return node.channelMessages;
    }

    return [
      ...node.channelMessages,
      {
        id: `local-question-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: 'question' as const,
        text: promptMessage,
        timestamp: new Date(),
      },
    ];
  };

  const handleSubmit = useCallback(
    (answer: string, attachments?: Attachment[]) => {
      const activeChannelId = getActiveChannelIdSnapshot();
      // Use central dispatch system to resolve the correct target.
      // CRITICAL: For prompt responses, this uses prompt.providerSessionId, not node's.
      const target = resolvePromptTarget(nodesRef.current, activeChannelId);
      if (!target) {
        console.warn('[handleSubmit] Could not resolve dispatch target');
        return;
      }

      const { node: currentNode, nodeKey } = target;

      // Clear the prompt and append the answer message. After Phase 5 the
      // nodes map is keyed by providerSessionId (or connectionId for direct
      // connections), so the nodeKey returned by resolvePromptTarget is
      // authoritative — no re-lookup / key-reshape is required.
      setNodes((prev) => {
        const node = prev.get(nodeKey);
        if (!node) return prev;
        const promptMessage = node.prompt?.message;
        const channelMessages = promptMessage
          ? ensureQuestionMessage(node, promptMessage)
          : node.channelMessages;
        const next = new Map(prev);
        next.set(nodeKey, {
          ...node,
          channelMessages: [
            ...channelMessages,
            {
              id: `local-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              kind: 'answer' as const,
              text: answer,
              timestamp: new Date(),
              attachments,
            },
          ],
          prompt: null,
          hasPendingPrompt: false,
        });
        return next;
      });

      // Inject relevant doc context using the resolved target's session ID.
      const { connectionId, docContextEnabled, baseDirectory } = currentNode;
      if (
        target.providerSessionId &&
        connectionId &&
        docContextEnabled !== false
      ) {
        void window.api.injectDocContext?.(
          connectionId,
          target.providerSessionId,
          answer,
          baseDirectory ?? undefined,
        );
      }

      window.api.sendPromptResponse({
        id: currentNode.prompt!.id,
        answer,
        attachments: attachments?.length ? attachments : undefined,
      });
    },
    [nodesRef, setNodes],
  );

  const handleSelectOption = useCallback(
    (option: string) => {
      // Use central dispatch system to resolve the correct target.
      const activeChannelId = getActiveChannelIdSnapshot();
      const target = resolvePromptTarget(nodesRef.current, activeChannelId);
      if (!target) {
        console.warn('[handleSelectOption] Could not resolve dispatch target');
        return;
      }

      const { node: currentNode, nodeKey } = target;

      // Clear the prompt and append the answer message.
      setNodes((prev) => {
        const node = prev.get(nodeKey);
        if (!node) return prev;
        const promptMessage = node.prompt?.message;
        const channelMessages = promptMessage
          ? ensureQuestionMessage(node, promptMessage)
          : node.channelMessages;
        const next = new Map(prev);
        next.set(nodeKey, {
          ...node,
          channelMessages: [
            ...channelMessages,
            {
              id: `local-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              kind: 'answer' as const,
              text: option,
              timestamp: new Date(),
            },
          ],
          prompt: null,
          hasPendingPrompt: false,
        });
        return next;
      });

      // Inject relevant doc context using the resolved target's session ID.
      const { connectionId, docContextEnabled, baseDirectory } = currentNode;
      if (
        target.providerSessionId &&
        connectionId &&
        docContextEnabled !== false
      ) {
        void window.api.injectDocContext?.(
          connectionId,
          target.providerSessionId,
          option,
          baseDirectory ?? undefined,
        );
      }

      window.api.sendPromptResponse({
        id: currentNode.prompt!.id,
        answer: option,
      });
    },
    [nodesRef, setNodes],
  );

  return {
    handleSubmit,
    handleSelectOption,
  };
}
