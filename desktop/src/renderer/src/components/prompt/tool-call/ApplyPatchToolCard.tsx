import React, { memo, useEffect, useMemo, useState } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  buildUnifiedDiffRows,
  DIFF_MAX_LINES,
  DiffDisplayModeToggle,
  inferLanguage,
  SideBySideDiffGrid,
  UnifiedDiffRows,
} from '../DiffView';
import {
  parseApplyPatchFileDiffs,
  parseApplyPatchMetadataFileDiffs,
  pairApplyPatchDiffLines,
  type ApplyPatchFileDiff,
  type PatchAction,
} from './apply-patch-diff';
import {
  DiagnosticsBadge,
  DiagnosticsList,
  DiffChanges,
  ToolDurationBadge,
  countDiagnostics,
  extractVisibleErrorsForFile,
} from './ToolCallShared';
import { useWrapCodeBlocks } from './use-wrap-code-blocks';

function getPatchActionLabel(action: PatchAction): string {
  switch (action) {
    case 'add':
      return 'Created';
    case 'delete':
      return 'Deleted';
    case 'move':
      return 'Moved';
    case 'update':
      return 'Updated';
  }
}

// The assembled patch lines are rendered as a side-by-side diff via
// `SideBySideDiffGrid`, which tokenizes each side with Shiki in the
// inferred source language (TS, JS, Python, etc.) — not the generic
// `diff` grammar — so keywords, strings, and comments get real colors.

export function isApplyPatchToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'apply_patch' || lower.includes('apply_patch');
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
  diagnostics,
  mode,
  onModeChange,
}: {
  file: ApplyPatchFileDiff;
  wrapLines: boolean;
  diagnostics: ReturnType<typeof extractVisibleErrorsForFile>;
  mode: 'unified' | 'side-by-side';
  onModeChange: (mode: 'unified' | 'side-by-side') => void;
}): React.ReactElement {
  const language = useMemo(() => inferLanguage(file.filePath), [file.filePath]);
  const paired = useMemo(
    () => pairApplyPatchDiffLines(file.lines, DIFF_MAX_LINES),
    [file.lines],
  );
  const unified = useMemo(
    () => buildUnifiedDiffRows(file.lines, DIFF_MAX_LINES),
    [file.lines],
  );

  return (
    <div>
      {file.lines.length > 0 &&
      (paired.rows.length > 0 || unified.rows.length > 0) ? (
        <>
          <DiffDisplayModeToggle mode={mode} onModeChange={onModeChange} />
          {mode === 'unified' ? (
            <UnifiedDiffRows
              rows={unified.rows}
              language={language}
              wrapLines={wrapLines}
            />
          ) : (
            <SideBySideDiffGrid
              rows={paired.rows}
              language={language}
              wrapLines={wrapLines}
            />
          )}
        </>
      ) : (
        <div className="px-2 py-2 text-[10px] font-mono text-[var(--text-weaker)]">
          No diff hunks available.
        </div>
      )}

      {(paired.truncated || unified.truncated) && (
        <div
          data-component="diff-view"
          data-variant="side-by-side"
          data-embedded="footer-only"
        >
          <div data-slot="diff-hunk-separator" className="font-mono text-[9px]">
            <span data-slot="diff-hunk-gutter">…</span>
            <span className="px-2 py-1 text-[var(--text-weaker)]">
              Showing first {DIFF_MAX_LINES} of{' '}
              {Math.max(paired.totalRows, unified.totalRows)} diff rows.
            </span>
          </div>
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="px-2 py-1.5 border-t border-[var(--border-weaker-base)]">
          <DiagnosticsList diagnostics={diagnostics} />
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
  metadata,
}: {
  file: ApplyPatchFileDiff;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  wrapLines: boolean;
  onToggleWrap: () => void;
  metadata: Record<string, unknown> | undefined;
}): React.ReactElement {
  const diagnostics = useMemo(
    () => extractVisibleErrorsForFile(metadata, file.filePath),
    [metadata, file.filePath],
  );
  const [mode, setMode] = useState<'unified' | 'side-by-side'>('side-by-side');
  const diagnosticCounts = useMemo(
    () => countDiagnostics(diagnostics),
    [diagnostics],
  );

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggle}
      render={
        <div data-slot="apply-patch-item">
          <div data-slot="apply-patch-trigger-row">
            <CollapsibleTrigger
              render={
                <button type="button" data-slot="apply-patch-trigger">
                  <span
                    data-slot="apply-patch-action"
                    data-action={file.action}
                  >
                    {getPatchActionLabel(file.action)}
                  </span>
                  <span data-slot="apply-patch-path" title={file.filePath}>
                    {file.fromPath
                      ? `${file.fromPath} → ${file.filePath}`
                      : file.filePath}
                  </span>
                  <span data-slot="apply-patch-summary">
                    <DiffChanges
                      additions={file.additions}
                      deletions={file.deletions}
                    />
                    <DiagnosticsBadge counts={diagnosticCounts} />
                  </span>
                </button>
              }
            />
            <button
              type="button"
              aria-pressed={wrapLines}
              onClick={() => {
                void onToggleWrap();
              }}
              data-slot="apply-patch-wrap-toggle"
            >
              Wrap lines
            </button>
          </div>

          <CollapsibleContent>
            <FileDiffBody
              file={file}
              wrapLines={wrapLines}
              diagnostics={diagnostics}
              mode={mode}
              onModeChange={setMode}
            />
          </CollapsibleContent>
        </div>
      }
    />
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
    () =>
      parseApplyPatchMetadataFileDiffs(tool.metadata) ??
      parseApplyPatchFileDiffs(tool.input) ??
      [],
    [tool.input, tool.metadata],
  );
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const { wrapLines, toggleWrap } = useWrapCodeBlocks();
  const handleToggleWrap = () => {
    void toggleWrap();
  };

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
          wrapLines={wrapLines}
          onToggleWrap={handleToggleWrap}
          metadata={tool.metadata}
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
          wrapLines={wrapLines}
          onToggleWrap={handleToggleWrap}
          metadata={tool.metadata}
        />
      ))}
    </div>
  );
});

export default ApplyPatchToolCard;
