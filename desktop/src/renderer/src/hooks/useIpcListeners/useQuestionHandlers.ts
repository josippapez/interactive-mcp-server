import type { PendingQuestion } from '../../types';
import type { HandlerContext } from './types';
import { findKeyByConnectionId } from './helpers';

/**
 * Registers IPC listeners for question-related events.
 *
 * Consumes the unified `conversation-batch` stream. The legacy dedicated
 * `question-asked` / `question-cleared` IPC channels were never emitted
 * from the main process after the C6 streaming rewrite; question events
 * now flow as `ConversationEvent` variants (`question.asked` /
 * `question.cleared`) mapped in `event-bridge.ts::bridgeEvent`.
 *
 * Returns a disposer that removes every listener registered here.
 */
export function useQuestionHandlers({
  setNodes,
  bufferQuestion,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  const applyQuestionAsked = (
    requestId: string,
    sessionId: string,
    questions: PendingQuestion['questions'],
    tool: PendingQuestion['tool'],
  ): void => {
    setNodes((prev) => {
      const question: PendingQuestion = {
        requestId,
        sessionID: sessionId,
        questions,
        tool,
      };

      const nodeId = findKeyByConnectionId(prev, null, sessionId);
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
  };

  const applyQuestionCleared = (requestId: string): void => {
    setNodes((prev) => {
      let nodeId: string | null = null;
      for (const [id, node] of prev) {
        if (node.pendingQuestions.some((q) => q.requestId === requestId)) {
          nodeId = id;
          break;
        }
      }
      if (!nodeId) return prev;

      const node = prev.get(nodeId)!;
      const nextQuestions = node.pendingQuestions.filter(
        (q) => q.requestId !== requestId,
      );

      const next = new Map(prev);
      next.set(nodeId, {
        ...node,
        pendingQuestions: nextQuestions,
        hasPendingPrompt: nextQuestions.length > 0 || node.prompt !== null,
      });
      return next;
    });
  };

  disposers.push(
    window.api.onQuestionAsked?.((data) => {
      applyQuestionAsked(
        data.requestId,
        data.sessionID,
        data.questions,
        data.tool,
      );
    }),
  );

  disposers.push(
    window.api.onQuestionCleared?.((data) => {
      applyQuestionCleared(data.requestId);
    }),
  );

  disposers.push(
    window.api.onConversationBatch?.((batch) => {
      for (const evt of batch.events) {
        if (evt.type === 'question.asked') {
          applyQuestionAsked(
            evt.requestId,
            evt.sessionId,
            evt.questions,
            evt.tool,
          );
          continue;
        }

        if (evt.type === 'question.cleared') {
          applyQuestionCleared(evt.requestId);
          continue;
        }
      }
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
