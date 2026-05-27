import type { SessionNode } from '../../types';

export type BackgroundSubagentDisplay = {
  id: string;
  title: string;
  status: 'running' | 'ended';
  depth: number;
  createdAt?: number;
  model: string | null;
  variant: string | null;
  isStalled: boolean;
};

const STALLED_AFTER_MS = 10 * 60_000;

export function countRunningBackgroundSubagents(
  subagents: BackgroundSubagentDisplay[],
): number {
  return subagents.filter((subagent) => subagent.status === 'running').length;
}

export function isSubagentStalled(
  status: BackgroundSubagentDisplay['status'],
  createdAt: number | undefined,
  nowMs = Date.now(),
): boolean {
  return (
    status === 'running' &&
    typeof createdAt === 'number' &&
    nowMs - createdAt >= STALLED_AFTER_MS
  );
}

export function deriveBackgroundSubagents(
  nodes: Map<string, SessionNode>,
  parentSessionId: string | null,
): BackgroundSubagentDisplay[] {
  if (!parentSessionId) return [];
  return [...nodes.values()]
    .filter(
      (node) =>
        node.providerType === 'opencode' &&
        node.openCodeParentId === parentSessionId &&
        node.providerSessionId !== null,
    )
    .map((node) => {
      const status = node.sessionStatuses.some(
        (entry) => entry.type === 'working',
      )
        ? ('running' as const)
        : ('ended' as const);
      return {
        id: node.providerSessionId as string,
        title: node.title,
        status,
        depth: node.depth,
        createdAt: node.createdAt,
        model: null,
        variant: null,
        isStalled: isSubagentStalled(status, node.createdAt),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
