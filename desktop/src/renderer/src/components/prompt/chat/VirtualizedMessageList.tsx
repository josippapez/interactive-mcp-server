import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { UnifiedMessage } from '../../../types/unified-message';
import MessageItem from '../MessageItem';
import UnreadDivider from './UnreadDivider';
import {
  getStreamingMessageId,
  useSeenMessageIds,
} from './virtualized-message-list-helpers';

/**
 * Compute a lightweight signature covering all messages' dynamic content.
 * This ensures we detect changes in tool outputs, statuses, and text
 * regardless of which message position they occur at.
 */
function computeMessagesContentSignature(messages: UnifiedMessage[]): string {
  let hash = 0;
  for (const msg of messages) {
    // Include message id and text length (not full text to keep it fast)
    hash = (hash * 31 + msg.id.length) | 0;
    hash = (hash * 31 + msg.text.length) | 0;
    hash = (hash * 31 + (msg.reasoning?.length ?? 0)) | 0;

    // Include tool call statuses and output lengths
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        hash = (hash * 31 + tc.id.length) | 0;
        hash = (hash * 31 + (tc.status?.length ?? 0)) | 0;
        hash = (hash * 31 + (tc.output?.length ?? 0)) | 0;
      }
    }
  }
  return `${messages.length}:${hash}`;
}

/** Threshold in pixels - if user is within this distance from bottom, consider them "at bottom" */
const BOTTOM_THRESHOLD_PX = 100;

interface VirtualizedMessageListProps {
  /** Messages to render */
  messages: UnifiedMessage[];
  /** Ref to the scroll container element */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref callback for the content wrapper (for height measurement and auto-scroll) */
  contentRef:
    | React.RefCallback<HTMLDivElement>
    | React.RefObject<HTMLDivElement | null>;
  /** Index of first unread message (-1 if none) */
  unreadStartIndex: number;
  /** Whether to show the unread divider */
  showUnreadDivider: boolean;
  /** Predefined options for active prompts */
  predefinedOptions?: string[];
  /** Callback when a predefined option is selected */
  onSelectOption?: (option: string) => void;
  /** Callback when an image is expanded */
  onExpandImage: (src: string, name: string) => void;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** List of tool names to exclude from auto-expand */
  toolAutoExpandExclusions?: string[];
  /** Callback to navigate to a session by openCodeSessionId */
  onNavigateToSession?: (sessionId: string) => void;
  /** Whether to show thinking sections expanded by default */
  showThinking?: boolean;
  /** Whether list should stay pinned to the latest message */
  followOutput?: boolean;
  /** Estimated size of each message row in pixels */
  estimateSize?: number;
  /** Number of items to render outside the visible area */
  overscan?: number;
  matchedMessageIds?: string[];
  activeSearchMatchId?: string | null;
  pauseVersion?: number;
}

const VirtualizedMessageList = memo(function VirtualizedMessageList({
  messages,
  scrollContainerRef,
  contentRef,
  unreadStartIndex,
  showUnreadDivider,
  predefinedOptions,
  onSelectOption,
  onExpandImage,
  expandAllTools = false,
  toolAutoExpandExclusions = [],
  onNavigateToSession,
  showThinking = false,
  followOutput = true,
  estimateSize = 100,
  overscan = 5,
  matchedMessageIds = [],
  activeSearchMatchId = null,
  pauseVersion = 0,
}: VirtualizedMessageListProps): React.ReactElement {
  const newMessageIds = useSeenMessageIds(messages);
  const streamingMessageId = useMemo(
    () => getStreamingMessageId(messages),
    [messages],
  );

  // Track whether user is at the bottom (for auto-scroll behavior)
  // Start true so initial load scrolls to bottom
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  // Flag to ignore scroll events triggered by our own programmatic scrolling
  const isProgrammaticScrollRef = useRef(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => {
      const msg = messages[index];
      if (!msg) return index;
      const compactionFlag = msg.isCompaction ? 'c' : '';
      const reasoningFlag = msg.reasoning ? 'r' : '';
      return `${msg.id}-${compactionFlag}${reasoningFlag}`;
    },
  });

  // Track content signature across ALL messages (not just the last one)
  // This ensures we detect changes in tool outputs, thinking sections, etc.
  // regardless of which message they occur in
  const contentSignature = useMemo(
    () => computeMessagesContentSignature(messages),
    [messages],
  );

  // Ref to track the content container for MutationObserver
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const followOutputRef = useRef(followOutput);
  followOutputRef.current = followOutput;

  useEffect(() => {
    if (pauseVersion === 0) return;
    isAtBottomRef.current = false;
    setIsAtBottom(false);
  }, [pauseVersion]);

  // Check if user is at bottom of scroll container
  const checkIfAtBottom = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  }, [scrollContainerRef]);

  // Track scroll position to detect when user scrolls away from bottom
  // We ignore scroll events triggered by our own programmatic scrolling
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      // Ignore scroll events caused by our programmatic scrolling
      if (isProgrammaticScrollRef.current) {
        return;
      }
      const atBottom = checkIfAtBottom();
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
    };
  }, [scrollContainerRef, checkIfAtBottom]);

  // Scroll to bottom when content signature changes (new messages or content updates)
  // BUT only if user is currently at the bottom (hasn't scrolled away)
  useEffect(() => {
    if (!followOutput || messages.length === 0) return;
    if (!isAtBottomRef.current) return; // User scrolled away, don't auto-scroll
    // Reference contentSignature to satisfy exhaustive-deps and document intent
    void contentSignature;
    // Mark as programmatic scroll so we don't reset isAtBottomRef
    isProgrammaticScrollRef.current = true;
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    // Clear the flag after a short delay to allow scroll event to fire
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [followOutput, contentSignature, messages.length, virtualizer]);

  // Stable scroll-to-bottom function (only scrolls if user is at bottom)
  const scrollToBottomIfPinned = useCallback(() => {
    if (!followOutputRef.current) return;
    if (!isAtBottomRef.current) return; // User scrolled away, don't auto-scroll
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    // Mark as programmatic scroll so we don't reset isAtBottomRef
    isProgrammaticScrollRef.current = true;
    // Use direct scrollTo for immediate response to height changes
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'auto' });
    // Clear the flag after a short delay to allow scroll event to fire
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [scrollContainerRef]);

  // MutationObserver to catch DOM-level height changes (expand/collapse, lazy content)
  // This handles cases where tool cards expand, thinking sections toggle, etc.
  // ResizeObserver on individual items doesn't trigger parent re-renders, so we
  // use MutationObserver on the content wrapper to detect structural changes.
  useEffect(() => {
    const contentEl = contentElRef.current;
    if (!contentEl) return;

    // Debounce scroll calls to avoid excessive scrolling during rapid mutations
    let rafId: number | null = null;

    const mutationObserver = new MutationObserver(() => {
      if (!followOutputRef.current) return;

      // Cancel any pending scroll to coalesce rapid mutations
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      // Defer to after layout/paint to get accurate scrollHeight
      rafId = requestAnimationFrame(() => {
        rafId = null;
        scrollToBottomIfPinned();
      });
    });

    // Only watch for structural changes (childList) and subtree changes
    // Attribute changes are too noisy and usually don't affect height
    mutationObserver.observe(contentEl, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [scrollToBottomIfPinned]);

  // Combined ref callback to capture content element for ResizeObserver
  const combinedContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentElRef.current = node;
      // Call the original contentRef if it's a callback
      if (typeof contentRef === 'function') {
        contentRef(node);
      } else if (contentRef && 'current' in contentRef) {
        (contentRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
      }
    },
    [contentRef],
  );

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (!activeSearchMatchId) return;
    const matchIndex = messages.findIndex((msg) => msg.id === activeSearchMatchId);
    if (matchIndex < 0) return;
    virtualizer.scrollToIndex(matchIndex, { align: 'center' });
  }, [activeSearchMatchId, messages, virtualizer]);

  return (
    <div
      ref={combinedContentRef}
      style={{
        height: virtualizer.getTotalSize(),
        width: '100%',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
        }}
      >
        {virtualItems.map((virtualRow: VirtualItem) => {
          const msg = messages[virtualRow.index];
          if (!msg) return null;

          const isActive = msg.isActivePrompt ?? false;
          const showOptions = Boolean(
            isActive &&
            predefinedOptions &&
            predefinedOptions.length > 0 &&
            onSelectOption,
          );

          const showDividerBefore =
            showUnreadDivider && virtualRow.index === unreadStartIndex;

          const isNewMessage = newMessageIds.has(msg.id);
          const isStreamingMessage = msg.id === streamingMessageId;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="pb-2"
            >
              {showDividerBefore && <UnreadDivider />}
              <MessageItem
                msg={msg}
                isActive={isActive}
                showOptions={showOptions}
                predefinedOptions={predefinedOptions}
                onSelectOption={onSelectOption}
                onExpandImage={onExpandImage}
                expandAllTools={expandAllTools}
                toolAutoExpandExclusions={toolAutoExpandExclusions}
                onNavigateToSession={onNavigateToSession}
                showThinking={showThinking}
                isNew={isNewMessage}
                isStreaming={isStreamingMessage}
                isSearchMatch={matchedMessageIds.includes(msg.id)}
                isActiveSearchMatch={activeSearchMatchId === msg.id}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default VirtualizedMessageList;
