import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { SearchCode } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  CopyButton,
  TOOL_CALL_MONO_TEXT_CLASS,
  ToolChevron,
  ToolDurationBadge,
  ToolStatusBadge,
  splitPath,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';

type GrepResultItem = {
  file: string;
  lines: string[];
};

const PATTERN_TRUNCATE = 60;
const DEFAULT_FILES_VISIBLE = 6;

export function isGrepToolCall(toolName: string): boolean {
  return classifyTool(toolName) === 'grep';
}

/**
 * Parse opencode grep output: blocks are separated by a `<path>:` line,
 * with matching lines following until the next path header.
 *
 * Ported from DefaultToolCard.tsx L98-127 so DefaultToolCard can stay
 * untouched while GrepToolCard owns grep presentation.
 */
function parseGrepOutput(output?: string): GrepResultItem[] | null {
  if (!output) return null;

  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const results: GrepResultItem[] = [];
  let current: GrepResultItem | null = null;

  for (const line of lines) {
    if (line.endsWith(':')) {
      if (current) {
        results.push(current);
      }
      current = { file: line.slice(0, -1), lines: [] };
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
  }

  if (current) {
    results.push(current);
  }

  return results.length > 0 ? results : null;
}

function truncatePattern(pattern: string): string {
  if (pattern.length <= PATTERN_TRUNCATE) return pattern;
  return pattern.slice(0, PATTERN_TRUNCATE - 1) + '…';
}

function getStringInput(
  input: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = input?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

const FileBlock = memo(function FileBlock({
  result,
}: {
  result: GrepResultItem;
}): React.ReactElement {
  const { directory, filename } = splitPath(result.file);
  return (
    <div className="rounded-[var(--radius-xs)] border border-[var(--border-weak-base)] bg-[var(--background-stronger)]">
      <div
        className={`flex items-center gap-1 px-2 py-1 border-b border-[var(--border-weak-base)] font-mono ${TOOL_CALL_MONO_TEXT_CLASS}`}
      >
        {directory && (
          <span className="text-[var(--text-weak)] truncate">{directory}</span>
        )}
        <span className="text-[var(--text-strong)] font-semibold">
          {filename}
        </span>
        <span className="ml-auto text-[var(--text-weak)]">
          ({result.lines.length})
        </span>
      </div>
      <div className="flex flex-col">
        {result.lines.map((line, idx) => (
          <div
            key={`${result.file}-${idx}`}
            className={`px-2 py-0.5 font-mono text-[var(--text-weak)] whitespace-pre-wrap border-l-2 border-[var(--border-weak-base)] ml-2 break-all ${TOOL_CALL_MONO_TEXT_CLASS}`}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
});

const GrepToolCard = memo(function GrepToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
}): React.ReactElement {
  const isPending = tool.status === 'pending';
  const [isExpanded, setIsExpanded] = useState(forceExpanded || isPending);
  const [showAllFiles, setShowAllFiles] = useState(false);

  useEffect(() => {
    setIsExpanded(forceExpanded || isPending);
  }, [forceExpanded, isPending]);

  const results = useMemo(() => parseGrepOutput(tool.output), [tool.output]);
  const totalMatches = useMemo(() => {
    if (!results) return 0;
    return results.reduce((acc, r) => acc + r.lines.length, 0);
  }, [results]);

  const pattern = getStringInput(tool.input, 'pattern');
  const searchPath = getStringInput(tool.input, 'path');
  const include = getStringInput(tool.input, 'include');
  const caseInsensitive =
    tool.input && tool.input['-i'] === true ? true : false;
  const glob = getStringInput(tool.input, 'glob');

  const chips = [
    include ? `include: ${include}` : null,
    glob ? `glob: ${glob}` : null,
    caseInsensitive ? 'case-insensitive' : null,
  ].filter((v): v is string => Boolean(v));

  const visibleResults =
    results && !showAllFiles
      ? results.slice(0, DEFAULT_FILES_VISIBLE)
      : (results ?? []);
  const hiddenCount = results
    ? Math.max(0, results.length - DEFAULT_FILES_VISIBLE)
    : 0;

  const toggleShowAll = useCallback(() => {
    setShowAllFiles((prev) => !prev);
  }, []);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="w-full"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-component="grep-trigger"
          data-pending={isPending ? 'true' : undefined}
        >
          <SearchCode
            data-slot="tool-icon"
            aria-hidden="true"
            className="shrink-0"
          />
          <span data-slot="tool-title">Search</span>
          {pattern && (
            <span
              data-slot="tool-subtitle"
              title={pattern}
              className="font-mono"
            >
              {truncatePattern(pattern)}
            </span>
          )}
          {searchPath && (
            <span
              data-slot="tool-path-suffix"
              className="text-[var(--text-weak)]"
              title={searchPath}
            >
              in {searchPath}
            </span>
          )}
          {results ? (
            <span
              data-slot="tool-count-pill"
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium bg-[var(--color-success-surface)] text-[var(--color-success)] shrink-0 ${TOOL_CALL_MONO_TEXT_CLASS}`}
            >
              {totalMatches} {totalMatches === 1 ? 'match' : 'matches'}
            </span>
          ) : tool.output ? (
            <span
              className={`${TOOL_CALL_MONO_TEXT_CLASS} text-[var(--text-weak)]`}
            >
              No matches
            </span>
          ) : null}
          <ToolDurationBadge tool={tool} />
          <ToolStatusBadge status={tool.status} />
          <ToolChevron />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span
                key={c}
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono bg-[var(--background-stronger)] text-[var(--text-weak)] border border-[var(--border-weak-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {results && results.length > 0 ? (
          <div className="relative group">
            <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
              {visibleResults.map((r) => (
                <FileBlock key={r.file} result={r} />
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={toggleShowAll}
                  className={`self-start text-[var(--text-weak)] hover:text-[var(--text-strong)] px-2 py-0.5 cursor-pointer ${TOOL_CALL_MONO_TEXT_CLASS}`}
                >
                  {showAllFiles
                    ? 'Show fewer files'
                    : `+${hiddenCount} more files`}
                </button>
              )}
            </div>
            {tool.output && (
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton
                  text={tool.output}
                  slot="bash-copy"
                  className={`px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--background-stronger)] border border-[var(--border-weak-base)] text-[var(--text-weak)] hover:text-[var(--text-strong)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
                />
              </div>
            )}
          </div>
        ) : tool.output ? (
          <div
            className={`font-mono text-[var(--text-weak)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
          >
            No matches
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
});

GrepToolCard.displayName = 'GrepToolCard';

export { GrepToolCard };
export default GrepToolCard;
