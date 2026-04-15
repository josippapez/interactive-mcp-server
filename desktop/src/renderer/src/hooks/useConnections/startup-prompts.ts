import { useCallback, useEffect, useRef } from 'react';
import type { PromptData, SessionNode } from '../../types';
import { findKeyByConnectionId } from '../useIpcListeners';
import type { StartupPromptBuffer } from './types';

interface UseStartupPromptsOptions {
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
}

/**
 * Hook for recovering prompts that arrived while the renderer was restarting.
 * Also provides a callback to apply buffered prompts when nodes arrive late.
 */
export function useStartupPrompts({ setNodes }: UseStartupPromptsOptions) {
  const startupPromptBuffer = useRef<StartupPromptBuffer>(new Map());

  const ensureQuestionMessage = (node: SessionNode, promptData: PromptData) => {
    const hasQuestion = node.channelMessages.some(
      (message) =>
        message.kind === 'question' && message.text === promptData.message,
    );

    if (hasQuestion) {
      return node.channelMessages;
    }

    return [
      ...node.channelMessages,
      {
        id: `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: 'question' as const,
        text: promptData.message,
        timestamp: new Date(),
      },
    ];
  };

  // ---------------------------------------------------------------------------
  // Startup — recover any prompts that arrived while the renderer was restarting.
  // Main-process memory (activePrompts map) survives renderer restarts; we ask
  // for the live set on mount and inject them into matching nodes.
  // If a node doesn't exist yet, we buffer the prompt and apply it when the
  // node arrives via session-tree-updated.
  // ---------------------------------------------------------------------------

  const rehydrateActivePrompts = useCallback(async (): Promise<void> => {
    const activePrompts = await window.api.getActivePrompts?.();
    if (!activePrompts || activePrompts.length === 0) return;

    for (const promptData of activePrompts) {
      // Skip prompts that have already expired.
      if (promptData.expiresAt > 0 && Date.now() >= promptData.expiresAt) {
        continue;
      }

      setNodes((prev) => {
        // Use findKeyByConnectionId which prioritizes openCodeSessionId over
        // connectionId. This is critical for prompt recovery after app restart
        // where nodes may have null connectionId but still have openCodeSessionId.
        const nodeId = findKeyByConnectionId(
          prev,
          promptData.connectionId,
          promptData.openCodeSessionId,
        );
        if (!nodeId) {
          // Node not in map yet — buffer the prompt to apply when node arrives
          const bufferKey =
            promptData.openCodeSessionId ?? promptData.connectionId;
          startupPromptBuffer.current.set(bufferKey, promptData);
          return prev;
        }
        const node = prev.get(nodeId)!;
        // Don't overwrite a fresher prompt that's already in state.
        if (node.prompt && node.prompt.id !== promptData.id) return prev;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          prompt: promptData,
          hasPendingPrompt: true,
          baseDirectory: promptData.baseDirectory ?? node.baseDirectory,
          channelMessages: ensureQuestionMessage(node, promptData),
        });
        return next;
      });
    }
  }, [setNodes]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      await rehydrateActivePrompts();
      if (cancelled) {
        return;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rehydrateActivePrompts]);

  /**
   * Apply any buffered startup prompt for a given openCodeSessionId or connectionId.
   * Called when a new node arrives via session-tree-updated.
   */
  const applyStartupPromptBuffer = useCallback(
    (openCodeSessionId: string, connectionId: string | null) => {
      // Try to find a buffered prompt by openCodeSessionId first, then connectionId
      const bufferKey = openCodeSessionId;
      let buffered = startupPromptBuffer.current.get(bufferKey);
      if (!buffered && connectionId) {
        buffered = startupPromptBuffer.current.get(connectionId);
        if (buffered) {
          startupPromptBuffer.current.delete(connectionId);
        }
      } else if (buffered) {
        startupPromptBuffer.current.delete(bufferKey);
      }

      if (!buffered) return;

      // Skip if the prompt has expired
      if (buffered.expiresAt > 0 && Date.now() >= buffered.expiresAt) {
        return;
      }

      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          buffered.connectionId,
          buffered.openCodeSessionId,
        );
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        // Don't overwrite a fresher prompt that's already in state.
        if (node.prompt && node.prompt.id !== buffered.id) return prev;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          prompt: buffered,
          hasPendingPrompt: true,
          baseDirectory: buffered.baseDirectory ?? node.baseDirectory,
          channelMessages: ensureQuestionMessage(node, buffered),
        });
        return next;
      });
    },
    [setNodes],
  );

  /**
   * Buffer a prompt for later application when its target node arrives.
   * Called by usePromptHandlers when a real-time prompt arrives but no
   * matching node exists yet (timing race between prompt and session-tree-updated).
   */
  const bufferPrompt = useCallback((promptData: PromptData) => {
    const bufferKey = promptData.openCodeSessionId ?? promptData.connectionId;
    window.api.log(
      'info',
      'prompt-routing',
      `[bufferPrompt] Buffering prompt until node arrives: bufferKey=${bufferKey} promptId=${promptData.id}`,
    );
    startupPromptBuffer.current.set(bufferKey, promptData);
  }, []);

  return {
    applyStartupPromptBuffer,
    bufferPrompt,
    rehydrateActivePrompts,
  };
}
