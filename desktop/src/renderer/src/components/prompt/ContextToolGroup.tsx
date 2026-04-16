import React, { memo, useState, useCallback, useMemo } from 'react';
import type { ToolCallInfo } from '../../types/unified-message';
import ToolCallView from './ToolCallView';

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
  /** Callback to navigate to a session by openCodeSessionId */
  onNavigateToSession?: (sessionId: string) => void;
}

/**
 * Component that displays a collapsible group of context-gathering tools.
 * Shows a summary header like "Gathered context (5 files)" that expands
 * to show all the individual tool calls.
 */
const ContextToolGroup = memo(function ContextToolGroup({
  tools,
  forceExpanded = false,
  onNavigateToSession,
}: ContextToolGroupProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);

  React.useEffect(() => {
    setIsExpanded(forceExpanded);
  }, [forceExpanded]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

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

  // Check if all tools are completed
  const allCompleted = tools.every((t) => t.status === 'completed');
  const anyRunning = tools.some((t) => t.status === 'running');
  const anyError = tools.some((t) => t.status === 'error');

  const statusColor = anyError
    ? 'text-[var(--color-error)]'
    : anyRunning
      ? 'text-[var(--color-agent)]'
      : allCompleted
        ? 'text-[var(--color-success,#22c55e)]'
        : 'text-[var(--color-text-muted)]';

  return (
    <div className="rounded border border-[var(--color-border)]/50 bg-[var(--color-surface)]/35 overflow-hidden">
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full px-2 py-0.5 flex items-center justify-between text-left hover:bg-[var(--color-border)]/20 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`${statusColor} shrink-0`}>
            {anyRunning ? (
              <svg
                className="w-3.5 h-3.5 animate-spin"
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
            ) : (
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {GATHER_CONTEXT_TOOL_NAME}
          </span>
          <span className="text-[9px] text-[var(--color-text-faint)] truncate">
            {summary}
          </span>
        </div>
        <span className="text-[var(--color-text-faint)] text-[10px] shrink-0 ml-1">
          {isExpanded ? '▾' : '▸'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-border)]/40 px-1 py-0.5 space-y-0.5 bg-[var(--color-background)]/20">
          {tools.map((tool) => (
            <ToolCallView
              key={tool.id}
              tool={tool}
              forceExpanded={false}
              onNavigateToSession={onNavigateToSession}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default ContextToolGroup;
