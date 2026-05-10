import React, { memo, useEffect, useState } from 'react';
import { ArrowUpRight, Globe } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import type { BundledLanguage } from 'shiki';
import {
  HighlightedCodeBlock,
  TOOL_CALL_MONO_TEXT_CLASS,
  ToolChevron,
  ToolDurationBadge,
  ToolNameBadge,
  ToolStatusBadge,
  WrapToggleCodeBlock,
  hostnameOf,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';
import { resolveNextToolExpandedState } from './tool-expanded-state';

const ALLOWED_FORMATS = new Set(['markdown', 'text', 'html']);

function getUrl(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  for (const key of ['url', 'uri', 'endpoint']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function getFormat(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input['format'];
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return ALLOWED_FORMATS.has(lower) ? lower : null;
}

const FORMAT_LANGUAGE: Record<string, BundledLanguage> = {
  markdown: 'markdown',
  html: 'html',
};

export function isWebFetchToolCall(name: string): boolean {
  return classifyTool(name) === 'webfetch';
}

export const WebFetchToolCard = memo(function WebFetchToolCard({
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

  const url = getUrl(tool.input);
  const hostname = url ? hostnameOf(url) : '';
  const format = getFormat(tool.input);
  const output = tool.output ?? '';

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
            data-variant="webfetch-trigger"
            data-pending={isPending ? 'true' : undefined}
          >
            <Globe
              data-slot="tool-icon"
              aria-hidden="true"
              className="shrink-0"
            />
            <span data-slot="tool-title">Fetch</span>
            <ToolNameBadge name={tool.name} />
            {hostname && (
              <span data-slot="tool-subtitle" title={url} className="font-mono">
                {hostname}
              </span>
            )}
            {url && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Open URL in browser"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }
                }}
                className="inline-flex items-center justify-center h-4 w-4 rounded-[var(--radius-xs)] text-[var(--text-weak)] hover:text-[var(--text-strong)] hover:bg-[var(--background-stronger)] cursor-pointer shrink-0"
              >
                <ArrowUpRight
                  width={12}
                  height={12}
                  aria-hidden="true"
                  className="shrink-0"
                />
              </span>
            )}
            <ToolDurationBadge tool={tool} />
            <ToolStatusBadge status={tool.status} />
            <ToolChevron />
          </button>
        }
      />

      <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
        {url && (
          <div
            className={`font-mono text-[var(--text-weak)] overflow-x-auto whitespace-nowrap ${TOOL_CALL_MONO_TEXT_CLASS}`}
          >
            {url}
          </div>
        )}

        {format && (
          <div>
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium uppercase tracking-wide bg-[var(--background-stronger)] text-[var(--text-weak)] border border-[var(--border-weak-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
            >
              {format}
            </span>
          </div>
        )}

        {output &&
          (format && FORMAT_LANGUAGE[format] ? (
            <HighlightedCodeBlock
              text={output}
              language={FORMAT_LANGUAGE[format]}
              maxHeightClass="max-h-[320px]"
              preClassName="!max-h-[320px]"
            />
          ) : (
            <WrapToggleCodeBlock
              text={output}
              maxHeightClass="max-h-[320px]"
              preClassName="!max-h-[320px]"
            />
          ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
