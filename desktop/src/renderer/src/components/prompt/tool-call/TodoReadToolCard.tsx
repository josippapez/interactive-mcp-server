import React, { memo, useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  HighlightedCodeBlock,
  WrapToggleCodeBlock,
  guessOutputLanguage,
} from './ToolCallShared';
import {
  ToolChevron,
  ToolDurationBadge,
  ToolNameBadge,
  ToolStatusBadge,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';
import { resolveNextToolExpandedState } from './tool-expanded-state';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TodoPriority = 'high' | 'medium' | 'low';

type TodoSnapshot = {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
};

export function isTodoReadToolCall(toolName: string): boolean {
  if (classifyTool(toolName) !== 'todo') return false;
  return toolName.toLowerCase().includes('read');
}

function parseTodoOutput(output?: string): TodoSnapshot[] | null {
  if (!output) return null;

  const extractFirstJsonArray = (raw: string): string | null => {
    const start = raw.indexOf('[');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const char = raw[i];
      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (char === '\\') {
          isEscaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '[') {
        depth += 1;
        continue;
      }
      if (char === ']') {
        depth -= 1;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
    return null;
  };

  const parseCandidate = (raw: string): TodoSnapshot[] | null => {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const todos = parsed.filter((item): item is TodoSnapshot => {
        return (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as TodoSnapshot).content === 'string' &&
          typeof (item as TodoSnapshot).status === 'string' &&
          typeof (item as TodoSnapshot).priority === 'string'
        );
      });
      return todos.length > 0 ? todos : null;
    } catch {
      return null;
    }
  };

  const direct = parseCandidate(output);
  if (direct) return direct;

  const fencedBlocks = output.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [];
  for (const block of fencedBlocks) {
    const content = block.replace(/```(?:json)?\s*/i, '').replace(/```$/, '');
    const fencedDirect = parseCandidate(content.trim());
    if (fencedDirect) return fencedDirect;
    const fencedArray = extractFirstJsonArray(content);
    if (!fencedArray) continue;
    const parsedFencedArray = parseCandidate(fencedArray);
    if (parsedFencedArray) return parsedFencedArray;
  }

  const arrayCandidate = extractFirstJsonArray(output);
  if (!arrayCandidate) return null;
  return parseCandidate(arrayCandidate);
}

/**
 * Read-only mirror of the checkbox used by TodoWriteToolCard. Duplicated
 * intentionally so TodoWriteToolCard stays untouched (read-only per spec).
 */
const TodoCheckbox = memo(function TodoCheckbox({
  status,
}: {
  status: TodoStatus;
}): React.ReactElement {
  if (status === 'completed') {
    return (
      <svg
        data-slot="todo-checkbox"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
        <path d="M3.75 6L5.25 7.5L8.25 4.5" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg
        data-slot="todo-checkbox"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
        <path d="M6 1.5V10.5" stroke="currentColor" />
        <path d="M1.5 6H6V10.5H1.5Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (status === 'cancelled') {
    return (
      <svg
        data-slot="todo-checkbox"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
        <path d="M4 4L8 8M8 4L4 8" />
      </svg>
    );
  }
  return (
    <svg
      data-slot="todo-checkbox"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
    </svg>
  );
});

const PRIORITY_PILL: Record<TodoPriority, string> = {
  high: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
  medium: 'bg-[var(--background-stronger)] text-[var(--text-weak)]',
  low: 'bg-[var(--background-stronger)] text-[var(--text-weak)]',
};

const TodoReadToolCard = memo(function TodoReadToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
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

  const todos = useMemo(() => parseTodoOutput(tool.output), [tool.output]);

  const progress = useMemo(() => {
    if (!todos) return null;
    const total = todos.length;
    const completed = todos.filter((t) => t.status === 'completed').length;
    return { total, completed };
  }, [todos]);

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
            data-component="todoread-trigger"
            data-pending={isPending ? 'true' : undefined}
          >
            <ListChecks
              data-slot="tool-icon"
              aria-hidden="true"
              className="shrink-0"
            />
            <span data-slot="tool-title">Todos</span>
            <ToolNameBadge name={tool.name} />
            {progress && (
              <span
                data-slot="tool-subtitle"
                className="font-mono text-[var(--text-weak)]"
              >
                {progress.completed}/{progress.total}
              </span>
            )}
            <ToolDurationBadge tool={tool} />
            <ToolStatusBadge status={tool.status} />
            <ToolChevron />
          </button>
        }
      />

      <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
        {todos && todos.length > 0 ? (
          <div data-component="todos">
            {todos.map((todo, idx) => (
              <div
                key={`${todo.content}-${idx}`}
                data-slot="todo-item"
                data-status={todo.status}
              >
                <TodoCheckbox status={todo.status} />
                <span className="flex-1">{todo.content}</span>
                {todo.priority && todo.priority !== 'medium' && (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                      PRIORITY_PILL[todo.priority] ?? PRIORITY_PILL.medium
                    }`}
                  >
                    {todo.priority}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : tool.output ? (
          (() => {
            const language = guessOutputLanguage(tool.output);
            return language ? (
              <HighlightedCodeBlock
                text={tool.output}
                language={language}
                maxHeightClass="max-h-48"
                preClassName="text-[var(--text-weak)]"
              />
            ) : (
              <WrapToggleCodeBlock
                text={tool.output}
                maxHeightClass="max-h-48"
                preClassName="text-[var(--text-weak)]"
              />
            );
          })()
        ) : (
          <div className="text-[10px] text-[var(--text-weak)]">No todos</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});

TodoReadToolCard.displayName = 'TodoReadToolCard';

export { TodoReadToolCard };
export default TodoReadToolCard;
