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
}: {
  rows: SideBySideRow[];
  side: 'left' | 'right';
  language: BundledLanguage;
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
        return (
          <div
            key={row.key}
            data-slot="diff-row"
            data-kind={cell.kind}
            data-side={side}
          >
            <span data-slot="diff-gutter">{cell.lineNumber ?? ''}</span>
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

/* -------------------------------------------------------------------------- */
/*  Top-level DiffView                                                        */
/* -------------------------------------------------------------------------- */

const DiffView = memo(function DiffView({
  tool,
}: DiffViewProps): React.ReactElement | null {
  const { wrapLines } = useWrapCodeBlocks();
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
    if (rows.length === 0) return null;

    return {
      filePath: parsed.filePath,
      rows,
      additions,
      removals,
      totalRows,
      truncated,
      language: inferLanguage(parsed.filePath),
    };
  }, [tool.input, tool.name]);

  if (!diffData) return null;

  return (
    <div data-component="diff-view" data-variant="side-by-side">
      <SideBySideDiffGrid
        rows={diffData.rows}
        language={diffData.language}
        wrapLines={wrapLines}
      />

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
}: {
  rows: SideBySideRow[];
  language: BundledLanguage;
  wrapLines?: boolean;
}): React.ReactElement {
  return (
    <div
      data-component="diff-view"
      data-variant="side-by-side"
      data-embedded="true"
      data-wrap={wrapLines ? 'true' : 'false'}
    >
      <div data-slot="diff-grid" data-scrollable="true">
        <SideColumn rows={rows} side="left" language={language} />
        <SideColumn rows={rows} side="right" language={language} />
      </div>
    </div>
  );
});

export { inferLanguage, MAX_LINES as DIFF_MAX_LINES };
