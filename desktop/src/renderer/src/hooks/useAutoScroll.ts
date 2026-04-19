import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Auto-scroll behavior for chat views — single source of truth.
 *
 * State machine:
 *   isStickyToBottom=true  → auto-follow new content to bottom.
 *   isStickyToBottom=false → user has scrolled away; do NOT auto-scroll.
 *
 * Transitions:
 *   • At bottom + new content → programmatic scroll; stays sticky.
 *   • User scrolls up (wheel-up, drag, Page Up) → sticky=false.
 *   • User scrolls back within threshold → sticky=true.
 *   • jumpToBottom() / End key / channel switch → sticky=true AND scroll.
 *
 * The key problem this hook solves: distinguish **programmatic** scrolls (our
 * own `scrollTo()` calls) from **user** scrolls. We use the same technique as
 * OpenCode's `createAutoScroll`: before every programmatic scroll we `mark()`
 * the expected target scrollTop; when a subsequent scroll event fires, if the
 * current scrollTop is within 2px of that mark (within 1500ms), we treat it
 * as programmatic and preserve the sticky state.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Max drift from the marked target still considered "programmatic". */
const AUTO_MARKER_SCROLL_TOP_TOLERANCE_PX = 2;
/** Auto-marker expiry — after this, scroll events are always treated as user. */
const AUTO_MARKER_EXPIRY_MS = 1500;
/**
 * After a programmatic scroll request, treat ALL scroll events as "auto"
 * for this window — covers smooth-scroll animation frames whose intermediate
 * scrollTop values are far from the final target. Slightly longer than a
 * typical browser smooth-scroll animation.
 */
const PROGRAMMATIC_SCROLL_WINDOW_MS = 600;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseAutoScrollOptions {
  /** Whether content is actively streaming/updating. */
  working: boolean;
  /** Distance from bottom (px) still considered "at bottom". Default 10. */
  threshold?: number;
  /** Distance from bottom (px) beyond which the jump button should show. */
  jumpThreshold?: number;
  /**
   * External stick-to-bottom preference (Bug 3 — global toggle). When this
   * value flips from false → true the hook re-engages sticky and scrolls to
   * bottom. When the hook internally flips sticky → false (because the user
   * scrolled away), the consumer's `onStickyChange` callback fires so the
   * preference can be persisted.
   */
  stickyPreference?: boolean;
  /**
   * Called whenever the hook's internal `isStickyToBottom` changes. The
   * consumer is expected to mirror this into the persisted preference.
   */
  onStickyChange?: (sticky: boolean) => void;
}

export interface UseAutoScrollReturn {
  scrollRef: React.RefCallback<HTMLDivElement>;
  /** Primary boolean: is the view sticking to the bottom? */
  isStickyToBottom: boolean;
  /** @deprecated Alias of `isStickyToBottom` — kept for back-compat. */
  pinnedToBottom: boolean;
  /** Inverse of `isStickyToBottom`. */
  userScrolled: boolean;
  /** Distance-based: within `threshold` of the bottom. */
  isAtBottom: boolean;
  /** Show the "Jump to bottom" button. */
  showJump: boolean;
  /**
   * Monotonic counter bumped whenever sticky flips to false. Deprecated —
   * consumers should read `isStickyToBottom` directly. Kept to avoid breaking
   * existing call sites until they're migrated.
   */
  pauseVersion: number;
  /** Smooth or auto scroll to the bottom AND set sticky=true (user-initiated). */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Instant scroll to bottom + set sticky=true. */
  forceScrollToBottom: () => void;
  /** Jump button / End key: force scroll + set sticky=true. */
  jumpToBottom: () => void;
  /** Programmatically flip sticky=false (rarely needed externally). */
  pause: () => void;
  /** Programmatically flip sticky=true and scroll to bottom. */
  resume: () => void;
  /** Attach to the scroll container's `onScroll`. */
  handleScroll: () => void;
  /** Attach to the scroll container's `onWheel` (deltaY). */
  handleWheel: (deltaY: number) => void;
  /** Channel-switch reset: sticky=true and scroll to bottom. */
  reset: (channelId?: string | null) => void;
}

// ---------------------------------------------------------------------------
// Pure functions (unit-testable)
// ---------------------------------------------------------------------------

export function resolveAutoScrollState(
  distanceFromBottom: number,
  threshold: number,
  jumpThreshold: number,
): {
  isAtBottom: boolean;
  userScrolled: boolean;
  showJump: boolean;
} {
  const isAtBottom = distanceFromBottom <= threshold;
  return {
    isAtBottom,
    userScrolled: !isAtBottom,
    showJump: distanceFromBottom > jumpThreshold,
  };
}

export function shouldPauseAutoScrollOnWheel(deltaY: number): boolean {
  return deltaY < 0;
}

/**
 * Pure transition: given a scroll event, decide the next `isStickyToBottom`.
 *
 * - If the scroll was programmatic (`wasAuto`) → keep previous sticky state.
 *   This is critical: our own `scrollTo()` fires a scroll event with a
 *   momentarily-stale layout. Without this guard we'd immediately flip to
 *   `false` on every auto-scroll.
 * - Else if distance ≤ threshold → sticky=true (user is back at bottom).
 * - Else → sticky=false (user scrolled away).
 */
export function nextStickyStateOnScroll(input: {
  prev: boolean;
  distance: number;
  threshold: number;
  wasAuto: boolean;
}): boolean {
  if (input.wasAuto) return input.prev;
  return input.distance <= input.threshold;
}

/**
 * Returns true if `now` is before the programmatic-scroll window expiry.
 * Used to keep sticky=true across smooth-scroll animation frames whose
 * intermediate scrollTop values won't match the marker's exact target.
 *
 * A value of 0 (or negative) for `windowUntil` means no window is open.
 */
export function isWithinProgrammaticScrollWindow(
  windowUntil: number,
  now: number = Date.now(),
): boolean {
  return windowUntil > 0 && now < windowUntil;
}

/**
 * Marker that records the target scrollTop of a programmatic scroll, so the
 * subsequent `scroll` event can be classified as programmatic (not user).
 *
 * Matches OpenCode's `markAuto`/`isAuto` strategy — the 2px tolerance absorbs
 * sub-pixel layout drift, the 1500ms expiry guards against stale marks if the
 * user starts scrolling well after our last programmatic scroll.
 */
export interface AutoScrollMarker {
  mark: (scrollTop: number, now?: number) => void;
  isAuto: (scrollTop: number, now?: number) => boolean;
  clear: () => void;
}

export function createAutoScrollMarker(): AutoScrollMarker {
  let mark: { top: number; time: number } | undefined;

  return {
    mark(scrollTop: number, now: number = Date.now()): void {
      mark = { top: scrollTop, time: now };
    },
    isAuto(scrollTop: number, now: number = Date.now()): boolean {
      const m = mark;
      if (!m) return false;
      if (now - m.time > AUTO_MARKER_EXPIRY_MS) {
        mark = undefined;
        return false;
      }
      return Math.abs(scrollTop - m.top) <= AUTO_MARKER_SCROLL_TOP_TOLERANCE_PX;
    },
    clear(): void {
      mark = undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useAutoScroll(
  options: UseAutoScrollOptions,
): UseAutoScrollReturn {
  const {
    threshold = 10,
    jumpThreshold = 400,
    stickyPreference,
    onStickyChange,
  } = options;

  // Single source of truth.
  const [isStickyToBottom, setIsStickyToBottom] = useState(
    stickyPreference ?? true,
  );
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [pauseVersion, setPauseVersion] = useState(0);

  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(stickyPreference ?? true);
  const markerRef = useRef(createAutoScrollMarker());
  // Keep the latest onStickyChange callback in a ref so setSticky stays stable
  // even when the consumer passes an inline callback.
  const onStickyChangeRef = useRef(onStickyChange);
  useEffect(() => {
    onStickyChangeRef.current = onStickyChange;
  }, [onStickyChange]);
  /**
   * Timestamp (ms since epoch) until which scroll events should be treated as
   * programmatic regardless of the marker's exact-scrollTop match. Set by
   * `scrollToBottomInternal` to cover smooth-scroll animation frames whose
   * intermediate scrollTop values are far from the final target. Cleared by
   * `handleWheel` on any genuine user wheel-up.
   */
  const programmaticScrollUntilRef = useRef<number>(0);

  // Keep refs in sync with React state so event handlers always read fresh values.
  useEffect(() => {
    stickyRef.current = isStickyToBottom;
  }, [isStickyToBottom]);

  const setSticky = useCallback((next: boolean) => {
    if (stickyRef.current === next) return;
    stickyRef.current = next;
    setIsStickyToBottom(next);
    if (!next) setPauseVersion((v) => v + 1);
    // Notify the consumer so external state (e.g. a persisted atom) can mirror
    // the change. Using a ref keeps this callback effectively stable.
    onStickyChangeRef.current?.(next);
  }, []);

  const getDistanceFromBottom = useCallback((el: HTMLDivElement): number => {
    return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
  }, []);

  // Recompute derived state (isAtBottom, showJump) from current scroll position.
  const syncDerivedState = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const distance = getDistanceFromBottom(el);
    const derived = resolveAutoScrollState(distance, threshold, jumpThreshold);
    setIsAtBottom(derived.isAtBottom);
    setShowJump(derived.showJump);
  }, [getDistanceFromBottom, jumpThreshold, threshold]);

  /**
   * Core programmatic scroll: moves to bottom AND marks the expected scrollTop
   * so the subsequent `scroll` event is classified as programmatic.
   */
  const scrollToBottomInternal = useCallback(
    (behavior: ScrollBehavior, makeSticky: boolean) => {
      const el = scrollElRef.current;
      if (!el) return;
      const targetTop = Math.max(0, el.scrollHeight - el.clientHeight);
      markerRef.current.mark(targetTop);
      // Open a programmatic-scroll window so mid-animation scroll events
      // (whose scrollTop values won't match the final target) are still
      // classified as programmatic. Without this, smooth-scroll frames cause
      // `isAuto()` to return false and `nextStickyStateOnScroll` flips sticky
      // back to false before the animation finishes.
      programmaticScrollUntilRef.current =
        Date.now() + PROGRAMMATIC_SCROLL_WINDOW_MS;
      if (behavior === 'smooth') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        // Bypass any CSS scroll-behavior:smooth.
        el.scrollTop = el.scrollHeight;
      }
      if (makeSticky) setSticky(true);
      // Update derived state on next frame once the browser has processed scroll.
      requestAnimationFrame(() => {
        // Re-mark after layout in case scrollHeight changed between calls
        // (content grew during the frame). Keeps the auto-classifier accurate.
        const el2 = scrollElRef.current;
        if (el2) {
          markerRef.current.mark(
            Math.max(0, el2.scrollHeight - el2.clientHeight),
          );
        }
        syncDerivedState();
      });
    },
    [setSticky, syncDerivedState],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      scrollToBottomInternal(behavior, true);
    },
    [scrollToBottomInternal],
  );

  const forceScrollToBottom = useCallback(() => {
    scrollToBottomInternal('auto', true);
  }, [scrollToBottomInternal]);

  const jumpToBottom = useCallback(() => {
    // Jump button / End key: always force scroll and stick, regardless of state.
    scrollToBottomInternal('smooth', true);
  }, [scrollToBottomInternal]);

  const handleScroll = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const distance = getDistanceFromBottom(el);
    const wasAuto =
      markerRef.current.isAuto(el.scrollTop) ||
      isWithinProgrammaticScrollWindow(programmaticScrollUntilRef.current);
    const nextSticky = nextStickyStateOnScroll({
      prev: stickyRef.current,
      distance,
      threshold,
      wasAuto,
    });
    if (nextSticky !== stickyRef.current) setSticky(nextSticky);
    // Derived state still reflects the raw distance (for the jump button).
    const derived = resolveAutoScrollState(distance, threshold, jumpThreshold);
    setIsAtBottom(derived.isAtBottom);
    setShowJump(derived.showJump);
  }, [getDistanceFromBottom, jumpThreshold, setSticky, threshold]);

  const pause = useCallback(() => {
    setSticky(false);
  }, [setSticky]);

  const resume = useCallback(() => {
    forceScrollToBottom();
  }, [forceScrollToBottom]);

  const handleWheel = useCallback(
    (deltaY: number) => {
      if (!shouldPauseAutoScrollOnWheel(deltaY)) return;
      // User intent to scroll up → clear the auto marker so the upcoming scroll
      // event is classified as user, close the programmatic-scroll window so
      // an in-flight smooth-scroll animation can be cancelled, and flip
      // sticky=false immediately.
      markerRef.current.clear();
      programmaticScrollUntilRef.current = 0;
      setSticky(false);
    },
    [setSticky],
  );

  const reset = useCallback(
    (_channelId?: string | null): void => {
      // channelId is accepted for API compatibility; current impl doesn't use it.
      void _channelId;
      setSticky(true);
      // Scroll after the DOM has a chance to render the new channel's content.
      requestAnimationFrame(() => {
        scrollToBottomInternal('auto', true);
      });
    },
    [scrollToBottomInternal, setSticky],
  );

  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node;
      if (!node) return;
      syncDerivedState();
    },
    [syncDerivedState],
  );

  // External stick-to-bottom preference (Bug 3). When the consumer flips the
  // preference (e.g. via the toggle button or on channel switch), reflect it
  // here. Crucially we only react when the preference *differs* from the
  // current internal sticky state, otherwise we'd loop with `onStickyChange`.
  useEffect(() => {
    if (stickyPreference === undefined) return;
    if (stickyPreference === stickyRef.current) return;
    if (stickyPreference) {
      // Re-engage: sticky=true AND scroll to bottom.
      scrollToBottomInternal('auto', true);
    } else {
      setSticky(false);
    }
  }, [stickyPreference, scrollToBottomInternal, setSticky]);

  return {
    scrollRef,
    isStickyToBottom,
    pinnedToBottom: isStickyToBottom,
    userScrolled: !isStickyToBottom,
    isAtBottom,
    showJump,
    pauseVersion,
    scrollToBottom,
    forceScrollToBottom,
    jumpToBottom,
    pause,
    resume,
    handleScroll,
    handleWheel,
    reset,
  };
}
