import type { UnifiedMessage } from '../../../types/unified-message';

/**
 * Pure deterministic signature of "scrollable content state" for the
 * virtualized message list.
 *
 * The signature changes exactly when the content that matters for auto-scroll
 * changes:
 *   - messages.length (new message appended or backfill loaded)
 *   - the streaming tail message's text length (characters streamed in)
 *   - the streaming tail message's reasoning length (reasoning streamed in)
 *
 * This replaces the previous racy dual-driver setup (MutationObserver +
 * totalSize effect) with a single React-commit-time signal. Using it as an
 * effect key guarantees exactly one auto-scroll attempt per content change,
 * and React's effect scheduling guarantees it runs AFTER the DOM has been
 * committed — so `scrollToIndex(last)` always targets the freshest layout.
 *
 * Pure, trivially unit-testable, no DOM access.
 */
export function computeAutoScrollSignature(messages: UnifiedMessage[]): string {
  const count = messages.length;
  if (count === 0) return '0|';

  // Scan backward for the last assistant 'conversation' message — that's the
  // streaming target. If the tail isn't a streamer, fall back to the tail
  // message's own text size so backfills / user messages still trigger a
  // scroll.
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.source === 'conversation' && m.role === 'assistant') {
      const textLen = m.text?.length ?? 0;
      const reasoningLen = m.reasoning?.length ?? 0;
      return `${count}|${m.id}|${textLen}|${reasoningLen}`;
    }
    // First non-empty tail that isn't the streaming assistant — use its size.
    const textLen = m.text?.length ?? 0;
    return `${count}|${m.id}|${textLen}|0`;
  }

  return `${count}|`;
}
