import { memo } from 'react';
import { Button } from '@/components/ui/button';
import type { Project } from '../../../hooks/session-tree-merge';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import { ProviderFilter, PROVIDER_LABELS } from './types';
import { ProjectSection } from './ProjectSection';

type ProjectStartBucket = 'today' | 'yesterday' | 'older' | 'unknown';

type GroupedProjects = {
  key: string;
  label: string;
  sortValue: number;
  projects: Project[];
};

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

function getProjectStartBucket(timestamp: number): ProjectStartBucket {
  if (timestamp <= 0) return 'unknown';

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - MS_PER_DAY;

  if (timestamp >= startOfToday) return 'today';
  if (timestamp >= startOfYesterday) return 'yesterday';
  return 'older';
}

function formatDateHeader(timestamp: number): string {
  if (timestamp <= 0) return 'Unknown Start Date';

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfDate = new Date(
    new Date(timestamp).getFullYear(),
    new Date(timestamp).getMonth(),
    new Date(timestamp).getDate(),
  ).getTime();

  if (startOfDate === startOfToday) return 'Today';

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function groupProjectsBySessionStart(projects: Project[]): GroupedProjects[] {
  const grouped = new Map<string, GroupedProjects>();

  for (const project of projects) {
    const timestamp = project.earliestSessionCreatedAt;
    const bucket = getProjectStartBucket(timestamp);

    if (bucket === 'unknown') {
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

    const date = new Date(timestamp);
    const dayStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    const key = String(dayStart);
    const existing = grouped.get(key);

    if (existing) {
      existing.projects.push(project);
      continue;
    }

    grouped.set(key, {
      key,
      label: formatDateHeader(timestamp),
      sortValue: dayStart,
      projects: [project],
    });
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.sortValue - a.sortValue)
    .map((group) => ({
      ...group,
      projects: [...group.projects].sort(
        (a, b) => b.earliestSessionCreatedAt - a.earliestSessionCreatedAt,
      ),
    }));
}

type ProjectsSectionProps = {
  projects: Project[];
  filter: ProviderFilter;
  showInactive: boolean;
  runningCount: number;
  inactiveCount: number;
  onToggleInactive: () => void;
  collapsedProjects: Set<string>;
  onToggleProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
  getStatus: (sessionId: string) => SessionStatusType | null;
  onCreateSession?: (baseDirectory: string) => void;
  collapsedSessions: Set<string>;
  onToggleSession: (sessionId: string) => void;
  onAddProject: () => void;
  hasDirectConnections: boolean;
};

/**
 * Projects section with header and list of project folders.
 */
export const ProjectsSection = memo(function ProjectsSection({
  projects,
  filter,
  showInactive,
  runningCount,
  inactiveCount,
  onToggleInactive,
  collapsedProjects,
  onToggleProject,
  onRemoveProject,
  activeConnectionId,
  onSelect,
  getStatus,
  onCreateSession,
  collapsedSessions,
  onToggleSession,
  onAddProject,
  hasDirectConnections,
}: ProjectsSectionProps): React.ReactElement {
  const groupedProjects = groupProjectsBySessionStart(projects);

  return (
    <section>
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
          Projects
          {!showInactive && inactiveCount > 0 && (
            <span className="ml-1 opacity-60">({runningCount} active)</span>
          )}
        </span>
        {inactiveCount > 0 && (
          <button
            type="button"
            onClick={onToggleInactive}
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
      {projects.length === 0 && !hasDirectConnections && (
        <p className="px-4 py-1 text-xs text-[var(--color-text-faint)] italic">
          {filter === 'all'
            ? 'No sessions yet'
            : `No ${PROVIDER_LABELS[filter]} sessions`}
        </p>
      )}
      {groupedProjects.map((group, index) => (
        <div key={group.key} className={index > 0 ? 'mt-3' : ''}>
          <div className="px-3 py-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[var(--color-text-faint)]/90">
              {group.label}
            </span>
            <div className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
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
              activeConnectionId={activeConnectionId}
              onSelect={onSelect}
              getStatus={getStatus}
              onCreateSession={onCreateSession}
              collapsedSessions={collapsedSessions}
              onToggleSession={onToggleSession}
            />
          ))}
        </div>
      ))}
      {/* Add Project button */}
      <Button
        variant="ghost"
        onClick={onAddProject}
        className="w-full justify-start gap-2 px-3 py-2 h-auto text-sm text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
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
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>Add Project Folder</span>
      </Button>
    </section>
  );
});
