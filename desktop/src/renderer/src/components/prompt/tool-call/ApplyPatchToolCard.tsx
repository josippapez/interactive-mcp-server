import React, { memo, useEffect, useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ToolCallInfo } from '../../../types/unified-message';
import { useTheme } from '../../../ThemeContext';

type PatchAction = 'add' | 'update' | 'delete' | 'move';
type PatchLineType = 'context' | 'addition' | 'removal';

type PatchLine = {
  type: PatchLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type ApplyPatchFileDiff = {
  id: string;
  action: PatchAction;
  filePath: string;
  fromPath?: string;
  additions: number;
  deletions: number;
  lines: PatchLine[];
};

type BuildFileDraft = {
  action: PatchAction;
  filePath: string;
  fromPath?: string;
  moveToPath?: string;
  rawLines: string[];
};

const ACTION_STYLES: Record<PatchAction, string> = {
  add: 'text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/25',
  update:
    'text-[var(--color-tool)] bg-[var(--color-tool)]/10 border-[var(--color-tool)]/25',
  delete:
    'text-[var(--color-error)] bg-[var(--color-error)]/10 border-[var(--color-error)]/25',
  move: 'text-[var(--color-agent)] bg-[var(--color-agent)]/10 border-[var(--color-agent)]/25',
};

const ACTION_LABELS: Record<PatchAction, string> = {
  add: 'Created',
  update: 'Modified',
  delete: 'Deleted',
  move: 'Moved',
};

const SIDE_BY_SIDE_MIN_WIDTH = 760;

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

function getStringField(
  input: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = input?.[key];
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;
  return value;
}

function getPatchText(input?: Record<string, unknown>): string | null {
  const patchText =
    getStringField(input, 'patchText') ??
    getStringField(input, 'patch') ??
    getStringField(input, 'text');

  if (!patchText) return null;
  return patchText;
}

function startsWithHeader(line: string): boolean {
  return (
    line.startsWith('*** Add File: ') ||
    line.startsWith('*** Update File: ') ||
    line.startsWith('*** Delete File: ')
  );
}

function parseHeader(
  line: string,
): { action: PatchAction; filePath: string } | null {
  if (line.startsWith('*** Add File: ')) {
    return {
      action: 'add',
      filePath: line.replace('*** Add File: ', '').trim(),
    };
  }

  if (line.startsWith('*** Update File: ')) {
    return {
      action: 'update',
      filePath: line.replace('*** Update File: ', '').trim(),
    };
  }

  if (line.startsWith('*** Delete File: ')) {
    return {
      action: 'delete',
      filePath: line.replace('*** Delete File: ', '').trim(),
    };
  }

  return null;
}

function toPatchLines(rawLines: string[]): {
  lines: PatchLine[];
  additions: number;
  deletions: number;
} {
  const lines: PatchLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLine = 1;
  let newLine = 1;

  for (const rawLine of rawLines) {
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(
        /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
      );
      if (!match) continue;

      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      additions += 1;
      lines.push({
        type: 'addition',
        content: rawLine.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      deletions += 1;
      lines.push({
        type: 'removal',
        content: rawLine.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine += 1;
      continue;
    }

    if (!rawLine.startsWith(' ')) continue;

    lines.push({
      type: 'context',
      content: rawLine.slice(1),
      oldLineNumber: oldLine,
      newLineNumber: newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return { lines, additions, deletions };
}

function toFileDiff(draft: BuildFileDraft, index: number): ApplyPatchFileDiff {
  const normalizedAction =
    draft.moveToPath && draft.action === 'update' ? 'move' : draft.action;

  const { lines, additions, deletions } = toPatchLines(draft.rawLines);

  const filePath = draft.moveToPath ?? draft.filePath;
  const fromPath = draft.moveToPath ? draft.filePath : draft.fromPath;

  return {
    id: `${normalizedAction}:${filePath}:${index}`,
    action: normalizedAction,
    filePath,
    fromPath,
    additions,
    deletions,
    lines,
  };
}

export function isApplyPatchToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'apply_patch' || lower.includes('apply_patch');
}

export function parseApplyPatchFileDiffs(
  input?: Record<string, unknown>,
): ApplyPatchFileDiff[] | null {
  const patchText = getPatchText(input);
  if (!patchText) return null;

  const rawLines = patchText.split('\n');
  const beginIndex = rawLines.findIndex(
    (line) => line.trim() === '*** Begin Patch',
  );
  const endIndex = rawLines.findIndex(
    (line) => line.trim() === '*** End Patch',
  );

  if (beginIndex < 0 || endIndex <= beginIndex) return null;

  const patchLines = rawLines.slice(beginIndex + 1, endIndex);
  const files: ApplyPatchFileDiff[] = [];
  let draft: BuildFileDraft | null = null;

  const flushDraft = () => {
    if (!draft) return;
    files.push(toFileDiff(draft, files.length));
    draft = null;
  };

  for (const line of patchLines) {
    if (startsWithHeader(line)) {
      flushDraft();

      const header = parseHeader(line);
      if (!header) continue;

      draft = {
        action: header.action,
        filePath: header.filePath,
        rawLines: [],
      };
      continue;
    }

    if (!draft) continue;

    if (line.startsWith('*** Move to: ')) {
      draft.moveToPath = line.replace('*** Move to: ', '').trim();
      continue;
    }

    if (
      line.startsWith('@@') ||
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---')) ||
      line.startsWith(' ')
    ) {
      draft.rawLines.push(line);
    }
  }

  flushDraft();

  if (files.length === 0) return null;
  return files;
}

function groupLinesForSideBySide(
  lines: PatchLine[],
): Array<{ left: PatchLine | null; right: PatchLine | null }> {
  const grouped: Array<{ left: PatchLine | null; right: PatchLine | null }> =
    [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'context') {
      grouped.push({ left: line, right: line });
      i += 1;
      continue;
    }

    if (line.type === 'removal') {
      const removals: PatchLine[] = [];
      while (i < lines.length && lines[i].type === 'removal') {
        removals.push(lines[i]);
        i += 1;
      }

      const additions: PatchLine[] = [];
      while (i < lines.length && lines[i].type === 'addition') {
        additions.push(lines[i]);
        i += 1;
      }

      const maxCount = Math.max(removals.length, additions.length);
      for (let j = 0; j < maxCount; j += 1) {
        grouped.push({
          left: removals[j] ?? null,
          right: additions[j] ?? null,
        });
      }
      continue;
    }

    grouped.push({ left: null, right: line });
    i += 1;
  }

  return grouped;
}

const PatchDiffLine = memo(function PatchDiffLine({
  line,
  language,
  isDark,
}: {
  line: PatchLine;
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

const SideBySidePatchLine = memo(function SideBySidePatchLine({
  left,
  right,
  language,
  isDark,
}: {
  left: PatchLine | null;
  right: PatchLine | null;
  language: string;
  isDark: boolean;
}): React.ReactElement {
  const leftBg = left?.type === 'removal' ? 'bg-[var(--color-error)]/10' : '';
  const rightBg =
    right?.type === 'addition' ? 'bg-[var(--color-success)]/10' : '';

  return (
    <div className="grid grid-cols-2 text-[10px] font-mono leading-snug min-w-[860px]">
      <div
        className={`grid grid-cols-[48px_18px_minmax(0,1fr)] border-r border-[var(--color-border)]/60 ${leftBg}`}
      >
        <span className="px-1 text-right text-[var(--color-text-faint)] select-none">
          {left?.oldLineNumber ?? ''}
        </span>
        <span
          className={`text-center select-none ${left?.type === 'removal' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-faint)]'}`}
        >
          {left?.type === 'removal' ? '-' : ' '}
        </span>
        {left ? (
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
            {left.content || ' '}
          </SyntaxHighlighter>
        ) : (
          <span className="px-1.5 text-[var(--color-text-faint)]"> </span>
        )}
      </div>

      <div className={`grid grid-cols-[48px_18px_minmax(0,1fr)] ${rightBg}`}>
        <span className="px-1 text-right text-[var(--color-text-faint)] select-none">
          {right?.newLineNumber ?? ''}
        </span>
        <span
          className={`text-center select-none ${right?.type === 'addition' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-faint)]'}`}
        >
          {right?.type === 'addition' ? '+' : ' '}
        </span>
        {right ? (
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
            {right.content || ' '}
          </SyntaxHighlighter>
        ) : (
          <span className="px-1.5 text-[var(--color-text-faint)]"> </span>
        )}
      </div>
    </div>
  );
});

const FileDiffBody = memo(function FileDiffBody({
  file,
}: {
  file: ApplyPatchFileDiff;
}): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const language = useMemo(
    () => getLanguageFromPath(file.filePath),
    [file.filePath],
  );
  const sideBySideLines = useMemo(
    () => groupLinesForSideBySide(file.lines),
    [file.lines],
  );
  const [useSideBySide, setUseSideBySide] = useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setUseSideBySide(entry.contentRect.width >= SIDE_BY_SIDE_MIN_WIDTH);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="border-t border-[var(--color-border)]/60 bg-[var(--color-background)]/70"
    >
      <div className="flex items-center justify-between px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/40">
        <span>{useSideBySide ? 'Side-by-side diff' : 'Unified diff'}</span>
        <span className="font-mono">{language}</span>
      </div>

      <div className="max-h-64 overflow-auto" data-scrollable="true">
        {file.lines.length > 0 ? (
          useSideBySide ? (
            <div>
              {sideBySideLines.map((line, idx) => (
                <SideBySidePatchLine
                  key={`${file.id}-sbs-${idx}`}
                  left={line.left}
                  right={line.right}
                  language={language}
                  isDark={isDark}
                />
              ))}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[52px_52px_18px_minmax(0,1fr)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] bg-[var(--color-surface)]/30 border-b border-[var(--color-border)]/40">
                <span className="px-1 py-0.5 text-right">Old</span>
                <span className="px-1 py-0.5 text-right">New</span>
                <span className="px-1 py-0.5 text-center"> </span>
                <span className="px-1 py-0.5">Content</span>
              </div>
              {file.lines.map((line, idx) => (
                <PatchDiffLine
                  key={`${file.id}-${line.type}-${line.oldLineNumber ?? 'n'}-${line.newLineNumber ?? 'n'}-${idx}`}
                  line={line}
                  language={language}
                  isDark={isDark}
                />
              ))}
            </div>
          )
        ) : (
          <div className="px-2 py-2 text-[10px] font-mono text-[var(--color-text-faint)]">
            No diff hunks available.
          </div>
        )}
      </div>
    </div>
  );
});

const FileDiffAccordionItem = memo(function FileDiffAccordionItem({
  file,
  expanded,
  onToggle,
}: {
  file: ApplyPatchFileDiff;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2 py-1 text-left flex items-center justify-between gap-2 hover:bg-[var(--color-border)]/20 transition-colors"
      >
        <div className="min-w-0 flex items-center gap-2">
          <span
            className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wide ${ACTION_STYLES[file.action]}`}
          >
            {ACTION_LABELS[file.action]}
          </span>

          <div className="min-w-0">
            {file.fromPath ? (
              <div className="text-[10px] font-mono text-[var(--color-text)] truncate">
                {file.fromPath}{' '}
                <span className="text-[var(--color-text-faint)]">→</span>{' '}
                {file.filePath}
              </div>
            ) : (
              <div className="text-[10px] font-mono text-[var(--color-text)] truncate">
                {file.filePath}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 text-[10px] font-mono">
          <span className="text-[var(--color-success)]">+{file.additions}</span>
          <span className="text-[var(--color-error)]">-{file.deletions}</span>
          <span className="text-[var(--color-text-muted)]">
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {expanded && <FileDiffBody file={file} />}
    </div>
  );
});

const ApplyPatchToolCard = memo(function ApplyPatchToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded?: boolean;
}): React.ReactElement {
  const files = useMemo(
    () => parseApplyPatchFileDiffs(tool.input) ?? [],
    [tool.input],
  );
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  useEffect(() => {
    if (files.length === 0) {
      setExpandedIds([]);
      return;
    }

    if (forceExpanded || files.length === 1) {
      setExpandedIds([files[0].id]);
      return;
    }

    const firstExpandable =
      files.find((file) => file.action !== 'delete') ?? files[0];
    setExpandedIds([firstExpandable.id]);
  }, [files, forceExpanded]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  if (files.length === 0) {
    return (
      <div className="border border-[var(--color-border)] rounded overflow-hidden bg-[var(--color-surface)]">
        <div className="px-2 py-1 flex items-center justify-between gap-2 border-b border-[var(--color-border)]/60">
          <span className="text-[var(--color-tool)] font-mono text-[10px]">
            {tool.name}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
            No patch preview
          </span>
        </div>
        {tool.output && (
          <pre className="px-2 py-1.5 text-[10px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap max-h-48 overflow-auto">
            {tool.output}
          </pre>
        )}
      </div>
    );
  }

  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  if (files.length === 1) {
    const file = files[0];
    return (
      <div className="rounded border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
        <div className="px-2 py-1 flex items-center justify-between gap-2 bg-[var(--color-surface)]/70 border-b border-[var(--color-border)]/60">
          <div className="min-w-0 flex items-center gap-2">
            <span
              className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wide ${ACTION_STYLES[file.action]}`}
            >
              {ACTION_LABELS[file.action]}
            </span>
            <span
              className="text-[10px] font-mono text-[var(--color-text)] truncate"
              title={file.filePath}
            >
              {file.filePath}
            </span>
          </div>
          <span className="shrink-0 text-[10px] font-mono">
            <span className="text-[var(--color-success)]">
              +{file.additions}
            </span>
            <span className="mx-1 text-[var(--color-text-faint)]">/</span>
            <span className="text-[var(--color-error)]">-{file.deletions}</span>
          </span>
        </div>
        <FileDiffBody file={file} />
      </div>
    );
  }

  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
      <div className="px-2 py-1 flex items-center justify-between gap-2 bg-[var(--color-surface)]/70 border-b border-[var(--color-border)]/60">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-[var(--color-tool)] font-mono text-[10px]">
            apply_patch
          </span>
          <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
            {files.length} files
          </span>
        </div>
        <span className="shrink-0 text-[10px] font-mono">
          <span className="text-[var(--color-success)]">+{totalAdditions}</span>
          <span className="mx-1 text-[var(--color-text-faint)]">/</span>
          <span className="text-[var(--color-error)]">-{totalDeletions}</span>
        </span>
      </div>

      <div className="p-1.5 space-y-1.5">
        {files.map((file) => (
          <FileDiffAccordionItem
            key={file.id}
            file={file}
            expanded={expandedIds.includes(file.id)}
            onToggle={() => toggleExpanded(file.id)}
          />
        ))}
      </div>
    </div>
  );
});

export default ApplyPatchToolCard;
