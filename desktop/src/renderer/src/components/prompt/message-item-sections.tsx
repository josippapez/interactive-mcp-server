import React, { memo, useMemo } from 'react';
import type { ToolCallInfo } from '../../types/unified-message';
import MarkdownContent from '../MarkdownContent';
import ToolCallView from './ToolCallView';
import ContextToolGroup, {
  GATHER_CONTEXT_TOOL_NAME,
  groupContextTools,
} from './ContextToolGroup';

export const ReasoningSection = memo(function ReasoningSection({
  reasoning,
  defaultExpanded = false,
  isStreaming = false,
}: {
  reasoning: string;
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  React.useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const content = reasoning.replace('[REDACTED]', '').trim();
  if (!content) return <></>;

  return (
    <div className="mt-1 mb-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
      >
        <span className="text-[8px]">{isExpanded ? '▾' : '▸'}</span>
        <span className="italic">Thinking</span>
        {!isExpanded && (
          <span className="text-[var(--color-text-faint)] max-w-[200px] truncate">
            — {content.slice(0, 60)}...
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="mt-1 pl-3 border-l-2 border-[var(--color-tool)]/30">
          <div className="text-[11px] text-[var(--color-text-muted)]">
            <MarkdownContent content={content} streaming={isStreaming} />
          </div>
        </div>
      )}
    </div>
  );
});

export const ToolCallsSection = memo(function ToolCallsSection({
  toolCalls,
  expandAllTools,
  toolAutoExpandExclusions,
  onNavigateToSession,
}: {
  toolCalls: ToolCallInfo[];
  expandAllTools?: boolean;
  toolAutoExpandExclusions: string[];
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  const toolGroups = useMemo(() => groupContextTools(toolCalls), [toolCalls]);

  return (
    <div className="mt-1.5 space-y-0.5">
      {toolGroups.map((group) => {
        if (group.type === 'context' && group.tools) {
          const isExcluded = toolAutoExpandExclusions.some(
            (entry) =>
              entry.toLowerCase() === GATHER_CONTEXT_TOOL_NAME.toLowerCase(),
          );
          return (
            <ContextToolGroup
              key={`context-group-${group.tools.map((tool) => tool.id).join('-')}`}
              tools={group.tools}
              forceExpanded={Boolean(expandAllTools && !isExcluded)}
              onNavigateToSession={onNavigateToSession}
            />
          );
        }

        if (!group.tool) return null;
        const isExcluded = toolAutoExpandExclusions.some(
          (e) => e.toLowerCase() === group.tool.name.toLowerCase(),
        );
        const shouldExpand = expandAllTools && !isExcluded;
        return (
          <ToolCallView
            key={group.tool.id}
            tool={group.tool}
            forceExpanded={shouldExpand}
            onNavigateToSession={onNavigateToSession}
          />
        );
      })}
    </div>
  );
});
