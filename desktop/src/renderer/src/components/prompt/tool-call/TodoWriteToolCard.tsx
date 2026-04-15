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

function todoStatusIcon(status: TodoSnapshot['status']): string {
  switch (status) {
    case 'completed':
      return '●';
    case 'in_progress':
      return '◐';
    case 'cancelled':
      return '✕';
    default:
      return '○';
  }
}

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

  const completedCount = todos.filter(
    (todo) => todo.status === 'completed',
  ).length;
  const inProgressCount = todos.filter(
    (todo) => todo.status === 'in_progress',
  ).length;

  const statusColorClass: Record<TodoSnapshot['status'], string> = {
    pending: 'text-[var(--color-text-faint)]',
    in_progress: 'text-[var(--color-agent)]',
    completed: 'text-[var(--color-success,#22c55e)]',
    cancelled: 'text-[var(--color-error)]',
  };

  const statusLabel: Record<TodoSnapshot['status'], string> = {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Done',
    cancelled: 'Cancelled',
  };

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Todo list
        </span>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-faint)]">
          <span>
            {completedCount}/{todos.length} done
          </span>
          {inProgressCount > 0 && (
            <span className="text-[var(--color-agent)]">
              {inProgressCount} active
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {todos.map((todo, idx) => (
          <div
            key={`${todo.content}-${idx}`}
            className="flex items-start gap-2 rounded bg-[var(--color-surface)] px-2 py-1"
          >
            <span className={`${statusColorClass[todo.status]} mt-[1px]`}>
              {todoStatusIcon(todo.status)}
            </span>
            <span className="flex-1 text-[11px] text-[var(--color-text)] leading-snug">
              {todo.content}
            </span>
            <span
              className={`text-[9px] uppercase ${statusColorClass[todo.status]}`}
            >
              {statusLabel[todo.status]}
            </span>
            <span className="text-[9px] text-[var(--color-text-muted)] uppercase">
              {todo.priority}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default TodoWriteToolCard;
