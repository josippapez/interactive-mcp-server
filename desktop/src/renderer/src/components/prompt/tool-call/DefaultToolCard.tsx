import React, { memo, useCallback, useEffect, useState } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  HighlightedCodeBlock,
  TOOL_CALL_LABEL_TEXT_CLASS,
  TOOL_CALL_MONO_TEXT_CLASS,
  ToolNameBadge,
  ToolDurationBadge,
  ToolStatusBadge,
  WrapToggleCodeBlock,
  formatInputCompact,
  getToolInputSummary,
  guessOutputLanguage,
} from './ToolCallShared';
import { getToolPresentation } from './tool-registry';
import { resolveNextToolExpandedState } from './tool-expanded-state';
import { shouldShowToolSubtitle } from './tool-name-display';

export function parseTaskId(output?: string): string | null {
  if (!output) return null;
  const taskIdMatch = output.match(/"task_id"\s*:\s*"([^"]+)"/);
  if (taskIdMatch) return taskIdMatch[1];
  const simpleMatch = output.match(/task_id:\s*(\S+)/);
  if (simpleMatch) return simpleMatch[1];
  return null;
}

export function getTaskSessionId(
  metadata?: Record<string, unknown>,
  output?: string,
): string | null {
  if (metadata?.sessionId && typeof metadata.sessionId === 'string') {
    return metadata.sessionId;
  }
  return parseTaskId(output);
}

/**
 * Chevron rendered at the right of a tool trigger row. CSS rotates it
 * 90° when the trigger carries `data-state='open'`.
 */
const ToolChevron = memo(function ToolChevron(): React.ReactElement {
  return (
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
  );
});

const InputSection = memo(function InputSection({
  input,
  showFullInput,
  onToggle,
}: {
  input: Record<string, unknown>;
  showFullInput: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="px-0 py-0.5 flex items-center gap-1.5 text-left hover:text-[var(--text-strong)] transition-colors cursor-pointer"
      >
        <span className="text-[9px] uppercase tracking-wide text-[var(--text-weaker)] font-medium">
          Input
        </span>
        <span
          className={`${TOOL_CALL_LABEL_TEXT_CLASS} text-[var(--text-weaker)]`}
        >
          {showFullInput ? '(hide)' : '(show)'}
        </span>
      </button>
      {showFullInput && (
        <HighlightedCodeBlock
          text={formatInputCompact(input)}
          language="json"
          maxHeightClass="max-h-32"
          containerClassName="mt-1"
          preClassName={`text-[var(--text-weak)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
        />
      )}
    </div>
  );
});

export const TaskOutputSection = memo(function TaskOutputSection({
  output,
  parsedTaskId,
  onNavigateToSession,
}: {
  output: string;
  parsedTaskId: string;
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  const language = guessOutputLanguage(output);
  return (
    <div data-component="task-tool-card">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className={`font-mono text-[var(--text-weak)] truncate ${TOOL_CALL_MONO_TEXT_CLASS}`}
        >
          Subagent: {parsedTaskId}
        </span>
        {onNavigateToSession && parsedTaskId && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToSession(parsedTaskId);
            }}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-agent)]/15 border border-[var(--color-agent)]/30 text-[var(--color-agent)] hover:bg-[var(--color-agent)]/25 transition-colors cursor-pointer ${TOOL_CALL_MONO_TEXT_CLASS}`}
            title="Click to open subagent session"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 3H3a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-2" />
              <path d="M9 2h5v5" />
              <path d="M14 2L7 9" />
            </svg>
            <span>Open Subagent</span>
          </button>
        )}
      </div>
      {language ? (
        <HighlightedCodeBlock
          text={output}
          language={language}
          maxHeightClass="max-h-48"
          preClassName={`text-[var(--text-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
        />
      ) : (
        <WrapToggleCodeBlock
          text={output}
          maxHeightClass="max-h-48"
          preClassName={`text-[var(--text-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
        />
      )}
    </div>
  );
});

const GenericOutputSection = memo(function GenericOutputSection({
  output,
}: {
  output: string;
}): React.ReactElement {
  const language = guessOutputLanguage(output);
  if (language) {
    return (
      <HighlightedCodeBlock
        text={output}
        language={language}
        maxHeightClass="max-h-48"
        preClassName={TOOL_CALL_MONO_TEXT_CLASS}
      />
    );
  }
  return (
    <WrapToggleCodeBlock
      text={output}
      maxHeightClass="max-h-48"
      preClassName={TOOL_CALL_MONO_TEXT_CLASS}
    />
  );
});

const OutputSection = memo(function OutputSection({
  tool,
}: {
  tool: ToolCallInfo;
}): React.ReactElement {
  if (!tool.output) {
    return <></>;
  }
  return <GenericOutputSection output={tool.output} />;
});

export const DefaultToolCard = memo(function DefaultToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
}): React.ReactElement {
  const isPending = tool.status === 'pending';
  const [isExpanded, setIsExpanded] = useState(forceExpanded || isPending);
  const [showFullInput, setShowFullInput] = useState(false);

  useEffect(() => {
    setIsExpanded((currentExpanded) =>
      resolveNextToolExpandedState({
        currentExpanded,
        forceExpanded,
        isPending,
      }),
    );
  }, [forceExpanded, isPending]);

  const toggleFullInput = useCallback(() => {
    setShowFullInput((prev) => !prev);
  }, []);

  const presentation = getToolPresentation(tool.name, tool.input);
  const RegistryIcon = presentation.icon;
  const title = tool.title ?? presentation.title;
  const rawInputSummary =
    presentation.subtitle ?? getToolInputSummary(tool.name, tool.input);
  const inputSummary = shouldShowToolSubtitle(title, rawInputSummary)
    ? rawInputSummary
    : null;
  const hasInput = Boolean(tool.input && Object.keys(tool.input).length > 0);
  const hasOutput = Boolean(tool.output);

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
          >
            <RegistryIcon
              data-slot="tool-icon"
              aria-hidden="true"
              className="shrink-0"
            />
            <span data-slot="tool-title">{title}</span>
            <ToolNameBadge name={tool.name} />
            {inputSummary && (
              <span data-slot="tool-subtitle" title={inputSummary}>
                {inputSummary}
              </span>
            )}
            <ToolDurationBadge tool={tool} />
            <ToolStatusBadge status={tool.status} />
            <ToolChevron />
          </button>
        }
      />

      {(hasInput || hasOutput) && (
        <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
          {hasInput && tool.input && (
            <InputSection
              input={tool.input}
              showFullInput={showFullInput}
              onToggle={toggleFullInput}
            />
          )}
          {hasOutput && <OutputSection tool={tool} />}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});
