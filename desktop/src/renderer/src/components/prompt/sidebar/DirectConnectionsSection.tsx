import { memo } from 'react';
import type { SessionNode } from '../../../types';
import { ChannelItem } from './ChannelItem';

type DirectConnectionsSectionProps = {
  connections: SessionNode[];
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Section showing direct connections (non-project sessions).
 */
export const DirectConnectionsSection = memo(function DirectConnectionsSection({
  connections,
  activeConnectionId,
  onSelect,
}: DirectConnectionsSectionProps): React.ReactElement | null {
  if (connections.length === 0) return null;

  return (
    <section>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
        Direct Connections
      </div>
      <div className="px-2 pb-2 space-y-0.5">
        {connections.map((node) => (
          <ChannelItem
            key={node.id}
            node={node}
            isActive={node.id === activeConnectionId}
            onSelect={onSelect}
            sessionStatus={null}
          />
        ))}
      </div>
    </section>
  );
});
