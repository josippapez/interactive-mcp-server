import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import DiffView from '../DiffView';
import {
  DiagnosticsBadge,
  DiagnosticsList,
  DiffChanges,
  ToolDurationBadge,
  ToolStatusBadge,
  countDiagnostics,
  extractDiagnosticsForFile,
  splitPath,
} from './ToolCallShared';
import {
  generateUnifiedDiff,
  parseDiffLines,
  parseEditToolInput,
} from '../../../lib/diff-parser';

/**
 * File icon used for the tool-loaded-file row. Sized via CSS
 * (`[data-slot='file-icon']` → 12x12).
 */
const FileIcon = memo(function FileIcon(): React.ReactElement {
  return (
    <svg
      data-slot="file-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2Z" />
      <path d="M9 2v4h4" />
    </svg>
  );
});

export const ReadToolRow = memo(function ReadToolRow({
  tool,
  readFilePath,
}: {
  tool: ToolCallInfo;
  readFilePath: string;
}): React.ReactElement {
  return (
    <div data-component="tool-loaded-file">
      <FileIcon />
      <span data-slot="file-path" title={readFilePath}>
        {readFilePath}
      </span>
      <ToolDurationBadge tool={tool} />
      <ToolStatusBadge status={tool.status} />
    </div>
  );
});

/**
 * Compute {additions, deletions} for an edit tool invocation. The
 * parse may fail on malformed input — in that case we return `null`
 * and the trigger renders without the diff-changes summary.
 *
 * NOTE: `generateUnifiedDiff` runs an O(m·n) LCS over old/new content.
 * For large edits this is expensive; callers MUST memoize and/or skip
 * this call while the tool input is still streaming.
 */
function getEditCounts(
  tool: ToolCallInfo,
): { additions: number; deletions: number } | null {
  const parsed = parseEditToolInput(tool.input);
  if (!parsed) return null;
  const diffText = generateUnifiedDiff(
    parsed.oldString,
    parsed.newString,
    parsed.filePath,
  );
  const lines = parseDiffLines(diffText);
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === 'addition') additions += 1;
    else if (line.type === 'removal') deletions += 1;
  }
  return { additions, deletions };
}

const EditToolRow = memo(function EditToolRow({
  tool,
  filePath,
  isExpanded,
  onOpenChange,
}: {
  tool: ToolCallInfo;
  filePath: string;
  isExpanded: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const isPending = tool.status === 'pending';
  // Memoize the LCS-backed diff computation. Recompute only when the
  // actual input payload changes, NOT on every parent re-render (which
  // happens on every streaming `message.part.delta` while the tool is
  // in flight). Additionally, skip the computation entirely while the
  // tool is still streaming — the counts would be based on partial
  // input and are not worth the O(m·n) cost. Once the tool transitions
  // out of `pending`, the full input is available and we compute once.
  const counts = useMemo(() => {
    if (isPending) return null;
    return getEditCounts(tool);
  }, [isPending, tool]);
  const { directory, filename } = splitPath(filePath);
  const diagnostics = extractDiagnosticsForFile(tool.metadata, filePath);
  const diagnosticCounts = countDiagnostics(diagnostics);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onOpenChange}
      className="w-full"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-component="edit-trigger"
          data-pending={isPending ? 'true' : undefined}
        >
          <div data-slot="edit-title">
            <span data-slot="tool-name">{tool.name}</span>
            {directory && (
              <span data-slot="message-part-directory">{directory}</span>
            )}
            <span data-slot="message-part-filename">{filename}</span>
          </div>
          {counts && (
            <DiffChanges
              additions={counts.additions}
              deletions={counts.deletions}
            />
          )}
          <DiagnosticsBadge counts={diagnosticCounts} />
          <ToolDurationBadge tool={tool} />
          <ToolStatusBadge status={tool.status} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent data-component="edit-content">
        <DiffView tool={tool} />
        {diagnostics.length > 0 && (
          <div className="mt-2 pl-2 border-l-2 border-[var(--color-error-surface)]">
            <DiagnosticsList diagnostics={diagnostics} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});

export const EditToolCard = memo(function EditToolCard({
  tool,
  filePath,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  filePath: string;
  forceExpanded: boolean;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);

  useEffect(() => {
    setIsExpanded(forceExpanded);
  }, [forceExpanded]);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsExpanded(open);
  }, []);

  return (
    <EditToolRow
      tool={tool}
      filePath={filePath}
      isExpanded={isExpanded}
      onOpenChange={handleOpenChange}
    />
  );
});
