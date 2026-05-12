import React, {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import type { RefObject } from 'react';
import type { ChannelMessage } from '../../types';
import type { ConversationMessage } from '../../../../preload/index';
import type { UnifiedMessage } from '../../types/unified-message';
import { mergeMessages } from '../../types/unified-message';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { useStaging } from '../../hooks/useStaging';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import ImageModal from './chat/ImageModal';
import ScrollToBottomButton from './chat/ScrollToBottomButton';
import MessageList from './chat/MessageList';
import { computeAutoScrollSignature } from './chat/auto-scroll-signature';
import { messageAnchorId, messageIdFromHash } from './message-id-from-hash';
import { useSettings } from '../../store';
import { getChatTextSizeClasses, type ChatTextSize } from './chat-text-size';
import {
  useChannelStickToBottom,
  useSetChannelStickToBottom,
} from '../../store/channel-preferences';

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

const AUTO_SCROLL_THRESHOLD_PX = 50;
const AUTO_SCROLL_JUMP_THRESHOLD_PX = 180;

// Stable empty default for optional array props. Using a module-level
// constant keeps the prop identity stable across renders so memoized
// children (MessageItem / MessageList) don't thrash.
const EMPTY_EXCLUSIONS: string[] = [];
const EMPTY_CONVERSATION_MESSAGES: ConversationMessage[] = [];

type Props = {
  messages: ChannelMessage[];
  chatEndRef: RefObject<HTMLDivElement | null>;
  activePromptId?: string | null;
  predefinedOptions?: string[];
  onSelectOption?: (option: string) => void;
  /** ID of the last message that was read (unread marker appears after this) */
  lastReadMessageId?: string | null;
  /** Conversation messages from provider (optional - for OpenCode sessions) */
  conversationMessages?: ConversationMessage[];
  /** Whether to show conversation messages (provider capability flag) */
  showConversation?: boolean;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** List of tool names to exclude from auto-expand */
  toolAutoExpandExclusions?: string[];
  /** Callback when a new tool is discovered (for settings) */
  onToolDiscovered?: (toolName: string) => void;
  /** Callback to navigate to a session by providerSessionId (for subagent links) */
  onNavigateToSession?: (sessionId: string) => void;
  /** Whether to show thinking sections expanded by default */
  showThinking?: boolean;
  chatTextSize?: ChatTextSize;
  fullWidth?: boolean;
  /** Whether the agent is busy/streaming (controls auto-scroll behavior) */
  isBusy?: boolean;
  /** Channel/connection ID - triggers auto-scroll reset on change */
  channelId?: string | null;
  searchQuery?: string;
  activeSearchMatchIndex?: number;
  onSearchMatchesChange?: (matchCount: number) => void;
  /**
   * True while the REST seed for this session is still in flight and
   * no live messages have arrived yet. Renders a lightweight skeleton
   * instead of an empty container so the mount feels instant.
   */
  isSeeding?: boolean;
};

/**
 * Chat history view component for displaying unified messages.
 *
 * Renders channel messages and conversation messages in a unified timeline,
 * with support for:
 * - Unread message dividers
 * - Auto-scrolling to new messages (bottom-anchor, Vercel AI chatbot style)
 * - Image attachment previews
 * - Tool call display
 * - Active prompt highlighting
 *
 * Performance optimizations applied (based on OpenCode patterns):
 * 1. CSS content-visibility on MessageItem for off-screen optimization
 * 2. Context tool grouping in ToolCallsSection
 * 3. Turn-based history windowing via useHistoryWindow (last 15 turns initially)
 * 4. Real-time per-token streaming via split-store Map snapshots
 *    (messagesById + partsByMessageId + messageOrder in useConversation)
 * 5. Plain scrollable list (see `MessageList`) — virtualization was removed
 *    because per-token row re-measurement caused streaming jank.
 * 6. useStaging for progressive DOM staging of large batches (opt-in)
 * 7. useAutoScroll for intelligent auto-scroll behavior
 */
export default function ChatHistoryView({
  messages,
  chatEndRef,
  activePromptId,
  predefinedOptions,
  onSelectOption,
  lastReadMessageId,
  conversationMessages = [],
  showConversation = false,
  expandAllTools = false,
  toolAutoExpandExclusions = EMPTY_EXCLUSIONS,
  onNavigateToSession,
  showThinking = false,
  chatTextSize = 'md',
  fullWidth = false,
  isBusy = false,
  channelId,
  searchQuery = '',
  activeSearchMatchIndex = -1,
  onSearchMatchesChange,
  isSeeding = false,
}: Props): React.ReactElement {
  const settings = useSettings();
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  // Refs for the scroll container and inner content wrapper.
  // (useAutoScroll exposes a callback ref we combine with our own.)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------------------
  // Stick-to-bottom toggle (Bug 3) — global preference per channel.
  // ---------------------------------------------------------------------------
  const stickToBottomPreference = useChannelStickToBottom(channelId);
  const setChannelStickToBottom = useSetChannelStickToBottom();
  const handleStickyChange = useCallback(
    (next: boolean) => {
      if (!channelId) return;
      setChannelStickToBottom(channelId, next);
    },
    [channelId, setChannelStickToBottom],
  );

  // ---------------------------------------------------------------------------
  // Auto-scroll behavior via useAutoScroll hook
  // ---------------------------------------------------------------------------
  const {
    scrollRef,
    isStickyToBottom,
    userScrolled,
    isAtBottom,
    showJump,
    forceScrollToBottom,
    jumpToBottom,
    handleScroll: handleAutoScroll,
    handleWheel: handleAutoScrollWheel,
    handleInteraction: handleAutoScrollInteraction,
    pause: pauseAutoScroll,
    reset: resetAutoScroll,
  } = useAutoScroll({
    working: isBusy,
    threshold: AUTO_SCROLL_THRESHOLD_PX,
    jumpThreshold: AUTO_SCROLL_JUMP_THRESHOLD_PX,
    stickyPreference: stickToBottomPreference,
    onStickyChange: handleStickyChange,
  });

  // Combine scroll ref with our local ref for scroll container access.
  const combinedScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      scrollRef(node);
    },
    [scrollRef],
  );

  // Combine content ref with our local ref
  const combinedContentRef = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
  }, []);

  // Track previous channel ID to detect channel switches
  const prevChannelIdRef = useRef<string | null | undefined>(channelId);

  // Channel switch detection - reset auto-scroll state completely
  useEffect(() => {
    // Detect channel switch by comparing channelId
    if (prevChannelIdRef.current !== channelId) {
      prevChannelIdRef.current = channelId;
      // Reset auto-scroll state when switching channels
      resetAutoScroll();
    }
  }, [channelId, resetAutoScroll]);

  // Outer ref-equality short-circuit for mergeMessages. During streaming,
  // Immer mints a new `conversationMessages` reference on every 16ms flush,
  // which invalidates the useMemo below even when nothing meaningful changed
  // beyond a text-tail append on the last assistant message. This ref-based
  // cache short-circuits those ticks without rehashing anything.
  const mergeCacheRef = useRef<{
    messagesRef: ChannelMessage[] | null;
    conversationRef: ConversationMessage[] | null;
    activePromptId: string | null | undefined;
    hideSystemReminders: boolean;
    hideDocInjections: boolean;
    lastStreamingSig: string;
    result: UnifiedMessage[];
  } | null>(null);

  // Merge channel and conversation messages if showConversation is enabled
  const unifiedMessages = useMemo(() => {
    const hideSystemReminders = settings.hideSystemReminders ?? false;
    const hideDocInjections = settings.hideDocInjections ?? false;
    const hiddenFilterOptions = { hideSystemReminders, hideDocInjections };

    const effectiveConversation =
      showConversation && conversationMessages.length > 0
        ? conversationMessages
        : EMPTY_CONVERSATION_MESSAGES;

    // Streaming signature for the last conversation message — avoids
    // invoking hashParts on the fast path. Catches tail-append deltas.
    const lastMsg =
      effectiveConversation.length > 0
        ? effectiveConversation[effectiveConversation.length - 1]
        : null;
    const lastPart =
      lastMsg && lastMsg.parts.length > 0
        ? lastMsg.parts[lastMsg.parts.length - 1]
        : null;
    const lastStreamingSig = lastMsg
      ? `${lastMsg.id}|${lastMsg.parts.length}|${lastPart?.type ?? ''}|${lastPart?.text?.length ?? 0}|${lastPart?.toolStatus ?? ''}`
      : '';

    const cache = mergeCacheRef.current;
    if (
      cache &&
      cache.messagesRef === messages &&
      cache.conversationRef === effectiveConversation &&
      cache.activePromptId === activePromptId &&
      cache.hideSystemReminders === hideSystemReminders &&
      cache.hideDocInjections === hideDocInjections &&
      cache.lastStreamingSig === lastStreamingSig
    ) {
      return cache.result;
    }

    const result = mergeMessages(
      messages,
      effectiveConversation,
      activePromptId,
      hiddenFilterOptions,
    );

    mergeCacheRef.current = {
      messagesRef: messages,
      conversationRef: effectiveConversation,
      activePromptId,
      hideSystemReminders,
      hideDocInjections,
      lastStreamingSig,
      result,
    };

    return result;
  }, [
    messages,
    conversationMessages,
    showConversation,
    activePromptId,
    settings.hideSystemReminders,
    settings.hideDocInjections,
  ]);

  const normalizedSearchQuery = normalizeSearchText(searchQuery);

  const matchedMessageIds = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return unifiedMessages
      .filter((msg) => {
        const haystacks = [
          msg.text,
          msg.reasoning,
          msg.modelId,
          msg.agent,
          msg.toolCalls?.map((tool) => tool.name).join(' '),
          msg.toolCalls?.map((tool) => tool.output ?? '').join(' '),
          msg.attachments?.map((attachment) => attachment.name).join(' '),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystacks.includes(normalizedSearchQuery);
      })
      .map((msg) => msg.id)
      .reverse();
  }, [normalizedSearchQuery, unifiedMessages]);

  useEffect(() => {
    onSearchMatchesChange?.(matchedMessageIds.length);
  }, [matchedMessageIds.length, onSearchMatchesChange]);

  // Turn-based windowing: only render the last N turns for fast initial paint.
  // Older messages are loaded on scroll-up (backfill).
  const getMessageId = useCallback((msg: UnifiedMessage) => msg.id, []);
  const getTimestamp = useCallback((msg: UnifiedMessage) => msg.timestamp, []);
  const isNewTurn = useCallback(
    (msg: UnifiedMessage, prev: UnifiedMessage | undefined) => {
      // A new turn starts when the role changes to "user" (or it's the first message)
      if (!prev) return true;
      return msg.role === 'user' && prev.role !== 'user';
    },
    [],
  );

  const {
    visibleItems: windowedMessages,
    hasMore: hasOlderMessages,
    handleScroll: handleBackfillScroll,
  } = useHistoryWindow({
    items: unifiedMessages,
    getId: getMessageId,
    getTimestamp,
    isNewTurn,
    initialTurns: 15,
    backfillTurns: 8,
    backfillThreshold: 300,
  });

  // Progressive DOM staging: when a large batch arrives (e.g., backfill or
  // initial session load), render items in batches via requestIdleCallback
  // to avoid blocking the main thread.
  const { stagedItems: stagedMessages, isStaging } = useStaging({
    items: windowedMessages,
    getId: getMessageId,
    initialBatch: 20,
    stagingBatch: 10,
    stagingThreshold: 30,
    enabled: !isBusy,
  });

  const [lastSeenMessageId, setLastSeenMessageId] = useState<string | null>(
    lastReadMessageId ?? null,
  );

  useEffect(() => {
    setLastSeenMessageId(lastReadMessageId ?? null);
  }, [lastReadMessageId]);

  const latestStagedMessageId = stagedMessages.at(-1)?.id ?? null;

  useEffect(() => {
    if (userScrolled) return;
    if (!latestStagedMessageId) return;
    setLastSeenMessageId(latestStagedMessageId);
  }, [userScrolled, latestStagedMessageId]);

  // Memoize unread divider calculations (use staged messages for index)
  const { unreadStartIndex, showUnreadDivider, unreadCount } = useMemo(() => {
    if (!userScrolled) {
      return {
        unreadStartIndex: -1,
        showUnreadDivider: false,
        unreadCount: 0,
      };
    }

    const anchorId = lastSeenMessageId ?? lastReadMessageId ?? null;
    const anchorIndex =
      anchorId != null
        ? stagedMessages.findIndex((m) => m.id === anchorId)
        : stagedMessages.length - 1;

    if (anchorIndex < 0) {
      return {
        unreadStartIndex: -1,
        showUnreadDivider: false,
        unreadCount: 0,
      };
    }

    const startIndex = anchorIndex + 1;
    const count = Math.max(0, stagedMessages.length - startIndex);

    return {
      unreadStartIndex: startIndex,
      showUnreadDivider: count > 0 && startIndex < stagedMessages.length,
      unreadCount: count,
    };
  }, [stagedMessages, userScrolled, lastSeenMessageId, lastReadMessageId]);

  // Stable callback for expanding images (passed to memoized MessageItem)
  const handleExpandImage = useCallback((src: string, name: string) => {
    setExpandedImage({ src, name });
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-scroll driver — bottom-anchor (Vercel AI chatbot style).
  //
  // Whenever the rendered content changes in a way that should follow the
  // bottom (new message, token appended during streaming) AND the user is
  // currently sticky to the bottom, we call the hook's `forceScrollToBottom`.
  // That routes the scroll through `useAutoScroll`'s programmatic marker so
  // the user's sticky state is preserved (the marker classifies the ensuing
  // scroll event as programmatic, not user-initiated).
  //
  // We use a content signature keyed on (message count, streaming-tail id,
  // streaming-tail text/reasoning length) so each token tick fires exactly
  // one scroll — no ResizeObserver / MutationObserver / rAF dance needed
  // now that rows render their full content synchronously.
  // ---------------------------------------------------------------------------
  const autoScrollSignature = computeAutoScrollSignature(stagedMessages);
  useEffect(() => {
    if (!isStickyToBottom) return;
    if (stagedMessages.length === 0) return;
    forceScrollToBottom();
    // `forceScrollToBottom` and `isStickyToBottom` are deliberately read via
    // the latest closure — the signature change is the trigger, not the
    // message list identity.
  }, [autoScrollSignature]);

  // Stable callback for closing the image modal
  const handleCloseImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  // Listen for attachment-click events dispatched by streaming-markdown
  // renderers (via `dispatchEvent`) so attachment links in streamed markdown
  // also open the modal. The anchor element's click doesn't always go through
  // the React event system depending on the renderer implementation.
  useEffect(() => {
    const handleOpenImage = (e: Event) => {
      const detail = (e as CustomEvent<{ src: string; name: string }>).detail;
      if (!detail) return;
      setExpandedImage({ src: detail.src, name: detail.name });
    };
    window.addEventListener('interactive-mcp:open-image', handleOpenImage);
    return () =>
      window.removeEventListener('interactive-mcp:open-image', handleOpenImage);
  }, []);

  // Stable callback for the stick-to-bottom toggle. Turning ON re-engages
  // sticky and jumps to the latest message; turning OFF leaves the scroll
  // position alone (the persisted atom flips through `handleStickyChange`).
  const handleToggleStickToBottom = useCallback(
    (next: boolean) => {
      if (!channelId) {
        if (next) jumpToBottom();
        return;
      }
      setChannelStickToBottom(channelId, next);
      if (next) jumpToBottom();
    },
    [channelId, jumpToBottom, setChannelStickToBottom],
  );

  // Keyboard shortcut: End key scrolls to bottom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // End key (without modifiers) scrolls to bottom
      if (e.key === 'End' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Don't trigger if user is typing in an input
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        jumpToBottom();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jumpToBottom]);

  // Deep-link scroll: when URL is `#message-<id>`, scroll that row into view
  // and briefly pulse it so the user can locate the referenced message.
  // Ported from opencode's use-session-hash-scroll.ts — simplified to use the
  // DOM anchor id rather than plumbing refs out of MessageList.
  const [deepLinkMessageId, setDeepLinkMessageId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    const DEEP_LINK_HIGHLIGHT_MS = 1500;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const applyFromHash = () => {
      const id = messageIdFromHash(window.location.hash);
      if (!id) {
        setDeepLinkMessageId(null);
        return;
      }
      // Defer to next frame so the target row is mounted.
      requestAnimationFrame(() => {
        const node = document.getElementById(messageAnchorId(id));
        if (!node) {
          // Row not yet rendered (e.g. windowed history) — still flag the id
          // so the pulse fires once it mounts.
          setDeepLinkMessageId(id);
          return;
        }
        pauseAutoScroll();
        const container = scrollContainerRef.current;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const nodeRect = node.getBoundingClientRect();
          const target =
            nodeRect.top - containerRect.top + container.scrollTop - 64;
          container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        } else {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        setDeepLinkMessageId(id);
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => {
          setDeepLinkMessageId(null);
          clearTimer = null;
        }, DEEP_LINK_HIGHLIGHT_MS);
      });
    };

    applyFromHash();
    window.addEventListener('hashchange', applyFromHash);
    return () => {
      window.removeEventListener('hashchange', applyFromHash);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [pauseAutoScroll]);

  // Combined scroll handler for both backfill and auto-scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      handleBackfillScroll(e);
      handleAutoScroll();
    },
    [handleBackfillScroll, handleAutoScroll],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Respect nested scrollable surfaces (tool outputs/diffs) without pausing
      // the main chat auto-scroll lock.
      const nestedScrollable = (e.target as HTMLElement | null)?.closest(
        '[data-scrollable="true"]',
      );
      if (nestedScrollable && nestedScrollable !== e.currentTarget) {
        return;
      }
      handleAutoScrollWheel(e.deltaY);
    },
    [handleAutoScrollWheel],
  );

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      <div
        ref={combinedScrollRef}
        className="flex-1 overflow-y-auto"
        style={{ contain: 'strict' }}
        data-scrollable="true"
        onScroll={handleScroll}
        onWheel={handleWheel}
        onMouseUp={handleAutoScrollInteraction}
        role="log"
        aria-label="Conversation history"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
      >
        <div
          data-slot="session-turn-container"
          data-full-width={fullWidth ? 'true' : 'false'}
          className={`pb-2 pt-3 ${getChatTextSizeClasses(chatTextSize)}`}
        >
          {/* "Load older messages" indicator at top of scroll area */}
          {hasOlderMessages && (
            <div className="flex items-center justify-center py-2 text-[10px] text-[var(--color-text-muted)]">
              Scroll up for older messages
            </div>
          )}
          {/* Staging progress indicator — shown when progressively rendering a large batch */}
          {isStaging && (
            <div className="flex items-center justify-center py-1 text-[10px] text-[var(--color-text-muted)]">
              Loading messages…
            </div>
          )}

          {/* Seed-in-flight skeleton (D1). Replaces empty chat pane with
              3 placeholder message shells so the user sees immediate
              visual feedback instead of a blank content-visibility hole
              while the REST seed resolves. */}
          {isSeeding && stagedMessages.length === 0 && (
            <div
              className="flex flex-col gap-3 px-4 py-2"
              aria-label="Loading conversation"
              aria-busy="true"
              data-testid="chat-seed-skeleton"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-md bg-[var(--color-surface-muted,rgba(128,128,128,0.12))]"
                  style={{
                    height: i === 1 ? '3.5rem' : '2.25rem',
                    width: i === 0 ? '60%' : i === 1 ? '85%' : '45%',
                  }}
                />
              ))}
            </div>
          )}

          {/* Message list (plain, non-virtualized) */}
          <MessageList
            messages={stagedMessages}
            contentRef={combinedContentRef}
            scrollContainerRef={scrollContainerRef}
            unreadStartIndex={unreadStartIndex}
            showUnreadDivider={showUnreadDivider}
            predefinedOptions={predefinedOptions}
            onSelectOption={onSelectOption}
            onExpandImage={handleExpandImage}
            expandAllTools={expandAllTools}
            toolAutoExpandExclusions={toolAutoExpandExclusions}
            onNavigateToSession={onNavigateToSession}
            showThinking={showThinking}
            isBusy={isBusy}
            matchedMessageIds={matchedMessageIds}
            activeSearchMatchId={
              activeSearchMatchIndex >= 0
                ? (matchedMessageIds[activeSearchMatchIndex] ?? null)
                : null
            }
            deepLinkMessageId={deepLinkMessageId}
          />

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Stick-to-bottom toggle (Bug 3) — replaces the old jump button. */}
      <ScrollToBottomButton
        isAtBottom={isAtBottom}
        showJump={showJump}
        stickToBottom={isStickyToBottom}
        unreadCount={unreadCount}
        onToggle={handleToggleStickToBottom}
      />

      {/* Expanded image modal */}
      {expandedImage && (
        <ImageModal image={expandedImage} onClose={handleCloseImage} />
      )}
    </div>
  );
}
