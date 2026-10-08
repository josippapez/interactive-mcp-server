import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { UnifiedMessage } from '../../../types/unified-message';
import MessageItem from '../MessageItem';
import MarkdownContent from '../../MarkdownContent';
import UnreadDivider from './UnreadDivider';
import {
  getStreamingMessageId,
  useSeenMessageIds,
} from './message-list-helpers';
import { ReasoningSection, ToolCallsSection } from '../message-item-sections';
import {
  VIRTUAL_MESSAGE_ESTIMATED_HEIGHT_PX,
  VIRTUAL_MESSAGE_OVERSCAN,
  buildTimelineRows,
  getVirtualizedMessageIndex,
  registerVirtualMessageRow,
  shouldVirtualizeMessageList,
  type TimelineRow,
} from './message-list-virtualization';

interface MessageListProps {
  /** Messages to render */
  messages: UnifiedMessage[];
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
  /** Whether the backing session is currently busy/streaming. */
  isBusy?: boolean;
  /** Ref callback forwarded to the content wrapper (parent scroll container observes it). */
  contentRef?:
    React.RefCallback<HTMLDivElement> | React.RefObject<HTMLDivElement | null>;
  matchedMessageIds?: string[];
  activeSearchMatchId?: string | null;
  /**
   * Optional scroll container ref — when provided together with
   * `activeSearchMatchId`, the list will scroll the matched row into view.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Id of the message currently targeted by a `#message-<id>` URL hash.
   * Causes a transient pulse highlight on that row (managed by parent).
   */
  deepLinkMessageId?: string | null;
}

// Stable empty default for optional array props — avoid remounting child
// MessageItems due to new [] identity on every render of parents.
const EMPTY_EXCLUSIONS: string[] = [];
const EMPTY_MATCHED_IDS: string[] = [];
const CHAT_MARKDOWN_TEXT_CLASS =
  '[&_.prose]:text-[var(--chat-message-size)] [&_.prose]:leading-[var(--chat-message-line-height)] [&_.prose_p]:!text-[var(--chat-message-size)] [&_.prose_p]:leading-[var(--chat-message-line-height)] [&_.prose_li]:!text-[var(--chat-message-size)] [&_.prose_li]:leading-[var(--chat-message-line-height)] [&_.prose_code]:text-[calc(var(--chat-message-size)-1px)]';

/**
 * Non-virtualized message list. Auto-scroll is owned by the parent
 * (`ChatHistoryView` + `useAutoScroll`) observing this content wrapper.
 */
const MessageList = memo(function MessageList({
  messages,
  unreadStartIndex,
  showUnreadDivider,
  predefinedOptions,
  onSelectOption,
  onExpandImage,
  expandAllTools = false,
  toolAutoExpandExclusions = EMPTY_EXCLUSIONS,
  onNavigateToSession,
  showThinking = false,
  isBusy = false,
  contentRef,
  matchedMessageIds = EMPTY_MATCHED_IDS,
  activeSearchMatchId = null,
  scrollContainerRef,
  deepLinkMessageId = null,
}: MessageListProps): React.ReactElement {
  const newMessageIds = useSeenMessageIds(messages);
  const streamingMessageId = useMemo(
    () => getStreamingMessageId(messages, isBusy),
    [messages, isBusy],
  );

  // Row refs for scrolling the active search match into view.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Stable ref-setter factory keyed by message id. Using a per-id cached
  // callback (instead of an inline `(node) => ...` each render) keeps the
  // `ref` prop identity stable across renders, which prevents React from
  // detaching + reattaching the ref (and thereby avoids unnecessary
  // MessageItem remounts for rows whose props otherwise didn't change).
  const refSettersRef = useRef(
    new Map<string, (node: HTMLDivElement | null) => void>(),
  );
  const getRefSetter = useCallback(
    (id: string): ((node: HTMLDivElement | null) => void) => {
      const cached = refSettersRef.current.get(id);
      if (cached) return cached;
      const setter = (node: HTMLDivElement | null): void => {
        if (node) {
          rowRefs.current.set(id, node);
        } else {
          rowRefs.current.delete(id);
        }
      };
      refSettersRef.current.set(id, setter);
      return setter;
    },
    [],
  );

  // O(1) search-match lookups. Prop remains array-shaped to minimize churn
  // for callers; memoize to avoid rebuilding the Set unless the array
  // reference changes.
  const matchedIdSet = useMemo(
    () => new Set(matchedMessageIds),
    [matchedMessageIds],
  );

  // Which message currently holds keyboard focus (null = none).
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(focusedId);
  focusedIdRef.current = focusedId;
  const previousMessageCountRef = useRef(messages.length);
  const timelineRows = useMemo(() => buildTimelineRows(messages), [messages]);
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message] as const)),
    [messages],
  );
  const shouldVirtualize = shouldVirtualizeMessageList(timelineRows.length);

  const rowVirtualizer = useVirtualizer({
    count: timelineRows.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: () => VIRTUAL_MESSAGE_ESTIMATED_HEIGHT_PX,
    overscan: VIRTUAL_MESSAGE_OVERSCAN,
    enabled: shouldVirtualize,
  });
  const rowVirtualizerRef = useRef(rowVirtualizer);
  rowVirtualizerRef.current = rowVirtualizer;

  const virtualRefSettersRef = useRef(
    new Map<string, (node: HTMLDivElement | null) => void>(),
  );
  const virtualObservedRowsRef = useRef(new Map<string, HTMLDivElement>());
  const virtualResizeObserverRef = useRef<ResizeObserver | null>(null);
  const getVirtualResizeObserver = useCallback((): ResizeObserver | null => {
    if (typeof ResizeObserver === 'undefined') return null;
    if (!virtualResizeObserverRef.current) {
      virtualResizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          rowVirtualizerRef.current.measureElement(
            entry.target as HTMLDivElement,
          );
        }
      });
    }
    return virtualResizeObserverRef.current;
  }, []);
  const getVirtualRefSetter = useCallback(
    (id: string): ((node: HTMLDivElement | null) => void) => {
      const cached = virtualRefSettersRef.current.get(id);
      if (cached) return cached;
      const setter = (node: HTMLDivElement | null): void => {
        registerVirtualMessageRow(id, node, {
          rowRefs: rowRefs.current,
          observedRows: virtualObservedRowsRef.current,
          resizeObserver: getVirtualResizeObserver(),
          measureElement: (element) =>
            rowVirtualizerRef.current.measureElement(element),
        });
        if (node) {
          if (focusedIdRef.current === id) {
            requestAnimationFrame(() => {
              node
                .querySelector<HTMLElement>(
                  'article[data-slot^="session-turn-"]',
                )
                ?.focus({ preventScroll: true });
            });
          }
        }
      };
      virtualRefSettersRef.current.set(id, setter);
      return setter;
    },
    [getVirtualResizeObserver],
  );

  useLayoutEffect(() => {
    if (!shouldVirtualize) return;
    for (const node of virtualObservedRowsRef.current.values()) {
      rowVirtualizer.measureElement(node);
    }
  }, [messages, rowVirtualizer, shouldVirtualize]);

  useEffect(() => {
    return () => {
      virtualResizeObserverRef.current?.disconnect();
      virtualResizeObserverRef.current = null;
      virtualObservedRowsRef.current.clear();
    };
  }, []);

  // If the focused message is removed (e.g. history trimmed), drop focus.
  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    if (!focusedId) return;
    if (messages.length >= previousMessageCount) return;
    const exists = messages.some((m) => m.id === focusedId);
    if (!exists) setFocusedId(null);
  }, [focusedId, messages]);

  const handleRequestFocus = useCallback((id: string) => {
    setFocusedId(id);
    // Move DOM focus to the <article> so keydown handlers fire.
    const row = rowRefs.current.get(id);
    const article = row?.querySelector<HTMLElement>(
      'article[data-slot^="session-turn-"]',
    );
    article?.focus({ preventScroll: true });
  }, []);

  const handleKeyNavigate = useCallback(
    (id: string, direction: 'up' | 'down' | 'escape') => {
      if (direction === 'escape') {
        setFocusedId(null);
        const row = rowRefs.current.get(id);
        const article = row?.querySelector<HTMLElement>(
          'article[data-slot^="session-turn-"]',
        );
        article?.blur();
        return;
      }
      const idx = messages.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const nextIdx = direction === 'down' ? idx + 1 : idx - 1;
      const next = messages[nextIdx];
      if (!next) return;
      setFocusedId(next.id);
      const nextRow = rowRefs.current.get(next.id);
      if (!nextRow && shouldVirtualize) {
        rowVirtualizer.scrollToIndex(nextIdx, { align: 'auto' });
      }
      const nextArticle = nextRow?.querySelector<HTMLElement>(
        'article[data-slot^="session-turn-"]',
      );
      nextArticle?.focus({ preventScroll: false });
      nextArticle?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [messages, rowVirtualizer, shouldVirtualize],
  );

  useEffect(() => {
    if (!activeSearchMatchId) return;
    if (shouldVirtualize) {
      const targetIndex = getVirtualizedMessageIndex(
        timelineRows,
        activeSearchMatchId,
      );
      if (targetIndex >= 0) {
        rowVirtualizer.scrollToIndex(targetIndex, {
          align: 'center',
          behavior: 'smooth',
        });
      }
      return;
    }
    const node = rowRefs.current.get(activeSearchMatchId);
    if (!node) return;
    const container = scrollContainerRef?.current;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const offsetWithinContainer =
        nodeRect.top - containerRect.top + container.scrollTop;
      const target =
        offsetWithinContainer - (container.clientHeight - nodeRect.height) / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      return;
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [
    activeSearchMatchId,
    rowVirtualizer,
    scrollContainerRef,
    shouldVirtualize,
    timelineRows,
  ]);

  useEffect(() => {
    if (!deepLinkMessageId || !shouldVirtualize) return;
    const targetIndex = getVirtualizedMessageIndex(
      timelineRows,
      deepLinkMessageId,
    );
    if (targetIndex < 0) return;
    rowVirtualizer.scrollToIndex(targetIndex, {
      align: 'start',
      behavior: 'smooth',
    });
  }, [deepLinkMessageId, rowVirtualizer, shouldVirtualize, timelineRows]);

  const renderWholeMessage = useCallback(
    (msg: UnifiedMessage, index: number) => {
      const isActive = msg.isActivePrompt ?? false;
      const showOptions = Boolean(
        isActive &&
        predefinedOptions &&
        predefinedOptions.length > 0 &&
        onSelectOption,
      );
      const showDividerBefore = showUnreadDivider && index === unreadStartIndex;

      return (
        <>
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
            isNew={newMessageIds.has(msg.id)}
            isStreaming={msg.id === streamingMessageId}
            isSearchMatch={matchedIdSet.has(msg.id)}
            isActiveSearchMatch={activeSearchMatchId === msg.id}
            isFocused={focusedId === msg.id}
            isDeepLinkTarget={deepLinkMessageId === msg.id}
            onRequestFocus={handleRequestFocus}
            onKeyNavigate={handleKeyNavigate}
          />
        </>
      );
    },
    [
      activeSearchMatchId,
      deepLinkMessageId,
      expandAllTools,
      focusedId,
      handleKeyNavigate,
      handleRequestFocus,
      matchedIdSet,
      newMessageIds,
      onExpandImage,
      onNavigateToSession,
      onSelectOption,
      predefinedOptions,
      showThinking,
      showUnreadDivider,
      streamingMessageId,
      toolAutoExpandExclusions,
      unreadStartIndex,
    ],
  );

  const renderTimelineRow = useCallback(
    (row: TimelineRow, index: number) => {
      const msg = messageById.get(row.messageId);
      if (!msg) return null;
      const showDividerBefore =
        showUnreadDivider && row.firstForMessage && index === unreadStartIndex;
      const isStreaming = msg.id === streamingMessageId;

      if (row.type === 'message') {
        return (
          <>
            {showDividerBefore && <UnreadDivider />}
            {renderWholeMessage(msg, index)}
          </>
        );
      }

      const activePromptClass = msg.isActivePrompt
        ? 'ring-1 ring-[var(--color-agent)]/40 bg-[var(--color-agent)]/10'
        : '';
      const searchRingClass =
        activeSearchMatchId === msg.id
          ? 'ring-2 ring-[var(--color-warning,#f59e0b)]/70 bg-[var(--color-warning,#f59e0b)]/10'
          : matchedIdSet.has(msg.id)
            ? 'ring-1 ring-[var(--color-warning,#f59e0b)]/35 bg-[var(--color-warning,#f59e0b)]/5'
            : '';
      const focusRingClass =
        focusedId === msg.id ? 'ring-1 ring-[var(--color-agent)]/60' : '';
      const deepLinkClass =
        deepLinkMessageId === msg.id
          ? 'ring-2 ring-[var(--color-agent)]/80 bg-[var(--color-agent)]/12 animate-pulse'
          : '';

      return (
        <>
          {showDividerBefore && <UnreadDivider />}
          <article
            id={row.firstForMessage ? `message-${msg.id}` : undefined}
            data-slot={`session-turn-${row.type}`}
            data-message-id={msg.id}
            className={`group relative flex w-full flex-col items-start outline-none ${focusRingClass} ${deepLinkClass} ${searchRingClass} ${activePromptClass}`.trim()}
            aria-label="Assistant message part"
            aria-current={msg.isActivePrompt ? 'true' : undefined}
            tabIndex={-1}
            onClick={() => handleRequestFocus(msg.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                handleKeyNavigate(msg.id, 'down');
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                handleKeyNavigate(msg.id, 'up');
              } else if (event.key === 'Escape') {
                handleKeyNavigate(msg.id, 'escape');
              }
            }}
          >
            {row.type === 'assistant-reasoning' && msg.reasoning && (
              <ReasoningSection
                reasoning={msg.reasoning}
                defaultExpanded={showThinking}
                isStreaming={isStreaming}
              />
            )}
            {row.type === 'assistant-text' && msg.text && (
              <div
                className={`mb-1 min-w-0 w-full ${CHAT_MARKDOWN_TEXT_CLASS}`}
              >
                <MarkdownContent content={msg.text} streaming={isStreaming} />
              </div>
            )}
            {row.type === 'assistant-tools' && row.toolCalls && (
              <ToolCallsSection
                toolCalls={row.toolCalls}
                expandAllTools={expandAllTools}
                toolAutoExpandExclusions={toolAutoExpandExclusions}
                onNavigateToSession={onNavigateToSession}
              />
            )}
            {row.type === 'assistant-thinking' && (
              <div
                data-slot="session-turn-thinking"
                className="text-[var(--color-text-muted)] animate-pulse"
              >
                Thinking...
              </div>
            )}
          </article>
        </>
      );
    },
    [
      activeSearchMatchId,
      deepLinkMessageId,
      expandAllTools,
      focusedId,
      handleKeyNavigate,
      handleRequestFocus,
      matchedIdSet,
      messageById,
      onNavigateToSession,
      renderWholeMessage,
      showThinking,
      showUnreadDivider,
      streamingMessageId,
      toolAutoExpandExclusions,
      unreadStartIndex,
    ],
  );

  if (shouldVirtualize) {
    return (
      <div
        ref={contentRef}
        data-slot="session-turn-list"
        data-virtualized="true"
        className="px-4 py-4 md:px-5"
      >
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = timelineRows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                data-index={virtualRow.index}
                data-message-id={row.messageId}
                ref={getVirtualRefSetter(row.key)}
                className="absolute left-0 top-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="pb-5">
                  {renderTimelineRow(row, virtualRow.index)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={contentRef}
      data-slot="session-turn-list"
      className="flex flex-col gap-5 px-4 py-4 md:px-5"
    >
      {messages.map((msg, index) => {
        return (
          <div
            key={msg.id}
            data-index={index}
            data-message-id={msg.id}
            ref={getRefSetter(msg.id)}
          >
            {renderWholeMessage(msg, index)}
          </div>
        );
      })}
    </div>
  );
});

export default MessageList;
