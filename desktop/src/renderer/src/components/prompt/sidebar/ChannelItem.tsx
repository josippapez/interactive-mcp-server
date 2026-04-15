import { memo, useRef } from 'react';
import type { SessionNode } from '../../../types';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import {
  StatusDot,
  SessionStatusBadge,
  ProviderBadge,
} from './StatusIndicators';
import { gsap, useGSAP, prefersReducedMotion } from '../../../lib/gsap';

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
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(containerRef.current, {
        opacity: 0,
        x: -6,
        duration: 0.18,
        ease: 'power2.out',
      });
    },
    { scope: containerRef },
  );

  const label = node.sessionChannel?.label ?? node.title;
  const depth = node.depth ?? 0;
  const isChild = depth > 0;
  const isDeepChild = depth > 1;

  const indentPx = depth * 12;

  // Determine what status indicator to show (priority order)
  const showPendingPrompt = node.hasPendingPrompt;
  const showUnread = !showPendingPrompt && node.unreadCount > 0;
  const showBusy =
    !showPendingPrompt && !showUnread && sessionStatus === 'busy';
  const showLegacyStatus =
    !showPendingPrompt && !showUnread && !showBusy && !isActive;

  // Determine if this channel is "running" (has activity)
  const isRunning =
    showPendingPrompt ||
    sessionStatus === 'busy' ||
    node.sessionStatuses.some((s) => s.type === 'working');

  const startTimeLabel = showStartTime ? formatStartTime(node.createdAt) : '';

  return (
    <div ref={containerRef} className="flex items-center group min-w-0">
      {/* Collapse/expand button for parent sessions */}
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
          style={{ marginLeft: `${indentPx}px` }}
          className="w-5 h-5 flex items-center justify-center shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition-colors"
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
        /* Spacer for alignment when no children */
        <div
          style={{
            marginLeft: `${indentPx}px`,
            width: hasChildren ? undefined : '8px',
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={`flex-1 min-w-0 flex items-center gap-2 pr-2 py-1.5 text-left rounded-sm transition-colors ${
          isChild ? 'text-xs' : 'text-sm'
        } ${
          showPendingPrompt
            ? 'bg-[var(--color-user)]/15 text-[var(--color-user)] font-medium ring-1 ring-[var(--color-user)]/30'
            : isActive
              ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
              : isRunning
                ? 'text-[var(--color-text)] hover:bg-[var(--color-border)] font-medium'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
        }`}
      >
        {isDeepChild ? (
          <span className="text-[var(--color-text-faint)] shrink-0">↳</span>
        ) : isChild ? (
          <span className="text-[var(--color-text-faint)] shrink-0">↳</span>
        ) : (
          <ProviderBadge providerType={node.providerType} />
        )}
        <span className="truncate flex-1">{label}</span>
        {showPendingPrompt && (
          <span className="w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse shrink-0" />
        )}
        {showUnread && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-user)]/15 text-[var(--color-user)] shrink-0">
            {node.unreadCount}
          </span>
        )}
        {showBusy && <SessionStatusBadge status={sessionStatus} />}
        {showLegacyStatus && (
          <StatusDot sessionStatuses={node.sessionStatuses} />
        )}
        {startTimeLabel ? (
          <span className="ml-1 text-[11px] text-[var(--color-text-faint)] shrink-0">
            {startTimeLabel}
          </span>
        ) : null}
      </button>
    </div>
  );
});
