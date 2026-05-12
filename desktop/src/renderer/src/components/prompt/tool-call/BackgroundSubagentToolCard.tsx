import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Eye,
  List,
  ListTodo,
  Loader,
  MessageSquare,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  ToolDurationBadge,
  ToolNameBadge,
  ToolSpinner,
} from './ToolCallShared';
import { resolveNextToolExpandedState } from './tool-expanded-state';
import {
  resolveBackgroundSubagentTitle,
  resolveAction,
  type SubagentAction,
} from './background-subagent-helpers';
import { useMessageCopy } from '../useMessageCopy';

export { resolveAction, type SubagentAction };

export function isBackgroundSubagentToolCall(toolName: string): boolean {
  return toolName.toLowerCase().includes('manage_background_subagents');
}

// ---------------------------------------------------------------------------
// Action metadata
// ---------------------------------------------------------------------------

interface ActionMeta {
  label: string;
  /** Tailwind/CSS-var colour token applied to the pill */
  colorClass: string;
  icon: React.ReactElement;
}

const ACTION_META: Record<SubagentAction, ActionMeta> = {
  start: {
    label: 'Start',
    colorClass:
      'bg-[var(--color-success-surface,#ecfdf5)] text-[var(--color-success,#16a34a)]',
    icon: <PlayCircle size={10} aria-hidden="true" />,
  },
  models: {
    label: 'Models',
    colorClass: 'bg-[var(--background-stronger)] text-[var(--text-weak)]',
    icon: <List size={10} aria-hidden="true" />,
  },
  list: {
    label: 'List',
    colorClass: 'bg-[var(--background-stronger)] text-[var(--text-weak)]',
    icon: <List size={10} aria-hidden="true" />,
  },
  status: {
    label: 'Status',
    colorClass:
      'bg-[var(--color-info-surface,#eff6ff)] text-[var(--color-info,#2563eb)]',
    icon: <Loader size={10} aria-hidden="true" />,
  },
  output: {
    label: 'Output',
    colorClass:
      'bg-[var(--color-info-surface,#eff6ff)] text-[var(--color-info,#2563eb)]',
    icon: <MessageSquare size={10} aria-hidden="true" />,
  },
  cancel: {
    label: 'Cancel',
    colorClass: 'bg-[var(--color-error-surface)] text-[var(--color-error)]',
    icon: <XCircle size={10} aria-hidden="true" />,
  },
};

const FALLBACK_ICON = <Eye size={10} aria-hidden="true" />;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveSessionId(tool: ToolCallInfo): string | null {
  const metaId = readString(tool.metadata?.['sessionId']);
  if (metaId) return metaId;
  const output = tool.output;
  if (output) {
    try {
      const parsed = JSON.parse(output) as {
        backgroundSubagent?: { sessionId?: unknown };
      };
      const sessionId = readString(parsed.backgroundSubagent?.sessionId);
      if (sessionId) return sessionId;
    } catch {
      // Fall through to null for non-JSON or in-flight output.
    }
    const match = output.match(/"sessionId"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function resolveTitle(tool: ToolCallInfo): string {
  return resolveBackgroundSubagentTitle(tool.input);
}

function resolveSubtitle(
  tool: ToolCallInfo,
  sessionId: string | null,
): string | null {
  const title = readString(tool.input?.['title']);
  if (title) return title;
  const providerId = readString(tool.input?.['providerId']);
  const modelId = readString(tool.input?.['modelId']);
  if (providerId && modelId) return `${providerId}/${modelId}`;
  if (sessionId) return sessionId.slice(0, 12);
  // Don't fall back to action string — the ActionBadge already shows it.
  return null;
}

// ---------------------------------------------------------------------------
// ActionBadge sub-component
// ---------------------------------------------------------------------------

const ActionBadge = memo(function ActionBadge({
  action,
}: {
  action: SubagentAction | null;
}): React.ReactElement | null {
  if (!action) return null;
  const meta = ACTION_META[action];
  return (
    <span
      data-slot="subagent-action-badge"
      data-action={action}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[calc(var(--chat-message-size,13px)-2px)] font-medium uppercase tracking-wide ${meta.colorClass}`}
      aria-label={`Action: ${meta.label}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
});

// ---------------------------------------------------------------------------
// Main card component
// ---------------------------------------------------------------------------

export const BackgroundSubagentToolCard = memo(
  function BackgroundSubagentToolCard({
    tool,
    forceExpanded,
    onNavigateToSession,
  }: {
    tool: ToolCallInfo;
    forceExpanded: boolean;
    onNavigateToSession?: (sessionId: string) => void;
  }): React.ReactElement {
    const isPending = tool.status === 'pending';
    const [isExpanded, setIsExpanded] = useState(forceExpanded || isPending);

    useEffect(() => {
      setIsExpanded((currentExpanded) =>
        resolveNextToolExpandedState({
          currentExpanded,
          forceExpanded,
          isPending,
        }),
      );
    }, [forceExpanded, isPending]);

    const action = resolveAction(tool.input);
    const sessionId = resolveSessionId(tool);
    const title = resolveTitle(tool);
    const subtitle = resolveSubtitle(tool, sessionId);
    const { copied: outputCopied, copy: copyOutput } = useMessageCopy();

    // Navigable for start/output/status (when we have a session ID), not for
    // list/cancel where there is no child session to open.
    const navigableActions: Array<SubagentAction | null> = [
      'start',
      'status',
      'output',
    ];
    const clickable = Boolean(
      sessionId &&
      onNavigateToSession &&
      (action === null || navigableActions.includes(action)),
    );
    const isRunning = tool.status === 'running' || tool.status === 'pending';
    const isError = tool.status === 'error';

    const handleNavigate = useCallback(
      (event: React.MouseEvent) => {
        if (!sessionId || !onNavigateToSession) return;
        event.preventDefault();
        event.stopPropagation();
        onNavigateToSession(sessionId);
      },
      [onNavigateToSession, sessionId],
    );

    const leadingIcon = isRunning ? (
      <span className="inline-flex items-center text-[var(--color-agent)]">
        <ToolSpinner />
      </span>
    ) : action !== null ? (
      <span className="inline-flex items-center text-[var(--color-agent)]">
        {ACTION_META[action]?.icon ?? FALLBACK_ICON}
      </span>
    ) : (
      <ListTodo data-slot="tool-icon" aria-hidden="true" />
    );

    const headerContent = (
      <>
        {leadingIcon}
        <span
          data-slot="tool-title"
          style={{
            color: isError ? 'var(--color-error)' : 'var(--color-agent)',
            borderBottom: isError ? '1px solid var(--color-error)' : undefined,
          }}
        >
          {title}
        </span>
        <ToolNameBadge name={tool.name} />
        <ActionBadge action={action} />
        {subtitle && (
          <span data-slot="tool-subtitle" title={subtitle}>
            {subtitle}
          </span>
        )}
        <ToolDurationBadge tool={tool} />
        {isError && (
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-[var(--color-error)]">
            Error
          </span>
        )}
        {clickable ? (
          <ArrowUpRight
            data-slot="tool-chevron"
            size={12}
            aria-hidden="true"
            className="ml-auto shrink-0 text-[var(--icon-weaker)]"
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

    if (clickable) {
      return (
        <button
          type="button"
          data-component="tool-trigger"
          data-pending={isPending ? 'true' : undefined}
          onClick={handleNavigate}
          aria-label={`Open background subagent session${subtitle ? `: ${subtitle}` : ''}`}
        >
          {headerContent}
        </button>
      );
    }

    const prompt = readString(tool.input?.['prompt']);
    const canExpand = Boolean(prompt || tool.output);
    const copyableOutput = tool.output || prompt || '';

    return (
      <Collapsible
        open={isExpanded}
        onOpenChange={setIsExpanded}
        className="w-full"
      >
        <CollapsibleTrigger
          render={
            <button
              type="button"
              data-component="tool-trigger"
              data-pending={isPending ? 'true' : undefined}
              aria-disabled={!canExpand || undefined}
              disabled={!canExpand}
            >
              {headerContent}
            </button>
          }
        />
        {canExpand && (
          <CollapsibleContent className="pl-6 pr-0 py-1">
            {copyableOutput && (
              <button
                type="button"
                onClick={() => void copyOutput(copyableOutput)}
                className="mb-1 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                aria-label="Copy background subagent output"
              >
                {outputCopied ? 'Copied' : 'Copy output'}
              </button>
            )}
            <div className="text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap break-words">
              {copyableOutput}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    );
  },
);

export default BackgroundSubagentToolCard;
