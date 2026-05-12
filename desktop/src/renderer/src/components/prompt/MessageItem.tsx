import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Attachment } from '../../types';
import type { UnifiedMessage } from '../../types/unified-message';
import { useSettings } from '../../store';
import MarkdownContent from '../MarkdownContent';
import {
  filterMessageText,
  formatCost,
  getAssistantHeaderMetadata,
  getExecutionStatusLabel,
  unifiedRoleLabel,
} from './message-item-helpers';
import {
  AssistantErrorBlock,
  HiddenContextNotice,
  MessageAttachments,
  MessageContextMenu,
  MessageFileParts,
  MessageHoverToolbar,
  MessageMetaRow,
  MessageOptions,
  MessageSourceLinks,
  MessageTimestampLine,
  OutboundStatusBadge,
} from './message-item-blocks';
import { ReasoningSection, ToolCallsSection } from './message-item-sections';
import CompactionMessageItem from './CompactionMessageItem';
import { messageAnchorId } from './message-id-from-hash';
import { useMessageCopy } from './useMessageCopy';
import { PERF_LOG_ENABLED } from '../../lib/perf-flag';

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
  /** Whether this message currently holds keyboard focus (from MessageList). */
  isFocused?: boolean;
  /** Whether this message is the current URL-hash deep-link target (transient highlight). */
  isDeepLinkTarget?: boolean;
  /** Notify parent that this message wants focus (click / right-click). */
  onRequestFocus?: (id: string) => void;
  /** Keyboard nav (ArrowUp/Down) handled by parent when row is focused. */
  onKeyNavigate?: (id: string, direction: 'up' | 'down' | 'escape') => void;
}

/**
 * Determine whether the message should render as a user-side bubble
 * (right-aligned, outlined) vs. an assistant-side block (full-width, no border).
 *
 * Mirrors the opencode timeline: "you said this" goes right, anything from an
 * agent / tool / system flows left as plain content.
 */
// Stable empty default for optional array props. Prevents memoized MessageItem
// from re-rendering due to new [] identity from parents on every render.
const EMPTY_EXCLUSIONS: string[] = [];

const CHAT_MARKDOWN_TEXT_CLASS =
  '[&_.prose]:text-[var(--chat-message-size)] [&_.prose]:leading-[var(--chat-message-line-height)] [&_.prose_p]:!text-[var(--chat-message-size)] [&_.prose_p]:leading-[var(--chat-message-line-height)] [&_.prose_li]:!text-[var(--chat-message-size)] [&_.prose_li]:leading-[var(--chat-message-line-height)] [&_.prose_code]:text-[calc(var(--chat-message-size)-1px)]';

function isUserSideMessage(msg: UnifiedMessage): boolean {
  if (msg.source === 'channel') {
    return msg.channelKind === 'answer' || msg.channelKind === 'outbound';
  }
  return msg.role === 'user';
}

/**
 * Opt-in perf gate. Logs first-paint latency for assistant messages the
 * first time they render with non-empty streaming content. Enable with
 * `VITE_OPENCODE_PERF_LOG=1`. See §6 metric #1 and
 * `docs/PERF-VALIDATION.md`.
 *
 * NOTE: previously enabled whenever `import.meta.env.DEV` was truthy,
 * which dispatched console.log through the synchronous devtools bridge
 * on every streamed message's first paint.
 */
const PERF_ENABLED = PERF_LOG_ENABLED;

const MessageItem = memo(function MessageItem({
  msg,
  isActive,
  showOptions,
  predefinedOptions,
  onSelectOption,
  onExpandImage,
  expandAllTools,
  toolAutoExpandExclusions = EMPTY_EXCLUSIONS,
  onNavigateToSession,
  showThinking,
  isNew = false,
  isStreaming = false,
  isSearchMatch = false,
  isActiveSearchMatch = false,
  isFocused = false,
  isDeepLinkTarget = false,
  onRequestFocus,
  onKeyNavigate,
}: MessageItemProps): React.ReactElement {
  const settings = useSettings();
  const roleLabel = unifiedRoleLabel(msg);
  const costInfo = formatCost(msg.cost);
  const { agentBadgeLabel, effortBadge, modelLabel } =
    getAssistantHeaderMetadata({
      agent: msg.agent,
      modelId: msg.modelId,
      roleLabel,
      variant: msg.variant,
    });
  const userSide = isUserSideMessage(msg);
  const [now, setNow] = useState(() => Date.now());
  const executionStatus = getExecutionStatusLabel({
    completedAt: msg.completedAt,
    isStreaming,
    now,
    source: msg.source,
    timestamp: msg.timestamp,
    userSide,
  });
  const conversationAgentBadgeLabel =
    msg.source === 'conversation' ? agentBadgeLabel : null;
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

  useEffect(() => {
    if (
      userSide ||
      msg.source !== 'conversation' ||
      !isStreaming ||
      msg.completedAt
    ) {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming, msg.completedAt, msg.source, userSide]);

  // Opt-in first-paint marker: fires exactly once per message id the
  // first time it renders with non-empty assistant content.
  const perfFirstPaintFiredRef = useRef(false);
  useEffect(() => {
    if (!PERF_ENABLED) return;
    if (perfFirstPaintFiredRef.current) return;
    if (userSide) return;
    if (!displayText || displayText.length === 0) return;
    perfFirstPaintFiredRef.current = true;
    const markName = `perf.first-paint:${msg.id}`;
    try {
      performance.mark(markName);
    } catch {
      // Ignore — performance API unavailable in some sandboxed tests.
    }

    window.api?.log?.(
      'info',
      'perf',
      `first-paint msgId=${msg.id} chars=${displayText.length} at=${Date.now()}`,
    );
  }, [displayText, msg.id, userSide]);

  const handleImageClick = useCallback(
    (attachment: Attachment) => {
      onExpandImage(
        `data:${attachment.mimeType};base64,${attachment.data}`,
        attachment.name,
      );
    },
    [onExpandImage],
  );

  // --- Copy + context-menu + focus plumbing ---------------------------------
  const { copied, copy } = useMessageCopy();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleCopyText = useCallback(() => {
    void copy(displayText || msg.text || '');
    closeMenu();
  }, [copy, displayText, msg.text, closeMenu]);

  const handleCopyId = useCallback(() => {
    void copy(msg.id);
    closeMenu();
  }, [copy, msg.id, closeMenu]);

  const handleCopyLink = useCallback(() => {
    void copy(`#${messageAnchorId(msg.id)}`);
    closeMenu();
  }, [copy, msg.id, closeMenu]);

  const handleCopyRawMessage = useCallback(() => {
    void copy(JSON.stringify(msg, null, 2));
    closeMenu();
  }, [copy, msg, closeMenu]);

  const handleCopyTools = useCallback(() => {
    const tools = msg.toolCalls ?? [];
    void copy(JSON.stringify(tools, null, 2));
    closeMenu();
  }, [copy, msg.toolCalls, closeMenu]);

  const handleFocusClick = useCallback(() => {
    onRequestFocus?.(msg.id);
  }, [onRequestFocus, msg.id]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      onRequestFocus?.(msg.id);
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [onRequestFocus, msg.id],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!onKeyNavigate) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onKeyNavigate(msg.id, 'down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onKeyNavigate(msg.id, 'up');
      } else if (e.key === 'Escape') {
        onKeyNavigate(msg.id, 'escape');
      } else if ((e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey)) {
        // Let the browser handle native text-selection copy; only hijack when
        // nothing is selected so keyboard users can copy the whole message.
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          e.preventDefault();
          void copy(displayText || msg.text || '');
        }
      }
    },
    [onKeyNavigate, msg.id, copy, displayText, msg.text],
  );

  if (msg.isCompaction) {
    return <CompactionMessageItem msg={msg} />;
  }

  const outboundBadge = <OutboundStatusBadge msg={msg} />;

  // Shared: search/active-prompt ring classes for both layouts.
  const searchRingClass = isActiveSearchMatch
    ? 'ring-2 ring-[var(--color-warning,#f59e0b)]/70 bg-[var(--color-warning,#f59e0b)]/10'
    : isSearchMatch
      ? 'ring-1 ring-[var(--color-warning,#f59e0b)]/35 bg-[var(--color-warning,#f59e0b)]/5'
      : '';

  const activePromptClass = isActive
    ? 'ring-1 ring-[var(--color-agent)]/40 bg-[var(--color-agent)]/10'
    : '';

  // Keyboard-focus + deep-link highlight classes (shared by both layouts).
  const focusRingClass = isFocused ? 'ring-1 ring-[var(--color-agent)]/60' : '';
  const deepLinkClass = isDeepLinkTarget
    ? 'ring-2 ring-[var(--color-agent)]/80 bg-[var(--color-agent)]/12 animate-pulse'
    : '';

  const hoverToolbar = (
    <MessageHoverToolbar copied={copied} onCopyText={handleCopyText} />
  );

  const contextMenu = (
    <MessageContextMenu
      hasToolCalls={Boolean(msg.toolCalls?.length)}
      menu={menu}
      onClose={closeMenu}
      onCopyId={handleCopyId}
      onCopyLink={handleCopyLink}
      onCopyRawMessage={handleCopyRawMessage}
      onCopyText={handleCopyText}
      onCopyTools={handleCopyTools}
    />
  );

  const anchorId = messageAnchorId(msg.id);

  const metaRow = (
    <MessageMetaRow
      costInfo={costInfo}
      isActive={isActive}
      outboundBadge={outboundBadge}
      show={showMetaRow}
    />
  );
  const attachmentsBlock = (
    <MessageAttachments
      attachments={msg.attachments}
      msgId={msg.id}
      onImageClick={handleImageClick}
      userSide={userSide}
    />
  );
  const filePartsBlock = (
    <MessageFileParts
      files={msg.fileParts}
      msgId={msg.id}
      userSide={userSide}
    />
  );
  const sourceLinksBlock = (
    <MessageSourceLinks msgId={msg.id} sourceUrls={msg.sourceUrls} />
  );
  const hiddenContextBlock = (
    <HiddenContextNotice count={msg.hiddenTextPartCount} />
  );
  const optionsBlock = (
    <MessageOptions
      onSelectOption={onSelectOption}
      options={predefinedOptions}
      show={showOptions}
    />
  );
  const timestampBlock = (
    <MessageTimestampLine
      executionStatus={executionStatus}
      timestamp={msg.timestamp}
    />
  );
  const assistantErrorBlock = (
    <AssistantErrorBlock
      error={msg.error}
      errorName={msg.errorName}
      userSide={userSide}
    />
  );

  // ---------------------------------------------------------------------------
  // User-side layout: right-aligned rounded bubble (opencode parity).
  // ---------------------------------------------------------------------------
  if (userSide) {
    return (
      <article
        id={anchorId}
        data-slot="session-turn-user"
        data-focused={isFocused ? 'true' : undefined}
        data-deep-link-target={isDeepLinkTarget ? 'true' : undefined}
        className={`group relative flex w-full flex-col items-end rounded-2xl outline-none ${focusRingClass} ${deepLinkClass} ${isNew ? 'msg-enter' : ''}`.trim()}
        aria-label={`${roleLabel} message`}
        aria-current={isActive ? 'true' : undefined}
        tabIndex={-1}
        onClick={handleFocusClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        {hoverToolbar}
        <div
          data-slot="session-turn-user-bubble"
          data-active-prompt={isActive ? 'true' : undefined}
          className={`rounded-2xl border border-[var(--color-border-weak)] bg-[var(--color-surface)] px-4 py-3 shadow-sm ${searchRingClass} ${activePromptClass}`.trim()}
          style={{
            contentVisibility: 'auto',
            containIntrinsicSize: 'auto 100px',
          }}
        >
          {metaRow}
          {displayText && (
            <div className={`min-w-0 ${CHAT_MARKDOWN_TEXT_CLASS}`}>
              <MarkdownContent content={displayText} streaming={isStreaming} />
            </div>
          )}
          {attachmentsBlock}
          {filePartsBlock}
          {optionsBlock}
        </div>
        {timestampBlock}
        {contextMenu}
      </article>
    );
  }

  // ---------------------------------------------------------------------------
  // Assistant-side layout: full-width block, no bubble, no gutters.
  // Subagent badge (when applicable) appears inline above content.
  // ---------------------------------------------------------------------------
  return (
    <article
      id={anchorId}
      data-slot="session-turn-assistant"
      data-focused={isFocused ? 'true' : undefined}
      data-deep-link-target={isDeepLinkTarget ? 'true' : undefined}
      className={`group relative flex w-full flex-col rounded-2xl border border-[var(--color-border-weak)]/80 bg-[var(--color-surface)]/55 px-4 py-3 outline-none shadow-[0_1px_0_rgba(0,0,0,0.03)] ${focusRingClass} ${deepLinkClass} ${isNew ? 'msg-enter' : ''}`.trim()}
      aria-label={`${roleLabel} message`}
      aria-current={isActive ? 'true' : undefined}
      tabIndex={-1}
      onClick={handleFocusClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    >
      {hoverToolbar}
      {(conversationAgentBadgeLabel || modelLabel || effortBadge) && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-faint)]">
          {conversationAgentBadgeLabel && (
            <span className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 1a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v1h1a1 1 0 1 1 0 2h-1v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8H2a1 1 0 0 1 0-2h1V5a2 2 0 0 1 2-2h2V2a1 1 0 0 1 1-1ZM6 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-4 4a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2H6Z" />
              </svg>
              <span className="truncate">{conversationAgentBadgeLabel}</span>
            </span>
          )}
          {effortBadge && (
            <span
              className="inline-flex items-center rounded border border-[var(--color-border-weak)] bg-[var(--color-surface-raised)]/70 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]"
              data-effort={effortBadge.variant}
              title={effortBadge.label}
            >
              {effortBadge.label}
            </span>
          )}
          {modelLabel && (
            <span className="font-mono text-[10px] text-[var(--color-text-faint)]">
              {modelLabel}
            </span>
          )}
        </div>
      )}

      <div
        className={`min-w-0 rounded-xl ${searchRingClass} ${activePromptClass}`.trim()}
        data-active-prompt={isActive ? 'true' : undefined}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 100px',
        }}
      >
        {metaRow}

        {msg.reasoning && (
          <ReasoningSection
            reasoning={msg.reasoning}
            defaultExpanded={showThinking}
            isStreaming={isStreaming}
          />
        )}

        {displayText && (
          <div className={`mb-1 min-w-0 ${CHAT_MARKDOWN_TEXT_CLASS}`}>
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

        {assistantErrorBlock}

        {attachmentsBlock}
        {filePartsBlock}
        {sourceLinksBlock}
        {hiddenContextBlock}
        {optionsBlock}
      </div>

      {timestampBlock}
      {contextMenu}
    </article>
  );
});

export default MessageItem;
