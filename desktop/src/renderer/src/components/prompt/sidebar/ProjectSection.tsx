import { memo } from 'react';
import type { Project } from '../../../hooks/session-tree-merge';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import { ChannelItem } from './ChannelItem';

type ProjectSectionProps = {
  project: Project;
  isCollapsed: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
  getStatus: (sessionId: string) => SessionStatusType | null;
  onCreateSession?: (baseDirectory: string) => void;
  collapsedSessions: Set<string>;
  onToggleSession: (sessionId: string) => void;
};

/**
 * Collapsible project section showing all sessions for a project directory.
 */
export const ProjectSection = memo(function ProjectSection({
  project,
  isCollapsed,
  onToggle,
  onRemove,
  activeConnectionId,
  onSelect,
  getStatus,
  onCreateSession,
  collapsedSessions,
  onToggleSession,
}: ProjectSectionProps): React.ReactElement {
  const sessionCount = project.sessions.length;
  const hasActive = project.sessions.some((s) => s.id === activeConnectionId);

  return (
    <div className="group mb-1 min-w-0">
      {/* Project header */}
      <div
        className={`flex min-w-0 items-center rounded-md transition-colors hover:bg-[var(--color-border)]/70 ${
          hasActive ? 'bg-[var(--color-agent)]/5' : ''
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        >
          {/* Chevron icon */}
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
            className={`shrink-0 text-[var(--color-text-faint)] transition-transform ${
              isCollapsed ? '' : 'rotate-90'
            }`}
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>

          {/* Folder icon */}
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

          {/* Project name */}
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              project.isRunning
                ? 'text-[var(--color-text)] font-medium'
                : project.isPinned && sessionCount === 0
                  ? 'text-[var(--color-text-faint)] opacity-70'
                  : 'text-[var(--color-text-muted)]'
            }`}
            title={project.path}
          >
            {project.name}
          </span>

          {/* Session count */}
          {sessionCount > 0 && (
            <span className="text-[10px] text-[var(--color-text-faint)]">
              {sessionCount}
            </span>
          )}

          {/* Activity indicators */}
          {project.isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-agent)] animate-pulse shrink-0" />
          )}
          {project.hasUnread && !project.isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-user)] shrink-0" />
          )}
        </button>

        {/* Remove button (only for pinned projects) */}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove project folder"
            className="px-2 py-1.5 opacity-0 group-hover:opacity-100 text-[var(--color-text-faint)] hover:text-[var(--color-error)] transition-opacity"
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
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Empty state for pinned projects with no sessions */}
      {!isCollapsed && sessionCount === 0 && (
        <div className="px-4 py-2">
          <p className="text-xs text-[var(--color-text-faint)] italic mb-2">
            No sessions yet
          </p>
          {onCreateSession && (
            <button
              type="button"
              onClick={() => onCreateSession(project.path)}
              className="flex items-center gap-1.5 text-xs text-[var(--color-agent)] hover:text-[var(--color-agent)]/80 transition-colors"
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

      {/* Sessions list (when expanded) */}
      {!isCollapsed && sessionCount > 0 && (
        <div className="space-y-0.5 px-2 pb-1">
          {project.sessions
            .filter((node) => {
              // Hide children of collapsed parent sessions
              if (!node.openCodeParentId) return true; // Root sessions always visible
              // Check if any ancestor is collapsed
              let parentId = node.openCodeParentId;
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
              // Check if this node has children
              const hasChildren = project.sessions.some(
                (s) => s.openCodeParentId === node.providerSessionId,
              );
              return (
                <ChannelItem
                  key={node.id}
                  node={node}
                  isActive={node.id === activeConnectionId}
                  onSelect={onSelect}
                  sessionStatus={getStatus(node.providerSessionId ?? '')}
                  showStartTime={!node.openCodeParentId}
                  hasChildren={hasChildren}
                  isSessionCollapsed={collapsedSessions.has(
                    node.providerSessionId ?? '',
                  )}
                  onToggleCollapse={
                    hasChildren
                      ? () => onToggleSession(node.providerSessionId ?? '')
                      : undefined
                  }
                />
              );
            })}
          {/* New Session button at the bottom of the sessions list */}
          {onCreateSession && (
            <button
              type="button"
              onClick={() => onCreateSession(project.path)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-agent)] hover:bg-[var(--color-border)] rounded-sm transition-colors"
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
    </div>
  );
});
