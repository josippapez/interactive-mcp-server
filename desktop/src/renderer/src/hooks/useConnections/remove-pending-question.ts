import type { SessionNode } from '../../types';

/**
 * Pure helper that removes a pending question (by requestId) from whichever
 * node currently holds it. Returns the same Map reference when no node
 * contains the question so that React can bail out of a re-render.
 *
 * Used as a local clear-on-success fallback in case the OpenCode server's
 * `question.replied` / `question.rejected` SSE event does not arrive or is
 * delivered after the user has already navigated away.
 */
export function removePendingQuestion(
  prev: Map<string, SessionNode>,
  requestId: string,
): Map<string, SessionNode> {
  let targetNodeId: string | null = null;
  for (const [id, node] of prev) {
    if (node.pendingQuestions.some((q) => q.requestId === requestId)) {
      targetNodeId = id;
      break;
    }
  }
  if (!targetNodeId) return prev;

  const node = prev.get(targetNodeId)!;
  const nextQuestions = node.pendingQuestions.filter(
    (q) => q.requestId !== requestId,
  );

  const next = new Map(prev);
  next.set(targetNodeId, {
    ...node,
    pendingQuestions: nextQuestions,
    hasPendingPrompt: nextQuestions.length > 0 || node.prompt !== null,
  });
  return next;
}
