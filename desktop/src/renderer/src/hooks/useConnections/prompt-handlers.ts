import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../../types';
import {
  getActiveChannelIdSnapshot,
  type ChannelSelectionSource,
} from '../../store/channel-selection';
import {
  resolvePromptTarget,
  findNodeKeyWithFallback,
} from '../../store/message-dispatch';

interface PromptHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
  selectChannel: (
    id: string | null,
    source: ChannelSelectionSource,
    intentionalNull?: boolean,
  ) => void;
}

export function usePromptHandlers({
  nodesRef,
  setNodes,
  selectChannel,
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
      // CRITICAL: For prompt responses, this uses prompt.openCodeSessionId, not node's.
      const target = resolvePromptTarget(nodesRef.current, activeChannelId);
      if (!target) {
        console.warn('[handleSubmit] Could not resolve dispatch target');
        return;
      }

      const { node: currentNode, nodeKey } = target;

      // Clear the prompt and append the answer message.
      // Use findNodeKeyWithFallback to handle node key changes (direct→tree absorption).
      setNodes((prev) => {
        const effectiveKey = findNodeKeyWithFallback(
          prev,
          nodeKey,
          currentNode.connectionId,
        );
        if (!effectiveKey) return prev;
        const node = prev.get(effectiveKey)!;
        const promptMessage = node.prompt?.message;
        const channelMessages = promptMessage
          ? ensureQuestionMessage(node, promptMessage)
          : node.channelMessages;
        const next = new Map(prev);
        next.set(effectiveKey, {
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

      // Update the selected node only when the renderer promoted a direct
      // connection placeholder to a concrete session node. For normal OpenCode
      // prompt replies, keep the user on the current selected channel.
      const newKey = findNodeKeyWithFallback(
        nodesRef.current,
        nodeKey,
        currentNode.connectionId,
      );
      if (newKey && newKey !== nodeKey && !currentNode.openCodeSessionId) {
        selectChannel(newKey, 'hook-migration');
      }

      // Inject relevant doc context using the resolved target's session ID.
      const { connectionId, docContextEnabled, baseDirectory } = currentNode;
      if (
        target.openCodeSessionId &&
        connectionId &&
        docContextEnabled !== false
      ) {
        void window.api.injectDocContext?.(
          connectionId,
          target.openCodeSessionId,
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
    [nodesRef, setNodes, selectChannel],
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
        const effectiveKey = findNodeKeyWithFallback(
          prev,
          nodeKey,
          currentNode.connectionId,
        );
        if (!effectiveKey) return prev;
        const node = prev.get(effectiveKey)!;
        const promptMessage = node.prompt?.message;
        const channelMessages = promptMessage
          ? ensureQuestionMessage(node, promptMessage)
          : node.channelMessages;
        const next = new Map(prev);
        next.set(effectiveKey, {
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

      // Only migrate selection when a direct connection placeholder was
      // promoted to a concrete node. Avoid jumping across OpenCode sessions.
      const newKey = findNodeKeyWithFallback(
        nodesRef.current,
        nodeKey,
        currentNode.connectionId,
      );
      if (newKey && newKey !== nodeKey && !currentNode.openCodeSessionId) {
        selectChannel(newKey, 'hook-migration');
      }

      // Inject relevant doc context using the resolved target's session ID.
      const { connectionId, docContextEnabled, baseDirectory } = currentNode;
      if (
        target.openCodeSessionId &&
        connectionId &&
        docContextEnabled !== false
      ) {
        void window.api.injectDocContext?.(
          connectionId,
          target.openCodeSessionId,
          option,
          baseDirectory ?? undefined,
        );
      }

      window.api.sendPromptResponse({
        id: currentNode.prompt!.id,
        answer: option,
      });
    },
    [nodesRef, setNodes, selectChannel],
  );

  return {
    handleSubmit,
    handleSelectOption,
  };
}
