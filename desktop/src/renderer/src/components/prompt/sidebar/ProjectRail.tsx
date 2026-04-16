import { memo, useState, useCallback } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Project } from '../../../hooks/session-tree-merge';

type ProjectRailProps = {
  projects: Project[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  onAddProject: () => void;
  onRemoveProject?: (path: string) => void;
};

/** Get initials from project name (max 2 chars) */
function getInitials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** Get a consistent color from project path */
function getProjectColor(path: string): string {
  const colors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-teal-500',
    'bg-emerald-500',
    'bg-orange-500',
    'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = (hash * 31 + path.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Single project icon in the rail */
const ProjectIcon = memo(function ProjectIcon({
  project,
  isSelected,
  onSelect,
  onRemove,
}: {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}): React.ReactElement {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (onRemove) {
        setMenuPosition({ x: e.clientX, y: e.clientY });
        setShowContextMenu(true);
      }
    },
    [onRemove],
  );

  const handleCloseMenu = useCallback(() => {
    setShowContextMenu(false);
  }, []);

  const handleRemoveClick = useCallback(() => {
    onRemove?.();
    setShowContextMenu(false);
  }, [onRemove]);

  const initials = getInitials(project.name ?? '');
  const color = getProjectColor(project.path ?? '');
  const sessionCount = project.rootSessions?.length ?? 0;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSelect}
            onContextMenu={handleContextMenu}
            className={`
              relative h-9 w-9 rounded-xl flex items-center justify-center overflow-visible
              text-white text-[11px] font-semibold transition-all duration-150
              ${color}
              ${isSelected ? 'ring-2 ring-[var(--color-agent)] ring-offset-2 ring-offset-[var(--color-surface)] shadow-[0_0_0_1px_rgba(255,255,255,0.08)] scale-[1.03]' : 'opacity-75 hover:opacity-100 hover:scale-[1.03]'}
            `}
            title={project.name}
          >
            {initials}
            {sessionCount > 0 && (
              <span className="absolute right-0 top-0 flex h-4 min-w-[16px] translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-[9px] text-[var(--color-text-muted)] shadow-sm">
                {sessionCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <div className="text-xs max-w-[200px]">
            <div className="font-medium truncate">{project.name}</div>
            <div className="text-[var(--color-text-faint)] mt-0.5 truncate text-[10px] font-mono">
              {project.path}
            </div>
            <div className="text-[var(--color-text-faint)] mt-0.5">
              {sessionCount} session{sessionCount !== 1 ? 's' : ''}
            </div>
            {onRemove && (
              <div className="text-[var(--color-text-faint)] mt-1 text-[10px] italic">
                Right-click to remove
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Context Menu */}
      {showContextMenu && (
        <>
          {/* Backdrop to close menu */}
          <button
            type="button"
            aria-label="Close project context menu"
            className="fixed inset-0 z-50"
            onClick={handleCloseMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              handleCloseMenu();
            }}
          />
          {/* Menu */}
          <div
            className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: menuPosition.x, top: menuPosition.y }}
          >
            <button
              type="button"
              onClick={handleRemoveClick}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] flex items-center gap-2"
            >
              <svg
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
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Remove from rail
            </button>
          </div>
        </>
      )}
    </>
  );
});

/** "All Projects" icon */
const AllProjectsIcon = memo(function AllProjectsIcon({
  isSelected,
  onSelect,
  totalSessions,
}: {
  isSelected: boolean;
  onSelect: () => void;
  totalSessions: number;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={`
            relative h-9 w-9 rounded-xl flex items-center justify-center
            bg-[var(--color-surface)] border transition-all duration-150 shadow-sm
            ${isSelected ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10 text-[var(--color-agent)]' : 'border-[var(--color-border)] text-[var(--color-text-faint)] hover:border-[var(--color-agent)]/50 hover:text-[var(--color-text-muted)]'}
          `}
          title="All Projects"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="All projects grid"
          >
            <title>All projects</title>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <div className="text-xs">
          <div className="font-medium">All Projects</div>
          <div className="text-[var(--color-text-faint)] mt-0.5">
            {totalSessions} total session{totalSessions !== 1 ? 's' : ''}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

/** Add project button */
const AddProjectButton = memo(function AddProjectButton({
  onClick,
}: {
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="h-9 w-9 rounded-xl flex items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/55 text-[var(--color-text-faint)] hover:border-[var(--color-agent)]/50 hover:text-[var(--color-text-muted)] transition-all duration-150"
          title="Add Project"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Add project"
          >
            <title>Add project</title>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        Add Project Folder
      </TooltipContent>
    </Tooltip>
  );
});

/**
 * Project rail - vertical bar with project icons like Slack workspaces.
 * Shows project folder icons on the far left of the sidebar.
 */
export const ProjectRail = memo(function ProjectRail({
  projects,
  selectedPath,
  onSelect,
  onAddProject,
  onRemoveProject,
}: ProjectRailProps): React.ReactElement {
  const safeProjects = projects ?? [];
  const totalSessions = safeProjects.reduce(
    (sum, p) => sum + (p.rootSessions?.length ?? 0),
    0,
  );

  return (
    <div className="flex w-[3.75rem] shrink-0 flex-col items-center gap-2.5 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-3">
      {/* All Projects */}
      <AllProjectsIcon
        isSelected={selectedPath === null}
        onSelect={() => onSelect(null)}
        totalSessions={totalSessions}
      />

      {/* Divider */}
      {safeProjects.length > 0 && (
        <div className="my-1 h-px w-7 bg-[var(--color-border)]" />
      )}

      {/* Project icons */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto overflow-x-visible no-scrollbar">
        {safeProjects.map((project) => (
          <ProjectIcon
            key={project.path}
            project={project}
            isSelected={selectedPath === project.path}
            onSelect={() => onSelect(project.path)}
            onRemove={
              project.isPinned && onRemoveProject
                ? () => onRemoveProject(project.path)
                : undefined
            }
          />
        ))}
      </div>

      {/* Add project button at bottom */}
      <div className="mt-auto pt-2">
        <AddProjectButton onClick={onAddProject} />
      </div>
    </div>
  );
});
