import { memo } from 'react';
import {
  SidebarGroup,
  SidebarGroupContent,
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
 * Renders under the "Channels" label in the new sidebar design.
 */
export const DirectConnectionsSection = memo(function DirectConnectionsSection({
  connections,
  activeConnectionId,
  onSelect,
}: DirectConnectionsSectionProps): React.ReactElement | null {
  if (connections.length === 0) return null;

  return (
    <SidebarGroup className="gap-0 p-0">
      <div className="section-label">Channels</div>
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
