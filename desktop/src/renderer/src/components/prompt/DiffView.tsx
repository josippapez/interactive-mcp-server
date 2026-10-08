import React, { memo, useEffect, useMemo, useState } from 'react';
import type { BundledLanguage, ThemedToken } from 'shiki';
import { highlightCode } from '@/components/ai-elements/code-block';
import {
  isEditToolCall,
  parseEditToolInput,
  generateUnifiedDiff,
  parseDiffLines,
  type DiffLine,
} from '../../lib/diff-parser';
import type { ToolCallInfo } from '../../types/unified-message';
import { useWrapCodeBlocks } from './tool-call/use-wrap-code-blocks';

type DiffViewProps = {
  tool: ToolCallInfo;
};

const MAX_LINES = 500;

/**
 * Map a file extension → Shiki BundledLanguage id.
 * Unknown / unmapped extensions fall back to `text`.
 */
const EXTENSION_LANGUAGE_MAP: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  md: 'markdown',
  mdx: 'mdx',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'docker',
  lua: 'lua',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  ini: 'ini',
  env: 'bash',
};

function inferLanguage(filePath: string): BundledLanguage {
  const lower = filePath.toLowerCase();
  // Special case: Dockerfile has no extension
  const base = lower.split('/').pop() ?? lower;
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return 'text' as BundledLanguage;
  const ext = base.slice(dot + 1);
  return EXTENSION_LANGUAGE_MAP[ext] ?? ('text' as BundledLanguage);
}

type SideCellKind = 'empty' | 'context' | 'removal' | 'addition';

interface SideCell {
  kind: SideCellKind;
  content: string;
  lineNumber: number | null;
}

interface SideBySideRow {
  key: string;
  left: SideCell;
  right: SideCell;
}

export type DiffLineCommentTarget = {
  side: 'old' | 'new';
  lineNumber: number;
  content: string;
};

type UnifiedDiffRowKind = 'hunk' | 'context' | 'removal' | 'addition';

interface UnifiedDiffRow {
  key: string;
  kind: UnifiedDiffRowKind;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

type DiffDisplayMode = 'unified' | 'side-by-side';

const EMPTY_CELL: SideCell = { kind: 'empty', content: '', lineNumber: null };

/**
 * Pair parsed diff lines into side-by-side rows (OLD | NEW).
 *
 * - Context lines appear on both sides.
 * - Consecutive runs of removals + additions are zipped row-by-row;
 *   the longer side keeps going with empty cells on the opposite side.
 * - Headers & hunk separators are skipped (the outer component renders
 *   its own header).
 *
 * Numbering: we track independent old/new line counters because the
 * source `DiffLine.lineNumber` from `parseDiffLines` conflates removals
 * (which should have an OLD number) with the NEW-side counter.
 */
function pairDiffLines(
  lines: DiffLine[],
  maxRows: number,
): { rows: SideBySideRow[]; truncated: boolean; totalRows: number } {
  const rows: SideBySideRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let totalRows = 0;

  // Initialize counters from the first hunk header if present
  for (const l of lines) {
    if (l.type === 'hunk') {
      const m = l.content.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      break;
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'header' || line.type === 'hunk') {
      i += 1;
      continue;
    }

    if (line.type === 'context') {
      totalRows += 1;
      if (rows.length < maxRows) {
        rows.push({
          key: `row-${rows.length}`,
          left: { kind: 'context', content: line.content, lineNumber: oldLine },
          right: {
            kind: 'context',
            content: line.content,
            lineNumber: newLine,
          },
        });
      }
      oldLine += 1;
      newLine += 1;
      i += 1;
      continue;
    }

    // Collect consecutive removals + additions into a run, then zip.
    const removals: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (i < lines.length && lines[i].type === 'removal') {
      removals.push(lines[i]);
      i += 1;
    }
    while (i < lines.length && lines[i].type === 'addition') {
      additions.push(lines[i]);
      i += 1;
    }

    const pairCount = Math.max(removals.length, additions.length);
    for (let p = 0; p < pairCount; p += 1) {
      const r = removals[p];
      const a = additions[p];
      totalRows += 1;
      if (rows.length < maxRows) {
        const left: SideCell = r
          ? { kind: 'removal', content: r.content, lineNumber: oldLine }
          : EMPTY_CELL;
        const right: SideCell = a
          ? { kind: 'addition', content: a.content, lineNumber: newLine }
          : EMPTY_CELL;
        rows.push({ key: `row-${rows.length}`, left, right });
      }
      if (r) oldLine += 1;
      if (a) newLine += 1;
    }
  }

  return { rows, truncated: totalRows > maxRows, totalRows };
}

function parseHunkLineNumbers(content: string): {
  oldLine: number;
  newLine: number;
} | null {
  const match = content.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
  if (!match) return null;
  return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}

export function buildUnifiedDiffRows(
  lines: ReadonlyArray<GenericDiffLine>,
  maxRows: number,
): { rows: UnifiedDiffRow[]; truncated: boolean; totalRows: number } {
  const rows: UnifiedDiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let totalRows = 0;

  const pushRow = (row: Omit<UnifiedDiffRow, 'key'>) => {
    totalRows += 1;
    if (rows.length >= maxRows) return;
    rows.push({ key: `row-${rows.length}`, ...row });
  };

  for (const line of lines) {
    if (line.type === 'header') continue;

    if (line.type === 'hunk') {
      const parsed = parseHunkLineNumbers(line.content);
      if (parsed) {
        oldLine = parsed.oldLine;
        newLine = parsed.newLine;
      }
      pushRow({
        kind: 'hunk',
        content: line.content,
        oldLineNumber: null,
        newLineNumber: null,
      });
      continue;
    }

    if (line.type === 'context') {
      pushRow({
        kind: 'context',
        content: line.content,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (line.type === 'removal') {
      pushRow({
        kind: 'removal',
        content: line.content,
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine += 1;
      continue;
    }

    pushRow({
      kind: 'addition',
      content: line.content,
      oldLineNumber: null,
      newLineNumber: newLine,
    });
    newLine += 1;
  }

  return { rows, truncated: totalRows > maxRows, totalRows };
}

/* -------------------------------------------------------------------------- */
/*  Shiki-backed highlighting for a single side (OLD or NEW)                  */
/* -------------------------------------------------------------------------- */

type TokenizedLines = ThemedToken[][];

/**
 * Render Shiki tokens for a single line. Falls back to plain text if no
 * tokens are available yet (highlighter warming up).
 */
const HighlightedLine = memo(function HighlightedLine({
  tokens,
  fallback,
}: {
  tokens: ThemedToken[] | undefined;
  fallback: string;
}) {
  if (!tokens || tokens.length === 0) {
    // Preserve whitespace; render non-breaking space for empty lines to
    // keep row heights stable.
    return <>{fallback.length > 0 ? fallback : '\u00A0'}</>;
  }
  return (
    <>
      {tokens.map((tok, idx) => (
        <span
          // Shiki tokens within a single line are positional and stable
          // for the same source line — index-based keys are acceptable
          // here and avoid an extra mapping pass.
          // oxlint-disable-next-line eslint(react/no-array-index-key)
          key={`t-${idx}`}
          // In dual-theme mode Shiki emits CSS custom properties on
          // `htmlStyle` (e.g. `--shiki-light: #24292e; --shiki-dark: #c9d1d9`)
          // and sets `color` to the DEFAULT (first) theme's color. We
          // spread `htmlStyle` so the custom properties are available,
          // then use the Tailwind `dark:` override to swap colors.
          className="dark:!text-[var(--shiki-dark)]"
          style={
            {
              color: tok.color,
              ...(tok.htmlStyle as React.CSSProperties | undefined),
            } as React.CSSProperties
          }
        >
          {tok.content}
        </span>
      ))}
    </>
  );
});

/**
 * Hook that highlights a piece of source with Shiki and returns a
 * per-line token array. Uses the shared `highlightCode` cache in
 * `code-block.tsx` so repeated renders are cheap.
 */
function useTokenizedLines(
  source: string,
  language: BundledLanguage,
): TokenizedLines | null {
  const [tokens, setTokens] = useState<TokenizedLines | null>(() => {
    const cached = highlightCode(source, language);
    return cached ? cached.tokens : null;
  });

  useEffect(() => {
    let cancelled = false;
    const cached = highlightCode(
      source,
      language,
      (result: { tokens: ThemedToken[][] }) => {
        if (!cancelled) setTokens(result.tokens);
      },
    );
    if (cached) {
      setTokens(cached.tokens);
    } else {
      setTokens(null);
    }
    return () => {
      cancelled = true;
    };
  }, [source, language]);

  return tokens;
}

/* -------------------------------------------------------------------------- */
/*  Side-by-side grid                                                         */
/* -------------------------------------------------------------------------- */

function buildSideSource(
  rows: SideBySideRow[],
  side: 'left' | 'right',
): {
  source: string;
  lineIndexByRow: (number | null)[];
} {
  const parts: string[] = [];
  const lineIndexByRow: (number | null)[] = [];
  for (const row of rows) {
    const cell = side === 'left' ? row.left : row.right;
    if (cell.kind === 'empty') {
      lineIndexByRow.push(null);
      continue;
    }
    lineIndexByRow.push(parts.length);
    parts.push(cell.content);
  }
  return { source: parts.join('\n'), lineIndexByRow };
}

const SideColumn = memo(function SideColumn({
  rows,
  side,
  language,
  onLineComment,
}: {
  rows: SideBySideRow[];
  side: 'left' | 'right';
  language: BundledLanguage;
  onLineComment?: (target: DiffLineCommentTarget) => void;
}) {
  const { source, lineIndexByRow } = useMemo(
    () => buildSideSource(rows, side),
    [rows, side],
  );
  const tokenized = useTokenizedLines(source, language);

  return (
    <div data-slot={side === 'left' ? 'diff-side-old' : 'diff-side-new'}>
      {rows.map((row, rowIdx) => {
        const cell = side === 'left' ? row.left : row.right;
        const lineIdx = lineIndexByRow[rowIdx];
        const tokens =
          tokenized && lineIdx !== null ? tokenized[lineIdx] : undefined;
        const commentTarget = getSideCommentTarget(cell, side);
        return (
          <div
            key={row.key}
            data-slot="diff-row"
            data-kind={cell.kind}
            data-side={side}
          >
            <span data-slot="diff-gutter">{cell.lineNumber ?? ''}</span>
            {onLineComment && (
              <button
                type="button"
                data-slot="diff-comment-button"
                disabled={!commentTarget}
                aria-label={
                  commentTarget
                    ? `Comment on ${commentTarget.side} line ${commentTarget.lineNumber}`
                    : 'Cannot comment on empty diff row'
                }
                onClick={() => {
                  if (commentTarget) onLineComment(commentTarget);
                }}
              >
                +
              </button>
            )}
            <span data-slot="diff-marker">
              {cell.kind === 'removal'
                ? '-'
                : cell.kind === 'addition'
                  ? '+'
                  : ' '}
            </span>
            <span data-slot="diff-content">
              <HighlightedLine tokens={tokens} fallback={cell.content} />
            </span>
          </div>
        );
      })}
    </div>
  );
});

function getSideCommentTarget(
  cell: SideCell,
  side: 'left' | 'right',
): DiffLineCommentTarget | null {
  if (cell.kind === 'empty' || cell.lineNumber === null) return null;
  return {
    side: side === 'left' ? 'old' : 'new',
    lineNumber: cell.lineNumber,
    content: cell.content,
  };
}

function buildUnifiedSource(rows: UnifiedDiffRow[]): {
  source: string;
  lineIndexByRow: (number | null)[];
} {
  const parts: string[] = [];
  const lineIndexByRow: (number | null)[] = [];
  for (const row of rows) {
    if (row.kind === 'hunk') {
      lineIndexByRow.push(null);
      continue;
    }
    lineIndexByRow.push(parts.length);
    parts.push(row.content);
  }
  return { source: parts.join('\n'), lineIndexByRow };
}

export const UnifiedDiffRows = memo(function UnifiedDiffRows({
  rows,
  language,
  wrapLines = false,
  onLineComment,
}: {
  rows: UnifiedDiffRow[];
  language: BundledLanguage;
  wrapLines?: boolean;
  onLineComment?: (target: DiffLineCommentTarget) => void;
}): React.ReactElement {
  const { source, lineIndexByRow } = useMemo(
    () => buildUnifiedSource(rows),
    [rows],
  );
  const tokenized = useTokenizedLines(source, language);

  return (
    <div
      data-component="diff-view"
      data-variant="unified"
      data-wrap={wrapLines ? 'true' : 'false'}
      data-commentable={onLineComment ? 'true' : undefined}
      data-scrollable="true"
    >
      {rows.map((row, rowIdx) => {
        const lineIdx = lineIndexByRow[rowIdx];
        const tokens =
          tokenized && lineIdx !== null ? tokenized[lineIdx] : undefined;
        const commentTarget = getUnifiedCommentTarget(row);
        return (
          <div key={row.key} data-slot="diff-row" data-kind={row.kind}>
            <span data-slot="diff-gutter-old">{row.oldLineNumber ?? ''}</span>
            <span data-slot="diff-gutter-new">{row.newLineNumber ?? ''}</span>
            {onLineComment && (
              <button
                type="button"
                data-slot="diff-comment-button"
                disabled={!commentTarget}
                aria-label={
                  commentTarget
                    ? `Comment on ${commentTarget.side} line ${commentTarget.lineNumber}`
                    : 'Cannot comment on hunk header'
                }
                onClick={() => {
                  if (commentTarget) onLineComment(commentTarget);
                }}
              >
                +
              </button>
            )}
            <span data-slot="diff-marker">
              {row.kind === 'removal'
                ? '-'
                : row.kind === 'addition'
                  ? '+'
                  : row.kind === 'hunk'
                    ? '…'
                    : ' '}
            </span>
            <span data-slot="diff-content">
              {row.kind === 'hunk' ? (
                row.content
              ) : (
                <HighlightedLine tokens={tokens} fallback={row.content} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
});

function getUnifiedCommentTarget(
  row: UnifiedDiffRow,
): DiffLineCommentTarget | null {
  if (row.kind === 'removal' && row.oldLineNumber !== null) {
    return {
      side: 'old',
      lineNumber: row.oldLineNumber,
      content: row.content,
    };
  }

  if (
    (row.kind === 'addition' || row.kind === 'context') &&
    row.newLineNumber !== null
  ) {
    return {
      side: 'new',
      lineNumber: row.newLineNumber,
      content: row.content,
    };
  }

  return null;
}

export function DiffDisplayModeToggle({
  mode,
  onModeChange,
}: {
  mode: DiffDisplayMode;
  onModeChange: (mode: DiffDisplayMode) => void;
}): React.ReactElement {
  return (
    <div data-slot="diff-view-toggle" role="group" aria-label="Diff view mode">
      <button
        type="button"
        data-active={mode === 'unified' ? 'true' : undefined}
        onClick={() => onModeChange('unified')}
      >
        Unified
      </button>
      <button
        type="button"
        data-active={mode === 'side-by-side' ? 'true' : undefined}
        onClick={() => onModeChange('side-by-side')}
      >
        Side by side
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Top-level DiffView                                                        */
/* -------------------------------------------------------------------------- */

const DiffView = memo(function DiffView({
  tool,
}: DiffViewProps): React.ReactElement | null {
  const { wrapLines } = useWrapCodeBlocks();
  const [mode, setMode] = useState<DiffDisplayMode>('side-by-side');
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

    let additions = 0;
    let removals = 0;
    for (const l of parsedLines) {
      if (l.type === 'addition') additions += 1;
      else if (l.type === 'removal') removals += 1;
    }

    const { rows, truncated, totalRows } = pairDiffLines(
      parsedLines,
      MAX_LINES,
    );
    const unified = buildUnifiedDiffRows(parsedLines, MAX_LINES);
    if (rows.length === 0 && unified.rows.length === 0) return null;

    return {
      filePath: parsed.filePath,
      rows,
      unifiedRows: unified.rows,
      additions,
      removals,
      totalRows: Math.max(totalRows, unified.totalRows),
      truncated: truncated || unified.truncated,
      language: inferLanguage(parsed.filePath),
    };
  }, [tool.input, tool.name]);

  if (!diffData) return null;

  return (
    <div data-component="diff-view" data-variant="side-by-side">
      <DiffDisplayModeToggle mode={mode} onModeChange={setMode} />
      {mode === 'unified' ? (
        <UnifiedDiffRows
          rows={diffData.unifiedRows}
          language={diffData.language}
          wrapLines={wrapLines}
        />
      ) : (
        <SideBySideDiffGrid
          rows={diffData.rows}
          language={diffData.language}
          wrapLines={wrapLines}
        />
      )}

      {diffData.truncated && (
        <div data-slot="diff-hunk-separator" className="font-mono text-[9px]">
          <span data-slot="diff-hunk-gutter">…</span>
          <span className="px-2 py-1 text-[var(--text-weaker)]">
            Showing first {MAX_LINES} of {diffData.totalRows} diff rows.
          </span>
        </div>
      )}
    </div>
  );
});

export default DiffView;

/* -------------------------------------------------------------------------- */
/*  Reusable building blocks (consumed by ApplyPatchToolCard)                 */
/* -------------------------------------------------------------------------- */

/**
 * Generic line shape accepted by `SideBySideDiffGrid`. `DiffLine` from
 * `diff-parser.ts` and `PatchLine` from `ApplyPatchToolCard.tsx` both
 * satisfy this structurally.
 */
export interface GenericDiffLine {
  type: 'header' | 'hunk' | 'context' | 'addition' | 'removal';
  content: string;
}

/**
 * Pair an arbitrary sequence of diff-style lines into side-by-side rows.
 * Ignores header/hunk lines. Line numbers are assigned independently per
 * side starting at 1, since patch inputs don't always carry canonical
 * numbering.
 */
export function pairGenericDiffLines(
  lines: ReadonlyArray<GenericDiffLine>,
  maxRows: number,
): { rows: SideBySideRow[]; truncated: boolean; totalRows: number } {
  const rows: SideBySideRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let totalRows = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'header' || line.type === 'hunk') {
      i += 1;
      continue;
    }
    if (line.type === 'context') {
      totalRows += 1;
      if (rows.length < maxRows) {
        rows.push({
          key: `row-${rows.length}`,
          left: { kind: 'context', content: line.content, lineNumber: oldLine },
          right: {
            kind: 'context',
            content: line.content,
            lineNumber: newLine,
          },
        });
      }
      oldLine += 1;
      newLine += 1;
      i += 1;
      continue;
    }

    const removals: GenericDiffLine[] = [];
    const additions: GenericDiffLine[] = [];
    while (i < lines.length && lines[i].type === 'removal') {
      removals.push(lines[i]);
      i += 1;
    }
    while (i < lines.length && lines[i].type === 'addition') {
      additions.push(lines[i]);
      i += 1;
    }

    const pairCount = Math.max(removals.length, additions.length);
    for (let p = 0; p < pairCount; p += 1) {
      const r = removals[p];
      const a = additions[p];
      totalRows += 1;
      if (rows.length < maxRows) {
        const left: SideCell = r
          ? { kind: 'removal', content: r.content, lineNumber: oldLine }
          : EMPTY_CELL;
        const right: SideCell = a
          ? { kind: 'addition', content: a.content, lineNumber: newLine }
          : EMPTY_CELL;
        rows.push({ key: `row-${rows.length}`, left, right });
      }
      if (r) oldLine += 1;
      if (a) newLine += 1;
    }
  }

  return { rows, truncated: totalRows > maxRows, totalRows };
}

/**
 * Pre-built side-by-side grid. Accepts paired rows (usually from
 * `pairGenericDiffLines`) and a Shiki language id. Useful when the
 * caller already has file-level context (header/chrome) and only needs
 * the grid body.
 */
export const SideBySideDiffGrid = memo(function SideBySideDiffGrid({
  rows,
  language,
  wrapLines = false,
  onLineComment,
}: {
  rows: SideBySideRow[];
  language: BundledLanguage;
  wrapLines?: boolean;
  onLineComment?: (target: DiffLineCommentTarget) => void;
}): React.ReactElement {
  return (
    <div
      data-component="diff-view"
      data-variant="side-by-side"
      data-embedded="true"
      data-wrap={wrapLines ? 'true' : 'false'}
      data-commentable={onLineComment ? 'true' : undefined}
    >
      <div data-slot="diff-grid" data-scrollable="true">
        <SideColumn
          rows={rows}
          side="left"
          language={language}
          onLineComment={onLineComment}
        />
        <SideColumn
          rows={rows}
          side="right"
          language={language}
          onLineComment={onLineComment}
        />
      </div>
    </div>
  );
});

export { inferLanguage, MAX_LINES as DIFF_MAX_LINES };
