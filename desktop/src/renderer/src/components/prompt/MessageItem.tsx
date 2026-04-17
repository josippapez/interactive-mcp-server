import React, { memo, useCallback, useMemo } from 'react';
import type { Attachment } from '../../types';
import type { UnifiedMessage } from '../../types/unified-message';
import { useSettings } from '../../store';
import MarkdownContent from '../MarkdownContent';
import MessageTimestamp from './MessageTimestamp';
import {
  filterMessageText,
  formatCost,
  formatTokens,
  isImageAttachment,
  isSubagent,
  unifiedMessageClass,
  unifiedRoleLabel,
} from './message-item-helpers';
import { ReasoningSection, ToolCallsSection } from './message-item-sections';
import CompactionMessageItem from './CompactionMessageItem';

export interface MessageItemProps {
  msg: UnifiedMessage;
  isActive: boolean;
  showOptions: boolean;
  predefinedOptions?: string[];
  onSelectOption?: (option: string) => void;
  onExpandImage: (src: string, name: string) => void;
  expandAllTools?: boolean;
  toolAutoExpandExclusions?: string[];
  onNavigateToSession?: (sessionId: string) => void;
  showThinking?: boolean;
  isNew?: boolean;
  isStreaming?: boolean;
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
}

const MessageItem = memo(function MessageItem({
  msg,
  isActive,
  showOptions,
  predefinedOptions,
  onSelectOption,
  onExpandImage,
  expandAllTools,
  toolAutoExpandExclusions = [],
  onNavigateToSession,
  showThinking,
  isNew = false,
  isStreaming = false,
  isSearchMatch = false,
  isActiveSearchMatch = false,
}: MessageItemProps): React.ReactElement {
  const settings = useSettings();
  const roleLabel = unifiedRoleLabel(msg);
  const tokenInfo = formatTokens(msg.tokens);
  const costInfo = formatCost(msg.cost);
  const modelLabel = msg.modelId ?? null;
  const agentBadgeLabel =
    msg.source === 'conversation' && isSubagent(msg.agent) ? roleLabel : null;
  const leftGutterLabel = modelLabel || agentBadgeLabel ? null : roleLabel;
  const showMetaRow = Boolean(
    isActive || msg.channelKind === 'outbound' || costInfo,
  );

  // Filter message text based on display settings
  const displayText = useMemo(() => {
    if (!msg.text) return '';
    return filterMessageText(
      msg.text,
      settings.hideSystemReminders ?? false,
      settings.hideDocInjections ?? false,
    );
  }, [msg.text, settings.hideSystemReminders, settings.hideDocInjections]);

  const handleImageClick = useCallback(
    (attachment: Attachment) => {
      onExpandImage(
        `data:${attachment.mimeType};base64,${attachment.data}`,
        attachment.name,
      );
    },
    [onExpandImage],
  );

  if (msg.isCompaction) {
    return <CompactionMessageItem msg={msg} />;
  }

  return (
    <article
      className="flex items-start gap-2"
      aria-label={`${roleLabel} message`}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="sticky top-2 basis-20 min-w-0 max-w-[6.5rem] shrink self-start text-right">
        {agentBadgeLabel && (
          <span className="mb-1 inline-flex max-w-full items-center gap-1 rounded border border-purple-500/30 bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="shrink-0"
              aria-hidden="true"
            >
              <path d="M8 1a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v1h1a1 1 0 1 1 0 2h-1v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8H2a1 1 0 0 1 0-2h1V5a2 2 0 0 1 2-2h2V2a1 1 0 0 1 1-1ZM6 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-4 4a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2H6Z" />
            </svg>
            <span className="min-w-0 truncate">{agentBadgeLabel}</span>
          </span>
        )}
        {modelLabel ? (
          <span className="block break-words font-mono text-[10px] text-[var(--color-text-faint)]">
            {modelLabel}
          </span>
        ) : leftGutterLabel ? (
          <span className="block break-words text-[11px] text-[var(--color-text-muted)]">
            {leftGutterLabel}
          </span>
        ) : null}
      </div>

      <div
        className={`min-w-0 flex-1 pl-3 py-2 text-sm ${isNew ? 'msg-enter' : ''} ${unifiedMessageClass(msg)} ${
          isActive
            ? 'border-l-2 border-[var(--color-agent)] bg-[var(--color-agent)]/15 ring-1 ring-[var(--color-agent)]/20'
            : ''
        } ${
          isActiveSearchMatch
            ? 'ring-2 ring-[var(--color-warning,#f59e0b)]/70 bg-[var(--color-warning,#f59e0b)]/10'
            : isSearchMatch
              ? 'ring-1 ring-[var(--color-warning,#f59e0b)]/35 bg-[var(--color-warning,#f59e0b)]/5'
              : ''
        } ${
          msg.source === 'conversation'
            ? 'border-l border-[var(--color-tool)]/30'
            : ''
        }`}
        data-active-prompt={isActive ? 'true' : undefined}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 100px',
        }}
      >
        {showMetaRow && (
          <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[var(--color-text-faint)]">
            {isActive && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-agent)] animate-pulse" />
            )}
            {msg.channelKind === 'outbound' ? (
              msg.role === 'sent' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M13.5 4.5L6 12l-3.5-3.5" />
                  </svg>
                  SENT
                </span>
              ) : msg.role === 'sending' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-sky-300">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="animate-spin"
                    aria-hidden="true"
                  >
                    <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
                  </svg>
                  SENDING
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 8h10" />
                    <path d="M8 3v10" opacity="0.35" />
                  </svg>
                  QUEUED
                </span>
              )
            ) : null}
            {costInfo && (
              <>
                <span className="text-[var(--color-text-faint)]/60">•</span>
                <span className="text-[var(--color-text-muted)]">
                  {costInfo}
                </span>
              </>
            )}
          </div>
        )}

        {msg.reasoning && (
          <ReasoningSection
            reasoning={msg.reasoning}
            defaultExpanded={showThinking}
            isStreaming={isStreaming}
          />
        )}

        {displayText && (
          <div className="mb-1 min-w-0">
            <MarkdownContent content={displayText} streaming={isStreaming} />
          </div>
        )}

        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsSection
            toolCalls={msg.toolCalls}
            expandAllTools={expandAllTools}
            toolAutoExpandExclusions={toolAutoExpandExclusions}
            onNavigateToSession={onNavigateToSession}
          />
        )}

        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.attachments.map((attachment) =>
              isImageAttachment(attachment) ? (
                <button
                  key={`${msg.id}-att-${attachment.name}-${attachment.mimeType}`}
                  type="button"
                  onClick={() => handleImageClick(attachment)}
                  className="h-20 w-20 overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-agent)]"
                  title={`${attachment.name} — click to expand`}
                >
                  <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : (
                <span
                  key={`${msg.id}-att-${attachment.name}-${attachment.mimeType}`}
                  className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                >
                  <span aria-hidden="true">&#128206;</span> {attachment.name}
                </span>
              ),
            )}
          </div>
        )}

        {showOptions && predefinedOptions && onSelectOption && (
          <div className="mt-3 flex flex-wrap gap-2">
            {predefinedOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onSelectOption(option)}
                className="cursor-pointer rounded-md border border-[var(--color-agent)]/40 bg-[var(--color-agent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-agent)] transition-all hover:border-[var(--color-agent)] hover:bg-[var(--color-agent)]/20 active:scale-95"
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sticky top-2 basis-14 min-w-0 max-w-[4.5rem] shrink self-start pt-2 text-[10px] text-[var(--color-text-faint)]">
        <span className="block break-words text-right">
          <MessageTimestamp timestamp={new Date(msg.timestamp)} />
        </span>
      </div>
    </article>
  );
});

export default MessageItem;
