import { useCallback, useEffect, useRef } from 'react';
import type {
  PendingPermission,
  PendingQuestion,
  PromptData,
  SessionNode,
} from '../../types';
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
  const startupPermissionBuffer = useRef<Map<string, PendingPermission[]>>(
    new Map(),
  );
  const startupQuestionBuffer = useRef<Map<string, PendingQuestion[]>>(
    new Map(),
  );

  const ensureQuestionMessage = useCallback(
    (node: SessionNode, promptData: PromptData) => {
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
    },
    [],
  );

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
        // Use findKeyByConnectionId which prioritizes providerSessionId over
        // connectionId. This is critical for prompt recovery after app restart
        // where nodes may have null connectionId but still have providerSessionId.
        const nodeId = findKeyByConnectionId(
          prev,
          promptData.connectionId,
          promptData.providerSessionId,
        );
        if (!nodeId) {
          // Node not in map yet — buffer the prompt to apply when node arrives
          const bufferKey =
            promptData.providerSessionId ?? promptData.connectionId;
          if (bufferKey) {
            startupPromptBuffer.current.set(bufferKey, promptData);
          }
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
  }, [ensureQuestionMessage, setNodes]);

  const rehydratePendingPermissions = useCallback(async (): Promise<void> => {
    const pendingPermissions = await window.api.getPendingPermissions?.();
    if (!pendingPermissions || pendingPermissions.length === 0) return;

    for (const pendingPermission of pendingPermissions) {
      const permission: PendingPermission = {
        requestId: pendingPermission.requestId,
        sessionID: pendingPermission.sessionID,
        permission: pendingPermission.permission,
        patterns: pendingPermission.patterns,
        always: pendingPermission.always,
        tool: pendingPermission.tool,
        metadata: pendingPermission.metadata,
      };

      setNodes((prev) => {
        // Permissions are OpenCode-specific; sessionID IS the providerSessionId,
        // which is the nodes-map key after Phase 6. Direct lookup avoids the
        // shared-connectionId ambiguity between OC parent + children.
        const nodeId = prev.has(pendingPermission.sessionID)
          ? pendingPermission.sessionID
          : null;
        if (!nodeId) {
          const buffered =
            startupPermissionBuffer.current.get(pendingPermission.sessionID) ??
            [];
          if (
            !buffered.some((item) => item.requestId === permission.requestId)
          ) {
            startupPermissionBuffer.current.set(pendingPermission.sessionID, [
              ...buffered,
              permission,
            ]);
          }
          return prev;
        }

        const node = prev.get(nodeId)!;
        if (
          node.pendingPermissions.some(
            (item) => item.requestId === permission.requestId,
          )
        ) {
          return prev;
        }

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingPermissions: [...node.pendingPermissions, permission],
        });
        return next;
      });
    }
  }, [setNodes]);

  const rehydratePendingQuestions = useCallback(async (): Promise<void> => {
    const pendingQuestions = await window.api.getPendingQuestions?.();
    if (!pendingQuestions || pendingQuestions.length === 0) return;

    for (const pendingQuestion of pendingQuestions) {
      const question: PendingQuestion = {
        requestId: pendingQuestion.requestId,
        sessionID: pendingQuestion.sessionID,
        questions: pendingQuestion.questions,
        tool: pendingQuestion.tool,
      };

      setNodes((prev) => {
        // Questions are OpenCode-specific; sessionID IS the providerSessionId,
        // which is the nodes-map key after Phase 6. Direct lookup avoids the
        // shared-connectionId ambiguity between OC parent + children.
        const nodeId = prev.has(pendingQuestion.sessionID)
          ? pendingQuestion.sessionID
          : null;
        if (!nodeId) {
          const buffered =
            startupQuestionBuffer.current.get(pendingQuestion.sessionID) ?? [];
          if (!buffered.some((item) => item.requestId === question.requestId)) {
            startupQuestionBuffer.current.set(pendingQuestion.sessionID, [
              ...buffered,
              question,
            ]);
          }
          return prev;
        }

        const node = prev.get(nodeId)!;
        if (
          node.pendingQuestions.some(
            (item) => item.requestId === question.requestId,
          )
        ) {
          return prev;
        }

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingQuestions: [...node.pendingQuestions, question],
          hasPendingPrompt: true,
        });
        return next;
      });
    }
  }, [setNodes]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      await rehydrateActivePrompts();
      await rehydratePendingPermissions();
      await rehydratePendingQuestions();
      if (cancelled) {
        return;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    rehydrateActivePrompts,
    rehydratePendingPermissions,
    rehydratePendingQuestions,
  ]);

  /**
   * Apply any buffered startup prompt for a given providerSessionId or connectionId.
   * Called when a new node arrives via session-tree-updated.
   */
  const applyStartupPromptBuffer = useCallback(
    (providerSessionId: string, connectionId: string | null) => {
      // Try to find a buffered prompt by providerSessionId first, then connectionId
      const bufferKey = providerSessionId;
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
          buffered.providerSessionId,
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
    [ensureQuestionMessage, setNodes],
  );

  const applyStartupPermissionBuffer = useCallback(
    (providerSessionId: string, connectionId: string | null) => {
      let buffered = startupPermissionBuffer.current.get(providerSessionId);
      if (!buffered && connectionId) {
        buffered = startupPermissionBuffer.current.get(connectionId);
        if (buffered) {
          startupPermissionBuffer.current.delete(connectionId);
        }
      } else if (buffered) {
        startupPermissionBuffer.current.delete(providerSessionId);
      }

      if (!buffered) return;

      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          connectionId ?? providerSessionId,
          providerSessionId,
        );
        if (!nodeId) return prev;

        const node = prev.get(nodeId)!;
        const incoming = buffered.filter(
          (permission) =>
            !node.pendingPermissions.some(
              (item) => item.requestId === permission.requestId,
            ),
        );
        if (incoming.length === 0) return prev;

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingPermissions: [...node.pendingPermissions, ...incoming],
        });
        return next;
      });
    },
    [setNodes],
  );

  const applyStartupQuestionBuffer = useCallback(
    (providerSessionId: string, connectionId: string | null) => {
      let buffered = startupQuestionBuffer.current.get(providerSessionId);
      if (!buffered && connectionId) {
        buffered = startupQuestionBuffer.current.get(connectionId);
        if (buffered) {
          startupQuestionBuffer.current.delete(connectionId);
        }
      } else if (buffered) {
        startupQuestionBuffer.current.delete(providerSessionId);
      }

      if (!buffered) return;

      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          connectionId ?? providerSessionId,
          providerSessionId,
        );
        if (!nodeId) return prev;

        const node = prev.get(nodeId)!;
        const incoming = buffered.filter(
          (question) =>
            !node.pendingQuestions.some(
              (item) => item.requestId === question.requestId,
            ),
        );
        if (incoming.length === 0) return prev;

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingQuestions: [...node.pendingQuestions, ...incoming],
          hasPendingPrompt: true,
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
    const bufferKey = promptData.providerSessionId ?? promptData.connectionId;
    window.api.log(
      'info',
      'prompt-routing',
      `[bufferPrompt] Buffering prompt until node arrives: bufferKey=${bufferKey ?? '<none>'} promptId=${promptData.id}`,
    );
    if (!bufferKey) return;
    startupPromptBuffer.current.set(bufferKey, promptData);
  }, []);

  const bufferPermission = useCallback((permission: PendingPermission) => {
    const bufferKey = permission.sessionID;
    const buffered = startupPermissionBuffer.current.get(bufferKey) ?? [];
    if (buffered.some((item) => item.requestId === permission.requestId)) {
      return;
    }
    startupPermissionBuffer.current.set(bufferKey, [...buffered, permission]);
  }, []);

  const bufferQuestion = useCallback((question: PendingQuestion) => {
    const bufferKey = question.sessionID;
    const buffered = startupQuestionBuffer.current.get(bufferKey) ?? [];
    if (buffered.some((item) => item.requestId === question.requestId)) {
      return;
    }
    startupQuestionBuffer.current.set(bufferKey, [...buffered, question]);
  }, []);

  return {
    applyStartupPromptBuffer,
    applyStartupPermissionBuffer,
    applyStartupQuestionBuffer,
    bufferPrompt,
    bufferPermission,
    bufferQuestion,
    rehydrateActivePrompts,
    rehydratePendingPermissions,
    rehydratePendingQuestions,
  };
}
