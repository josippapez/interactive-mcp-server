import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { UnifiedMessage } from '../../../types/unified-message';
import MessageItem from '../MessageItem';
import UnreadDivider from './UnreadDivider';
import {
  getStreamingMessageId,
  useSeenMessageIds,
} from './message-list-helpers';

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
    | React.RefCallback<HTMLDivElement>
    | React.RefObject<HTMLDivElement | null>;
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

/**
 * Plain (non-virtualized) message list.
 *
 * Renders all messages in-order as regular DOM nodes. Auto-scroll / sticky
 * behavior is owned entirely by the parent (`ChatHistoryView` + `useAutoScroll`)
 * — this component just mounts rows and forwards its content wrapper ref so
 * the parent can observe height changes if desired.
 *
 * Replaces the previous TanStack Virtual implementation. Virtualization added
 * re-measurement jank during streaming (row heights change per token, forcing
 * re-layout and fighting with the auto-scroll driver). The Vercel AI chatbot
 * style — plain list + bottom-anchor — renders far more predictably, and the
 * existing history-windowing (`useHistoryWindow`) already caps the rendered
 * message count for long sessions.
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

  // If the focused message is removed (e.g. history trimmed), drop focus.
  useEffect(() => {
    if (!focusedId) return;
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
      const nextArticle = nextRow?.querySelector<HTMLElement>(
        'article[data-slot^="session-turn-"]',
      );
      nextArticle?.focus({ preventScroll: false });
      nextArticle?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [messages],
  );

  useEffect(() => {
    if (!activeSearchMatchId) return;
    const node = rowRefs.current.get(activeSearchMatchId);
    if (!node) return;
    // Scroll the match to the center of the scroll container if available,
    // otherwise fall back to the element's default `scrollIntoView` behavior.
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
  }, [activeSearchMatchId, scrollContainerRef]);

  return (
    <div
      ref={contentRef}
      data-slot="session-turn-list"
      className="flex flex-col gap-3 px-2 py-3"
    >
      {messages.map((msg, index) => {
        const isActive = msg.isActivePrompt ?? false;
        const showOptions = Boolean(
          isActive &&
          predefinedOptions &&
          predefinedOptions.length > 0 &&
          onSelectOption,
        );

        const showDividerBefore =
          showUnreadDivider && index === unreadStartIndex;

        const isNewMessage = newMessageIds.has(msg.id);
        const isStreamingMessage = msg.id === streamingMessageId;

        return (
          <div
            key={msg.id}
            data-index={index}
            data-message-id={msg.id}
            ref={getRefSetter(msg.id)}
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
              isSearchMatch={matchedIdSet.has(msg.id)}
              isActiveSearchMatch={activeSearchMatchId === msg.id}
              isFocused={focusedId === msg.id}
              isDeepLinkTarget={deepLinkMessageId === msg.id}
              onRequestFocus={handleRequestFocus}
              onKeyNavigate={handleKeyNavigate}
            />
          </div>
        );
      })}
    </div>
  );
});

export default MessageList;
