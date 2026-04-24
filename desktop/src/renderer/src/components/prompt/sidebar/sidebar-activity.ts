import type { SessionNode } from '../../../types';

function isNodeRunning(node: SessionNode): boolean {
  return (
    node.hasPendingPrompt ||
    node.sessionStatuses.some((status) => status.type === 'working')
  );
}

export function filterVisibleSessionIds(
  nodes: SessionNode[],
  activeConnectionId: string | null,
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
      isNodeRunning(node) ||
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
