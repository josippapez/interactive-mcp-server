import { memo, useMemo } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';

type TodoSnapshot = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
};

export function isTodoWriteToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'todowrite' || lower.includes('todowrite');
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

        if (char === '"') {
          inString = false;
        }

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
        if (depth === 0) {
          return raw.slice(start, i + 1);
        }
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

function parseTodoInput(
  input?: Record<string, unknown>,
): TodoSnapshot[] | null {
  const todos = input?.todos;
  if (!Array.isArray(todos)) return null;

  const normalized = todos.filter((item): item is TodoSnapshot => {
    return (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as TodoSnapshot).content === 'string' &&
      typeof (item as TodoSnapshot).status === 'string' &&
      typeof (item as TodoSnapshot).priority === 'string'
    );
  });

  return normalized.length > 0 ? normalized : null;
}

/**
 * Checkbox SVG per opencode `todowrite` reference:
 *
 * - pending: empty square
 * - in_progress: half-filled square (agent color via CSS)
 * - completed: filled square with check
 * - cancelled: square with X
 *
 * Sizing (12x12) and status-driven color come from CSS at
 * main.css `[data-component='todos'] [data-slot='todo-checkbox']`.
 */
const TodoCheckbox = memo(function TodoCheckbox({
  status,
}: {
  status: TodoSnapshot['status'];
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
  // pending
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

const TodoWriteToolCard = memo(function TodoWriteToolCard({
  tool,
}: {
  tool: ToolCallInfo;
}): React.ReactElement | null {
  const todos = useMemo(() => {
    const parsedOutput = parseTodoOutput(tool.output);
    if (parsedOutput) return parsedOutput;
    return parseTodoInput(tool.input);
  }, [tool.input, tool.output]);

  if (!todos || todos.length === 0) return null;

  return (
    <div data-component="todos">
      {todos.map((todo, idx) => (
        <div
          key={`${todo.content}-${idx}`}
          data-slot="todo-item"
          data-status={todo.status}
        >
          <TodoCheckbox status={todo.status} />
          <span>{todo.content}</span>
        </div>
      ))}
    </div>
  );
});

export default TodoWriteToolCard;
