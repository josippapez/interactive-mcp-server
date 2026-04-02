/**
 * session-lifecycle hook
 *
 * A Copilot CLI hook that manages the interactive-mcp-server session channel
 * shared between all extensions in a Copilot session.
 *
 * Lifecycle:
 *   onSessionStart:
 *     - Generates a UUID session ID (distinct from Copilot's own session ID)
 *     - Writes { sessionId, port } to SESSION_FILE so extensions can read it
 *     - Registers the session via POST /api/sessions on the desktop app
 *
 *   onSessionEnd:
 *     - Reads SESSION_FILE to recover the session ID
 *     - Calls DELETE /api/sessions/:id to remove the session from the DB
 *     - Removes SESSION_FILE
 *
 * SIGTERM / SIGINT handlers mirror onSessionEnd so cleanup runs even on
 * abrupt termination.
 *
 * All network and FS operations fail silently — if the Interactive MCP
 * Desktop app is not running nothing breaks.
 *
 * Installation:
 *   Copy this file to .github/hooks/session-lifecycle.mjs in any repo
 *   where you want the Copilot CLI to manage session channels automatically.
 */

import { CopilotClient } from '@github/copilot-sdk';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3100';
const PORT = 3100;
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

function writeSessionFile(data) {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(data), 'utf8');
  } catch {
    // silently skip — desktop app may not be running
  }
}

function deleteSessionFile() {
  try {
    unlinkSync(SESSION_FILE);
  } catch {
    // silently skip — file may not exist
  }
}

// ─── Network helpers ──────────────────────────────────────────────────────────

/**
 * Registers a new session channel in the desktop app's SQLite database.
 * @param {string} id - The session ID to register.
 */
async function registerSession(id) {
  await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: id, label: 'Copilot Session' }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * Deletes a session and all its queued messages from the desktop app.
 * @param {string} id - The session ID to delete.
 */
async function unregisterSession(id) {
  await fetch(`${BASE_URL}/api/sessions/${id}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
  try {
    const stored = readSessionFile();
    if (stored?.sessionId) {
      await unregisterSession(stored.sessionId);
    }
  } catch {
    // silently skip
  } finally {
    deleteSessionFile();
  }
}

// ─── Hook registration ────────────────────────────────────────────────────────

const client = new CopilotClient();
await client.start();

await client.createSession({
  hooks: {
    /**
     * Runs when the Copilot CLI session starts.
     * Creates a session channel and writes the session ID to disk so that
     * the session-messages extension can read it without re-generating.
     *
     * @param {object} input - Session start input from the Copilot SDK.
     * @param {object} invocation - Contains invocation.sessionId from Copilot.
     */
    onSessionStart: async (input, invocation) => {
      try {
        const sessionId = randomUUID();
        writeSessionFile({ sessionId, port: PORT });
        await registerSession(sessionId);
      } catch {
        // Desktop app not running — silently skip
      }
    },

    /**
     * Runs when the Copilot CLI session ends (normal exit).
     * Cleans up the session channel and removes the session file.
     *
     * @param {object} input - Session end input from the Copilot SDK.
     * @param {object} invocation - Contains invocation.sessionId from Copilot.
     */
    onSessionEnd: async (input, invocation) => {
      await cleanup();
    },
  },

  onPermissionRequest: async () => ({ kind: 'approved' }),
});

// ─── Signal handlers ──────────────────────────────────────────────────────────

// sync-only: just remove the file (async DELETE not possible in 'exit')
process.on('exit', () => {
  deleteSessionFile();
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});
