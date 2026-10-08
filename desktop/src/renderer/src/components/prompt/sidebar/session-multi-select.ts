import type { SessionNode } from '../../../types';

export type SessionSelectionInput = {
  current: Set<string>;
  clickedId: string;
  visibleIds: string[];
  anchorId: string | null;
  shiftKey: boolean;
  toggleKey: boolean;
};

export function resolveSessionSelection({
  current,
  clickedId,
  visibleIds,
  anchorId,
  shiftKey,
  toggleKey,
}: SessionSelectionInput): { selectedIds: Set<string>; anchorId: string } {
  if (shiftKey && anchorId && visibleIds.includes(anchorId)) {
    const clickedIndex = visibleIds.indexOf(clickedId);
    const anchorIndex = visibleIds.indexOf(anchorId);
    if (clickedIndex >= 0 && anchorIndex >= 0) {
      const start = Math.min(clickedIndex, anchorIndex);
      const end = Math.max(clickedIndex, anchorIndex);
      const selectedIds = new Set(current);
      for (const id of visibleIds.slice(start, end + 1)) {
        selectedIds.add(id);
      }
      return { selectedIds, anchorId };
    }
  }

  if (toggleKey) {
    const selectedIds = new Set(current);
    if (selectedIds.has(clickedId)) {
      selectedIds.delete(clickedId);
    } else {
      selectedIds.add(clickedId);
    }
    return { selectedIds, anchorId: clickedId };
  }

  return { selectedIds: new Set(), anchorId: clickedId };
}

export function getVisibleSessionIds(
  projects: Array<{ sessions: SessionNode[] }>,
  collapsedSessions: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const project of projects) {
    for (const node of project.sessions) {
      if (
        isHiddenByCollapsedAncestor(node, project.sessions, collapsedSessions)
      ) {
        continue;
      }
      if (node.providerSessionId) ids.push(node.providerSessionId);
    }
  }
  return ids;
}

export function getBulkArchiveSessionIds(
  nodes: Map<string, SessionNode>,
  selectedIds: Set<string>,
  clickedId: string,
): string[] {
  const candidates = selectedIds.has(clickedId)
    ? Array.from(selectedIds)
    : [clickedId];
  const selected = new Set(candidates);

  return candidates.filter((id) => {
    let parentId = nodes.get(id)?.openCodeParentId ?? null;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = nodes.get(parentId)?.openCodeParentId ?? null;
    }
    return true;
  });
}

function isHiddenByCollapsedAncestor(
  node: SessionNode,
  projectSessions: SessionNode[],
  collapsedSessions: Set<string>,
): boolean {
  let parentId = node.openCodeParentId;
  while (parentId) {
    if (collapsedSessions.has(parentId)) return true;
    const parent = projectSessions.find(
      (s) => s.providerSessionId === parentId,
    );
    parentId = parent?.openCodeParentId ?? null;
  }
  return false;
}
