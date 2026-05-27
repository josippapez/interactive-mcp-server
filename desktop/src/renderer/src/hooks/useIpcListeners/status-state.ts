import type { SessionNode, SessionStatus } from '../../types';

export const MAX_SESSION_STATUSES = 100;

export function trimSessionStatuses(
  statuses: readonly SessionStatus[],
): SessionStatus[] {
  if (statuses.length <= MAX_SESSION_STATUSES) return [...statuses];
  return statuses.slice(statuses.length - MAX_SESSION_STATUSES);
}

export function clearTerminalSessionState(
  prev: Map<string, SessionNode>,
  nodeId: string,
): Map<string, SessionNode> {
  const node = prev.get(nodeId);
  if (!node) return prev;

  const filteredStatuses = trimSessionStatuses(
    node.sessionStatuses.filter((status) => status.type !== 'working'),
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
