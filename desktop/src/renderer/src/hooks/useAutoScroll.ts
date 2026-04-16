import { useCallback, useRef, useState } from 'react';

/**
 * Very simple auto-scroll behavior for chat views.
 *
 * - Stay pinned to bottom by default
 * - Stop pinning when user scrolls away from bottom
 * - Resume pinning when user returns to bottom
 */

export interface UseAutoScrollOptions {
  /** Whether content is actively streaming/updating */
  working: boolean;
  /** Threshold in pixels from bottom to consider "at bottom" (default: 10) */
  threshold?: number;
  /** Jump threshold - show "scroll to bottom" button when this far from bottom */
  jumpThreshold?: number;
}

export interface UseAutoScrollReturn {
  scrollRef: React.RefCallback<HTMLDivElement>;
  pinnedToBottom: boolean;
  userScrolled: boolean;
  isAtBottom: boolean;
  showJump: boolean;
  pauseVersion: number;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  forceScrollToBottom: () => void;
  pause: () => void;
  resume: () => void;
  handleScroll: () => void;
  handleWheel: (deltaY: number) => void;
  reset: (channelId?: string | null) => void;
}

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

export function useAutoScroll(
  options: UseAutoScrollOptions,
): UseAutoScrollReturn {
  const { threshold = 10, jumpThreshold = 400 } = options;

  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [pauseVersion, setPauseVersion] = useState(0);

  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);

  const syncBottomState = useCallback(() => {
    isAtBottomRef.current = true;
    setPinnedToBottom(true);
    setUserScrolled(false);
    setIsAtBottom(true);
    setShowJump(false);
  }, []);

  const getDistanceFromBottom = useCallback((el: HTMLDivElement): number => {
    return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
  }, []);

  const syncStateFromElement = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const distance = getDistanceFromBottom(el);
    const nextState = resolveAutoScrollState(
      distance,
      threshold,
      jumpThreshold,
    );
    isAtBottomRef.current = nextState.isAtBottom;
    setPinnedToBottom(nextState.isAtBottom);
    setIsAtBottom(nextState.isAtBottom);
    setUserScrolled(nextState.userScrolled);
    setShowJump(nextState.showJump);
  }, [getDistanceFromBottom, jumpThreshold, threshold]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = scrollElRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      syncBottomState();
      requestAnimationFrame(syncStateFromElement);
    },
    [syncBottomState, syncStateFromElement],
  );

  const forceScrollToBottom = useCallback(() => {
    scrollToBottom('auto');
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    syncStateFromElement();
  }, [syncStateFromElement]);

  const pause = useCallback(() => {
    isAtBottomRef.current = false;
    setPinnedToBottom(false);
    setUserScrolled(true);
    setIsAtBottom(false);
    setPauseVersion((value) => value + 1);
  }, []);

  const resume = useCallback(() => {
    forceScrollToBottom();
  }, [forceScrollToBottom]);

  const handleWheel = useCallback(
    (deltaY: number) => {
      if (!shouldPauseAutoScrollOnWheel(deltaY)) return;
      pause();
    },
    [pause],
  );

  const reset = useCallback(
    (_channelId?: string | null) => {
      syncBottomState();
      requestAnimationFrame(() => {
        forceScrollToBottom();
      });
    },
    [forceScrollToBottom, syncBottomState],
  );

  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node;
      if (!node) return;
      syncStateFromElement();
    },
    [syncStateFromElement],
  );

  return {
    scrollRef,
    pinnedToBottom,
    userScrolled,
    isAtBottom,
    showJump,
    pauseVersion,
    scrollToBottom,
    forceScrollToBottom,
    pause,
    resume,
    handleScroll,
    handleWheel,
    reset,
  };
}
