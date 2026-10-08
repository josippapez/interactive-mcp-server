import React, { memo, useMemo } from 'react';
import type { ToolCallInfo } from '../../types/unified-message';
import MarkdownContent from '../MarkdownContent';
import ToolCallView from './ToolCallView';
import ContextToolGroup, {
  GATHER_CONTEXT_TOOL_NAME,
  groupContextTools,
} from './ContextToolGroup';
import {
  Reasoning,
  ReasoningTrigger,
  useReasoning,
} from '../ai-elements/reasoning';
import { CollapsibleContent } from '../ui/collapsible';

/**
 * Custom trigger body that matches the prior minimal "Thinking" pill:
 * a small caret + italic label, with a 60-char content preview when
 * collapsed. Rendered inside `ReasoningTrigger` via `children` so we
 * bypass the default brain icon / "Thinking for N seconds" affordance
 * but still get the Collapsible trigger wiring from AI Elements.
 */
const ReasoningTriggerBody = memo(function ReasoningTriggerBody({
  preview,
}: {
  preview: string;
}): React.ReactElement {
  const { isOpen } = useReasoning();
  return (
    <span className="flex items-center gap-1.5 text-[calc(var(--chat-message-size,13px)-2px)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
      <span className="text-[8px]">{isOpen ? '▾' : '▸'}</span>
      <span className="italic">Thinking</span>
      {!isOpen && (
        <span className="text-[var(--color-text-faint)] max-w-[200px] truncate">
          — {preview}...
        </span>
      )}
    </span>
  );
});

export const ReasoningSection = memo(function ReasoningSection({
  reasoning,
  defaultExpanded = false,
  isStreaming = false,
}: {
  reasoning: string;
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}): React.ReactElement {
  // Preserve previous behavior: strip the `[REDACTED]` marker that
  // upstream providers occasionally inject into reasoning traces and
  // treat empty/whitespace-only reasoning as a no-op.
  const content = reasoning.replace('[REDACTED]', '').trim();
  if (!content) return <></>;

  const preview = content.slice(0, 60);

  return (
    <Reasoning
      // `key` remounts the Collapsible when `defaultExpanded` flips so
      // the prop change reopens/closes the section (matches the prior
      // `useEffect(setIsExpanded)` behavior against the local state).
      key={`${defaultExpanded}`}
      data-slot="session-turn-reasoning"
      className="mt-1 mb-2"
      defaultOpen={defaultExpanded}
      isStreaming={isStreaming}
    >
      <ReasoningTrigger className="cursor-pointer">
        <ReasoningTriggerBody preview={preview} />
      </ReasoningTrigger>
      <CollapsibleContent className="mt-1 pl-3 border-l-2 border-[var(--color-tool)]/30 data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in">
        <MarkdownContent content={content} streaming={isStreaming} />
      </CollapsibleContent>
    </Reasoning>
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
    <div className="mt-1.5 min-w-0 w-full space-y-0.5 overflow-hidden">
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
        const singleTool = group.tool;
        const isExcluded = toolAutoExpandExclusions.some(
          (e) => e.toLowerCase() === singleTool.name.toLowerCase(),
        );
        const shouldExpand = expandAllTools && !isExcluded;
        return (
          <ToolCallView
            key={singleTool.id}
            tool={singleTool}
            forceExpanded={shouldExpand}
            onNavigateToSession={onNavigateToSession}
          />
        );
      })}
    </div>
  );
});
