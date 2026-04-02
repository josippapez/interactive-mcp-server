import { memo } from 'react';
import type { ConnectionState } from '../../types';

type Props = {
  connections: Map<string, ConnectionState>;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
};

const ChannelSidebar = memo(function ChannelSidebar({
  connections,
  activeConnectionId,
  onSelect,
}: Props): React.ReactElement {
  const items = Array.from(connections.values());

  return (
    <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-y-auto">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
        Channels
      </div>
      <div className="px-2 pb-2 space-y-1">
        {items.map((conn) => {
          const isActive = conn.id === activeConnectionId;
          const label = conn.sessionChannel?.label ?? conn.name;
          return (
            <button
              key={conn.id}
              onClick={() => onSelect(conn.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-sm text-sm transition-colors ${
                isActive
                  ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
              }`}
            >
              <span className="text-[var(--color-text-faint)]">#</span>
              <span className="truncate flex-1">{label}</span>
              {conn.hasPendingPrompt && (
                <span className="w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse" />
              )}
              {!conn.hasPendingPrompt && conn.unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-user)]/15 text-[var(--color-user)]">
                  {conn.unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
});

export default ChannelSidebar;
