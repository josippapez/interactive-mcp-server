import React, { memo, useEffect, useMemo, useState } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  DIFF_MAX_LINES,
  SideBySideDiffGrid,
  inferLanguage,
  pairGenericDiffLines,
} from '../DiffView';
import { DiffChanges, ToolDurationBadge, splitPath } from './ToolCallShared';
import { pruneDiffWrapState, toggleDiffWrapState } from './diff-wrap-state';

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

// The assembled patch lines are rendered as a side-by-side diff via
// `SideBySideDiffGrid`, which tokenizes each side with Shiki in the
// inferred source language (TS, JS, Python, etc.) — not the generic
// `diff` grammar — so keywords, strings, and comments get real colors.

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

// Rebuild a unified-diff-style source string that shiki's `diff` grammar
// understands. We emit `+`, `-`, or ` ` as the leading character for each
// line so shiki colors additions/removals/context appropriately.
// NOTE: Deprecated — retained only in case a future consumer needs a
// flat unified-diff string. The active renderer uses `SideBySideDiffGrid`.

/**
 * Render the side-by-side diff for a single file within an apply_patch
 * result. Tokenized per-side in the file's inferred source language so
 * keywords/strings/comments get real syntax colors instead of the
 * generic `diff` grammar (which only tints +/- characters).
 */
const FileDiffBody = memo(function FileDiffBody({
  file,
  wrapLines,
  onToggleWrap,
}: {
  file: ApplyPatchFileDiff;
  wrapLines: boolean;
  onToggleWrap: () => void;
}): React.ReactElement {
  const extension = file.filePath.split('.').pop() ?? '';
  const language = useMemo(() => inferLanguage(file.filePath), [file.filePath]);
  const paired = useMemo(
    () => pairGenericDiffLines(file.lines, DIFF_MAX_LINES),
    [file.lines],
  );

  return (
    <div>
      <div
        data-component="diff-view"
        data-variant="side-by-side"
        data-embedded="header-only"
      >
        <div data-slot="diff-header">
          <span data-slot="diff-filepath" title={file.filePath}>
            {file.filePath}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={wrapLines}
              onClick={onToggleWrap}
              className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide transition-colors ${
                wrapLines
                  ? 'border-[var(--color-agent)]/40 bg-[var(--color-agent)]/12 text-[var(--color-agent)]'
                  : 'border-[var(--border-weaker-base)] text-[var(--text-weaker)] hover:bg-[var(--background-base)]'
              }`}
            >
              Wrap lines
            </button>
            {extension && (
              <span className="font-mono text-[var(--text-weaker)]">
                {extension}
              </span>
            )}
          </div>
        </div>
      </div>

      {file.lines.length > 0 && paired.rows.length > 0 ? (
        <SideBySideDiffGrid
          rows={paired.rows}
          language={language}
          wrapLines={wrapLines}
        />
      ) : (
        <div className="px-2 py-2 text-[10px] font-mono text-[var(--text-weaker)]">
          No diff hunks available.
        </div>
      )}

      {paired.truncated && (
        <div
          data-component="diff-view"
          data-variant="side-by-side"
          data-embedded="footer-only"
        >
          <div data-slot="diff-hunk-separator" className="font-mono text-[9px]">
            <span data-slot="diff-hunk-gutter">…</span>
            <span className="px-2 py-1 text-[var(--text-weaker)]">
              Showing first {DIFF_MAX_LINES} of {paired.totalRows} diff rows.
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * One accordion item in a multi-file apply_patch result. Emits the
 * `apply-patch-item` / `apply-patch-trigger` slots so the sticky-header
 * CSS (main.css 977-1022) takes effect. Directory is RTL-truncated.
 */
const FileDiffAccordionItem = memo(function FileDiffAccordionItem({
  file,
  expanded,
  onToggle,
  wrapLines,
  onToggleWrap,
}: {
  file: ApplyPatchFileDiff;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  wrapLines: boolean;
  onToggleWrap: () => void;
}): React.ReactElement {
  // For moves, show the destination path (the file's current identity).
  // `fromPath → filePath` is still useful context; keep it visible inside
  // the filename slot so RTL-truncation of the directory still works.
  const { directory, filename } = splitPath(file.filePath);

  return (
    <Collapsible open={expanded} onOpenChange={onToggle} asChild>
      <div data-slot="apply-patch-item">
        <CollapsibleTrigger asChild>
          <button type="button" data-slot="apply-patch-trigger">
            {directory && (
              <span data-slot="apply-patch-directory">{directory}</span>
            )}
            <span data-slot="apply-patch-filename">
              {file.fromPath ? `${file.fromPath} → ${filename}` : filename}
            </span>
            <span data-slot="apply-patch-summary">
              <DiffChanges
                additions={file.additions}
                deletions={file.deletions}
              />
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <FileDiffBody
            file={file}
            wrapLines={wrapLines}
            onToggleWrap={onToggleWrap}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
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
  const [wrappedById, setWrappedById] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    setWrappedById((prev) =>
      pruneDiffWrapState(
        prev,
        files.map((file) => file.id),
      ),
    );
  }, [files]);

  const toggleExpanded = (id: string, open: boolean) => {
    setExpandedIds((prev) => {
      if (open) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  if (files.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-weak-base)] overflow-hidden bg-[var(--background-base)]">
        <div className="px-2 py-1 flex items-center justify-between gap-2 border-b border-[var(--border-weaker-base)]">
          <span className="text-[var(--color-tool)] font-mono text-[10px]">
            {tool.name}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-[var(--text-weaker)]">
            No patch preview
          </span>
        </div>
        {tool.output && (
          <pre className="px-2 py-1.5 text-[10px] font-mono text-[var(--text-weak)] whitespace-pre-wrap max-h-48 overflow-auto">
            {tool.output}
          </pre>
        )}
      </div>
    );
  }

  // Single-file case — render one accordion item with a scope wrapper so
  // border/sticky rules still apply. No summary row needed.
  if (files.length === 1) {
    const file = files[0];
    return (
      <div data-scope="apply-patch">
        <FileDiffAccordionItem
          file={file}
          expanded={expandedIds.includes(file.id)}
          onToggle={(open) => toggleExpanded(file.id, open)}
          wrapLines={Boolean(wrappedById[file.id])}
          onToggleWrap={() =>
            setWrappedById((prev) => toggleDiffWrapState(prev, file.id))
          }
        />
      </div>
    );
  }

  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div data-scope="apply-patch">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-[var(--border-weaker-base)] bg-[var(--background-stronger)]">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-[var(--color-tool)] font-mono text-[10px]">
            apply_patch
          </span>
          <span className="text-[9px] uppercase tracking-wide text-[var(--text-weaker)]">
            {files.length} files
          </span>
          <ToolDurationBadge tool={tool} />
        </div>
        <DiffChanges additions={totalAdditions} deletions={totalDeletions} />
      </div>

      {files.map((file) => (
        <FileDiffAccordionItem
          key={file.id}
          file={file}
          expanded={expandedIds.includes(file.id)}
          onToggle={(open) => toggleExpanded(file.id, open)}
          wrapLines={Boolean(wrappedById[file.id])}
          onToggleWrap={() =>
            setWrappedById((prev) => toggleDiffWrapState(prev, file.id))
          }
        />
      ))}
    </div>
  );
});

export default ApplyPatchToolCard;
