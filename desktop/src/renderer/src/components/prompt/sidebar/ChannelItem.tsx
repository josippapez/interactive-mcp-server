import { memo } from 'react';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import type { SessionNode } from '../../../types';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import {
  StatusDot,
  SessionStatusBadge,
  ProviderBadge,
} from './StatusIndicators';

type ChannelItemProps = {
  node: SessionNode;
  isActive: boolean;
  onSelect: (id: string) => void;
  sessionStatus: SessionStatusType | null;
  hasChildren?: boolean;
  isSessionCollapsed?: boolean;
  onToggleCollapse?: () => void;
  showStartTime?: boolean;
};

function formatStartTime(createdAt?: number): string {
  if (!createdAt || createdAt <= 0) return '';

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(createdAt));
}

/**
 * Memoized channel item component to prevent unnecessary re-renders when
 * other channels update but this specific item hasn't changed.
 */
export const ChannelItem = memo(function ChannelItem({
  node,
  isActive,
  onSelect,
  sessionStatus,
  hasChildren = false,
  isSessionCollapsed = false,
  onToggleCollapse,
  showStartTime = false,
}: ChannelItemProps): React.ReactElement {
  const label = node.sessionChannel?.label ?? node.title;
  const depth = node.depth ?? 0;
  const isChild = depth > 0;
  const isDeepChild = depth > 1;

  const indentPx = depth * 12;

  const showPendingPrompt = node.hasPendingPrompt;
  const showUnread = !showPendingPrompt && node.unreadCount > 0;
  const showBusy =
    !showPendingPrompt && !showUnread && sessionStatus === 'busy';
  const showLegacyStatus =
    !showPendingPrompt && !showUnread && !showBusy && !isActive;

  const isRunning =
    showPendingPrompt ||
    sessionStatus === 'busy' ||
    node.sessionStatuses.some((s) => s.type === 'working');

  const startTimeLabel = showStartTime ? formatStartTime(node.createdAt) : '';

  return (
    <div className="group anim-channel-item flex min-w-0 items-center">
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
          style={{ marginLeft: `${indentPx}px` }}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-text-muted)]"
          aria-label={
            isSessionCollapsed ? 'Expand children' : 'Collapse children'
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-150 ${
              isSessionCollapsed ? '' : 'rotate-90'
            }`}
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      ) : (
        <div
          style={{
            marginLeft: `${indentPx}px`,
            width: '8px',
          }}
        />
      )}

      <SidebarMenuButton
        asChild
        isActive={isActive}
        className={`h-auto min-w-0 flex-1 rounded-lg px-2.5 py-2 pr-2 ${
          isChild ? 'text-xs' : 'text-sm'
        } ${
          showPendingPrompt
            ? 'bg-[var(--color-user)]/15 text-[var(--color-user)] font-medium ring-1 ring-[var(--color-user)]/30'
            : isActive
              ? 'bg-[var(--color-agent)]/12 text-[var(--color-agent)] ring-1 ring-[var(--color-agent)]/12'
              : isRunning
                ? 'font-medium text-[var(--color-text)] hover:bg-[var(--color-border)]/75'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/75 hover:text-[var(--color-text)]'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 w-full items-center gap-2 overflow-hidden"
        >
          {isDeepChild || isChild ? (
            <span className="shrink-0 text-[var(--color-text-faint)]">↳</span>
          ) : (
            <ProviderBadge providerType={node.providerType} />
          )}
          <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {label}
          </span>
          {showPendingPrompt && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-user)] animate-pulse" />
          )}
          {showUnread && (
            <span className="shrink-0 rounded-full bg-[var(--color-user)]/15 px-1.5 py-0.5 text-[10px] text-[var(--color-user)]">
              {node.unreadCount}
            </span>
          )}
          {showBusy && <SessionStatusBadge status={sessionStatus} />}
          {showLegacyStatus && (
            <StatusDot sessionStatuses={node.sessionStatuses} />
          )}
          {startTimeLabel ? (
            <span className="ml-1 shrink-0 text-[11px] text-[var(--color-text-faint)]">
              {startTimeLabel}
            </span>
          ) : null}
        </button>
      </SidebarMenuButton>
    </div>
  );
});
