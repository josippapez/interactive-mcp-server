import React, { memo, useEffect, useState } from 'react';
import { FilePlus } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  DiagnosticsBadge,
  DiagnosticsList,
  TOOL_CALL_MONO_TEXT_CLASS,
  ToolChevron,
  ToolDurationBadge,
  ToolStatusBadge,
  WrapToggleCodeBlock,
  countDiagnostics,
  extractDiagnosticsForFile,
  splitPath,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';

function getFilePath(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  for (const key of ['filePath', 'path', 'file']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function getContent(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const content = input['content'];
  return typeof content === 'string' ? content : '';
}

function countLines(text: string): number {
  if (!text) return 0;
  // Count lines without regex split to keep this cheap on large content.
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) lines += 1;
  }
  // Trailing newline shouldn't be counted as an extra empty line.
  if (text.endsWith('\n')) lines -= 1;
  return Math.max(lines, 0);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function isSuccessOutput(output: string | undefined): boolean {
  if (!output) return false;
  const lower = output.toLowerCase();
  return (
    lower.includes('created') ||
    lower.includes('written') ||
    lower.includes('wrote') ||
    lower.includes('success')
  );
}

export function isWriteToolCall(name: string): boolean {
  return classifyTool(name) === 'write';
}

export const WriteToolCard = memo(function WriteToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);

  useEffect(() => {
    if (forceExpanded) setIsExpanded(true);
  }, [forceExpanded]);

  const filePath = getFilePath(tool.input);
  const content = getContent(tool.input);
  const { directory, filename } = splitPath(filePath);
  const lineCount = countLines(content);
  const isPending = tool.status === 'pending';
  const showSuccessFooter =
    tool.status === 'completed' && isSuccessOutput(tool.output) && filePath;
  const diagnostics = extractDiagnosticsForFile(tool.metadata, filePath);
  const diagnosticCounts = countDiagnostics(diagnostics);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="w-full"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-component="tool-trigger"
          data-variant="write-trigger"
          data-pending={isPending ? 'true' : undefined}
        >
          <FilePlus
            data-slot="tool-icon"
            aria-hidden="true"
            className="shrink-0"
          />
          <span data-slot="tool-title">Write</span>
          <span
            data-slot="tool-subtitle"
            title={filePath}
            className="font-mono inline-flex items-baseline min-w-0"
          >
            {directory && (
              <span className="text-[var(--text-weak)] truncate">
                {directory}
              </span>
            )}
            <span className="text-[var(--text-strong)] font-medium">
              {filename}
            </span>
          </span>
          {lineCount > 0 && (
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium uppercase tracking-wide shrink-0 bg-[var(--color-success-surface)] text-[var(--color-success)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
            >
              +{lineCount} lines
            </span>
          )}
          <DiagnosticsBadge counts={diagnosticCounts} />
          <ToolDurationBadge tool={tool} />
          <ToolStatusBadge status={tool.status} />
          <ToolChevron />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
        {content && (
          <WrapToggleCodeBlock
            text={content}
            maxHeightClass="max-h-[360px]"
            preClassName="!max-h-[360px]"
          />
        )}

        {showSuccessFooter && (
          <div
            className={`text-[var(--text-weak)] font-mono ${TOOL_CALL_MONO_TEXT_CLASS}`}
          >
            Created {basename(filePath)}
          </div>
        )}

        {diagnostics.length > 0 && (
          <div className="mt-1 pl-2 border-l-2 border-[var(--color-error-surface)]">
            <DiagnosticsList diagnostics={diagnostics} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});
