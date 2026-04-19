/**
 * Pure helpers for the ResizeObserver-driven auto-scroll loop in
 * `VirtualizedMessageList`.
 *
 * Background: TanStack Virtual reports `getTotalSize()` from a mix of
 * estimated and measured row heights. When a row is measured *after* our
 * initial `scrollToIndex(last, { align: 'end' })` call (because the actual
 * height differs from `estimateSize`), the total size grows and the scroll
 * container ends up "one row short" of the bottom.
 *
 * We solve this by observing the items wrapper with a ResizeObserver. On
 * every height change, while we're meant to be following output, we re-issue
 * `scrollToIndex(last, …)`. The pure helpers below decide *whether* to
 * re-scroll given the previous and next observed heights — kept pure so the
 * decision logic can be unit-tested without ResizeObserver / DOM.
 */

export interface ResizeRescrollDecisionInput {
  /** Last observed wrapper height (px). `null` on the very first observation. */
  prevHeight: number | null;
  /** Newly observed wrapper height (px). */
  nextHeight: number;
  /** Whether the list is currently meant to follow output to the bottom. */
  isFollowing: boolean;
  /** Number of messages currently rendered. */
  messageCount: number;
}

/**
 * Decide whether a ResizeObserver entry should trigger a re-scroll to bottom.
 *
 * Rules:
 *  - Never re-scroll when the list isn't following output (user has scrolled
 *    away on purpose).
 *  - Never re-scroll when there are no messages.
 *  - Always re-scroll on the first observation while following — this catches
 *    the initial mount where rows are measured after the first paint.
 *  - Otherwise re-scroll only when the height actually changed. A pure no-op
 *    resize (same px) shouldn't cost us a `scrollToIndex` call.
 */
export function shouldRescrollOnResize(
  input: ResizeRescrollDecisionInput,
): boolean {
  if (!input.isFollowing) return false;
  if (input.messageCount === 0) return false;
  if (input.prevHeight === null) return true;
  return input.nextHeight !== input.prevHeight;
}
