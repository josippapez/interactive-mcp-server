/**
 * session-messages extension
 *
 * A Copilot CLI extension that injects queued user messages from the
 * Interactive MCP Desktop app as additional context before every tool call.
 *
 * Prerequisites:
 *   - The session-lifecycle hook must be running alongside this extension.
 *     It handles session creation/teardown and writes SESSION_FILE so this
 *     extension can look up the active session ID.
 *   - The Interactive MCP Desktop app must be running on localhost:3100.
 *
 * Lifecycle:
 *   onPreToolUse (before every tool call):
 *     - Reads the session ID from SESSION_FILE (written by the hook)
 *     - Calls GET /api/sessions/:id/messages to fetch unsent queued messages
 *     - The desktop app marks those messages as sent=1 when fetched
 *     - If messages exist, returns { additionalContext } to inject them
 *
 * All network and FS operations fail silently — if the desktop app is not
 * running or the session file doesn't exist nothing breaks.
 *
 * Installation:
 *   Copy this file to .github/extensions/<folder>/extension.mjs in any repo
 *   where you want queued desktop messages injected into Copilot tool calls.
 */

import { joinSession } from '@github/copilot-sdk/extension';
import { readFileSync } from 'node:fs';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3100';
const SESSION_FILE = '/tmp/imcp-session.json';
const FETCH_TIMEOUT_MS = 2000;

// ─── FS helpers ───────────────────────────────────────────────────────────────

function readSessionFile() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Network helpers ──────────────────────────────────────────────────────────

/**
 * Fetches unsent queued messages for the given session.
 * The desktop app marks them as sent=1 on read (idempotent drain).
 *
 * @param {string} id - The session ID to fetch messages for.
 * @returns {Promise<{ messages: Array<{ id: string, message: string, createdAt: string }> } | null>}
 */
async function fetchMessages(id) {
  const response = await fetch(`${BASE_URL}/api/sessions/${id}/messages`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

// ─── Message formatting ───────────────────────────────────────────────────────

/**
 * Formats a messages payload into an additionalContext string.
 * Returns null if there are no messages to inject.
 *
 * @param {{ messages: Array<{ id: string, message: string, createdAt: string }> } | null} data
 * @returns {string | null}
 */
function formatMessages(data) {
  if (!Array.isArray(data?.messages) || data.messages.length === 0) return null;

  const lines = data.messages.map(
    (entry) => `[User message via session channel]: ${entry.message}`,
  );

  return lines.length > 0 ? lines.join('\n') : null;
}

// ─── Extension entry ─────────────────────────────────────────────────────────

await joinSession({
  tools: [],
  hooks: {
    /**
     * Runs before every tool call.
     * Drains any queued desktop messages and injects them as context so the
     * model sees user messages sent through the desktop app's session channel.
     */
    onPreToolUse: async () => {
      try {
        const stored = readSessionFile();
        if (!stored?.sessionId) return;

        const data = await fetchMessages(stored.sessionId);
        const formatted = formatMessages(data);
        if (formatted) {
          return { additionalContext: formatted };
        }
      } catch {
        // Desktop app not running or unreachable — silently skip
      }
    },
  },
});
