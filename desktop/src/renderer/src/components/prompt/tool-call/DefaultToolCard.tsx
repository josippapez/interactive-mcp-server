import React, { memo, useCallback, useEffect, useState } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  formatInputCompact,
  getToolInputSummary,
  ToolStatusBadge,
} from './ToolCallShared';

type BashOutputSection = {
  title: string;
  body: string;
};

type BashOutputCardData = {
  sections: BashOutputSection[];
  reminder?: string;
};

type GrepResultItem = {
  file: string;
  lines: string[];
};

function isBashToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'bash' || lower.includes('bash');
}

function isGrepToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'grep' || lower.includes('grep');
}

function isTaskToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'task' || lower === 'mcp__opencode__task';
}

function parseTaskId(output?: string): string | null {
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

function parseBashOutput(output?: string): BashOutputCardData | null {
  if (!output) return null;

  const trimmed = output.trim();
  if (!trimmed) return null;

  const reminderMarker = '\n---\n[test-reminder]';
  const reminderIndex = trimmed.indexOf(reminderMarker);

  const mainOutput =
    reminderIndex >= 0 ? trimmed.slice(0, reminderIndex).trim() : trimmed;
  const reminder =
    reminderIndex >= 0 ? trimmed.slice(reminderIndex + 5).trim() : undefined;

  const codeBlockMatch = mainOutput.match(/```(?:\w+)?\n([\s\S]*?)```/);
  const commandOutput = codeBlockMatch ? codeBlockMatch[1].trim() : mainOutput;

  const sections: BashOutputSection[] = [];
  const lines = commandOutput.split('\n');

  if (lines.length > 0 && lines[0].startsWith('> ')) {
    const command = lines.slice(0, 2).join('\n').trim();
    if (command) {
      sections.push({ title: 'Command', body: command });
    }

    const remaining = lines.slice(2).join('\n').trim();
    if (remaining) {
      sections.push({ title: 'Result', body: remaining });
    }
  } else if (commandOutput) {
    sections.push({ title: 'Result', body: commandOutput });
  }

  if (sections.length === 0 && !reminder) return null;
  return { sections, reminder };
}

function parseGrepOutput(output?: string): GrepResultItem[] | null {
  if (!output) return null;

  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const results: GrepResultItem[] = [];
  let current: GrepResultItem | null = null;

  for (const line of lines) {
    if (line.endsWith(':')) {
      if (current) {
        results.push(current);
      }
      current = { file: line.slice(0, -1), lines: [] };
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
  }

  if (current) {
    results.push(current);
  }

  return results.length > 0 ? results : null;
}

const ToolHeader = memo(function ToolHeader({
  tool,
  inputSummary,
  isExpanded,
  onToggle,
}: {
  tool: ToolCallInfo;
  inputSummary: string | null;
  isExpanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-2 py-0.5 flex items-center justify-between text-left hover:bg-[var(--color-border)]/30 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="text-[var(--color-tool)] font-mono text-[10px] shrink-0">
          {tool.name}
        </span>
        {inputSummary && (
          <span className="text-[var(--color-text-muted)] font-mono text-[10px] truncate">
            {inputSummary}
          </span>
        )}
        <ToolStatusBadge status={tool.status} />
      </div>
      <span className="text-[var(--color-text-muted)] text-[10px] shrink-0 ml-1">
        {isExpanded ? '▾' : '▸'}
      </span>
    </button>
  );
});

const TaskSessionLink = memo(function TaskSessionLink({
  taskId,
  onNavigateToSession,
}: {
  taskId: string;
  onNavigateToSession: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onNavigateToSession(taskId)}
      className="w-full px-2 py-1 flex items-center gap-2 bg-gradient-to-r from-[var(--color-agent)]/15 via-[var(--color-agent)]/10 to-transparent border-b border-[var(--color-agent)]/30 hover:from-[var(--color-agent)]/25 hover:via-[var(--color-agent)]/15 transition-colors cursor-pointer group"
      title="Click to open subagent session"
    >
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-agent)]/20 text-[var(--color-agent)] group-hover:bg-[var(--color-agent)]/30 transition-colors">
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 3H3a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-2" />
          <path d="M9 2h5v5" />
          <path d="M14 2L7 9" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-medium text-[var(--color-agent)]">
          Open Subagent Session
        </span>
        <span className="ml-1.5 text-[9px] font-mono text-[var(--color-text-muted)] truncate">
          {taskId}
        </span>
      </div>
      <span className="text-[var(--color-agent)] opacity-60 group-hover:opacity-100 transition-opacity text-xs">
        →
      </span>
    </button>
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
    <div className="border-b border-[var(--color-border)]/50">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2 py-0.5 flex items-center gap-1.5 text-left hover:bg-[var(--color-border)]/20 transition-colors cursor-pointer"
      >
        <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] font-medium">
          Input
        </span>
        <span className="text-[9px] text-[var(--color-text-faint)]">
          {showFullInput ? '(hide)' : '(show)'}
        </span>
      </button>
      {showFullInput && (
        <pre className="px-2 pb-1.5 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-background)]/50 overflow-x-auto max-h-32 whitespace-pre-wrap">
          {formatInputCompact(input)}
        </pre>
      )}
    </div>
  );
});

const TaskOutputSection = memo(function TaskOutputSection({
  output,
  parsedTaskId,
  onNavigateToSession,
}: {
  output: string;
  parsedTaskId: string;
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <div className="text-[10px] font-mono text-[var(--color-text)] bg-[var(--color-background)] p-1.5 rounded overflow-x-auto max-h-48 whitespace-pre-wrap border-l-2 border-[var(--color-success,#22c55e)]/40">
      {onNavigateToSession ? (
        <button
          type="button"
          onClick={() => onNavigateToSession(parsedTaskId)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mb-1.5 rounded bg-[var(--color-agent)]/10 border border-[var(--color-agent)]/30 text-[var(--color-agent)] hover:bg-[var(--color-agent)]/20 hover:border-[var(--color-agent)]/50 transition-colors cursor-pointer text-[10px]"
          title="Click to open subagent channel"
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
          >
            <path d="M5 3H3a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-2" />
            <path d="M9 2h5v5" />
            <path d="M14 2L7 9" />
          </svg>
          <span>Open Subagent: {parsedTaskId}</span>
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 px-1 py-0.5 mb-1.5 rounded bg-[var(--color-tool)]/10 text-[var(--color-tool)] text-[9px]">
          Subagent: {parsedTaskId}
        </span>
      )}
      <pre className="whitespace-pre-wrap">{output}</pre>
    </div>
  );
});

const GenericOutputSection = memo(function GenericOutputSection({
  output,
}: {
  output: string;
}): React.ReactElement {
  return (
    <pre className="text-[10px] font-mono text-[var(--color-text)] bg-[var(--color-background)] p-1.5 rounded overflow-x-auto max-h-48 whitespace-pre-wrap border-l-2 border-[var(--color-success,#22c55e)]/40">
      {output}
    </pre>
  );
});

const BashOutputSection = memo(function BashOutputSection({
  data,
}: {
  data: BashOutputCardData;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      {data.sections.map((section) => (
        <div
          key={section.title}
          className="rounded border border-[var(--color-border)] bg-[var(--color-background)]/75"
        >
          <div className="px-2 py-1 border-b border-[var(--color-border)]/60 text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] font-medium">
            {section.title}
          </div>
          <pre className="px-2 py-1.5 text-[10px] font-mono text-[var(--color-text)] overflow-x-auto max-h-48 whitespace-pre-wrap">
            {section.body}
          </pre>
        </div>
      ))}

      {data.reminder && (
        <div className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/8 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wide text-[var(--color-warning)] font-medium mb-0.5">
            Test reminder
          </div>
          <pre className="text-[10px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap">
            {data.reminder}
          </pre>
        </div>
      )}
    </div>
  );
});

const GrepOutputSection = memo(function GrepOutputSection({
  results,
}: {
  results: GrepResultItem[];
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      {results.map((result) => (
        <div
          key={result.file}
          className="rounded border border-[var(--color-border)] bg-[var(--color-background)]/75"
        >
          <div className="px-2 py-1 border-b border-[var(--color-border)]/60 text-[10px] font-mono text-[var(--color-tool)] truncate">
            {result.file}
          </div>
          <div className="px-2 py-1.5 space-y-0.5">
            {result.lines.map((line, index) => (
              <div
                key={`${result.file}-${index}`}
                className="text-[10px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap"
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

const OutputSection = memo(function OutputSection({
  tool,
  onNavigateToSession,
}: {
  tool: ToolCallInfo;
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  if (!tool.output) {
    return <></>;
  }

  const parsedTaskId = isTaskToolCall(tool.name)
    ? parseTaskId(tool.output)
    : null;
  const parsedBashOutput = isBashToolCall(tool.name)
    ? parseBashOutput(tool.output)
    : null;
  const parsedGrepOutput = isGrepToolCall(tool.name)
    ? parseGrepOutput(tool.output)
    : null;

  return (
    <div className="px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-[var(--color-success,#22c55e)] font-medium mb-0.5">
        Output
      </div>
      {parsedTaskId ? (
        <TaskOutputSection
          output={tool.output}
          parsedTaskId={parsedTaskId}
          onNavigateToSession={onNavigateToSession}
        />
      ) : parsedBashOutput ? (
        <BashOutputSection data={parsedBashOutput} />
      ) : parsedGrepOutput ? (
        <GrepOutputSection results={parsedGrepOutput} />
      ) : (
        <GenericOutputSection output={tool.output} />
      )}
    </div>
  );
});

export const DefaultToolCard = memo(function DefaultToolCard({
  tool,
  forceExpanded,
  onNavigateToSession,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);
  const [showFullInput, setShowFullInput] = useState(false);

  useEffect(() => {
    setIsExpanded(forceExpanded);
  }, [forceExpanded]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const toggleFullInput = useCallback(() => {
    setShowFullInput((prev) => !prev);
  }, []);

  const inputSummary = getToolInputSummary(tool.name, tool.input);
  const hasInput = Boolean(tool.input && Object.keys(tool.input).length > 0);
  const hasOutput = Boolean(tool.output);
  const isTask = isTaskToolCall(tool.name);
  const taskId = isTask ? getTaskSessionId(tool.metadata, tool.output) : null;

  return (
    <div className="border border-[var(--color-border)] rounded overflow-hidden bg-[var(--color-surface)]">
      {isTask && taskId && onNavigateToSession && (
        <TaskSessionLink
          taskId={taskId}
          onNavigateToSession={onNavigateToSession}
        />
      )}

      <ToolHeader
        tool={tool}
        inputSummary={inputSummary}
        isExpanded={isExpanded}
        onToggle={toggleExpanded}
      />

      {isExpanded && (hasInput || hasOutput) && (
        <div className="border-t border-[var(--color-border)]">
          {hasInput && tool.input && (
            <InputSection
              input={tool.input}
              showFullInput={showFullInput}
              onToggle={toggleFullInput}
            />
          )}
          {hasOutput && (
            <OutputSection
              tool={tool}
              onNavigateToSession={onNavigateToSession}
            />
          )}
        </div>
      )}
    </div>
  );
});
