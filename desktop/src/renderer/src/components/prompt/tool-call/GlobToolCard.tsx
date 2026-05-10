import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Files } from 'lucide-react';
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
  ToolNameBadge,
  ToolStatusBadge,
  splitPath,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';
import { resolveNextToolExpandedState } from './tool-expanded-state';

const PATTERN_TRUNCATE = 60;
const DEFAULT_PATHS_VISIBLE = 15;

export function isGlobToolCall(toolName: string): boolean {
  return classifyTool(toolName) === 'glob';
}

function parseGlobOutput(output?: string): string[] {
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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

function getNumberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getBooleanMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

const PathRow = memo(function PathRow({
  path,
}: {
  path: string;
}): React.ReactElement {
  const { directory, filename } = splitPath(path);
  return (
    <div
      className={`flex items-baseline gap-0 font-mono px-2 py-0.5 truncate ${TOOL_CALL_MONO_TEXT_CLASS}`}
    >
      {directory && (
        <span className="text-[var(--text-weak)] truncate">{directory}</span>
      )}
      <span className="text-[var(--text-strong)]">{filename}</span>
    </div>
  );
});

const GlobToolCard = memo(function GlobToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
}): React.ReactElement {
  const isPending = tool.status === 'pending';
  const [isExpanded, setIsExpanded] = useState(forceExpanded || isPending);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setIsExpanded((currentExpanded) =>
      resolveNextToolExpandedState({
        currentExpanded,
        forceExpanded,
        isPending,
      }),
    );
  }, [forceExpanded, isPending]);

  const paths = useMemo(() => parseGlobOutput(tool.output), [tool.output]);
  const pattern = getStringInput(tool.input, 'pattern');
  const searchPath = getStringInput(tool.input, 'path');
  const resultCount = getNumberMetadata(tool.metadata, 'count') ?? paths.length;
  const truncated = getBooleanMetadata(tool.metadata, 'truncated');

  const visible = showAll ? paths : paths.slice(0, DEFAULT_PATHS_VISIBLE);
  const hiddenCount = Math.max(0, paths.length - DEFAULT_PATHS_VISIBLE);

  const toggleShowAll = useCallback(() => {
    setShowAll((prev) => !prev);
  }, []);

  const hasOutput = Boolean(tool.output);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="w-full"
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            data-component="glob-trigger"
            data-pending={isPending ? 'true' : undefined}
          >
            <Files
              data-slot="tool-icon"
              aria-hidden="true"
              className="shrink-0"
            />
            <span data-slot="tool-title">Find</span>
            <ToolNameBadge name={tool.name} />
            {pattern && (
              <span
                data-slot="tool-subtitle"
                title={pattern}
                className="font-mono"
              >
                {truncatePattern(pattern)}
              </span>
            )}
            {resultCount > 0 ? (
              <span
                data-slot="tool-count-pill"
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium bg-[var(--color-success-surface)] text-[var(--color-success)] shrink-0 ${TOOL_CALL_MONO_TEXT_CLASS}`}
              >
                {resultCount} {resultCount === 1 ? 'file' : 'files'}
              </span>
            ) : hasOutput ? (
              <span
                className={`${TOOL_CALL_MONO_TEXT_CLASS} text-[var(--text-weak)]`}
              >
                No matches
              </span>
            ) : null}
            {truncated && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium uppercase tracking-wide shrink-0 bg-[var(--background-stronger)] text-[var(--text-weak)] border border-[var(--border-weak-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
              >
                truncated
              </span>
            )}
            <ToolDurationBadge tool={tool} />
            <ToolStatusBadge status={tool.status} />
            <ToolChevron />
          </button>
        }
      />

      <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
        {searchPath && (
          <div>
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono bg-[var(--background-stronger)] text-[var(--text-weak)] border border-[var(--border-weak-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
              title={searchPath}
            >
              in {searchPath}
            </span>
          </div>
        )}

        {paths.length > 0 ? (
          <div className="relative group">
            <div className="max-h-[400px] overflow-y-auto rounded-[var(--radius-xs)] border border-[var(--border-weak-base)] bg-[var(--background-stronger)] py-1">
              {visible.map((p, idx) => (
                <PathRow key={`${p}-${idx}`} path={p} />
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={toggleShowAll}
                  className={`text-[var(--text-weak)] hover:text-[var(--text-strong)] px-2 py-0.5 cursor-pointer ${TOOL_CALL_MONO_TEXT_CLASS}`}
                >
                  {showAll ? 'Show fewer' : `+${hiddenCount} more`}
                </button>
              )}
            </div>
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton
                text={paths.join('\n')}
                slot="bash-copy"
                className={`px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--background-stronger)] border border-[var(--border-weak-base)] text-[var(--text-weak)] hover:text-[var(--text-strong)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
              />
            </div>
          </div>
        ) : hasOutput ? (
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

GlobToolCard.displayName = 'GlobToolCard';

export { GlobToolCard };
export default GlobToolCard;
