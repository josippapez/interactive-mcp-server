import { memo, useState } from 'react';
import type { SessionNode, SessionStatus } from '../../types';
import { partitionNodes } from '../../hooks/session-tree-merge';

type Props = {
  connections: Map<string, SessionNode>;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
};

const STATUS_DOT_CLASSES: Record<string, string> = {
  working: 'bg-[var(--color-user)] animate-pulse',
  success: 'bg-[var(--color-success)]',
  error: 'bg-[var(--color-error)]',
  info: 'bg-[var(--color-agent)]',
};

function StatusDot({
  sessionStatuses,
}: {
  sessionStatuses: SessionStatus[];
}): React.ReactElement | null {
  const latest = sessionStatuses.at(-1);
  if (!latest) return null;

  const dotClass = STATUS_DOT_CLASSES[latest.type] ?? STATUS_DOT_CLASSES.info;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
      title={latest.status}
    />
  );
}

const ChannelSidebar = memo(function ChannelSidebar({
  connections,
  activeConnectionId,
  onSelect,
}: Props): React.ReactElement {
  const { openCodeTree, directConnections } = partitionNodes(connections);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh(): Promise<void> {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await window.api.refreshSessionTree();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-y-auto flex flex-col">
      <section>
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Sessions
          </span>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh sessions"
            className="p-0.5 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isRefreshing ? 'animate-spin' : ''}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
        {openCodeTree.length === 0 && (
          <p className="px-4 py-1 text-xs text-[var(--color-text-faint)] italic">
            No sessions yet
          </p>
        )}
        {openCodeTree.length > 0 && (
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
        )}
      </section>

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
      {!isActive && !node.hasPendingPrompt && node.unreadCount === 0 && (
        <StatusDot sessionStatuses={node.sessionStatuses} />
      )}
    </button>
  );
}

export default ChannelSidebar;
