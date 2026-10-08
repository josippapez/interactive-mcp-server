import type { SessionNode } from '../../../types';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';

export function filterVisibleSessionIds(
  nodes: SessionNode[],
  _activeConnectionId: string | null,
  _getStatus?: (sessionId: string) => SessionStatusType | null,
): string[] {
  return nodes.map((node) => node.id);
}
