import React, { memo, useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ListTodo } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import { TaskOutputSection, parseTaskId } from './DefaultToolCard';
import { ToolDurationBadge, ToolSpinner } from './ToolCallShared';

/**
 * Task tool card — mirrors opencode's Task registry entry.
 *
 * Differences from DefaultToolCard:
 *   - Title = agent display name (from `input.subagent_type`)
 *   - Subtitle = `input.description` (fallback: resolved child sessionId)
 *   - Leading icon = task glyph (ListTodo)
 *   - When `running`, show a colored spinner at the leading edge
 *   - When a child sessionId is resolvable, the entire collapsed header
 *     becomes a `<button>` that navigates to the child session; the
 *     right-side chevron is replaced with an `ArrowUpRight` glyph.
 *   - When not clickable, the header stays a plain collapsible trigger
 *     (title + subtitle + chevron) so the user can still expand/collapse.
 *
 * SessionId resolution order:
 *   1. `tool.metadata?.sessionId` (bridge now merges `state.metadata`, so
 *      this is populated as soon as the `running` state arrives).
 *   2. `tool.subtaskSessionId` — bound from a sibling `subtask` part in the
 *      same message (ordering-based; see `conversationToUnified`). Present
 *      even before opencode writes sessionId into state.metadata.
 *   3. `parseTaskId(tool.output)` — last-resort regex fallback for
 *      completed Task invocations whose output embeds `task_id`.
 */
export function isTaskToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'task' || lower === 'mcp__opencode__task';
}

function resolveSessionId(tool: ToolCallInfo): string | null {
  const metaId = tool.metadata?.['sessionId'];
  if (typeof metaId === 'string' && metaId) return metaId;
  if (typeof tool.subtaskSessionId === 'string' && tool.subtaskSessionId) {
    return tool.subtaskSessionId;
  }
  return parseTaskId(tool.output);
}

function resolveAgentName(tool: ToolCallInfo): string {
  const raw = tool.input?.['subagent_type'];
  if (typeof raw !== 'string' || !raw) return 'Agent';
  // Capitalize first letter to match opencode's fallback casing.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function resolveSubtitle(
  tool: ToolCallInfo,
  sessionId: string | null,
): string | null {
  const description = tool.input?.['description'];
  if (typeof description === 'string' && description) return description;
  if (sessionId) return sessionId.slice(0, 12);
  return null;
}

const TaskSpinner = memo(function TaskSpinner(): React.ReactElement {
  return <ToolSpinner />;
});

export const TaskToolCard = memo(function TaskToolCard({
  tool,
  forceExpanded,
  onNavigateToSession,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);

  useEffect(() => {
    setIsExpanded(forceExpanded);
  }, [forceExpanded]);

  const sessionId = resolveSessionId(tool);
  const title = resolveAgentName(tool);
  const subtitle = resolveSubtitle(tool, sessionId);
  const isRunning = tool.status === 'running';
  const isPending = tool.status === 'pending';
  const isError = tool.status === 'error';
  const clickable = Boolean(sessionId && onNavigateToSession);

  const handleNavigate = useCallback(
    (e: React.MouseEvent) => {
      if (!clickable || !sessionId || !onNavigateToSession) return;
      e.preventDefault();
      e.stopPropagation();
      onNavigateToSession(sessionId);
    },
    [clickable, sessionId, onNavigateToSession],
  );

  const headerContent = (
    <>
      {isRunning ? (
        <span
          data-slot="task-tool-spinner"
          className="text-[var(--color-agent)] inline-flex items-center"
        >
          <TaskSpinner />
        </span>
      ) : (
        <ListTodo
          data-slot="tool-icon"
          aria-hidden="true"
          className="shrink-0"
        />
      )}
      <span
        data-slot="tool-title"
        style={{
          color: isError ? 'var(--color-error)' : 'var(--color-agent)',
          borderBottom: isError ? '1px solid var(--color-error)' : undefined,
        }}
      >
        {title}
      </span>
      {subtitle && (
        <span data-slot="tool-subtitle" title={subtitle}>
          {subtitle}
        </span>
      )}
      <ToolDurationBadge tool={tool} />
      {isError && (
        <span className="text-[9px] uppercase tracking-wide text-[var(--color-error)] font-medium shrink-0">
          Error
        </span>
      )}
      {clickable ? (
        <ArrowUpRight
          data-slot="tool-chevron"
          size={12}
          aria-hidden="true"
          className="shrink-0 ml-auto text-[var(--icon-weaker)]"
        />
      ) : (
        <svg
          data-slot="tool-chevron"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4.5 3 8 6l-3.5 3" />
        </svg>
      )}
    </>
  );

  const parsedSessionId = parseTaskId(tool.output);
  const hasOutput = Boolean(tool.output);

  // Preview shown inside the collapsible when there is no completed output
  // yet. During `running` we expose the user-facing prompt/description so
  // the row is never a dead-end. Kept short — 200 chars mirrors opencode's
  // inline task row.
  const PREVIEW_MAX = 200;
  const rawDescription = tool.input?.['description'];
  const rawPrompt = tool.input?.['prompt'];
  const previewSource =
    (typeof rawDescription === 'string' && rawDescription) ||
    (typeof rawPrompt === 'string' && rawPrompt) ||
    '';
  const previewText = previewSource.slice(0, PREVIEW_MAX);
  const hasPreview = previewText.length > 0;

  // When clickable (sessionId resolved + navigation available), the whole
  // card is a navigation button and the expanded panel is hidden — the
  // child session IS the expanded view. Mirrors opencode's `hideDetails`.
  if (clickable) {
    return (
      <button
        type="button"
        data-component="tool-trigger"
        data-pending={isPending ? 'true' : undefined}
        onClick={handleNavigate}
        aria-label={`Open subagent session${subtitle ? `: ${subtitle}` : ''}`}
      >
        {headerContent}
      </button>
    );
  }

  // Non-clickable fallback: classic collapsible. The trigger stays
  // enabled whenever we have any expandable content — either real tool
  // output OR the running-state preview (description/prompt). Previously
  // this rendered a `disabled` button during `running` with no output,
  // leaving the user clicking a dead row.
  const canExpand = hasOutput || hasPreview;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="w-full"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-component="tool-trigger"
          data-pending={isPending ? 'true' : undefined}
          aria-disabled={!canExpand || undefined}
          disabled={!canExpand}
        >
          {headerContent}
        </button>
      </CollapsibleTrigger>

      {hasOutput && tool.output && (
        <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
          <TaskOutputSection
            output={tool.output}
            parsedTaskId={parsedSessionId ?? sessionId ?? ''}
            onNavigateToSession={onNavigateToSession}
          />
        </CollapsibleContent>
      )}

      {!hasOutput && hasPreview && (
        <CollapsibleContent className="pl-6 pr-0 py-1">
          <div className="text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap break-words">
            {previewText}
            {previewSource.length > PREVIEW_MAX ? '…' : ''}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

export default TaskToolCard;
