import { memo } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
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

function getProjectDisplayName(project: Project): string {
  if (project.name?.trim()) return project.name;
  const parts = project.path?.split('/').filter(Boolean) ?? [];
  return parts.at(-1) ?? 'Project';
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
  const initials = getInitials(project.name ?? '');
  const color = getProjectColor(project.path ?? '');
  const sessionCount = project.rootSessions?.length ?? 0;
  const displayName = getProjectDisplayName(project);

  const trigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={`
            relative flex h-10 w-10 items-center justify-center overflow-visible rounded-[14px]
            border text-white text-[11px] font-semibold transition-all duration-150
            ${color}
            ${isSelected ? 'border-[var(--color-agent)] ring-2 ring-[var(--color-agent)]/70 ring-offset-2 ring-offset-[var(--color-surface)] shadow-[0_10px_24px_rgba(0,0,0,0.25)] scale-[1.02]' : 'border-white/5 opacity-75 hover:opacity-100 hover:scale-[1.03]'}
          `}
          title={displayName}
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
          <div className="font-medium truncate">{displayName}</div>
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
  );

  if (!onRemove) {
    return trigger;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem variant="destructive" onClick={onRemove}>
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
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
            relative flex h-10 w-10 items-center justify-center rounded-[14px]
            border bg-[var(--color-surface)]/90 transition-all duration-150 shadow-sm
            ${isSelected ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10 text-[var(--color-agent)] ring-2 ring-[var(--color-agent)]/70 ring-offset-2 ring-offset-[var(--color-surface)] shadow-[0_10px_24px_rgba(0,0,0,0.16)]' : 'border-[var(--color-border)] text-[var(--color-text-faint)] hover:border-[var(--color-agent)]/30 hover:text-[var(--color-text-muted)]'}
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
          className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/55 text-[var(--color-text-faint)] transition-all duration-150 hover:border-[var(--color-agent)]/40 hover:bg-[var(--color-agent)]/6 hover:text-[var(--color-text-muted)]"
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
    <div className="flex w-[4.5rem] shrink-0 flex-col items-center gap-3 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      {/* All Projects */}
      <AllProjectsIcon
        isSelected={selectedPath === null}
        onSelect={() => onSelect(null)}
        totalSessions={totalSessions}
      />

      {/* Divider */}
      {safeProjects.length > 0 && (
        <div className="my-1 h-px w-8 bg-[var(--color-border)]" />
      )}

      {/* Project icons */}
      <ScrollArea className="min-h-0 w-full flex-1">
        <div className="flex w-full flex-col items-center gap-3 overflow-x-visible pb-2">
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
      </ScrollArea>

      {/* Add project button at bottom */}
      <div className="mt-auto pt-2">
        <AddProjectButton onClick={onAddProject} />
      </div>
    </div>
  );
});
