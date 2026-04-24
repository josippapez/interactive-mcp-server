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
import MessageTimestamp from './MessageTimestamp';
import {
  filterMessageText,
  formatCost,
  getAttachmentKey,
  getEffortBadge,
  isImageAttachment,
  isSubagent,
  unifiedRoleLabel,
} from './message-item-helpers';
import { ReasoningSection, ToolCallsSection } from './message-item-sections';
import CompactionMessageItem from './CompactionMessageItem';
import { messageAnchorId } from './message-id-from-hash';
import { useMessageCopy } from './useMessageCopy';
import { Tag } from '../ui/tag';
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
  const modelLabel = msg.modelId ?? null;
  const effortBadge = getEffortBadge(msg.variant);
  const agentBadgeLabel =
    msg.source === 'conversation' && isSubagent(msg.agent) ? roleLabel : null;
  const showMetaRow = Boolean(
    isActive || msg.channelKind === 'outbound' || costInfo,
  );
  const userSide = isUserSideMessage(msg);

  // Filter message text based on display settings
  const displayText = useMemo(() => {
    if (!msg.text) return '';
    return filterMessageText(
      msg.text,
      settings.hideSystemReminders ?? false,
      settings.hideDocInjections ?? false,
    );
  }, [msg.text, settings.hideSystemReminders, settings.hideDocInjections]);

  // Dev-only first-paint marker: fires exactly once per message id the
  // first time it renders with non-empty assistant content. Emits a
  // `performance.mark` + console log for §6 metric #1 validation.
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

    console.log(
      `[perf.first-paint] msgId=${msg.id} chars=${displayText.length} at=${Date.now()}`,
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

  // Shared: outbound status badge (SENT/SENDING/QUEUED)
  const outboundBadge =
    msg.channelKind === 'outbound' ? (
      msg.role === 'sent' ? (
        <Tag
          tone="success"
          icon={
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
          }
        >
          SENT
        </Tag>
      ) : msg.role === 'sending' ? (
        <Tag
          tone="info"
          icon={
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
          }
        >
          SENDING
        </Tag>
      ) : (
        <Tag
          tone="warning"
          icon={
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
          }
        >
          QUEUED
        </Tag>
      )
    ) : null;

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

  // Hover toolbar: Copy button revealed on group-hover / focus.
  const hoverToolbar = (
    <div
      className="pointer-events-none absolute right-1 top-1 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
      data-slot="message-hover-toolbar"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleCopyText();
        }}
        className="inline-flex h-6 items-center gap-1 rounded border border-[var(--color-border-weak)] bg-[var(--color-surface)]/90 px-1.5 text-[10px] text-[var(--color-text-muted)] shadow-sm backdrop-blur-sm transition-colors hover:border-[var(--color-agent)]/50 hover:text-[var(--color-text)]"
        aria-label={copied ? 'Copied message' : 'Copy message'}
        title={copied ? 'Copied' : 'Copy message'}
      >
        {copied ? (
          <>
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
            Copied
          </>
        ) : (
          <>
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );

  // Inline context menu (fixed position + backdrop) — mirrors ProjectRail pattern.
  const contextMenu = menu && (
    <>
      <button
        type="button"
        aria-label="Close context menu"
        onClick={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closeMenu();
        }}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        aria-label="Message actions"
        className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lg"
        style={{ left: menu.x, top: menu.y }}
      >
        <button
          type="button"
          role="menuitem"
          onClick={handleCopyText}
          className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-agent)]/15"
        >
          Copy text
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={handleCopyId}
          className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-agent)]/15"
        >
          Copy message ID
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={handleCopyLink}
          className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-agent)]/15"
        >
          Copy link
        </button>
      </div>
    </>
  );

  const anchorId = messageAnchorId(msg.id);

  const metaRow = showMetaRow && (
    <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[var(--color-text-faint)]">
      {isActive && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-agent)] animate-pulse" />
      )}
      {outboundBadge}
      {costInfo && (
        <>
          <span className="text-[var(--color-text-faint)]/60">•</span>
          <span className="text-[var(--color-text-muted)]">{costInfo}</span>
        </>
      )}
    </div>
  );

  const attachmentsBlock = msg.attachments && msg.attachments.length > 0 && (
    <div
      className={`mt-2 flex flex-wrap gap-2 ${userSide ? 'justify-end' : ''}`}
    >
      {msg.attachments.map((attachment, index) =>
        isImageAttachment(attachment) ? (
          <button
            key={getAttachmentKey(msg.id, attachment, index)}
            type="button"
            onClick={() => handleImageClick(attachment)}
            className="h-12 w-12 overflow-hidden rounded-md border border-[var(--color-border-weak)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-agent)]"
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
            key={getAttachmentKey(msg.id, attachment, index)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-weak)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
          >
            <span aria-hidden="true">&#128206;</span> {attachment.name}
          </span>
        ),
      )}
    </div>
  );

  const optionsBlock = showOptions && predefinedOptions && onSelectOption && (
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
  );

  const timestampBlock = (
    <span className="mt-1 block text-[10px] text-[var(--color-text-faint)]">
      <MessageTimestamp timestamp={new Date(msg.timestamp)} />
    </span>
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
      {(agentBadgeLabel || modelLabel || effortBadge) && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-faint)]">
          {agentBadgeLabel && (
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
              <span className="truncate">{agentBadgeLabel}</span>
            </span>
          )}
          {modelLabel && (
            <span className="font-mono text-[10px] text-[var(--color-text-faint)]">
              {modelLabel}
            </span>
          )}
          {effortBadge && (
            <span
              className="inline-flex items-center rounded border border-[var(--color-border-weak)] bg-[var(--color-surface)]/85 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]"
              data-variant={effortBadge.variant}
            >
              {effortBadge.label}
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

        {attachmentsBlock}
        {optionsBlock}
      </div>

      {timestampBlock}
      {contextMenu}
    </article>
  );
});

export default MessageItem;
