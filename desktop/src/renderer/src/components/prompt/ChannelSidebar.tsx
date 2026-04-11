import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { SessionNode, ProviderType } from '../../types';
import { partitionNodes } from '../../hooks/session-tree-merge';
import {
  useSessionStatus,
  type SessionStatusType,
} from '../../hooks/useSessionStatus';

type ProviderFilter = 'all' | ProviderType;

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

/** Session status from OpenCode API */
const SESSION_STATUS_CLASSES: Record<SessionStatusType, string> = {
  busy: 'bg-amber-500 animate-pulse',
  idle: 'bg-emerald-500',
  error: 'bg-[var(--color-error)]',
  unknown: 'bg-gray-400',
};

const SESSION_STATUS_LABELS: Record<SessionStatusType, string> = {
  busy: 'Working...',
  idle: 'Idle',
  error: 'Error',
  unknown: 'Unknown',
};

const PROVIDER_LABELS: Record<ProviderFilter, string> = {
  all: 'All',
  opencode: 'OpenCode',
  'copilot-cli': 'Copilot',
  'claude-sdk': 'Claude',
  standalone: 'Other',
};

const PROVIDER_ICONS: Record<ProviderFilter, string> = {
  all: '◎',
  opencode: '⬡',
  'copilot-cli': '◇',
  'claude-sdk': '◆',
  standalone: '○',
};

function StatusDot({
  sessionStatuses,
}: {
  sessionStatuses: { status: string; type: string }[];
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

/** Live session status indicator from OpenCode API */
function SessionStatusBadge({
  status,
}: {
  status: SessionStatusType | null;
}): React.ReactElement | null {
  if (!status || status === 'idle') return null;

  const dotClass = SESSION_STATUS_CLASSES[status];
  const label = SESSION_STATUS_LABELS[status];

  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
      title={label}
    />
  );
}

function ProviderBadge({
  providerType,
}: {
  providerType: ProviderType | null;
}): React.ReactElement | null {
  if (!providerType) return null;

  const colors: Record<ProviderType, string> = {
    opencode: 'text-emerald-400',
    'copilot-cli': 'text-blue-400',
    'claude-sdk': 'text-orange-400',
    standalone: 'text-gray-400',
  };

  return (
    <span
      className={`text-[9px] shrink-0 ${colors[providerType]}`}
      title={PROVIDER_LABELS[providerType]}
    >
      {PROVIDER_ICONS[providerType]}
    </span>
  );
}

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 280;

const ChannelSidebar = memo(function ChannelSidebar({
  connections,
  activeConnectionId,
  onSelect,
}: Props): React.ReactElement {
  const { openCodeTree, directConnections } = partitionNodes(connections);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [showInactive, setShowInactive] = useState(() => {
    const saved = localStorage.getItem('sidebar-show-inactive');
    return saved === 'true';
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Number(saved)))
      : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Fetch live session status from OpenCode API
  const { getStatus } = useSessionStatus(true);

  // Helper to check if a node is "running" (active)
  const isNodeRunning = useCallback(
    (node: SessionNode): boolean => {
      const status = getStatus(node.openCodeSessionId ?? '');
      return (
        node.hasPendingPrompt ||
        status === 'busy' ||
        node.sessionStatuses.some((s) => s.type === 'working')
      );
    },
    [getStatus],
  );

  // Filter nodes by provider
  const filterByProvider = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      if (filter === 'all') return nodes;
      return nodes.filter((node) => node.providerType === filter);
    },
    [filter],
  );

  // Filter nodes by activity status (running vs inactive)
  // For tree nodes, this ensures parents are included when children pass
  const filterByActivity = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      if (showInactive) return nodes;

      // Build a set of IDs that should be visible
      const visibleIds = new Set<string>();

      // First pass: identify nodes that pass the filter directly
      for (const node of nodes) {
        if (
          node.id === activeConnectionId ||
          isNodeRunning(node) ||
          node.unreadCount > 0
        ) {
          visibleIds.add(node.id);

          // Also include all ancestors (parent chain) for tree structure
          let parentId = node.openCodeParentId;
          while (parentId) {
            visibleIds.add(parentId);
            const parent = nodes.find(
              (n) => n.openCodeSessionId === parentId || n.id === parentId,
            );
            parentId = parent?.openCodeParentId ?? null;
          }
        }
      }

      return nodes.filter(
        (node) =>
          visibleIds.has(node.id) || visibleIds.has(node.openCodeSessionId!),
      );
    },
    [showInactive, activeConnectionId, isNodeRunning],
  );

  /**
   * Sort nodes by:
   * 1. Running/busy sessions first (hasPendingPrompt, busy status, or working status)
   * 2. Newest sessions first (by latest status timestamp or channel message)
   */
  const sortNodes = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      return [...nodes].sort((a, b) => {
        // Priority 1: Running sessions first
        const aIsRunning = isNodeRunning(a);
        const bIsRunning = isNodeRunning(b);

        if (aIsRunning && !bIsRunning) return -1;
        if (!aIsRunning && bIsRunning) return 1;

        // Priority 2: Newest first (by most recent activity)
        const aLatest = Math.max(
          a.sessionStatuses.at(-1)?.timestamp.getTime() ?? 0,
          a.channelMessages.at(-1)?.timestamp.getTime() ?? 0,
        );
        const bLatest = Math.max(
          b.sessionStatuses.at(-1)?.timestamp.getTime() ?? 0,
          b.channelMessages.at(-1)?.timestamp.getTime() ?? 0,
        );

        return bLatest - aLatest; // Descending (newest first)
      });
    },
    [isNodeRunning],
  );

  const filteredOpenCodeTree = useMemo(
    () => filterByActivity(filterByProvider(openCodeTree)),
    [filterByActivity, filterByProvider, openCodeTree],
  );
  const filteredDirectConnections = useMemo(
    () => sortNodes(filterByActivity(filterByProvider(directConnections))),
    [sortNodes, filterByActivity, filterByProvider, directConnections],
  );

  // Get available providers for tabs
  const allNodes = [...openCodeTree, ...directConnections];
  const availableProviders = new Set<ProviderFilter>(['all']);
  for (const node of allNodes) {
    if (node.providerType) {
      availableProviders.add(node.providerType);
    }
  }

  // Count per provider (total, not filtered by activity)
  const providerCounts: Record<ProviderFilter, number> = {
    all: allNodes.length,
    opencode: allNodes.filter((n) => n.providerType === 'opencode').length,
    'copilot-cli': allNodes.filter((n) => n.providerType === 'copilot-cli')
      .length,
    'claude-sdk': allNodes.filter((n) => n.providerType === 'claude-sdk')
      .length,
    standalone: allNodes.filter(
      (n) => n.providerType === 'standalone' || !n.providerType,
    ).length,
  };

  // Count running sessions
  const runningCount = allNodes.filter(isNodeRunning).length;
  const inactiveCount = allNodes.length - runningCount;

  async function handleRefresh(): Promise<void> {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await window.api.refreshSessionTree();
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleToggleInactive(): void {
    const newValue = !showInactive;
    setShowInactive(newValue);
    localStorage.setItem('sidebar-show-inactive', String(newValue));
  }

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, e.clientX),
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem('sidebar-width', String(sidebarWidth));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, sidebarWidth]);

  // Save width on change
  useEffect(() => {
    if (!isResizing) {
      localStorage.setItem('sidebar-width', String(sidebarWidth));
    }
  }, [sidebarWidth, isResizing]);

  const providerTabs = Array.from(availableProviders).filter(
    (p) => p === 'all' || providerCounts[p] > 0,
  );

  return (
    <aside
      ref={sidebarRef}
      style={{ width: sidebarWidth }}
      className="relative border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-hidden flex flex-col shrink-0"
    >
      {/* Provider filter tabs + refresh button */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center px-2 py-1.5 gap-1">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
            {providerTabs.map((provider) => (
              <button
                key={provider}
                onClick={() => setFilter(provider)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-sm transition-colors whitespace-nowrap ${
                  filter === provider
                    ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                    : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'
                }`}
                title={`Show ${PROVIDER_LABELS[provider]} sessions`}
              >
                <span>{PROVIDER_ICONS[provider]}</span>
                <span>{PROVIDER_LABELS[provider]}</span>
                <span className="text-[9px] opacity-60">
                  ({providerCounts[provider]})
                </span>
              </button>
            ))}
          </div>
          {/* Refresh button - always visible */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh sessions"
            className="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
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
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto">
        <section>
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
              Sessions
              {!showInactive && inactiveCount > 0 && (
                <span className="ml-1 opacity-60">({runningCount} active)</span>
              )}
            </span>
            {inactiveCount > 0 && (
              <button
                onClick={handleToggleInactive}
                title={
                  showInactive
                    ? 'Hide inactive sessions'
                    : `Show ${inactiveCount} inactive sessions`
                }
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  showInactive
                    ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                    : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'
                }`}
              >
                {showInactive ? 'Hide inactive' : `+${inactiveCount} more`}
              </button>
            )}
          </div>
          {filteredOpenCodeTree.length === 0 &&
            filteredDirectConnections.length === 0 && (
              <p className="px-4 py-1 text-xs text-[var(--color-text-faint)] italic">
                {filter === 'all'
                  ? 'No sessions yet'
                  : `No ${PROVIDER_LABELS[filter]} sessions`}
              </p>
            )}
          {filteredOpenCodeTree.length > 0 && (
            <div className="px-2 pb-2 space-y-0.5">
              {filteredOpenCodeTree.map((node) => (
                <ChannelItem
                  key={node.id}
                  node={node}
                  isActive={node.id === activeConnectionId}
                  onSelect={onSelect}
                  sessionStatus={getStatus(node.openCodeSessionId ?? '')}
                />
              ))}
            </div>
          )}
        </section>

        {filteredDirectConnections.length > 0 && (
          <section>
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
              Direct Connections
            </div>
            <div className="px-2 pb-2 space-y-0.5">
              {filteredDirectConnections.map((node) => (
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
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--color-agent)]/30 transition-colors ${
          isResizing ? 'bg-[var(--color-agent)]/50' : ''
        }`}
      />
    </aside>
  );
});

/**
 * Memoized channel item component to prevent unnecessary re-renders when
 * other channels update but this specific item hasn't changed.
 */
const ChannelItem = memo(function ChannelItem({
  node,
  isActive,
  onSelect,
  sessionStatus,
}: {
  node: SessionNode;
  isActive: boolean;
  onSelect: (id: string) => void;
  sessionStatus: SessionStatusType | null;
}): React.ReactElement {
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

  // Inactive channels get dimmed styling
  const isInactive = !isActive && !isRunning && !showUnread;

  return (
    <button
      onClick={() => onSelect(node.id)}
      style={{ paddingLeft: `${8 + indentPx}px` }}
      className={`w-full flex items-center gap-2 pr-2 py-1.5 text-left rounded-sm transition-colors ${
        isChild ? 'text-xs' : 'text-sm'
      } ${
        isActive
          ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
          : isRunning
            ? 'text-[var(--color-text)] hover:bg-[var(--color-border)] font-medium'
            : isInactive
              ? 'text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-muted)] opacity-60'
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
      {showLegacyStatus && <StatusDot sessionStatuses={node.sessionStatuses} />}
    </button>
  );
});

export default ChannelSidebar;
