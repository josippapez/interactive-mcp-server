import { memo } from 'react';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import {
  getSessionChildSummary,
  type Project,
} from '../../../hooks/session-tree-merge';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import { ChannelItem } from './ChannelItem';

type ProjectSectionProps = {
  project: Project;
  isCollapsed: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onPin?: () => void;
  activeConnectionId: string | null;
  onSelect: (id: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  getStatus: (sessionId: string) => SessionStatusType | null;
  onCreateSession?: (baseDirectory: string) => void;
  onLoadMoreSessions?: (baseDirectory: string) => void;
  loadingMoreSessions?: boolean;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  selectedSessionIds: Set<string>;
  showArchived: boolean;
  collapsedSessions: Set<string>;
  onToggleSession: (sessionId: string) => void;
};

const OPEN_CODE_LOAD_MORE_STEP = 5;

/**
 * Collapsible project section showing all sessions for a project directory.
 */
export const ProjectSection = memo(function ProjectSection({
  project,
  isCollapsed,
  onToggle,
  onRemove,
  onPin,
  activeConnectionId,
  onSelect,
  getStatus,
  onCreateSession,
  onLoadMoreSessions,
  loadingMoreSessions = false,
  onArchiveSession,
  selectedSessionIds,
  showArchived,
  collapsedSessions,
  onToggleSession,
}: ProjectSectionProps): React.ReactElement {
  const sessionCount = project.sessions.length;
  const nextSessionLimit =
    project.sessionLimit === undefined
      ? undefined
      : project.sessionLimit + OPEN_CODE_LOAD_MORE_STEP;
  const hasActive = project.sessions.some((s) => s.id === activeConnectionId);

  return (
    <div className="group mb-1 min-w-0 rounded-lg border border-[var(--color-border-weak)]/60 bg-[var(--color-surface)]/25 p-1">
      <div className="relative flex min-w-0 items-center">
        <SidebarMenuButton
          isActive={hasActive}
          className={`h-auto min-w-0 rounded-md px-2 py-1.5 hover:bg-[var(--color-border)]/55 flex min-w-0 w-full items-center gap-2 overflow-hidden text-left ${
            hasActive
              ? 'bg-[var(--color-agent)]/6 text-[var(--color-text)] ring-1 ring-[var(--color-agent)]/12'
              : ''
          }`}
          render={<button type="button" onClick={onToggle} />}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-[var(--color-text-faint)] transition-transform ${
              isCollapsed ? '' : 'rotate-90'
            }`}
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>

          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 ${
              project.isRunning
                ? 'text-[var(--color-agent)]'
                : project.isPinned && sessionCount === 0
                  ? 'text-[var(--color-text-faint)] opacity-50'
                  : 'text-[var(--color-text-faint)]'
            }`}
            aria-hidden="true"
          >
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
          </svg>

          <span
            className={`block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs ${
              project.isRunning
                ? 'font-medium text-[var(--color-text)]'
                : project.isPinned && sessionCount === 0
                  ? 'text-[var(--color-text-faint)] opacity-70'
                  : 'text-[var(--color-text-muted)]'
            }`}
            title={project.path}
          >
            {project.name}
          </span>

          {sessionCount > 0 && (
            <span className="rounded-full border border-[var(--color-border)] px-1 py-px text-[9px] text-[var(--color-text-faint)]">
              {sessionCount}
            </span>
          )}

          {project.isRunning && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-agent)] animate-pulse" />
          )}
          {project.hasUnread && !project.isRunning && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-user)]" />
          )}
        </SidebarMenuButton>

        {(onRemove || onPin) && (
          <SidebarMenuAction
            showOnHover
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              if (onRemove) {
                onRemove();
              } else {
                onPin?.();
              }
            }}
            title={onRemove ? 'Remove project folder' : 'Pin project folder'}
            className={`text-[var(--color-text-faint)] ${
              onRemove
                ? 'hover:text-[var(--color-error)]'
                : 'hover:text-[var(--color-agent)]'
            }`}
          >
            <span className="sr-only">
              {onRemove ? 'Remove project folder' : 'Pin project folder'}
            </span>
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
              aria-hidden="true"
            >
              {onRemove ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M12 17v5M5 7l14 0M7 7l1 10h8l1-10M9 7V4h6v3" />
              )}
            </svg>
          </SidebarMenuAction>
        )}
      </div>

      {!isCollapsed && sessionCount === 0 && (
        <div className="px-3 py-1.5">
          <p className="mb-1.5 text-[11px] italic text-[var(--color-text-faint)]">
            No sessions yet
          </p>
          {onCreateSession && (
            <button
              type="button"
              onClick={() => onCreateSession(project.path)}
              className="flex items-center gap-1.5 text-[11px] text-[var(--color-agent)] transition-colors hover:text-[var(--color-agent)]/80"
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
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>New Session</span>
            </button>
          )}
        </div>
      )}

      {!isCollapsed && sessionCount > 0 && (
        <SidebarMenuSub className="mx-0 mt-0.5 gap-0.5 border-l border-[var(--color-border-weak)] px-1.5 pb-0.5 pt-1">
          {project.sessions
            .filter((node) => {
              if (!node.openCodeParentId) return true;

              let parentId: string | null = node.openCodeParentId;
              while (parentId) {
                if (collapsedSessions.has(parentId)) return false;
                const parent = project.sessions.find(
                  (s) => s.providerSessionId === parentId,
                );
                parentId = parent?.openCodeParentId ?? null;
              }
              return true;
            })
            .map((node) => {
              const hasChildren = project.sessions.some(
                (s) => s.openCodeParentId === node.providerSessionId,
              );
              const childSummary = node.providerSessionId
                ? getSessionChildSummary(
                    project.sessions,
                    node.providerSessionId,
                  )
                : { total: 0, active: 0 };

              return (
                <ChannelItem
                  key={node.id}
                  node={node}
                  isActive={node.id === activeConnectionId}
                  isSelected={
                    node.providerSessionId
                      ? selectedSessionIds.has(node.providerSessionId)
                      : false
                  }
                  selectedCount={selectedSessionIds.size}
                  onSelect={onSelect}
                  sessionStatus={getStatus(node.providerSessionId ?? '')}
                  showStartTime={!node.openCodeParentId}
                  hasChildren={hasChildren}
                  childSummary={childSummary}
                  isSessionCollapsed={collapsedSessions.has(
                    node.providerSessionId ?? '',
                  )}
                  onToggleCollapse={
                    hasChildren
                      ? () => onToggleSession(node.providerSessionId ?? '')
                      : undefined
                  }
                  onArchive={
                    node.providerSessionId && onArchiveSession
                      ? () =>
                          onArchiveSession(
                            node.providerSessionId ?? '',
                            !showArchived,
                          )
                      : undefined
                  }
                  archiveLabel={
                    showArchived ? 'Unarchive session' : 'Archive session'
                  }
                />
              );
            })}
          {onCreateSession && (
            <button
              type="button"
              onClick={() => onCreateSession(project.path)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-agent)]"
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
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>New Session</span>
            </button>
          )}
          {project.hasMoreSessions && onLoadMoreSessions && (
            <div className="relative w-full py-1">
              <button
                type="button"
                onClick={(event) => {
                  onLoadMoreSessions(project.path);
                  event.currentTarget.blur();
                }}
                disabled={loadingMoreSessions}
                className="flex h-8 w-full items-center justify-start rounded-md px-2 text-left text-xs text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text-muted)] disabled:pointer-events-none disabled:opacity-60"
                title={
                  nextSessionLimit === undefined
                    ? 'Load more sessions'
                    : `Load ${nextSessionLimit} recent sessions`
                }
              >
                {loadingMoreSessions ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </SidebarMenuSub>
      )}
    </div>
  );
});
