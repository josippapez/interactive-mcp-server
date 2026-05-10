import React, { memo, useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolCallInfo } from '../../../types/unified-message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import {
  HighlightedCodeBlock,
  TOOL_CALL_LABEL_TEXT_CLASS,
  TOOL_CALL_MONO_TEXT_CLASS,
  ToolChevron,
  ToolDurationBadge,
  ToolNameBadge,
  ToolStatusBadge,
  WrapToggleCodeBlock,
  getToolDurationMs,
} from './ToolCallShared';
import { classifyTool } from './tool-registry';
import { resolveNextToolExpandedState } from './tool-expanded-state';

const BASH_PREVIEW_MAX = 60;

type BashOutputSection = {
  title: string;
  body: string;
};

type BashOutputCardData = {
  sections: BashOutputSection[];
  reminder?: string;
};

/**
 * Ported from DefaultToolCard — lifts the `> cmd\nresult` convention
 * emitted by some bash wrappers into ordered sections, and strips a
 * trailing `[test-reminder]` marker into its own field.
 */
function parseBashOutput(output?: string): BashOutputCardData | null {
  if (!output) return null;

  const trimmed = output.trim();
  if (!trimmed) return null;

  const reminderMarker = '\n---\n[test-reminder]';
  const reminderIndex = trimmed.indexOf(reminderMarker);

  const mainOutput =
    reminderIndex >= 0 ? trimmed.slice(0, reminderIndex).trim() : trimmed;
  const reminder =
    reminderIndex >= 0 ? trimmed.slice(reminderIndex + 5).trim() : undefined;

  const codeBlockMatch = mainOutput.match(/```(?:\w+)?\n([\s\S]*?)```/);
  const commandOutput = codeBlockMatch ? codeBlockMatch[1].trim() : mainOutput;

  const sections: BashOutputSection[] = [];
  const lines = commandOutput.split('\n');

  if (lines.length > 0 && lines[0].startsWith('> ')) {
    const command = lines.slice(0, 2).join('\n').trim();
    if (command) {
      sections.push({ title: 'Command', body: command });
    }

    const remaining = lines.slice(2).join('\n').trim();
    if (remaining) {
      sections.push({ title: 'Result', body: remaining });
    }
  } else if (commandOutput) {
    sections.push({ title: 'Result', body: commandOutput });
  }

  if (sections.length === 0 && !reminder) return null;
  return { sections, reminder };
}

function getCommand(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  for (const key of ['command', 'cmd', 'script']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function getExitCode(
  metadata: Record<string, unknown> | undefined,
): number | null {
  const raw = metadata?.exit ?? metadata?.exitCode;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value ? value : null;
}

function getMetadataBoolean(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

export function isBashToolCall(name: string): boolean {
  return classifyTool(name) === 'bash';
}

export const BashToolCard = memo(function BashToolCard({
  tool,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  forceExpanded: boolean;
}): React.ReactElement {
  const isPending = tool.status === 'pending';
  const initialOpen = forceExpanded || isPending;
  const [isExpanded, setIsExpanded] = useState(initialOpen);

  useEffect(() => {
    setIsExpanded((currentExpanded) =>
      resolveNextToolExpandedState({
        currentExpanded,
        forceExpanded,
        isPending,
      }),
    );
  }, [forceExpanded, isPending]);

  const command = getCommand(tool.input);
  const preview =
    command.length > BASH_PREVIEW_MAX
      ? `${command.slice(0, BASH_PREVIEW_MAX - 3)}...`
      : command;

  const durationMs = getToolDurationMs(tool);
  const exitCode = getExitCode(tool.metadata);
  const description = getMetadataString(tool.metadata, 'description');
  const outputPath = getMetadataString(tool.metadata, 'outputPath');
  const truncated = getMetadataBoolean(tool.metadata, 'truncated');
  const parsedOutput = parseBashOutput(tool.output);
  const combinedOutput = parsedOutput
    ? parsedOutput.sections.map((s) => s.body).join('\n\n')
    : '';

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
            data-variant="bash-trigger"
            data-pending={isPending ? 'true' : undefined}
          >
            <Terminal
              data-slot="tool-icon"
              aria-hidden="true"
              className="shrink-0"
            />
            <span data-slot="tool-title">Shell</span>
            <ToolNameBadge name={tool.name} />
            {durationMs !== null && <ToolDurationBadge tool={tool} />}
            {preview && (
              <span
                data-slot="tool-subtitle"
                title={command}
                className="font-mono"
              >
                {preview}
              </span>
            )}
            {description && !preview && (
              <span data-slot="tool-subtitle" title={description}>
                {description}
              </span>
            )}
            {truncated && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium uppercase tracking-wide shrink-0 bg-[var(--background-stronger)] text-[var(--text-weak)] border border-[var(--border-weak-base)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
                title={outputPath ?? undefined}
              >
                truncated
              </span>
            )}
            {exitCode !== null && exitCode !== 0 && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium uppercase tracking-wide shrink-0 bg-[var(--color-error-surface)] text-[var(--color-error)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
              >
                exit {exitCode}
              </span>
            )}
            <ToolStatusBadge status={tool.status} />
            <ToolChevron />
          </button>
        }
      />

      <CollapsibleContent className="pl-6 pr-0 py-1 flex flex-col gap-[var(--tool-content-gap,6px)]">
        {command && (
          <HighlightedCodeBlock
            text={command}
            language="bash"
            containerClassName="group relative"
            preClassName="whitespace-pre-wrap break-all"
          />
        )}

        {parsedOutput && (
          <div className="flex flex-col gap-1.5">
            {combinedOutput && (
              <WrapToggleCodeBlock text={combinedOutput} autoScroll={true} />
            )}

            {parsedOutput.reminder && (
              <div className="rounded-[var(--radius-xs)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/8 px-2 py-1.5">
                <div
                  className={`uppercase tracking-wide text-[var(--color-warning)] font-medium mb-0.5 ${TOOL_CALL_LABEL_TEXT_CLASS}`}
                >
                  Test reminder
                </div>
                <WrapToggleCodeBlock
                  text={parsedOutput.reminder}
                  containerClassName="mt-1"
                  preClassName={`text-[var(--text-weak)] ${TOOL_CALL_MONO_TEXT_CLASS}`}
                />
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});
