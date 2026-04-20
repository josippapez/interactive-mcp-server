import type { PendingQuestion } from '../../types';
import type { HandlerContext } from './types';
import { findKeyByConnectionId } from './helpers';

/**
 * Registers IPC listeners for question-related events.
 * Handles: onQuestionAsked, onQuestionCleared
 *
 * Returns a disposer that removes every listener registered here.
 */
export function useQuestionHandlers({
  setNodes,
  bufferQuestion,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  disposers.push(
    window.api.onQuestionAsked?.((data) => {
      setNodes((prev) => {
        const question: PendingQuestion = {
          requestId: data.requestId,
          sessionID: data.sessionID,
          questions: data.questions,
          tool: data.tool,
        };

        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (!nodeId) {
          bufferQuestion(question);
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
    }),
  );

  disposers.push(
    window.api.onQuestionCleared?.((data) => {
      setNodes((prev) => {
        let nodeId: string | null = null;
        for (const [id, node] of prev) {
          if (
            node.pendingQuestions.some((q) => q.requestId === data.requestId)
          ) {
            nodeId = id;
            break;
          }
        }
        if (!nodeId) return prev;

        const node = prev.get(nodeId)!;
        const nextQuestions = node.pendingQuestions.filter(
          (q) => q.requestId !== data.requestId,
        );

        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingQuestions: nextQuestions,
          hasPendingPrompt: nextQuestions.length > 0 || node.prompt !== null,
        });
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
