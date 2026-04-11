import React, { memo, useMemo, useState, useEffect, useRef } from 'react';
import {
  isEditToolCall,
  parseEditToolInput,
  generateUnifiedDiff,
  parseDiffLines,
  type DiffLine,
} from '../../lib/diff-parser';
import type { ToolCallInfo } from '../../types/unified-message';

type DiffViewProps = {
  /** The tool call to render */
  tool: ToolCallInfo;
};

/** Minimum width (px) to show side-by-side view */
const SIDE_BY_SIDE_MIN_WIDTH = 600;

/**
 * Render a single diff line with TUI-style inline formatting (unified view).
 */
const UnifiedDiffLine = memo(function UnifiedDiffLine({
  line,
}: {
  line: DiffLine;
}): React.ReactElement | null {
  if (line.type === 'header' || line.type === 'hunk') return null;

  const typeStyles: Record<DiffLine['type'], string> = {
    header: '',
    hunk: '',
    context: 'text-[var(--color-text-muted)]',
    addition: 'text-[var(--color-success)] bg-[var(--color-success)]/10',
    removal: 'text-[var(--color-error)] bg-[var(--color-error)]/10',
  };

  const linePrefix: Record<DiffLine['type'], string> = {
    header: '',
    hunk: '',
    context: ' ',
    addition: '+',
    removal: '-',
  };

  return (
    <div
      className={`font-mono text-[11px] leading-snug px-2 ${typeStyles[line.type]}`}
    >
      <span className="select-none opacity-60 mr-1">
        {linePrefix[line.type]}
      </span>
      <span className="whitespace-pre-wrap">{line.content}</span>
    </div>
  );
});

/**
 * Group consecutive diff lines into pairs for side-by-side view.
 * Returns arrays of [removals, additions, context] grouped together.
 */
function groupLinesForSideBySide(
  lines: DiffLine[],
): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const result: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'context') {
      // Context lines appear on both sides
      result.push({ left: line, right: line });
      i++;
    } else if (line.type === 'removal') {
      // Collect consecutive removals
      const removals: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'removal') {
        removals.push(lines[i]);
        i++;
      }

      // Collect consecutive additions
      const additions: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'addition') {
        additions.push(lines[i]);
        i++;
      }

      // Pair them up
      const maxLen = Math.max(removals.length, additions.length);
      for (let j = 0; j < maxLen; j++) {
        result.push({
          left: removals[j] ?? null,
          right: additions[j] ?? null,
        });
      }
    } else if (line.type === 'addition') {
      // Standalone addition (no preceding removal)
      result.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Render a side-by-side diff line.
 */
const SideBySideLine = memo(function SideBySideLine({
  left,
  right,
}: {
  left: DiffLine | null;
  right: DiffLine | null;
}): React.ReactElement {
  const leftStyle =
    left?.type === 'removal'
      ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
      : left?.type === 'context'
        ? 'text-[var(--color-text-muted)]'
        : 'text-[var(--color-text-faint)]';

  const rightStyle =
    right?.type === 'addition'
      ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
      : right?.type === 'context'
        ? 'text-[var(--color-text-muted)]'
        : 'text-[var(--color-text-faint)]';

  return (
    <div className="flex font-mono text-[10px] leading-snug">
      {/* Left side (old) */}
      <div
        className={`flex-1 px-2 py-0.5 border-r border-[var(--color-border)]/50 overflow-hidden ${leftStyle}`}
      >
        {left ? (
          <>
            <span className="select-none opacity-50 mr-1">
              {left.type === 'removal' ? '-' : ' '}
            </span>
            <span className="whitespace-pre-wrap break-all">
              {left.content}
            </span>
          </>
        ) : (
          <span className="opacity-30">—</span>
        )}
      </div>
      {/* Right side (new) */}
      <div className={`flex-1 px-2 py-0.5 overflow-hidden ${rightStyle}`}>
        {right ? (
          <>
            <span className="select-none opacity-50 mr-1">
              {right.type === 'addition' ? '+' : ' '}
            </span>
            <span className="whitespace-pre-wrap break-all">
              {right.content}
            </span>
          </>
        ) : (
          <span className="opacity-30">—</span>
        )}
      </div>
    </div>
  );
});

/**
 * Component to render a clean diff view.
 *
 * Automatically switches between:
 * - Side-by-side view when there's enough space (>600px)
 * - Unified view (inline) for narrower containers
 *
 * Memoized to prevent unnecessary re-renders.
 */
const DiffView = memo(function DiffView({
  tool,
}: DiffViewProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const [useSideBySide, setUseSideBySide] = useState(false);

  // Parse the diff data from tool input
  const diffData = useMemo(() => {
    if (!isEditToolCall(tool.name)) return null;

    const parsed = parseEditToolInput(tool.input);
    if (!parsed) return null;

    const diffText = generateUnifiedDiff(
      parsed.oldString,
      parsed.newString,
      parsed.filePath,
    );

    const lines = parseDiffLines(diffText);

    // Filter to only show actual diff lines
    const diffLines = lines.filter(
      (l) =>
        l.type === 'addition' || l.type === 'removal' || l.type === 'context',
    );

    return {
      filePath: parsed.filePath,
      lines: diffLines,
      sideBySideLines: groupLinesForSideBySide(diffLines),
    };
  }, [tool.name, tool.input]);

  // Watch container width to toggle side-by-side mode
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setUseSideBySide(width >= SIDE_BY_SIDE_MIN_WIDTH);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (!diffData || diffData.lines.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="rounded overflow-hidden bg-[var(--color-background)] border border-[var(--color-border)]"
    >
      {/* Header showing view mode */}
      <div className="flex items-center justify-between px-2 py-0.5 bg-[var(--color-surface)] border-b border-[var(--color-border)]/50">
        <span className="text-[9px] text-[var(--color-text-faint)] uppercase tracking-wide">
          {useSideBySide ? 'Side-by-side' : 'Unified'} diff
        </span>
        <span className="text-[9px] text-[var(--color-text-faint)]">
          {diffData.lines.filter((l) => l.type === 'removal').length} removed,{' '}
          {diffData.lines.filter((l) => l.type === 'addition').length} added
        </span>
      </div>

      {/* Diff content */}
      <div className="overflow-x-auto max-h-64">
        {useSideBySide ? (
          // Side-by-side view
          <div>
            {/* Column headers */}
            <div className="flex text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] border-b border-[var(--color-border)]/30">
              <div className="flex-1 px-2 py-0.5 border-r border-[var(--color-border)]/50 bg-[var(--color-error)]/5">
                Old
              </div>
              <div className="flex-1 px-2 py-0.5 bg-[var(--color-success)]/5">
                New
              </div>
            </div>
            {diffData.sideBySideLines.map((pair, idx) => (
              <SideBySideLine
                key={`sbs-${idx}`}
                left={pair.left}
                right={pair.right}
              />
            ))}
          </div>
        ) : (
          // Unified view
          <div className="py-1">
            {diffData.lines.map((line, idx) => (
              <UnifiedDiffLine
                key={`${line.type}-${idx}-${line.content.slice(0, 20)}`}
                line={line}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default DiffView;
