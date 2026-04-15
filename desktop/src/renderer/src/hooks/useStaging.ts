import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Progressive DOM staging hook based on OpenCode's implementation.
 *
 * When revealing a large batch of messages (e.g., expanding history or
 * switching to a session with many messages), this hook stages the render
 * to avoid blocking the main thread.
 *
 * Key features:
 * - Renders items in batches using requestIdleCallback
 * - First batch renders immediately for fast perceived performance
 * - Subsequent batches render during idle time
 * - Supports cancellation when items change mid-staging
 */

export interface UseStagingOptions<T> {
  /** Items to stage */
  items: T[];
  /** Function to extract a unique ID from an item */
  getId: (item: T) => string;
  /** Batch size for initial render (default: 20) */
  initialBatch?: number;
  /** Batch size for subsequent renders (default: 10) */
  stagingBatch?: number;
  /** Whether staging is enabled (default: true) */
  enabled?: boolean;
  /** Threshold to trigger staging (only stage if more than this many items) */
  stagingThreshold?: number;
}

export interface UseStagingReturn<T> {
  /** Items that should be rendered now */
  stagedItems: T[];
  /** Whether staging is in progress */
  isStaging: boolean;
  /** Progress (0-1) of staging */
  progress: number;
  /** Force complete staging immediately */
  completeStaging: () => void;
}

// Polyfill for requestIdleCallback
const requestIdle =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (cb: IdleRequestCallback): number =>
        setTimeout(
          () =>
            cb({
              didTimeout: false,
              timeRemaining: () => 50,
            } as IdleDeadline),
          1,
        ) as unknown as number;

const cancelIdle =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : (id: number) => clearTimeout(id);

// ---------------------------------------------------------------------------
// Pure helpers (extracted for unit testing)
// ---------------------------------------------------------------------------

/**
 * Compute the slice of items that should be rendered given the staged count.
 * Returns the LAST `stagedCount` items (newest messages first).
 * Returns the original array reference when all items are visible.
 */
export function computeStagedSlice<T>(items: T[], stagedCount: number): T[] {
  if (items.length <= stagedCount) return items;
  return items.slice(items.length - stagedCount);
}

/**
 * Determine how many items to show in the initial batch and whether
 * progressive staging is needed.
 */
export function computeInitialBatch(
  itemCount: number,
  opts: { enabled: boolean; stagingThreshold: number; initialBatch: number },
): { count: number; needsStaging: boolean } {
  if (itemCount === 0) return { count: 0, needsStaging: false };
  if (!opts.enabled || itemCount <= opts.stagingThreshold) {
    return { count: itemCount, needsStaging: false };
  }
  const count = Math.min(opts.initialBatch, itemCount);
  return { count, needsStaging: itemCount > count };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStaging<T>(
  options: UseStagingOptions<T>,
): UseStagingReturn<T> {
  const {
    items,
    initialBatch = 20,
    stagingBatch = 10,
    enabled = true,
    stagingThreshold = 30,
  } = options;

  // Track how many items we've staged
  const [stagedCount, setStagedCount] = useState(items.length);
  const [isStaging, setIsStaging] = useState(false);

  // Track the items we're staging (to detect changes)
  const itemsRef = useRef(items);
  const idleCallbackRef = useRef<number | null>(null);

  // Cancel any pending idle callback
  const cancelPendingStaging = useCallback(() => {
    if (idleCallbackRef.current !== null) {
      cancelIdle(idleCallbackRef.current);
      idleCallbackRef.current = null;
    }
  }, []);

  // Handle items change
  useEffect(() => {
    const prevItems = itemsRef.current;
    itemsRef.current = items;

    // If items changed, we need to re-evaluate staging
    const prevLength = prevItems.length;
    const newLength = items.length;

    // Case 1: Items decreased or changed identity - reset to show all
    if (newLength < prevLength) {
      cancelPendingStaging();
      setStagedCount(newLength);
      setIsStaging(false);
      return;
    }

    // Case 2: Small increase - show immediately
    if (newLength - prevLength <= stagingBatch) {
      setStagedCount(newLength);
      return;
    }

    // Case 3: Large batch of new items - stage them
    if (
      enabled &&
      newLength > stagingThreshold &&
      newLength - stagedCount > stagingBatch
    ) {
      // Start staging from current staged count
      setIsStaging(true);
    }
  }, [
    items,
    enabled,
    stagingBatch,
    stagingThreshold,
    stagedCount,
    cancelPendingStaging,
  ]);

  // Progressive staging via requestIdleCallback
  useEffect(() => {
    if (!isStaging) return;
    if (stagedCount >= items.length) {
      setIsStaging(false);
      return;
    }

    const stageNextBatch = (deadline: IdleDeadline) => {
      // Stage items while we have time
      let count = stagedCount;
      const targetCount = items.length;

      while (
        count < targetCount &&
        (deadline.timeRemaining() > 5 || deadline.didTimeout)
      ) {
        count = Math.min(count + stagingBatch, targetCount);
      }

      setStagedCount(count);

      if (count < targetCount) {
        // Schedule next batch
        idleCallbackRef.current = requestIdle(stageNextBatch, { timeout: 100 });
      } else {
        setIsStaging(false);
        idleCallbackRef.current = null;
      }
    };

    // Start staging
    idleCallbackRef.current = requestIdle(stageNextBatch, { timeout: 100 });

    return () => {
      cancelPendingStaging();
    };
  }, [
    isStaging,
    stagedCount,
    items.length,
    stagingBatch,
    cancelPendingStaging,
  ]);

  // Initialize staged count when items first appear
  useEffect(() => {
    if (items.length === 0) {
      setStagedCount(0);
      return;
    }

    // On initial mount or when items appear, show initial batch immediately
    if (stagedCount === 0 && items.length > 0) {
      if (enabled && items.length > stagingThreshold) {
        // Large initial load - stage it
        setStagedCount(Math.min(initialBatch, items.length));
        setIsStaging(items.length > initialBatch);
      } else {
        // Small load - show all
        setStagedCount(items.length);
      }
    }
  }, [items.length, stagedCount, enabled, stagingThreshold, initialBatch]);

  // Compute staged items
  const stagedItems = computeStagedSlice(items, stagedCount);

  const progress = items.length === 0 ? 1 : stagedCount / items.length;

  // Force complete staging
  const completeStaging = useCallback(() => {
    cancelPendingStaging();
    setStagedCount(items.length);
    setIsStaging(false);
  }, [items.length, cancelPendingStaging]);

  return {
    stagedItems,
    isStaging,
    progress,
    completeStaging,
  };
}
