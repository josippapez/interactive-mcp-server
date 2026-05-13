import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

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
 *   • jumpToBottom() / End key / channel switch → sticky=true.
 *
 * The key problem this hook solves: track user intent while keeping the DOM
 * scroll container anchored to the bottom during streaming.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Max drift from the marked target still considered "programmatic". */
const AUTO_MARKER_SCROLL_TOP_TOLERANCE_PX = 2;
/** Auto-marker expiry — after this, scroll events are always treated as user. */
const AUTO_MARKER_EXPIRY_MS = 1500;
/** Cover smooth-scroll frames whose intermediate scrollTop differs from target. */
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
  /** Invisible element after the latest rendered message. Preferred bottom anchor. */
  bottomAnchorRef?: React.RefObject<HTMLElement | null>;
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
  /** Pause follow mode only when the user made a real text selection. */
  handleInteraction: () => void;
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

export function isWithinProgrammaticScrollWindow(
  windowUntil: number,
  now: number = Date.now(),
): boolean {
  return windowUntil > 0 && now < windowUntil;
}

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
      const current = mark;
      if (!current) return false;
      if (now - current.time > AUTO_MARKER_EXPIRY_MS) {
        mark = undefined;
        return false;
      }
      return (
        Math.abs(scrollTop - current.top) <= AUTO_MARKER_SCROLL_TOP_TOLERANCE_PX
      );
    },
    clear(): void {
      mark = undefined;
    },
  };
}

export function getProgrammaticScrollTarget(input: {
  bottomAnchor: HTMLElement | null;
  fallbackTop: number;
}):
  | { type: 'anchor'; element: HTMLElement }
  | { type: 'scrollTop'; top: number } {
  if (input.bottomAnchor) {
    return { type: 'anchor', element: input.bottomAnchor };
  }
  return { type: 'scrollTop', top: input.fallbackTop };
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
    bottomAnchorRef,
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
  const programmaticScrollUntilRef = useRef<number>(0);
  // Keep the latest onStickyChange callback in a ref so setSticky stays stable
  // even when the consumer passes an inline callback.
  const onStickyChangeRef = useRef(onStickyChange);
  useEffect(() => {
    onStickyChangeRef.current = onStickyChange;
  }, [onStickyChange]);
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

  const updateOverflowAnchor = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    el.style.overflowAnchor = stickyRef.current ? 'none' : 'auto';
  }, []);

  const scrollToBottomInternal = useCallback(
    (behavior: ScrollBehavior, makeSticky: boolean) => {
      const el = scrollElRef.current;
      if (!el) return;
      const targetTop = Math.max(0, el.scrollHeight - el.clientHeight);
      markerRef.current.mark(targetTop);
      programmaticScrollUntilRef.current =
        Date.now() + PROGRAMMATIC_SCROLL_WINDOW_MS;

      const target = getProgrammaticScrollTarget({
        bottomAnchor: bottomAnchorRef?.current ?? null,
        fallbackTop: el.scrollHeight,
      });
      if (target.type === 'anchor') {
        target.element.scrollIntoView({ block: 'end', behavior });
      } else if (behavior === 'smooth') {
        el.scrollTo({ top: target.top, behavior: 'smooth' });
      } else {
        el.scrollTop = target.top;
      }
      if (makeSticky) setSticky(true);
      requestAnimationFrame(() => {
        const nextEl = scrollElRef.current;
        if (nextEl) {
          markerRef.current.mark(
            Math.max(0, nextEl.scrollHeight - nextEl.clientHeight),
          );
        }
        syncDerivedState();
      });
    },
    [bottomAnchorRef, setSticky, syncDerivedState],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      scrollToBottomInternal(behavior, true);
    },
    [scrollToBottomInternal],
  );

  const jumpToBottom = useCallback(() => {
    scrollToBottomInternal('smooth', true);
  }, [scrollToBottomInternal]);

  const forceScrollToBottom = useCallback(() => {
    scrollToBottomInternal('auto', true);
  }, [scrollToBottomInternal]);

  const handleScroll = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const distance = getDistanceFromBottom(el);
    const nextSticky = nextStickyStateOnScroll({
      prev: stickyRef.current,
      distance,
      threshold,
      wasAuto:
        markerRef.current.isAuto(el.scrollTop) ||
        isWithinProgrammaticScrollWindow(programmaticScrollUntilRef.current),
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
    scrollToBottomInternal('auto', true);
  }, [scrollToBottomInternal]);

  const handleWheel = useCallback(
    (deltaY: number) => {
      if (!shouldPauseAutoScrollOnWheel(deltaY)) return;
      // User intent to scroll up → flip sticky=false immediately.
      markerRef.current.clear();
      programmaticScrollUntilRef.current = 0;
      setSticky(false);
    },
    [setSticky],
  );

  const handleInteraction = useCallback(() => {
    if (!options.working) return;
    const selection = window.getSelection();
    if (!selection || selection.toString().length === 0) return;
    markerRef.current.clear();
    programmaticScrollUntilRef.current = 0;
    setSticky(false);
  }, [options.working, setSticky]);

  const reset = useCallback(
    (_channelId?: string | null): void => {
      // channelId is accepted for API compatibility; current impl doesn't use it.
      void _channelId;
      setSticky(true);
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

  useEffect(() => {
    updateOverflowAnchor();
  }, [isStickyToBottom, updateOverflowAnchor]);

  useLayoutEffect(() => {
    const content = scrollElRef.current?.firstElementChild;
    if (!(content instanceof HTMLElement)) return;

    const observer = new ResizeObserver(() => {
      const el = scrollElRef.current;
      if (!el) return;
      const canScroll = el.scrollHeight - el.clientHeight > 1;
      if (!canScroll) {
        setSticky(true);
        syncDerivedState();
        return;
      }
      if (options.working && stickyRef.current) {
        scrollToBottomInternal('auto', false);
        return;
      }
      syncDerivedState();
    });

    observer.observe(content);

    return () => observer.disconnect();
  }, [options.working, scrollToBottomInternal, setSticky, syncDerivedState]);

  // External stick-to-bottom preference (Bug 3). When the consumer flips the
  // preference (e.g. via the toggle button or on channel switch), reflect it
  // here. Crucially we only react when the preference *differs* from the
  // current internal sticky state, otherwise we'd loop with `onStickyChange`.
  useEffect(() => {
    if (stickyPreference === undefined) return;
    if (stickyPreference === stickyRef.current) return;
    if (stickyPreference) {
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
    handleInteraction,
    reset,
  };
}
