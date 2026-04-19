/**
 * Pure helper: given the current conversation messages for a session,
 * return the agent name that was used on the most recent assistant turn.
 *
 * Background:
 *   When the user loads an existing OpenCode session (clicks it in the
 *   sidebar), the bottom-bar agent selector is driven by
 *   `sessionAgentsAtom`, which is in-memory only and starts empty on every
 *   app start. Without this helper, the selector flips to "default" even
 *   when the session has been running under a specific custom agent for a
 *   while, and the very next prompt silently routes to the default agent
 *   (`build`) instead of the one the user has been iterating with.
 *
 *   OpenCode stamps the agent onto each assistant `ConversationMessage`
 *   via its `agent` field (set from the per-turn `mode` on the LLM side).
 *   We scan the messages in reverse and return the first non-empty agent
 *   we find on an assistant message.
 *
 * Notes:
 *   - We intentionally only look at `role === 'assistant'` messages. The
 *     agent on a user message reflects the mode requested for that turn,
 *     but OpenCode doesn't always populate it on user rows, and the
 *     assistant row is always stamped when a run completes.
 *   - We scan from the end so this is O(1) for the typical case where the
 *     last message is an assistant message.
 *   - Empty strings and whitespace-only agent names are treated as
 *     "unknown" — we keep scanning. This matches `setSessionAgentAtom`'s
 *     normalisation, so the two stay consistent.
 */

export interface DeriveSessionAgentMessage {
  role: 'user' | 'assistant' | 'system';
  agent?: string;
}

export function deriveSessionAgentFromConversation(
  messages: readonly DeriveSessionAgentMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;
    const trimmed = msg.agent?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}
