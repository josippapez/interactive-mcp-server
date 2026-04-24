import { memo } from 'react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
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
    <SidebarGroup className="gap-0 p-0">
      <SidebarGroupLabel className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
        Direct Connections
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2 pb-2">
          {connections.map((node) => (
            <ChannelItem
              key={node.id}
              node={node}
              isActive={node.id === activeConnectionId}
              onSelect={onSelect}
              sessionStatus={null}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
