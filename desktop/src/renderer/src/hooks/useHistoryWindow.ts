import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  startTransition,
} from 'react';

/**
 * Turn-based windowing hook based on OpenCode's implementation.
 *
 * Key features:
 * - Initial paint shows only the last N turns (fast first paint)
 * - Scroll-triggered backfill reveals older messages
 * - preserveScroll option maintains scroll position when prepending
 * - Supports both conversation turns and channel messages
 */

export interface Turn {
  /** Unique identifier for the turn */
  id: string;
  /** Messages in this turn (could be multiple for user+assistant pairs) */
  messageIds: string[];
  /** Timestamp of the turn (for ordering) */
  timestamp: number;
}

export interface UseHistoryWindowOptions<T> {
  /** All items in the history */
  items: T[];
  /** Function to extract a unique ID from an item */
  getId: (item: T) => string;
  /** Function to extract timestamp from an item */
  getTimestamp: (item: T) => number;
  /** Function to determine if an item starts a new turn (e.g., user message) */
  isNewTurn?: (item: T, prevItem: T | undefined) => boolean;
  /** Number of turns to show initially (default: 10) */
  initialTurns?: number;
  /** Number of turns to load per backfill (default: 5) */
  backfillTurns?: number;
  /** Threshold from top (in px) to trigger backfill (default: 200) */
  backfillThreshold?: number;
}

export interface UseHistoryWindowReturn<T> {
  /** Currently visible items (windowed subset) */
  visibleItems: T[];
  /** Whether there are more items to load */
  hasMore: boolean;
  /** Whether we're currently loading more */
  isBackfilling: boolean;
  /** Load more items (call when user scrolls near top) */
  loadMore: () => void;
  /** Scroll handler to attach to the scroll container */
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  /** Reset to initial state (e.g., on session change) */
  reset: () => void;
  /** Number of turns currently visible */
  visibleTurnCount: number;
  /** Total number of turns */
  totalTurnCount: number;
  /** Ref to attach to scroll container for preserveScroll behavior */
  scrollRef: React.RefCallback<HTMLDivElement>;
}

/**
 * Group items into turns based on the isNewTurn predicate.
 * By default, treats each item as its own turn.
 */
function groupIntoTurns<T>(
  items: T[],
  getId: (item: T) => string,
  getTimestamp: (item: T) => number,
  isNewTurn?: (item: T, prevItem: T | undefined) => boolean,
): Turn[] {
  if (items.length === 0) return [];

  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prevItem = i > 0 ? items[i - 1] : undefined;
    const startsNewTurn = isNewTurn ? isNewTurn(item, prevItem) : true;

    if (startsNewTurn || !currentTurn) {
      // Start a new turn
      currentTurn = {
        id: `turn-${getId(item)}`,
        messageIds: [getId(item)],
        timestamp: getTimestamp(item),
      };
      turns.push(currentTurn);
    } else {
      // Add to current turn
      currentTurn.messageIds.push(getId(item));
    }
  }

  return turns;
}

export function useHistoryWindow<T>(
  options: UseHistoryWindowOptions<T>,
): UseHistoryWindowReturn<T> {
  const {
    items,
    getId,
    getTimestamp,
    isNewTurn,
    initialTurns = 10,
    backfillTurns = 5,
    backfillThreshold = 200,
  } = options;

  // Track how many turns we're showing (from the end)
  const [visibleTurnCount, setVisibleTurnCount] = useState(initialTurns);
  const [isBackfilling, setIsBackfilling] = useState(false);

  // Refs for scroll preservation
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const preserveScrollRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  // Group items into turns
  const turns = useMemo(
    () => groupIntoTurns(items, getId, getTimestamp, isNewTurn),
    [items, getId, getTimestamp, isNewTurn],
  );

  const totalTurnCount = turns.length;

  // Get visible message IDs based on turn windowing
  const visibleMessageIds = useMemo(() => {
    if (turns.length === 0) return new Set<string>();

    // Show the last N turns
    const startTurnIndex = Math.max(0, turns.length - visibleTurnCount);
    const visibleTurns = turns.slice(startTurnIndex);

    const ids = new Set<string>();
    for (const turn of visibleTurns) {
      for (const msgId of turn.messageIds) {
        ids.add(msgId);
      }
    }
    return ids;
  }, [turns, visibleTurnCount]);

  // Filter items to only visible ones
  const visibleItems = useMemo(() => {
    if (visibleMessageIds.size === items.length) {
      // All items visible, no filtering needed
      return items;
    }
    return items.filter((item) => visibleMessageIds.has(getId(item)));
  }, [items, visibleMessageIds, getId]);

  const hasMore = visibleTurnCount < totalTurnCount;

  // Load more turns (scroll-triggered backfill).
  //
  // Staged mount (C7): the window bump is wrapped in `startTransition` so
  // React treats the large synchronous mount of older rows as a
  // non-blocking update. This keeps the backfill scroll-preservation
  // snap-back (the `useEffect` below) running at interactive priority
  // rather than competing with the heavy paint of newly mounted rows.
  const loadMore = useCallback(() => {
    if (!hasMore || isBackfilling) return;

    setIsBackfilling(true);

    // Capture scroll position before adding items
    const el = scrollElRef.current;
    if (el) {
      preserveScrollRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    }

    // Stage the mount — the scroll-restore effect below will still run
    // synchronously after the transition commits, preserving position.
    startTransition(() => {
      setVisibleTurnCount((prev) =>
        Math.min(prev + backfillTurns, totalTurnCount),
      );
    });

    // Backfilling state will be cleared after render via useEffect
  }, [hasMore, isBackfilling, backfillTurns, totalTurnCount]);

  // Restore scroll position after backfill (preserveScroll pattern)
  useEffect(() => {
    if (!isBackfilling) return;

    const el = scrollElRef.current;
    const preserved = preserveScrollRef.current;

    if (el && preserved) {
      // Calculate how much content was added
      const heightDiff = el.scrollHeight - preserved.scrollHeight;
      // Adjust scroll position to maintain visual position
      el.scrollTop = preserved.scrollTop + heightDiff;
    }

    preserveScrollRef.current = null;
    setIsBackfilling(false);
  }, [isBackfilling]);

  // Handle scroll to detect when user is near the top
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop < backfillThreshold && hasMore && !isBackfilling) {
        loadMore();
      }
    },
    [backfillThreshold, hasMore, isBackfilling, loadMore],
  );

  // Reset when items change significantly (e.g., session change)
  const prevItemsLengthRef = useRef(items.length);
  useEffect(() => {
    // If items decreased significantly or went to 0, reset
    if (
      items.length === 0 ||
      items.length < prevItemsLengthRef.current - initialTurns
    ) {
      setVisibleTurnCount(initialTurns);
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length, initialTurns]);

  // Manual reset function
  const reset = useCallback(() => {
    setVisibleTurnCount(initialTurns);
    setIsBackfilling(false);
    preserveScrollRef.current = null;
  }, [initialTurns]);

  // Scroll ref callback
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollElRef.current = node;
  }, []);

  return {
    visibleItems,
    hasMore,
    isBackfilling,
    loadMore,
    handleScroll,
    reset,
    visibleTurnCount: Math.min(visibleTurnCount, totalTurnCount),
    totalTurnCount,
    scrollRef,
  };
}
