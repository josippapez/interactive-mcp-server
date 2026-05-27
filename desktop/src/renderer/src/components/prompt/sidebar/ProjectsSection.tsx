import { memo, useMemo } from 'react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import type { Project } from '../../../hooks/session-tree-merge';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import { ProviderFilter, PROVIDER_LABELS } from './types';
import { ProjectSection } from './ProjectSection';

type GroupedProjects = {
  key: string;
  label: string;
  sortValue: number;
  projects: Project[];
};

// Module-scope cached formatter — constructing Intl.DateTimeFormat is
// expensive (hundreds of µs per call) and was previously instantiated
// once per group on every sidebar render.
const DATE_HEADER_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: '2-digit',
  year: 'numeric',
});

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupProjectsBySessionStart(projects: Project[]): GroupedProjects[] {
  const grouped = new Map<string, GroupedProjects>();

  // Compute "today boundary" once per invocation, not per project.
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  for (const project of projects) {
    const timestamp = project.latestSessionCreatedAt;

    if (timestamp <= 0) {
      const key = 'unknown';
      const existing = grouped.get(key);
      if (existing) {
        existing.projects.push(project);
      } else {
        grouped.set(key, {
          key,
          label: 'Unknown Start Date',
          sortValue: Number.NEGATIVE_INFINITY,
          projects: [project],
        });
      }
      continue;
    }

    const dayStart = startOfDay(timestamp);
    const key = String(dayStart);
    const existing = grouped.get(key);

    if (existing) {
      existing.projects.push(project);
      continue;
    }

    const label =
      dayStart === startOfToday
        ? 'Today'
        : DATE_HEADER_FORMATTER.format(new Date(timestamp));

    grouped.set(key, {
      key,
      label,
      sortValue: dayStart,
      projects: [project],
    });
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.sortValue - a.sortValue)
    .map((group) => ({
      ...group,
      projects: [...group.projects].sort(
        (a, b) => b.latestSessionCreatedAt - a.latestSessionCreatedAt,
      ),
    }));
}

type ProjectsSectionProps = {
  projects: Project[];
  filter: ProviderFilter;
  runningCount: number;
  collapsedProjects: Set<string>;
  onToggleProject: (path: string) => void;
  onPinProject: (path: string, name: string) => void;
  onRemoveProject: (path: string) => void;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
  getStatus: (sessionId: string) => SessionStatusType | null;
  onCreateSession?: (baseDirectory: string) => void;
  onLoadMoreSessions?: (baseDirectory: string) => void;
  collapsedSessions: Set<string>;
  onToggleSession: (sessionId: string) => void;
  hasDirectConnections: boolean;
  /** Currently selected project path from the rail (null = all projects) */
  selectedProjectPath?: string | null;
};

/**
 * Projects section with header and list of project folders.
 */
export const ProjectsSection = memo(function ProjectsSection({
  projects,
  filter,
  runningCount,
  collapsedProjects,
  onToggleProject,
  onPinProject,
  onRemoveProject,
  activeConnectionId,
  onSelect,
  getStatus,
  onCreateSession,
  onLoadMoreSessions,
  collapsedSessions,
  onToggleSession,
  hasDirectConnections,
  selectedProjectPath,
}: ProjectsSectionProps): React.ReactElement {
  const groupedProjects = useMemo(
    () => groupProjectsBySessionStart(projects),
    [projects],
  );
  const isProjectSelected =
    selectedProjectPath !== null && selectedProjectPath !== undefined;

  return (
    <SidebarGroup className="gap-0 p-0">
      {/* Show header when no specific project is selected */}
      {!isProjectSelected && (
        <div className="section-label">
          Projects
          <span className="ml-1 opacity-60 normal-case tracking-normal">
            ({runningCount} active)
          </span>
        </div>
      )}
      {projects.length === 0 && !hasDirectConnections && (
        <SidebarGroupContent>
          <p className="px-4 py-1 text-xs text-[var(--color-text-faint)] italic">
            {filter === 'all'
              ? 'No sessions yet'
              : `No ${PROVIDER_LABELS[filter]} sessions`}
          </p>
        </SidebarGroupContent>
      )}
      {groupedProjects.map((group, index) => (
        <div key={group.key} className={index > 0 ? 'mt-2' : ''}>
          <div className="flex items-center gap-2 px-2 py-1">
            <SidebarGroupLabel className="h-auto px-0 py-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-faint)]/75">
              {group.label}
            </SidebarGroupLabel>
            <div className="h-px flex-1 bg-[var(--color-border)]/70" />
          </div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {group.projects.map((project) => (
                <ProjectSection
                  key={project.path}
                  project={project}
                  isCollapsed={collapsedProjects.has(project.path)}
                  onToggle={() => onToggleProject(project.path)}
                  onRemove={
                    project.isPinned
                      ? () => onRemoveProject(project.path)
                      : undefined
                  }
                  onPin={
                    project.isPinned
                      ? undefined
                      : () => onPinProject(project.path, project.name)
                  }
                  activeConnectionId={activeConnectionId}
                  onSelect={onSelect}
                  getStatus={getStatus}
                  onCreateSession={onCreateSession}
                  onLoadMoreSessions={onLoadMoreSessions}
                  collapsedSessions={collapsedSessions}
                  onToggleSession={onToggleSession}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </div>
      ))}
    </SidebarGroup>
  );
});
