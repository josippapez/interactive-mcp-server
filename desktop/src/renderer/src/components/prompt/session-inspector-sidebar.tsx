import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bot,
  GitPullRequest,
  ListTodo,
  PanelRightClose,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
  ReviewDiffFile as ApiReviewDiffFile,
  ReviewDiffSource,
} from '../../../../preload';
import type { Todo } from '../../hooks/useTodos';
import type { Attachment } from '../../types';
import type { BackgroundSubagentDisplay } from '../../pages/prompt/background-subagents';
import ReviewSidebar from './ReviewSidebar';
import SessionTodoDock from './SessionTodoDock';
import {
  buildSessionInspectorSubagentRows,
  getSessionInspectorTabSummaries,
  isSessionInspectorTab,
  resolveSessionInspectorTab,
  type SessionInspectorTab,
} from './session-inspector-utils';

export type InspectorTabCountsInput = {
  backgroundSubagentCount: number;
  runningSubagentCount?: number;
  todoCount: number;
  reviewCount: number;
};

export type InspectorTabCounts = {
  subagents: number;
  runningSubagents: number;
  tasks: number;
  review: number;
};

type SessionInspectorSidebarProps = {
  backgroundSubagents: readonly BackgroundSubagentDisplay[];
  todos: Todo[];
  todosLoading: boolean;
  todosError: string | null;
  tasksCollapsed: boolean;
  onToggleTasksCollapsed: () => void;
  onRefreshTodos: () => void;
  reviewDiffs: readonly ApiReviewDiffFile[];
  reviewSessionId: string;
  onSubmitReviewComment?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  reviewSource: ReviewDiffSource;
  reviewSourceOptions: readonly ReviewDiffSource[];
  reviewLoading: boolean;
  reviewError: string | null;
  onReviewSourceChange: (source: ReviewDiffSource) => void;
  onRefreshReview?: () => void;
  onOpenSessionTab: (sessionId: string) => void;
  onClose: () => void;
};

export function getInspectorTabCounts({
  backgroundSubagentCount,
  runningSubagentCount = backgroundSubagentCount,
  todoCount,
  reviewCount,
}: InspectorTabCountsInput): InspectorTabCounts {
  return {
    subagents: backgroundSubagentCount,
    runningSubagents: runningSubagentCount,
    tasks: todoCount,
    review: reviewCount,
  };
}

export function getInitialInspectorTab({
  backgroundSubagentCount,
  todoCount,
  reviewCount,
}: InspectorTabCountsInput): SessionInspectorTab {
  if (backgroundSubagentCount > 0) return 'subagents';
  if (todoCount > 0) return 'tasks';
  if (reviewCount > 0) return 'review';
  return 'subagents';
}

function EmptyInspectorState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}): React.ReactElement {
  return (
    <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-faint)]">
        {icon}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-[var(--color-text)]">
          {title}
        </div>
        <div className="max-w-[18rem] text-xs leading-5 text-[var(--color-text-muted)]">
          {detail}
        </div>
      </div>
    </div>
  );
}

function formatSessionTime(timestamp: number | undefined): string | null {
  if (typeof timestamp !== 'number') return null;
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClassName(tone: 'active' | 'warning' | 'neutral'): string {
  if (tone === 'warning') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-500';
  }
  if (tone === 'active') {
    return 'border-[color-mix(in_srgb,var(--color-agent)_24%,transparent)] bg-[color-mix(in_srgb,var(--color-agent)_12%,transparent)] text-[var(--color-agent)]';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]';
}

function SessionInspectorSubagents({
  backgroundSubagents,
  onOpenSessionTab,
}: {
  backgroundSubagents: readonly BackgroundSubagentDisplay[];
  onOpenSessionTab: (sessionId: string) => void;
}): React.ReactElement {
  const rows = useMemo(
    () => buildSessionInspectorSubagentRows(backgroundSubagents),
    [backgroundSubagents],
  );

  if (rows.length === 0) {
    return (
      <EmptyInspectorState
        icon={<Bot className="h-4 w-4" aria-hidden="true" />}
        title="No background subagents"
        detail="This session has not spawned background work."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 py-3">
      {rows.map((subagent) => {
        const time = formatSessionTime(
          subagent.activityAt ?? subagent.createdAt,
        );
        return (
          <div
            key={subagent.id}
            className="group flex min-w-0 items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 shadow-sm"
          >
            <span
              className={cn(
                'mt-1 h-2 w-2 shrink-0 rounded-full',
                subagent.tone === 'warning'
                  ? 'bg-amber-500'
                  : subagent.tone === 'active'
                    ? 'bg-[var(--color-agent)]'
                    : 'bg-[var(--color-text-faint)]',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">
                  {subagent.title}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'h-5 rounded-sm px-1.5 text-[10px] font-medium',
                    statusClassName(subagent.tone),
                  )}
                >
                  {subagent.statusLabel}
                </Badge>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-muted)]">
                {subagent.meta && (
                  <span className="max-w-full truncate">{subagent.meta}</span>
                )}
                {subagent.statusSummary && (
                  <span className="max-w-full truncate">
                    {subagent.statusSummary}
                  </span>
                )}
                {time && <span>{time}</span>}
              </div>
              <div className="truncate font-mono text-[10px] text-[var(--color-text-faint)]">
                {subagent.id}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              aria-label={`Open ${subagent.title} in tab`}
              title="Open in tab"
              onClick={() => onOpenSessionTab(subagent.id)}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function SessionInspectorTasks({
  todos,
  todosLoading,
  todosError,
  tasksCollapsed,
  onToggleTasksCollapsed,
  onRefreshTodos,
}: Pick<
  SessionInspectorSidebarProps,
  | 'todos'
  | 'todosLoading'
  | 'todosError'
  | 'tasksCollapsed'
  | 'onToggleTasksCollapsed'
  | 'onRefreshTodos'
>): React.ReactElement {
  if (todos.length === 0 && !todosLoading && !todosError) {
    return (
      <EmptyInspectorState
        icon={<ListTodo className="h-4 w-4" aria-hidden="true" />}
        title="No tasks"
        detail="The active session does not have a task list."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
      <SessionTodoDock
        todos={todos}
        isLoading={todosLoading}
        error={todosError}
        collapsed={tasksCollapsed}
        onToggle={onToggleTasksCollapsed}
        onRefresh={onRefreshTodos}
      />
    </div>
  );
}

function SessionInspectorSidebar({
  backgroundSubagents,
  todos,
  todosLoading,
  todosError,
  tasksCollapsed,
  onToggleTasksCollapsed,
  onRefreshTodos,
  reviewDiffs,
  reviewSessionId,
  onSubmitReviewComment,
  reviewSource,
  reviewSourceOptions,
  reviewLoading,
  reviewError,
  onReviewSourceChange,
  onRefreshReview,
  onOpenSessionTab,
  onClose,
}: SessionInspectorSidebarProps): React.ReactElement {
  const summaries = useMemo(
    () =>
      getSessionInspectorTabSummaries({
        backgroundSubagents,
        todos,
        reviewFileCount: reviewDiffs.length,
        reviewLoading,
        reviewError,
      }),
    [
      backgroundSubagents,
      reviewDiffs.length,
      reviewError,
      reviewLoading,
      todos,
    ],
  );
  const [activeTab, setActiveTab] = useState<SessionInspectorTab>(() =>
    getInitialInspectorTab({
      backgroundSubagentCount: backgroundSubagents.length,
      runningSubagentCount: backgroundSubagents.filter(
        (subagent) => subagent.status === 'running',
      ).length,
      todoCount: todos.length,
      reviewCount: reviewDiffs.length,
    }),
  );
  const resolvedActiveTab = resolveSessionInspectorTab(activeTab, summaries);

  return (
    <aside
      aria-label="Session inspector"
      data-component="session-inspector"
      className="hidden min-h-0 w-[360px] max-w-[42vw] shrink-0 flex-col border-l border-[var(--border-weaker-base)] bg-[var(--background-base)] md:flex"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-weaker-base)] px-3">
        <div className="min-w-0 text-sm font-semibold text-[var(--color-text)]">
          Inspector
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          aria-label="Close inspector"
          title="Close inspector"
          onClick={onClose}
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <Tabs
        value={resolvedActiveTab}
        onValueChange={(value: string) => {
          if (isSessionInspectorTab(value)) {
            setActiveTab(value);
          }
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 border-b border-[var(--border-weaker-base)] px-3">
          <TabsList
            variant="line"
            className="h-10 w-full justify-start gap-1 border-0"
          >
            {summaries.map((summary) => (
              <TabsTrigger
                key={summary.id}
                value={summary.id}
                className="h-10 flex-none gap-1.5 px-2 text-xs data-active:border-[var(--color-agent)] data-active:text-[var(--color-text)]"
              >
                {summary.id === 'subagents' && (
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {summary.id === 'tasks' && (
                  <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {summary.id === 'review' && (
                  <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{summary.label}</span>
                {summary.badge && (
                  <span
                    className={cn(
                      'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                      summary.hasIssue
                        ? 'bg-amber-500/15 text-amber-500'
                        : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
                    )}
                  >
                    {summary.badge}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="subagents" className="min-h-0 overflow-hidden">
          <SessionInspectorSubagents
            backgroundSubagents={backgroundSubagents}
            onOpenSessionTab={onOpenSessionTab}
          />
        </TabsContent>
        <TabsContent value="tasks" className="min-h-0 overflow-hidden">
          <SessionInspectorTasks
            todos={todos}
            todosLoading={todosLoading}
            todosError={todosError}
            tasksCollapsed={tasksCollapsed}
            onToggleTasksCollapsed={onToggleTasksCollapsed}
            onRefreshTodos={onRefreshTodos}
          />
        </TabsContent>
        <TabsContent value="review" className="min-h-0 overflow-hidden">
          <ReviewSidebar
            diffs={reviewDiffs}
            sessionId={reviewSessionId}
            onSubmitComment={onSubmitReviewComment}
            defaultMode="unified"
            source={reviewSource}
            sourceOptions={reviewSourceOptions}
            loading={reviewLoading}
            error={reviewError}
            onSourceChange={onReviewSourceChange}
            onRefresh={onRefreshReview}
            embedded
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

export default memo(SessionInspectorSidebar);
