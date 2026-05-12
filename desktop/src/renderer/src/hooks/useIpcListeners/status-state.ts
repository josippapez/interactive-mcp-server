import type { SessionNode } from '../../types';

export function clearTerminalSessionState(
  prev: Map<string, SessionNode>,
  nodeId: string,
): Map<string, SessionNode> {
  const node = prev.get(nodeId);
  if (!node) return prev;

  const filteredStatuses = node.sessionStatuses.filter(
    (status) => status.type !== 'working',
  );
  if (
    filteredStatuses.length === node.sessionStatuses.length &&
    node.pendingQuestions.length === 0
  ) {
    return prev;
  }

  const next = new Map(prev);
  next.set(nodeId, {
    ...node,
    sessionStatuses: filteredStatuses,
    pendingQuestions: [],
    hasPendingPrompt: node.prompt !== null,
  });
  return next;
}
