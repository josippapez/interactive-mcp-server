import type { Todo } from '../../hooks/useTodos';
import type { BackgroundSubagentDisplay } from '../../pages/prompt/background-subagents';

export type SessionInspectorTab = 'subagents' | 'tasks' | 'review';

export type SessionInspectorTabSummary = {
  id: SessionInspectorTab;
  label: string;
  badge: string | null;
  hasContent: boolean;
  hasIssue: boolean;
};

export type SessionInspectorSubagentRow = BackgroundSubagentDisplay & {
  statusLabel: 'Running' | 'Stalled' | 'Ended';
  tone: 'active' | 'warning' | 'neutral';
  meta: string;
};

export type SessionInspectorSummaryInput = {
  backgroundSubagents: readonly BackgroundSubagentDisplay[];
  todos: readonly Todo[];
  reviewFileCount: number;
  reviewLoading: boolean;
  reviewError: string | null;
};

const TAB_LABELS: Record<SessionInspectorTab, string> = {
  subagents: 'Subagents',
  tasks: 'Tasks',
  review: 'Review',
};

function formatBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

function countActiveTodos(todos: readonly Todo[]): number {
  return todos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress',
  ).length;
}

export function getSessionInspectorTabSummaries({
  backgroundSubagents,
  todos,
  reviewFileCount,
  reviewLoading,
  reviewError,
}: SessionInspectorSummaryInput): SessionInspectorTabSummary[] {
  const runningSubagents = backgroundSubagents.filter(
    (subagent) => subagent.status === 'running',
  ).length;
  const activeTodos = countActiveTodos(todos);

  return [
    {
      id: 'subagents',
      label: TAB_LABELS.subagents,
      badge: formatBadge(runningSubagents),
      hasContent: backgroundSubagents.length > 0,
      hasIssue: backgroundSubagents.some((subagent) => subagent.isStalled),
    },
    {
      id: 'tasks',
      label: TAB_LABELS.tasks,
      badge: formatBadge(activeTodos),
      hasContent: todos.length > 0,
      hasIssue: false,
    },
    {
      id: 'review',
      label: TAB_LABELS.review,
      badge: formatBadge(reviewFileCount),
      hasContent: reviewFileCount > 0 || reviewLoading || Boolean(reviewError),
      hasIssue: Boolean(reviewError),
    },
  ];
}

export function resolveSessionInspectorTab(
  requested: SessionInspectorTab | undefined,
  summaries: readonly SessionInspectorTabSummary[],
): SessionInspectorTab {
  if (requested && summaries.some((summary) => summary.id === requested)) {
    return requested;
  }

  return (
    summaries.find((summary) => summary.hasContent)?.id ??
    summaries[0]?.id ??
    'subagents'
  );
}

export function isSessionInspectorTab(
  value: string,
): value is SessionInspectorTab {
  return value === 'subagents' || value === 'tasks' || value === 'review';
}

function subagentPriority(subagent: BackgroundSubagentDisplay): number {
  if (subagent.status === 'running' && subagent.isStalled) return 0;
  if (subagent.status === 'running') return 1;
  return 2;
}

function resolveStatusLabel(
  subagent: BackgroundSubagentDisplay,
): SessionInspectorSubagentRow['statusLabel'] {
  if (subagent.isStalled) return 'Stalled';
  return subagent.status === 'running' ? 'Running' : 'Ended';
}

function resolveTone(
  label: SessionInspectorSubagentRow['statusLabel'],
): SessionInspectorSubagentRow['tone'] {
  if (label === 'Stalled') return 'warning';
  if (label === 'Running') return 'active';
  return 'neutral';
}

function resolveMeta(subagent: BackgroundSubagentDisplay): string {
  const modelParts = [subagent.model, subagent.variant].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (modelParts.length > 0) return modelParts.join(' / ');
  return subagent.lastStatus ?? subagent.statusSummary ?? '';
}

export function buildSessionInspectorSubagentRows(
  subagents: readonly BackgroundSubagentDisplay[],
): SessionInspectorSubagentRow[] {
  return [...subagents]
    .sort((a, b) => {
      const priorityDelta = subagentPriority(a) - subagentPriority(b);
      if (priorityDelta !== 0) return priorityDelta;

      const createdAtDelta = (b.createdAt ?? 0) - (a.createdAt ?? 0);
      if (createdAtDelta !== 0) return createdAtDelta;

      const titleDelta = a.title.localeCompare(b.title);
      if (titleDelta !== 0) return titleDelta;
      return a.id.localeCompare(b.id);
    })
    .map((subagent) => {
      const statusLabel = resolveStatusLabel(subagent);
      return {
        ...subagent,
        statusLabel,
        tone: resolveTone(statusLabel),
        meta: resolveMeta(subagent),
      };
    });
}
