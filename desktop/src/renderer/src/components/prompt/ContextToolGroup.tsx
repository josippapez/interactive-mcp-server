import React, { memo, useMemo } from 'react';
import type { ToolCallInfo } from '../../types/unified-message';
import ToolCallView from './ToolCallView';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';

export const GATHER_CONTEXT_TOOL_NAME = 'Gather Context';

/**
 * Context tool names that should be grouped together.
 * These are typically read-only tools used for gathering information.
 */
const CONTEXT_TOOL_PATTERNS = [
  'read',
  'glob',
  'grep',
  'list',
  'search',
  'find',
  'cat',
  'head',
  'tail',
  'ls',
  'tree',
  'repo-docs',
  'find_docs',
  'list_docs',
  'read_doc',
  'find_libs',
  'resolve-library',
  'query-docs',
  'webfetch',
  'fetch',
];

/**
 * Check if a tool is a context-gathering tool.
 */
export function isContextTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  // Check for MCP-prefixed tools (e.g., mcp__opencode__read)
  const baseName = lower.includes('__')
    ? lower.split('__').pop() || lower
    : lower;

  return CONTEXT_TOOL_PATTERNS.some(
    (pattern) => baseName === pattern || baseName.includes(pattern),
  );
}

/**
 * Group consecutive context tools together.
 * Returns an array of groups where each group is either:
 * - { type: 'context', tools: ToolCallInfo[] } for grouped context tools
 * - { type: 'single', tool: ToolCallInfo } for non-context tools
 */
export interface ToolGroup {
  type: 'context' | 'single';
  tools?: ToolCallInfo[];
  tool?: ToolCallInfo;
}

export function groupContextTools(tools: ToolCallInfo[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  let contextBuffer: ToolCallInfo[] = [];

  const flushContextBuffer = () => {
    if (contextBuffer.length === 0) return;

    if (contextBuffer.length === 1) {
      // Single context tool - don't group it
      groups.push({ type: 'single', tool: contextBuffer[0] });
    } else {
      // Multiple context tools - group them
      groups.push({ type: 'context', tools: [...contextBuffer] });
    }
    contextBuffer = [];
  };

  for (const tool of tools) {
    if (isContextTool(tool.name)) {
      contextBuffer.push(tool);
    } else {
      // Flush any buffered context tools
      flushContextBuffer();
      // Add non-context tool as single
      groups.push({ type: 'single', tool });
    }
  }

  // Flush remaining context tools
  flushContextBuffer();

  return groups;
}

/**
 * Props for ContextToolGroup component.
 */
interface ContextToolGroupProps {
  tools: ToolCallInfo[];
  /** Whether to expand all tool calls by default */
  forceExpanded?: boolean;
  /** Callback to navigate to a session by providerSessionId */
  onNavigateToSession?: (sessionId: string) => void;
}

/**
 * Chevron SVG used by the context-tool-group trigger. The CSS layer
 * (`[data-component='context-tool-group-trigger'][data-state='open']
 * [data-slot='chevron']`) rotates it 90° when the group is open.
 */
const Chevron = memo(function Chevron(): React.ReactElement {
  return (
    <svg
      data-slot="chevron"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3 h-3"
      aria-hidden="true"
    >
      <path d="M4.5 3L7.5 6L4.5 9" />
    </svg>
  );
});

/**
 * Spinner shown when any grouped tool is still running. Sized to match
 * the chevron (12x12) so the trigger row height stays consistent.
 */
const RunningSpinner = memo(function RunningSpinner(): React.ReactElement {
  return (
    <svg
      className="w-3 h-3 animate-spin text-[var(--color-agent)] shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
});

/**
 * Component that displays a collapsible group of context-gathering tools.
 * Shows a summary header like "Gathered context (5 files)" that expands
 * to show all the individual tool calls.
 *
 * Emits `data-component='context-tool-group-trigger'` on the trigger
 * button and `data-component='context-tool-group-list'` on the body,
 * matching the opencode CSS contract (main.css 1138-1166). Radix
 * `Collapsible` forwards `data-state='open'|'closed'` to the trigger,
 * which CSS uses to rotate the chevron.
 *
 * The `forceExpanded` prop drives `defaultOpen`, and we re-key on the
 * prop so changes to `forceExpanded` reopen/close as before.
 */
const ContextToolGroup = memo(function ContextToolGroup({
  tools,
  forceExpanded = false,
  onNavigateToSession,
}: ContextToolGroupProps): React.ReactElement {
  // Generate summary of what was gathered
  const summary = useMemo(() => {
    const readCount = tools.filter((t) =>
      t.name.toLowerCase().includes('read'),
    ).length;
    const searchCount = tools.filter(
      (t) =>
        t.name.toLowerCase().includes('grep') ||
        t.name.toLowerCase().includes('glob') ||
        t.name.toLowerCase().includes('search') ||
        t.name.toLowerCase().includes('find'),
    ).length;
    const webCount = tools.filter(
      (t) =>
        t.name.toLowerCase().includes('fetch') ||
        t.name.toLowerCase().includes('web'),
    ).length;

    const parts: string[] = [];
    if (readCount > 0)
      parts.push(`${readCount} file${readCount > 1 ? 's' : ''}`);
    if (searchCount > 0)
      parts.push(`${searchCount} search${searchCount > 1 ? 'es' : ''}`);
    if (webCount > 0)
      parts.push(`${webCount} web fetch${webCount > 1 ? 'es' : ''}`);

    if (parts.length === 0) {
      return `${tools.length} tool${tools.length > 1 ? 's' : ''}`;
    }
    return parts.join(', ');
  }, [tools]);

  const anyRunning = tools.some((t) => t.status === 'running');

  return (
    <Collapsible
      // `key` forces a remount when `forceExpanded` flips, so `defaultOpen`
      // takes effect both when expanding-all and collapsing-all from the
      // toolbar — matching previous `useEffect(setIsExpanded)` behavior.
      key={forceExpanded ? 'expanded' : 'collapsed'}
      defaultOpen={forceExpanded}
      className="w-full"
    >
      <CollapsibleTrigger
        render={
          <button type="button" data-component="context-tool-group-trigger">
            <span className="text-[var(--text-base)]">
              {GATHER_CONTEXT_TOOL_NAME}
            </span>
            <span className="text-[var(--text-weaker)] truncate flex-1">
              {summary}
            </span>
            {anyRunning ? <RunningSpinner /> : <Chevron />}
          </button>
        }
      />

      <CollapsibleContent data-component="context-tool-group-list">
        {tools.map((tool) => (
          <ToolCallView
            key={tool.id}
            tool={tool}
            forceExpanded={false}
            onNavigateToSession={onNavigateToSession}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});

export default ContextToolGroup;
