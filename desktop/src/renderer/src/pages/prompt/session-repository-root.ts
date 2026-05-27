import type { SessionNode } from '../../types';

export function resolveSessionRepositoryRoot(
  activeNode: SessionNode | null,
  connections: Map<string, SessionNode>,
): string | null {
  if (!activeNode) return null;
  const ownRoot = activeNode.baseDirectory ?? activeNode.directory ?? null;
  if (ownRoot && ownRoot !== 'Unknown') return ownRoot;

  let parentId = activeNode.openCodeParentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = findNodeByProviderSessionId(connections, parentId);
    if (!parent) break;
    const parentRoot = parent.baseDirectory ?? parent.directory ?? null;
    if (parentRoot && parentRoot !== 'Unknown') return parentRoot;
    parentId = parent.openCodeParentId;
  }

  return null;
}

function findNodeByProviderSessionId(
  connections: Map<string, SessionNode>,
  providerSessionId: string,
): SessionNode | null {
  for (const node of connections.values()) {
    if (node.providerSessionId === providerSessionId) return node;
  }
  return null;
}
