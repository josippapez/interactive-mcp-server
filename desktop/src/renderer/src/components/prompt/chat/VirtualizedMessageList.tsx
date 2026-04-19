import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { UnifiedMessage } from '../../../types/unified-message';
import MessageItem from '../MessageItem';
import UnreadDivider from './UnreadDivider';
import {
  getStreamingMessageId,
  useSeenMessageIds,
} from './virtualized-message-list-helpers';
import { computeAutoScrollSignature } from './auto-scroll-signature';
import { shouldRescrollOnResize } from './auto-scroll-resize';

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
  /** Callback to navigate to a session by providerSessionId */
  onNavigateToSession?: (sessionId: string) => void;
  /** Whether to show thinking sections expanded by default */
  showThinking?: boolean;
  /**
   * Whether the list should stay pinned to the latest message.
   *
   * This is the single source of truth passed down from `useAutoScroll`
   * (parent owns the state). When `true`, this component will programmatically
   * scroll to the bottom whenever content changes. When `false`, it leaves
   * the scroll position untouched — the user is in control.
   */
  followOutput?: boolean;
  /**
   * Imperative scroll-to-bottom callback owned by the parent's `useAutoScroll`.
   * Called when content changes and `followOutput` is true, so the auto-scroll
   * marker in the parent hook stays accurate (and we don't bypass the single
   * source of truth with a raw `scrollEl.scrollTo`).
   */
  onAutoFollowContent?: () => void;
  /**
   * Estimated size of each message row in pixels.
   *
   * Defaults to 240 — empirically the median message row in this app is
   * 300–1000px (text + reasoning + tool cards). The previous default of 100
   * caused TanStack Virtual to under-allocate the total size, triggering
   * aggressive resize / re-measure passes on initial render and on scroll
   * (visible as layout thrash + jank). 240 overshoots short messages slightly
   * but dramatically reduces re-measure churn for typical chat history.
   */
  estimateSize?: number;
  /** Number of items to render outside the visible area */
  overscan?: number;
  matchedMessageIds?: string[];
  activeSearchMatchId?: string | null;
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
  onAutoFollowContent,
  estimateSize = 240,
  overscan = 5,
  matchedMessageIds = [],
  activeSearchMatchId = null,
}: VirtualizedMessageListProps): React.ReactElement {
  const newMessageIds = useSeenMessageIds(messages);
  const streamingMessageId = useMemo(
    () => getStreamingMessageId(messages),
    [messages],
  );

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

  // Ref to the content wrapper, kept for the combined ref callback below.
  const contentElRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest followOutput + onAutoFollowContent in refs so auto-scroll
  // effects always read the freshest values without re-subscribing.
  const followOutputRef = useRef(followOutput);
  followOutputRef.current = followOutput;
  const onAutoFollowContentRef = useRef(onAutoFollowContent);
  onAutoFollowContentRef.current = onAutoFollowContent;

  /**
   * Deterministic auto-scroll driver using TanStack Virtual natives plus a
   * ResizeObserver feedback loop.
   *
   * Why a ResizeObserver?
   *   `getTotalSize()` is built from a mix of estimated (`estimateSize`) and
   *   measured row heights. When TanStack Virtual measures a row *after* our
   *   initial `scrollToIndex` (e.g. estimate 240px, actual 920px), the inner
   *   wrapper's height grows and we end up "one row short" of the bottom.
   *   The previous design tried to compensate with a single rAF retry, but a
   *   row that re-measures two frames later (markdown re-render, image load,
   *   tool-result expansion) would still slip past it.
   *
   *   By observing the wrapper element directly, every measurement-driven
   *   height change re-fires the scroll while we're still meant to be
   *   following output. This is the virtualized equivalent of a sentinel
   *   element + `scrollIntoView`, but it works correctly because it reacts
   *   to the *measured* total size, not the estimated one.
   *
   * Driver layout:
   *   1. A signature-keyed effect handles the **content delta** case (new
   *      message arrived, streaming text grew). It marks + scrolls once.
   *   2. The ResizeObserver effect handles the **measurement delta** case
   *      (row height changed without new content). It marks + scrolls
   *      whenever the wrapper height moves while following.
   *   3. Both paths call `onAutoFollowContent` first so the parent's
   *      `useAutoScroll` marker classifies the resulting scroll event as
   *      programmatic (preserving `isStickyToBottom`).
   */
  const signature = computeAutoScrollSignature(messages);

  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;

  const scrollToBottomNow = useCallback(() => {
    if (!followOutputRef.current) return;
    if (messagesLengthRef.current === 0) return;
    const markCb = onAutoFollowContentRef.current;
    if (markCb) markCb();
    virtualizer.scrollToIndex(messagesLengthRef.current - 1, { align: 'end' });
  }, [virtualizer]);

  // Content-delta driver: fires once per new message / streaming text change.
  useEffect(() => {
    scrollToBottomNow();
  }, [signature, scrollToBottomNow]);

  // Measurement-delta driver: re-scrolls whenever the items wrapper height
  // changes (late row measurements, image loads, tool-card expansions).
  useEffect(() => {
    const node = contentElRef.current;
    if (!node) return;
    if (typeof ResizeObserver === 'undefined') return;

    let prevHeight: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextHeight = entry.contentRect.height;
      const decision = shouldRescrollOnResize({
        prevHeight,
        nextHeight,
        isFollowing: followOutputRef.current,
        messageCount: messagesLengthRef.current,
      });
      prevHeight = nextHeight;
      if (decision) scrollToBottomNow();
    });
    observer.observe(node);
    return () => observer.disconnect();
    // We re-attach when the message-count signature changes only via the
    // `scrollToBottomNow` reference (stable). The observer itself reads the
    // freshest follow-state and message count via refs, so it never needs to
    // be torn down on those changes.
  }, [scrollToBottomNow]);

  // Combined ref callback to capture content element for the MutationObserver.
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
    const matchIndex = messages.findIndex(
      (msg) => msg.id === activeSearchMatchId,
    );
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
