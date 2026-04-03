import { memo } from 'react';
import type { ConnectionState } from '../../types';

type Props = {
  connections: Map<string, ConnectionState>;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
};

/** A flat connection + its resolved children in display order. */
interface TreeNode {
  conn: ConnectionState;
  children: ConnectionState[];
}

/**
 * Build a parent-first tree from the flat connections map.
 *
 * A connection is treated as a child of another connection when its
 * `parentSessionId` matches the parent's `openCodeSessionId`.
 *
 * Connections with no parent (or an unresolved parent) appear at the top level.
 */
function buildTree(connections: Map<string, ConnectionState>): TreeNode[] {
  const items = Array.from(connections.values());

  // Index: openCodeSessionId → connectionId
  const byOpenCodeId = new Map<string, string>();
  for (const conn of items) {
    if (conn.openCodeSessionId) {
      byOpenCodeId.set(conn.openCodeSessionId, conn.id);
    }
  }

  const childIds = new Set<string>();
  const parentToChildren = new Map<string, ConnectionState[]>();

  for (const conn of items) {
    if (!conn.parentSessionId) continue;
    const parentConnId = byOpenCodeId.get(conn.parentSessionId);
    if (!parentConnId) continue; // parent not registered in app yet
    childIds.add(conn.id);
    const siblings = parentToChildren.get(parentConnId) ?? [];
    siblings.push(conn);
    parentToChildren.set(parentConnId, siblings);
  }

  const roots: TreeNode[] = [];
  for (const conn of items) {
    if (childIds.has(conn.id)) continue; // rendered under parent
    roots.push({
      conn,
      children: parentToChildren.get(conn.id) ?? [],
    });
  }

  return roots;
}

const ChannelSidebar = memo(function ChannelSidebar({
  connections,
  activeConnectionId,
  onSelect,
}: Props): React.ReactElement {
  const tree = buildTree(connections);

  return (
    <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-y-auto flex flex-col">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
        Channels
      </div>
      <div className="px-2 pb-2 space-y-1 flex-1">
        {tree.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-[var(--color-text-faint)] italic">
            No channels yet
          </p>
        )}
        {tree.map(({ conn, children }) => (
          <div key={conn.id}>
            <ChannelItem
              conn={conn}
              isActive={conn.id === activeConnectionId}
              onSelect={onSelect}
            />
            {children.length > 0 && (
              <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--color-border)] pl-2">
                {children.map((child) => (
                  <ChannelItem
                    key={child.id}
                    conn={child}
                    isActive={child.id === activeConnectionId}
                    onSelect={onSelect}
                    isChild
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
});

function ChannelItem({
  conn,
  isActive,
  onSelect,
  isChild = false,
}: {
  conn: ConnectionState;
  isActive: boolean;
  onSelect: (id: string) => void;
  isChild?: boolean;
}): React.ReactElement {
  const label = conn.sessionChannel?.label ?? conn.name;
  return (
    <button
      onClick={() => onSelect(conn.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-sm transition-colors ${
        isChild ? 'text-xs' : 'text-sm'
      } ${
        isActive
          ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
          : conn.isPlaceholder
            ? 'text-[var(--color-text-faint)] hover:bg-[var(--color-border)] italic cursor-default'
            : conn.isRestored
              ? 'text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-muted)] italic'
              : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
      }`}
    >
      <span
        className={`${(conn.isRestored || conn.isPlaceholder) && !isActive ? 'opacity-40' : ''} text-[var(--color-text-faint)] shrink-0`}
      >
        {isChild ? '↳' : '#'}
      </span>
      <span className="truncate flex-1">{label}</span>
      {conn.isPlaceholder && !isActive && (
        <span className="w-2 h-2 rounded-full bg-[var(--color-text-faint)] animate-pulse shrink-0" />
      )}
      {conn.isRestored && !conn.isPlaceholder && !isActive && (
        <span className="text-[9px] text-[var(--color-text-faint)] shrink-0 not-italic">
          ↺
        </span>
      )}
      {conn.hasPendingPrompt && (
        <span className="w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse shrink-0" />
      )}
      {!conn.hasPendingPrompt && conn.unreadCount > 0 && (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-user)]/15 text-[var(--color-user)] shrink-0">
          {conn.unreadCount}
        </span>
      )}
    </button>
  );
}

export default ChannelSidebar;
