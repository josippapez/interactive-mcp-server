import { memo } from 'react';
import type { SessionNode } from '../../types';

type Props = {
  connections: Map<string, SessionNode>;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Builds a depth-ordered list of OpenCode session nodes rooted at the given
 * parentId, recursing into children.
 */
function collectSubtree(
  nodes: SessionNode[],
  parentId: string | null,
  depth: number,
): SessionNode[] {
  const children = nodes
    .filter((n) => n.openCodeParentId === parentId && !n.isDirectConnection)
    .sort((a, b) => a.title.localeCompare(b.title));

  const result: SessionNode[] = [];
  for (const child of children) {
    result.push({ ...child, depth });
    result.push(...collectSubtree(nodes, child.openCodeSessionId, depth + 1));
  }
  return result;
}

/**
 * Returns two ordered lists:
 * - `openCodeTree`: root OpenCode sessions with their subagents interleaved
 *   in depth-first order.
 * - `directConnections`: MCP agents with no associated OpenCode session.
 */
function partitionNodes(nodes: Map<string, SessionNode>): {
  openCodeTree: SessionNode[];
  directConnections: SessionNode[];
} {
  const all = Array.from(nodes.values());
  const directConnections = all.filter((n) => n.isDirectConnection);

  const ocNodes = all.filter((n) => !n.isDirectConnection);
  const roots = ocNodes.filter((n) => n.openCodeParentId === null);

  const openCodeTree: SessionNode[] = [];
  for (const root of roots) {
    openCodeTree.push({ ...root, depth: 0 });
    openCodeTree.push(...collectSubtree(ocNodes, root.openCodeSessionId, 1));
  }

  return { openCodeTree, directConnections };
}

const ChannelSidebar = memo(function ChannelSidebar({
  connections,
  activeConnectionId,
  onSelect,
}: Props): React.ReactElement {
  const { openCodeTree, directConnections } = partitionNodes(connections);
  const hasAny = openCodeTree.length > 0 || directConnections.length > 0;

  return (
    <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-y-auto flex flex-col">
      {!hasAny && (
        <p className="px-4 py-3 text-xs text-[var(--color-text-faint)] italic">
          No channels yet
        </p>
      )}

      {openCodeTree.length > 0 && (
        <section>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Sessions
          </div>
          <div className="px-2 pb-2 space-y-0.5">
            {openCodeTree.map((node) => (
              <ChannelItem
                key={node.id}
                node={node}
                isActive={node.id === activeConnectionId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}

      {directConnections.length > 0 && (
        <section>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Direct Connections
          </div>
          <div className="px-2 pb-2 space-y-0.5">
            {directConnections.map((node) => (
              <ChannelItem
                key={node.id}
                node={node}
                isActive={node.id === activeConnectionId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}
    </aside>
  );
});

function ChannelItem({
  node,
  isActive,
  onSelect,
}: {
  node: SessionNode;
  isActive: boolean;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const label = node.sessionChannel?.label ?? node.title;
  const depth = node.depth ?? 0;
  const isChild = depth > 0;
  const isDeepChild = depth > 1;

  const indentPx = depth * 12;

  return (
    <button
      onClick={() => onSelect(node.id)}
      style={{ paddingLeft: `${8 + indentPx}px` }}
      className={`w-full flex items-center gap-2 pr-2 py-1.5 text-left rounded-sm transition-colors ${
        isChild ? 'text-xs' : 'text-sm'
      } ${
        isActive
          ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
      }`}
    >
      {isDeepChild ? (
        <span className="text-[var(--color-text-faint)] shrink-0">↳</span>
      ) : isChild ? (
        <span className="text-[var(--color-text-faint)] shrink-0">↳</span>
      ) : (
        <span className="text-[var(--color-text-faint)] shrink-0">
          {node.isDirectConnection ? '⬡' : '#'}
        </span>
      )}
      <span className="truncate flex-1">{label}</span>
      {node.hasPendingPrompt && (
        <span className="w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse shrink-0" />
      )}
      {!node.hasPendingPrompt && node.unreadCount > 0 && (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-user)]/15 text-[var(--color-user)] shrink-0">
          {node.unreadCount}
        </span>
      )}
    </button>
  );
}

export default ChannelSidebar;
