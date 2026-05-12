import type { SessionNode } from '../../../types';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';

function isNodeRunning(
  node: SessionNode,
  getStatus?: (sessionId: string) => SessionStatusType | null,
): boolean {
  const providerStatus = getStatus?.(node.providerSessionId ?? '');
  if (providerStatus === 'idle' || providerStatus === 'error') {
    return node.hasPendingPrompt;
  }
  return (
    node.hasPendingPrompt ||
    providerStatus === 'busy' ||
    node.sessionStatuses.some((status) => status.type === 'working')
  );
}

export function filterVisibleSessionIds(
  nodes: SessionNode[],
  activeConnectionId: string | null,
  getStatus?: (sessionId: string) => SessionStatusType | null,
): string[] {
  const byParentKey = new Map<string, SessionNode>();
  for (const node of nodes) {
    byParentKey.set(node.id, node);
    if (node.providerSessionId) {
      byParentKey.set(node.providerSessionId, node);
    }
  }

  const visibleIds = new Set<string>();

  for (const node of nodes) {
    if (
      node.id === activeConnectionId ||
      isNodeRunning(node, getStatus) ||
      node.unreadCount > 0
    ) {
      visibleIds.add(node.id);

      let parentId = node.openCodeParentId;
      while (parentId) {
        visibleIds.add(parentId);
        const parent = byParentKey.get(parentId);
        parentId = parent?.openCodeParentId ?? null;
      }
    }
  }

  return nodes
    .filter(
      (node) =>
        visibleIds.has(node.id) || visibleIds.has(node.providerSessionId ?? ''),
    )
    .map((node) => node.id);
}
