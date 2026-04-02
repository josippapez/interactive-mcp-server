/**
 * interactive-session-messages extension
 *
 * Injects queued Interactive MCP Desktop app messages into the Copilot CLI
 * agent context so the agent stays aware of what the user is typing in the
 * desktop window while it is working.
 *
 * Injection points:
 * - onUserPromptSubmitted: bootstraps the session channel and drains any
 *   messages queued BEFORE the current prompt (fires every user message).
 * - onPostToolUse: drains messages queued BETWEEN tool calls so the agent
 *   sees them in real time during long-running tool loops.
 *
 * Visual feedback:
 * - session.log() via event listeners reports injection counts to the UI.
 *
 * Prerequisites:
 *   - The Interactive MCP Desktop app should be running on localhost:3100.
 *     If it is not running all operations fail silently and nothing breaks.
 *
 * Installation:
 *   Copy this file to .github/extensions/<folder>/extension.mjs in any repo
 *   where you want queued desktop messages injected into Copilot tool calls.
 */

import { joinSession } from '@github/copilot-sdk/extension';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3100';
const PORT = 3100;
const SESSION_FILE = join(tmpdir(), 'imcp-session.json');
const REPO_SESSION_FILE = join(process.cwd(), '.imcp-session');
const SESSION_LOG = join(tmpdir(), 'imcp-session.log');
const FETCH_TIMEOUT_MS = 2000;

/** Consecutive session errors before proactive reconnect. */
const ERROR_THRESHOLD = 2;

// ─── Module-level session state ───────────────────────────────────────────────

let sessionId = null;
let initialized = false;
let consecutiveSessionErrors = 0;

// ─── File logging ─────────────────────────────────────────────────────────────

function log(message) {
  try {
    appendFileSync(
      SESSION_LOG,
      `[${new Date().toISOString()}] ${message}\n`,
      'utf-8',
    );
  } catch {
    // silently ignore
  }
}

log('Extension module loaded');

// ─── FS helpers ───────────────────────────────────────────────────────────────

function readSessionFile() {
  // Try repo-local file first (survives tmp cleanup)
  for (const path of [REPO_SESSION_FILE, SESSION_FILE]) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // continue to next path
    }
  }
  return null;
}

function writeSessionFile(id) {
  const data = JSON.stringify({ sessionId: id, port: PORT });
  for (const path of [SESSION_FILE, REPO_SESSION_FILE]) {
    try {
      writeFileSync(path, data, 'utf8');
    } catch {
      // silently skip
    }
  }
}

// ─── Network helpers ──────────────────────────────────────────────────────────

async function isServerRunning() {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function createSession(id) {
  try {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id, label: 'copilot-cli' }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteSession(id) {
  try {
    await fetch(`${BASE_URL}/api/sessions/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    // silently skip
  }
}

/**
 * Fetches and drains (marks as sent) queued messages for the session.
 * Returns null on 404 or network error.
 */
async function fetchMessages(id) {
  try {
    const res = await fetch(`${BASE_URL}/api/sessions/${id}/messages`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function forceReconnect() {
  try {
    const res = await fetch(`${BASE_URL}/api/reconnect`, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function isSessionError(toolResult) {
  try {
    const text =
      typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    return (
      /session.*(not found|expired|error)/i.test(text) ||
      /\b-?32001\b/.test(text) ||
      /ECONNREFUSED|ECONNRESET|socket hang up/i.test(text)
    );
  } catch {
    return false;
  }
}

// ─── Message formatting ───────────────────────────────────────────────────────

function formatMessages(data) {
  if (!Array.isArray(data?.messages) || data.messages.length === 0) return null;
  const lines = data.messages.map((entry) => {
    const ts = entry.createdAt
      ? new Date(entry.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
    return ts ? `- [${ts}] ${entry.message}` : `- ${entry.message}`;
  });
  return [
    'The user sent the following message(s) via the Interactive MCP Desktop app while you were working:',
    ...lines,
    'Please acknowledge these messages and incorporate any instructions into your current task.',
  ].join('\n');
}

// ─── Session bootstrap ────────────────────────────────────────────────────────

/**
 * Initializes the session channel on the very first hook call.
 *
 * Tries to adopt the server-written connectionId from the session file so the
 * UI and extension share the same ID (messages queued before the first hook
 * are not lost). Returns the initial messages batch to avoid a double-fetch.
 *
 * Falls back to creating a new UUID channel if the file is absent or the
 * channel is no longer alive.
 *
 * When force is true (e.g., on extension reload), always calls POST /api/sessions
 * to re-register the channel with the desktop app so it shows the session.
 */
async function initializeSession({ force = false } = {}) {
  const stored = readSessionFile();

  if (stored?.sessionId) {
    // Re-register the channel with the desktop app on forced init
    if (force) {
      sessionId = stored.sessionId;
      if (await isServerRunning()) {
        await createSession(sessionId);
        log(`FORCE-REGISTERED session channel with desktop: ${sessionId}`);
      }
    }

    const data = await fetchMessages(stored.sessionId ?? sessionId);
    if (data !== null) {
      sessionId = stored.sessionId;
      initialized = true;
      writeSessionFile(sessionId);
      log(
        `ADOPTED server session channel: ${sessionId} (${data.messages.length} queued messages)`,
      );
      return data;
    }
    log(`Session channel gone for ${stored.sessionId} — creating new channel`);
    await deleteSession(stored.sessionId).catch(() => {});
  }

  sessionId = randomUUID();

  if (!(await isServerRunning())) {
    log('Server not reachable — skipping session init');
    return null;
  }

  const created = await createSession(sessionId);
  if (!created) {
    log(`Failed to create session channel: ${sessionId}`);
    return null;
  }

  writeSessionFile(sessionId);
  initialized = true;
  log(`CREATED new session channel: ${sessionId}`);
  return { messages: [] };
}

// ─── Shared drain logic ───────────────────────────────────────────────────────

/**
 * Drains queued messages for the current session, recreating the channel if
 * it has gone away. Returns the messages data (possibly empty) or null.
 */
async function drainMessages() {
  // Proactive reconnect if many consecutive errors.
  if (consecutiveSessionErrors >= ERROR_THRESHOLD) {
    log(
      `${consecutiveSessionErrors} consecutive session errors — force-reconnecting`,
    );
    await forceReconnect();
    await createSession(sessionId);
    consecutiveSessionErrors = 0;
    return { messages: [] };
  }

  const data = await fetchMessages(sessionId);

  if (data === null) {
    log(`Channel gone — recreating: ${sessionId}`);
    const recreated = await createSession(sessionId);
    if (!recreated) return null;
    return { messages: [] };
  }

  return data;
}

// ─── Extension entry ─────────────────────────────────────────────────────────

const session = await joinSession({
  tools: [],
  hooks: {
    /**
     * Fires when the session starts / reconnects.
     * Bootstraps the session channel immediately so messages drain without
     * waiting for the first user prompt.
     */
    onSessionStart: async () => {
      log('onSessionStart fired');
      if (!initialized) {
        try {
          await initializeSession();
          if (initialized) log('Session initialized via onSessionStart hook');
        } catch (err) {
          log(`onSessionStart init error: ${err?.message ?? String(err)}`);
        }
      }
    },

    /**
     * Fires every time the user sends a message.
     * Bootstraps the session channel on the first call, then drains queued
     * desktop messages and injects them as additionalContext.
     */
    onUserPromptSubmitted: async () => {
      log('onUserPromptSubmitted fired');
      try {
        let data;

        if (!initialized) {
          data = await initializeSession();
          if (!initialized) return;
        } else {
          data = await drainMessages();
        }

        const count = data?.messages?.length ?? 0;
        if (count > 0) {
          log(`INJECTING ${count} message(s) via onUserPromptSubmitted`);
        }

        const formatted = formatMessages(data);
        if (formatted) return { additionalContext: formatted };
      } catch (err) {
        log(`onUserPromptSubmitted error: ${err?.message ?? String(err)}`);
      }
    },

    /**
     * Fires before every tool call.
     * Injects any messages queued BEFORE the tool runs so the agent sees
     * them as early as possible.
     */
    onPreToolUse: async () => {
      try {
        if (!initialized) return;

        const data = await drainMessages();
        const count = data?.messages?.length ?? 0;
        if (count > 0) {
          log(`INJECTING ${count} message(s) via onPreToolUse`);
        }

        const formatted = formatMessages(data);
        if (formatted) return { additionalContext: formatted };
      } catch (err) {
        log(`onPreToolUse error: ${err?.message ?? String(err)}`);
      }
    },

    /**
     * Fires after every tool call.
     * Injects any messages the user sent between tool calls so the agent sees
     * them in real time during long-running tool loops.
     * Also tracks consecutive interactive-desktop session errors.
     */
    onPostToolUse: async (input) => {
      try {
        const toolName = input.toolName ?? '';

        // Track session errors from interactive-desktop tools.
        const isDesktopTool =
          toolName.startsWith('interactive-desktop-') ||
          toolName.startsWith('interactive-desktop_');

        if (isDesktopTool) {
          if (isSessionError(input.toolResult)) {
            consecutiveSessionErrors++;
            log(
              `Session error on "${toolName}" (consecutive: ${consecutiveSessionErrors})`,
            );
          } else {
            if (consecutiveSessionErrors > 0)
              log(`"${toolName}" succeeded — resetting error counter`);
            consecutiveSessionErrors = 0;
          }
        }

        // Inject queued messages between tool calls (real-time path).
        if (!initialized) return;

        const data = await drainMessages();
        const count = data?.messages?.length ?? 0;
        if (count > 0) {
          log(
            `INJECTING ${count} message(s) via onPostToolUse after "${toolName}"`,
          );
        }

        const formatted = formatMessages(data);
        if (formatted) return { additionalContext: formatted };
      } catch (err) {
        log(`onPostToolUse error: ${err?.message ?? String(err)}`);
      }
    },
  },
});

// ─── Immediate bootstrap ─────────────────────────────────────────────────────
// Recover session channel on module load so messages are drained immediately.
// Non-blocking: run in background so hook registration is not delayed.
(async () => {
  try {
    const bootstrapData = await initializeSession({ force: true });
    if (initialized) {
      const count = bootstrapData?.messages?.length ?? 0;
      log(`BOOTSTRAP: session adopted on load (${count} queued messages)`);
      // If messages were queued, inject them via session.send() since hooks
      // may not be active yet right after reload.
      const formatted = formatMessages(bootstrapData);
      if (formatted) {
        log(`BOOTSTRAP: injecting ${count} message(s) via session.send()`);
        await session.send({ prompt: formatted });
      }
    } else {
      log('BOOTSTRAP: no session recovered on load — will retry on first hook');
    }
  } catch (err) {
    log(`BOOTSTRAP error: ${err?.message ?? String(err)}`);
  }
})();

// ─── Visual logging via event listeners ──────────────────────────────────────

// Log when user sends a message.
session.on('user.message', async () => {
  const status = initialized
    ? `session active: ${sessionId}`
    : 'session not yet initialized';
  await session.log(`💬 [imcp] User message received — ${status}`, {
    ephemeral: true,
  });
});

// Track toolCallId → toolName for completion events.
const pendingToolNames = new Map();

session.on('tool.execution_start', (event) => {
  const { toolCallId, toolName } = event?.data ?? {};
  if (toolCallId && toolName) pendingToolNames.set(toolCallId, toolName);
});

session.on('tool.execution_complete', async (event) => {
  const { toolCallId } = event?.data ?? {};
  const toolName = pendingToolNames.get(toolCallId) ?? 'unknown';
  if (toolCallId) pendingToolNames.delete(toolCallId);

  // Drain and inject queued messages via session.send() as a fallback
  // when hooks are not active (e.g., after extensions_reload mid-turn).
  if (!initialized || !sessionId) return;
  try {
    const data = await drainMessages();
    const count = data?.messages?.length ?? 0;
    if (count > 0) {
      const formatted = formatMessages(data);
      if (formatted) {
        log(`EVENT: injecting ${count} message(s) via session.send() after "${toolName}"`);
        await session.log(
          `📨 [imcp] Injecting ${count} message(s) from desktop after "${toolName}"`,
          { ephemeral: true },
        );
        await session.send({ prompt: formatted });
      }
    }
  } catch {
    // silently skip
  }
});
