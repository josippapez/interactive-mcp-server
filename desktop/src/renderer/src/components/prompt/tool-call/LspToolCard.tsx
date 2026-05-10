import React, { memo, useEffect, useMemo, useState } from 'react';
import { Braces } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  HighlightedCodeBlock,
  TOOL_CALL_MONO_TEXT_CLASS,
  ToolChevron,
  ToolDurationBadge,
  ToolNameBadge,
  ToolStatusBadge,
  WrapToggleCodeBlock,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';
import { resolveNextToolExpandedState } from './tool-expanded-state';

export function isLspToolCall(name: string): boolean {
  return classifyTool(name) === 'lsp';
}

function getStringInput(
  input: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = input?.[key];
  return typeof value === 'string' && value ? value : null;
}

function getResultCount(
  metadata: Record<string, unknown> | undefined,
): number | null {
  const result = metadata?.result;
  if (Array.isArray(result)) return result.length;
  return null;
}

function formatResult(
  metadata: Record<string, unknown> | undefined,
  output?: string,
): string {
  const result = metadata?.result;
  if (result !== undefined) return JSON.stringify(result, null, 2);
  return output ?? '';
}

const LspToolCard = memo(function LspToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
}): React.ReactElement {
  const isPending = tool.status === 'pending';
  const [isExpanded, setIsExpanded] = useState(forceExpanded || isPending);

  useEffect(() => {
    setIsExpanded((currentExpanded) =>
      resolveNextToolExpandedState({
        currentExpanded,
        forceExpanded,
        isPending,
      }),
    );
  }, [forceExpanded, isPending]);

  const operation = getStringInput(tool.input, 'operation') ?? tool.name;
  const filePath =
    getStringInput(tool.input, 'filePath') ??
    getStringInput(tool.input, 'path');
  const resultCount = getResultCount(tool.metadata);
  const resultText = useMemo(
    () => formatResult(tool.metadata, tool.output),
    [tool.metadata, tool.output],
  );

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
            data-component="tool-trigger"
            data-pending={isPending ? 'true' : undefined}
          >
            <Braces
              data-slot="tool-icon"
              aria-hidden="true"
              className="shrink-0"
            />
            <span data-slot="tool-title">LSP</span>
            <ToolNameBadge name={tool.name} />
            <span
              data-slot="tool-subtitle"
              title={operation}
              className="font-mono"
            >
              {operation}
            </span>
            {filePath && (
              <span data-slot="tool-path-suffix" title={filePath}>
                {filePath}
              </span>
            )}
            {resultCount !== null && (
              <span
                data-slot="tool-count-pill"
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium bg-[var(--background-stronger)] text-[var(--text-weak)] border border-[var(--border-weak-base)] shrink-0 ${TOOL_CALL_MONO_TEXT_CLASS}`}
              >
                {resultCount} {resultCount === 1 ? 'result' : 'results'}
              </span>
            )}
            <ToolDurationBadge tool={tool} />
            <ToolStatusBadge status={tool.status} />
            <ToolChevron />
          </button>
        }
      />

      {resultText && (
        <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
          {resultText.trim().startsWith('[') ||
          resultText.trim().startsWith('{') ? (
            <HighlightedCodeBlock
              text={resultText}
              language="json"
              maxHeightClass="max-h-72"
              preClassName="!max-h-72"
            />
          ) : (
            <WrapToggleCodeBlock
              text={resultText}
              maxHeightClass="max-h-72"
              preClassName={`text-[var(--text-weak)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
            />
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

LspToolCard.displayName = 'LspToolCard';

export { LspToolCard };
export default LspToolCard;
