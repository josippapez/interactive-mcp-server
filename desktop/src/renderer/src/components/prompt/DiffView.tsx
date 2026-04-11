import React, { memo, useMemo, useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../../ThemeContext';
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
 * Map file extensions to Prism language identifiers.
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    dockerfile: 'docker',
    makefile: 'makefile',
    toml: 'toml',
    ini: 'ini',
    env: 'bash',
  };
  return langMap[ext] || 'text';
}

/**
 * Render a single diff line with TUI-style inline formatting (unified view).
 * Uses syntax highlighting based on the file language.
 */
const UnifiedDiffLine = memo(function UnifiedDiffLine({
  line,
  language,
  isDark,
}: {
  line: DiffLine;
  language: string;
  isDark: boolean;
}): React.ReactElement | null {
  if (line.type === 'header' || line.type === 'hunk') return null;

  const bgStyles: Record<DiffLine['type'], string> = {
    header: '',
    hunk: '',
    context: '',
    addition: 'bg-[var(--color-success)]/10',
    removal: 'bg-[var(--color-error)]/10',
  };

  const linePrefix: Record<DiffLine['type'], string> = {
    header: '',
    hunk: '',
    context: ' ',
    addition: '+',
    removal: '-',
  };

  const prefixColor: Record<DiffLine['type'], string> = {
    header: '',
    hunk: '',
    context: 'text-[var(--color-text-muted)]',
    addition: 'text-[var(--color-success)]',
    removal: 'text-[var(--color-error)]',
  };

  return (
    <div
      className={`font-mono text-[11px] leading-snug flex ${bgStyles[line.type]}`}
    >
      <span
        className={`select-none w-4 text-center shrink-0 ${prefixColor[line.type]}`}
      >
        {linePrefix[line.type]}
      </span>
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '0 0.5rem',
          background: 'transparent',
          fontSize: '11px',
          lineHeight: '1.4',
          flex: 1,
          overflow: 'visible',
        }}
        codeTagProps={{
          style: {
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        }}
        PreTag="span"
      >
        {line.content || ' '}
      </SyntaxHighlighter>
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
 * Render a side-by-side diff line with syntax highlighting.
 */
const SideBySideLine = memo(function SideBySideLine({
  left,
  right,
  language,
  isDark,
}: {
  left: DiffLine | null;
  right: DiffLine | null;
  language: string;
  isDark: boolean;
}): React.ReactElement {
  const leftBg = left?.type === 'removal' ? 'bg-[var(--color-error)]/10' : '';

  const rightBg =
    right?.type === 'addition' ? 'bg-[var(--color-success)]/10' : '';

  return (
    <div className="flex font-mono text-[10px] leading-snug">
      {/* Left side (old) */}
      <div
        className={`flex-1 flex border-r border-[var(--color-border)]/50 overflow-hidden ${leftBg}`}
      >
        {left ? (
          <>
            <span
              className={`select-none w-4 text-center shrink-0 ${left.type === 'removal' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-muted)]'}`}
            >
              {left.type === 'removal' ? '-' : ' '}
            </span>
            <SyntaxHighlighter
              language={language}
              style={isDark ? oneDark : oneLight}
              customStyle={{
                margin: 0,
                padding: '0 0.25rem',
                background: 'transparent',
                fontSize: '10px',
                lineHeight: '1.4',
                flex: 1,
                overflow: 'visible',
              }}
              codeTagProps={{
                style: {
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                },
              }}
              PreTag="span"
            >
              {left.content || ' '}
            </SyntaxHighlighter>
          </>
        ) : (
          <span className="opacity-30 px-2">—</span>
        )}
      </div>
      {/* Right side (new) */}
      <div className={`flex-1 flex overflow-hidden ${rightBg}`}>
        {right ? (
          <>
            <span
              className={`select-none w-4 text-center shrink-0 ${right.type === 'addition' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}
            >
              {right.type === 'addition' ? '+' : ' '}
            </span>
            <SyntaxHighlighter
              language={language}
              style={isDark ? oneDark : oneLight}
              customStyle={{
                margin: 0,
                padding: '0 0.25rem',
                background: 'transparent',
                fontSize: '10px',
                lineHeight: '1.4',
                flex: 1,
                overflow: 'visible',
              }}
              codeTagProps={{
                style: {
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                },
              }}
              PreTag="span"
            >
              {right.content || ' '}
            </SyntaxHighlighter>
          </>
        ) : (
          <span className="opacity-30 px-2">—</span>
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
  const { theme } = useTheme();
  const isDark = theme === 'dark';

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
      language: getLanguageFromPath(parsed.filePath),
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
                language={diffData.language}
                isDark={isDark}
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
                language={diffData.language}
                isDark={isDark}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default DiffView;
