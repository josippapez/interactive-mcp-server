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
import VirtualizedMessageList from './chat/VirtualizedMessageList';
import { useSettings } from '../../store';

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

const AUTO_SCROLL_THRESHOLD_PX = 50;
const AUTO_SCROLL_JUMP_THRESHOLD_PX = 180;

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
  /** Callback to navigate to a session by openCodeSessionId (for subagent links) */
  onNavigateToSession?: (sessionId: string) => void;
  /** Whether to show thinking sections expanded by default */
  showThinking?: boolean;
  /** Whether the agent is busy/streaming (controls auto-scroll behavior) */
  isBusy?: boolean;
  /** Channel/connection ID - triggers auto-scroll reset on change */
  channelId?: string | null;
  searchQuery?: string;
  activeSearchMatchIndex?: number;
  onSearchMatchesChange?: (matchCount: number) => void;
};

/**
 * Chat history view component for displaying unified messages.
 *
 * Uses virtualization for performance with large message lists.
 * Renders channel messages and conversation messages in a unified timeline,
 * with support for:
 * - Unread message dividers
 * - Auto-scrolling to new messages
 * - Image attachment previews
 * - Tool call display
 * - Active prompt highlighting
 *
 * Performance optimizations applied (based on OpenCode patterns):
 * 1. CSS content-visibility on MessageItem for off-screen optimization
 * 2. Context tool grouping in ToolCallsSection
 * 3. Turn-based history windowing via useHistoryWindow (last 15 turns initially)
 * 4. Paced streaming via delta-batcher (~24ms batched state updates)
 * 5. @tanstack/react-virtual for DOM virtualization
 * 6. useStaging for progressive DOM staging of large batches
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
  toolAutoExpandExclusions = [],
  onNavigateToSession,
  showThinking = false,
  isBusy = false,
  channelId,
  searchQuery = '',
  activeSearchMatchIndex = -1,
  onSearchMatchesChange,
}: Props): React.ReactElement {
  const settings = useSettings();
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  // Refs for virtualization (useAutoScroll uses callback refs)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

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
    reset: resetAutoScroll,
  } = useAutoScroll({
    working: isBusy,
    threshold: AUTO_SCROLL_THRESHOLD_PX,
    jumpThreshold: AUTO_SCROLL_JUMP_THRESHOLD_PX,
  });

  // Combine scroll ref with our local ref for virtualization
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

  // Merge channel and conversation messages if showConversation is enabled
  const unifiedMessages = useMemo(() => {
    const hiddenFilterOptions = {
      hideSystemReminders: settings.hideSystemReminders ?? false,
      hideDocInjections: settings.hideDocInjections ?? false,
    };

    if (showConversation && conversationMessages.length > 0) {
      return mergeMessages(
        messages,
        conversationMessages,
        activePromptId,
        hiddenFilterOptions,
      );
    }
    // Just convert channel messages without merging
    return mergeMessages(messages, [], activePromptId, hiddenFilterOptions);
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
    // Avoid deferred/empty-looking updates while users are actively chatting.
    // Virtualization + history windowing already keep render cost bounded.
    enabled: false,
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

  // Stable callback for closing the image modal
  const handleCloseImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  // Stable callback for scrolling to bottom (smooth for user-triggered).
  // Both the jump button and the End-key shortcut go through jumpToBottom(),
  // which force-scrolls AND sets sticky=true so new content re-follows.
  const handleScrollToBottom = useCallback(() => {
    jumpToBottom();
  }, [jumpToBottom]);

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
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ contain: 'strict' }}
        data-scrollable="true"
        onScroll={handleScroll}
        onWheel={handleWheel}
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

        {/* Virtualized message list */}
        <VirtualizedMessageList
          messages={stagedMessages}
          scrollContainerRef={scrollContainerRef}
          contentRef={combinedContentRef}
          unreadStartIndex={unreadStartIndex}
          showUnreadDivider={showUnreadDivider}
          predefinedOptions={predefinedOptions}
          onSelectOption={onSelectOption}
          onExpandImage={handleExpandImage}
          expandAllTools={expandAllTools}
          toolAutoExpandExclusions={toolAutoExpandExclusions}
          onNavigateToSession={onNavigateToSession}
          showThinking={showThinking}
          followOutput={isStickyToBottom}
          onAutoFollowContent={forceScrollToBottom}
          matchedMessageIds={matchedMessageIds}
          activeSearchMatchId={
            activeSearchMatchIndex >= 0
              ? (matchedMessageIds[activeSearchMatchIndex] ?? null)
              : null
          }
        />

        <div ref={chatEndRef} />
      </div>

      {/* Scroll to bottom button - shows when user scrolls away from bottom */}
      <ScrollToBottomButton
        visible={showJump || !isAtBottom}
        unreadCount={unreadCount}
        onClick={handleScrollToBottom}
      />

      {/* Expanded image modal */}
      {expandedImage && (
        <ImageModal image={expandedImage} onClose={handleCloseImage} />
      )}
    </div>
  );
}
