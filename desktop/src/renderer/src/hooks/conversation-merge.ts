import type { ConversationMessage } from '../../../preload/index';

/**
 * Merge a freshly fetched batch of messages into the previous list,
 * preserving any previous messages whose IDs are missing from the fetched
 * batch (e.g. older messages dropped when the fetch is capped at N most
 * recent). Messages with the same ID are replaced by the fetched version
 * (authoritative source of truth).
 *
 * Result is sorted ascending by `createdAt` so the view stays chronological
 * after merges.
 *
 * Pure function — no side effects, fully unit-testable.
 */
export function mergeConversationMessages(
  previous: ConversationMessage[],
  fetched: ConversationMessage[],
): ConversationMessage[] {
  if (previous.length === 0) return fetched;
  if (fetched.length === 0) return previous;

  const byId = new Map<string, ConversationMessage>();
  for (const msg of previous) {
    byId.set(msg.id, msg);
  }
  // Fetched overrides previous for matching IDs (authoritative).
  for (const msg of fetched) {
    byId.set(msg.id, msg);
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => a.createdAt - b.createdAt);
  return merged;
}
