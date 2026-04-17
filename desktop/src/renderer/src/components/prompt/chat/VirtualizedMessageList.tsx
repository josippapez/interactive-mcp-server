import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { UnifiedMessage } from '../../../types/unified-message';
import MessageItem from '../MessageItem';
import UnreadDivider from './UnreadDivider';
import {
  getStreamingMessageId,
  useSeenMessageIds,
} from './virtualized-message-list-helpers';

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

  // Ref to track the content container for MutationObserver
  const contentElRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest followOutput + onAutoFollowContent in refs so the
  // MutationObserver callback always reads the freshest values without
  // being re-subscribed on every re-render.
  const followOutputRef = useRef(followOutput);
  followOutputRef.current = followOutput;
  const onAutoFollowContentRef = useRef(onAutoFollowContent);
  onAutoFollowContentRef.current = onAutoFollowContent;

  /**
   * When `followOutput` is true and new content arrives, scroll to bottom.
   * Delegates to the parent-owned callback so the parent's auto-scroll marker
   * stays in sync (prevents the scroll event from being misclassified as user).
   */
  const followToBottom = useCallback(() => {
    if (!followOutputRef.current) return;
    const cb = onAutoFollowContentRef.current;
    if (cb) {
      cb();
      return;
    }
    // Fallback: if no parent callback was provided, scroll directly.
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'auto' });
  }, [scrollContainerRef]);

  // Auto-scroll driver: MutationObserver on the content container is the
  // single source of truth for "content changed, maybe scroll". It fires on:
  //   - new messages being mounted (childList)
  //   - text streaming into existing messages (characterData via subtree)
  //   - tool cards / thinking sections expanding (subtree childList)
  //   - virtualized rows coming into view and growing (subtree)
  //
  // We intentionally do NOT also compute a content hash over `messages` and
  // drive a second effect off it — that was the previous design, and the
  // two drivers raced (signature-effect scrolled before the DOM had
  // actually grown, causing sporadic "stuck 1 row above bottom" bugs) and
  // doubled the work per streaming tick.
  useEffect(() => {
    const contentEl = contentElRef.current;
    if (!contentEl) return;

    // Debounce scroll calls to coalesce rapid mutations.
    let rafId: number | null = null;

    const mutationObserver = new MutationObserver(() => {
      if (!followOutputRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        followToBottom();
      });
    });

    // Watch structural changes + text streaming. Attribute changes are too
    // noisy (class toggles, aria updates) and usually don't affect height.
    mutationObserver.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      mutationObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [followToBottom]);

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
