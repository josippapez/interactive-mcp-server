import React, { memo, useMemo } from 'react';
import { SyntaxHighlighter, oneDark, oneLight } from '@/lib/syntax-highlighter';
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
  tool: ToolCallInfo;
};

type DisplayLineType = 'context' | 'addition' | 'removal';

type DisplayLine = {
  type: DisplayLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

const MAX_LINES = 500;

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

function toDisplayLines(lines: DiffLine[]): DisplayLine[] {
  const display: DisplayLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of lines) {
    if (
      line.type !== 'context' &&
      line.type !== 'addition' &&
      line.type !== 'removal'
    ) {
      continue;
    }

    if (line.type === 'context') {
      display.push({
        type: 'context',
        content: line.content,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (line.type === 'removal') {
      display.push({
        type: 'removal',
        content: line.content,
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine += 1;
      continue;
    }

    display.push({
      type: 'addition',
      content: line.content,
      oldLineNumber: null,
      newLineNumber: newLine,
    });
    newLine += 1;
  }

  return display;
}

function lineKey(line: DisplayLine, idx: number): string {
  return `${line.type}-${line.oldLineNumber ?? 'n'}-${line.newLineNumber ?? 'n'}-${idx}`;
}

const UnifiedLine = memo(function UnifiedLine({
  line,
  language,
  isDark,
}: {
  line: DisplayLine;
  language: string;
  isDark: boolean;
}): React.ReactElement {
  const backgroundClass =
    line.type === 'addition'
      ? 'bg-[var(--color-success)]/10'
      : line.type === 'removal'
        ? 'bg-[var(--color-error)]/10'
        : '';

  const sign =
    line.type === 'addition' ? '+' : line.type === 'removal' ? '-' : ' ';

  const signColorClass =
    line.type === 'addition'
      ? 'text-[var(--color-success)]'
      : line.type === 'removal'
        ? 'text-[var(--color-error)]'
        : 'text-[var(--color-text-faint)]';

  const lineNumberClass =
    line.type === 'addition'
      ? 'text-[var(--color-success)]/75'
      : line.type === 'removal'
        ? 'text-[var(--color-error)]/75'
        : 'text-[var(--color-text-faint)]';

  return (
    <div
      className={`grid grid-cols-[52px_52px_18px_minmax(0,1fr)] text-[10px] font-mono leading-snug ${backgroundClass}`}
    >
      <span className={`select-none px-1 text-right ${lineNumberClass}`}>
        {line.oldLineNumber ?? ''}
      </span>
      <span className={`select-none px-1 text-right ${lineNumberClass}`}>
        {line.newLineNumber ?? ''}
      </span>
      <span className={`select-none text-center ${signColorClass}`}>
        {sign}
      </span>
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '0 0.375rem',
          background: 'transparent',
          fontSize: '10px',
          lineHeight: '1.4',
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

const DiffView = memo(function DiffView({
  tool,
}: DiffViewProps): React.ReactElement | null {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const diffData = useMemo(() => {
    if (!isEditToolCall(tool.name)) return null;

    const parsed = parseEditToolInput(tool.input);
    if (!parsed) return null;

    const diffText = generateUnifiedDiff(
      parsed.oldString,
      parsed.newString,
      parsed.filePath,
    );
    const parsedLines = parseDiffLines(diffText);
    const displayLines = toDisplayLines(parsedLines);

    if (displayLines.length === 0) return null;

    const additions = displayLines.filter(
      (line) => line.type === 'addition',
    ).length;
    const removals = displayLines.filter(
      (line) => line.type === 'removal',
    ).length;
    const truncated = displayLines.length > MAX_LINES;
    const lines = truncated ? displayLines.slice(0, MAX_LINES) : displayLines;

    return {
      filePath: parsed.filePath,
      language: getLanguageFromPath(parsed.filePath),
      lines,
      additions,
      removals,
      totalLines: displayLines.length,
      truncated,
    };
  }, [tool.input, tool.name]);

  if (!diffData) return null;

  return (
    <div className="rounded overflow-hidden bg-[var(--color-background)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)]/50">
        <span
          className="min-w-0 truncate text-[10px] font-mono text-[var(--color-text-muted)]"
          title={diffData.filePath}
        >
          {diffData.filePath}
        </span>
        <span className="shrink-0 text-[9px] text-[var(--color-text-faint)]">
          <span className="text-[var(--color-success)]">
            +{diffData.additions}
          </span>
          <span className="mx-1 text-[var(--color-text-faint)]">/</span>
          <span className="text-[var(--color-error)]">
            -{diffData.removals}
          </span>
        </span>
      </div>

      <div className="overflow-x-auto max-h-72">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[52px_52px_18px_minmax(0,1fr)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/40">
            <span className="px-1 py-0.5 text-right">Old</span>
            <span className="px-1 py-0.5 text-right">New</span>
            <span className="px-1 py-0.5 text-center"> </span>
            <span className="px-1 py-0.5">Content</span>
          </div>

          {diffData.lines.map((line, idx) => (
            <UnifiedLine
              key={lineKey(line, idx)}
              line={line}
              language={diffData.language}
              isDark={isDark}
            />
          ))}

          {diffData.truncated && (
            <div className="px-2 py-1 text-[9px] text-[var(--color-text-faint)] border-t border-[var(--color-border)]/40 bg-[var(--color-surface)]/30">
              Showing first {MAX_LINES} of {diffData.totalLines} diff lines.
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default DiffView;
