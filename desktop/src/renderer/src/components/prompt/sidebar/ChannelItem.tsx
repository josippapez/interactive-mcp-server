import { memo } from 'react';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
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
  isSelected?: boolean;
  selectedCount?: number;
  onSelect: (id: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  sessionStatus: SessionStatusType | null;
  hasChildren?: boolean;
  childSummary?: { total: number; active: number };
  isSessionCollapsed?: boolean;
  onToggleCollapse?: () => void;
  showStartTime?: boolean;
  onArchive?: () => void;
  archiveLabel?: string;
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
  isSelected = false,
  selectedCount = 0,
  onSelect,
  sessionStatus,
  hasChildren = false,
  childSummary = { total: 0, active: 0 },
  isSessionCollapsed = false,
  onToggleCollapse,
  showStartTime = false,
  onArchive,
  archiveLabel = 'Archive session',
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
    <div
      className={cn(
        'group anim-channel-item relative flex min-w-0 items-center',
        isChild &&
          'before:absolute before:bottom-0 before:top-0 before:w-px before:bg-[var(--color-border-weak)]/70 before:left-[var(--child-rail-left)]',
      )}
      style={
        isChild
          ? ({
              '--child-rail-left': `${Math.max(8, indentPx - 6)}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {isChild && (
        <span
          className="pointer-events-none absolute top-1/2 h-px w-2 bg-[var(--color-border-weak)]/70"
          style={{ left: `${Math.max(8, indentPx - 6)}px` }}
          aria-hidden="true"
        />
      )}
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
        isActive={isActive}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 mx-0 rounded-md cursor-pointer truncate min-w-0 flex-1 h-auto border-0 transition-colors',
          isChild ? 'text-xs' : 'text-sm',
          'text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)]',
          showPendingPrompt &&
            'bg-[color-mix(in_srgb,var(--color-user)_14%,transparent)] text-[var(--color-user)] font-medium',
          isActive &&
            !showPendingPrompt &&
            'bg-[color-mix(in_srgb,var(--color-agent)_12%,transparent)] text-[var(--color-agent)]',
          isSelected &&
            !isActive &&
            'bg-[color-mix(in_srgb,var(--color-agent)_8%,transparent)] ring-1 ring-[var(--color-agent)]/20',
          !isActive && !showPendingPrompt && isRunning && 'font-medium',
          'flex min-w-0 w-full items-center gap-2 overflow-hidden',
        )}
        render={
          <button
            type="button"
            aria-selected={isSelected ? 'true' : undefined}
            onClick={(event) => onSelect(node.id, event)}
          />
        }
      >
        {isDeepChild || isChild ? (
          <span
            className="shrink-0 rounded-full border border-[var(--color-border-weak)]/70 bg-[var(--color-surface)] px-1 py-px text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]"
            title="Subagent session"
          >
            sub
          </span>
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
        {hasChildren && childSummary.total > 0 && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]',
              childSummary.active > 0
                ? 'border-[var(--color-agent)]/30 bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-faint)]',
            )}
            title={`${childSummary.total} subagent${childSummary.total === 1 ? '' : 's'}${childSummary.active > 0 ? `, ${childSummary.active} active` : ''}`}
          >
            {childSummary.total} sub
          </span>
        )}
        {showLegacyStatus && (
          <StatusDot sessionStatuses={node.sessionStatuses} />
        )}
        {startTimeLabel ? (
          <span className="ml-1 shrink-0 text-[11px] text-[var(--color-text-faint)]">
            {startTimeLabel}
          </span>
        ) : null}
      </SidebarMenuButton>
      {onArchive && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--color-text-faint)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)] hover:text-[var(--color-text-muted)] group-hover:opacity-100 focus:opacity-100"
                aria-label="Session actions"
                onClick={(event) => event.stopPropagation()}
              />
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onArchive}>
              {selectedCount > 1
                ? `${archiveLabel.replace(' session', '')} ${selectedCount} sessions`
                : archiveLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
