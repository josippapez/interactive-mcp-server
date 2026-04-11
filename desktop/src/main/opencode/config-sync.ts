/**
 * Syncs the Interactive MCP Desktop remote entry into the user's global
 * OpenCode config (`~/.config/opencode/opencode.json`).
 *
 * This is the **fallback** connection method. The primary method is dynamic
 * registration via `POST /mcp` (see `opencode-mcp-register.ts`).
 *
 * Called once at app startup (if auto-sync is enabled). It ensures the
 * `interactive-desktop` MCP entry points to the desktop app's HTTP endpoint
 * as a `type: "remote"` server.
 *
 * Only writes when:
 *   1. The config file exists (we never create it from scratch).
 *   2. The existing entry is missing or differs.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const OPENCODE_CONFIG_DIR = join(homedir(), '.config', 'opencode');
const OPENCODE_CONFIG_FILE = join(OPENCODE_CONFIG_DIR, 'opencode.json');

/** Default prompt timeout (seconds) matching defaultSettings.promptTimeoutSeconds. */
const DEFAULT_PROMPT_TIMEOUT_S = 800;

/** Extra buffer (ms) added on top of the prompt timeout for the MCP entry. */
const MCP_TIMEOUT_BUFFER_MS = 60_000;

/**
 * Compute the MCP timeout (ms) for the interactive-desktop entry.
 * Formula: promptTimeoutSeconds * 1000 + buffer.
 */
function computeMcpTimeout(promptTimeoutSeconds: number): number {
  return promptTimeoutSeconds * 1000 + MCP_TIMEOUT_BUFFER_MS;
}

/**
 * Ensure the user's `~/.config/opencode/opencode.json` has an
 * `interactive-desktop` MCP entry pointing to the desktop app's HTTP endpoint,
 * and optionally merges additional MCP server entries from a raw JSON string.
 *
 * @param appPort — the port the desktop app's MCP HTTP server listens on.
 * @param promptTimeoutSeconds — current prompt timeout from settings.
 *   Used to compute the MCP entry timeout dynamically. Defaults to 800s.
 * @param extraMcpServersJson — optional raw JSON string of extra MCP server
 *   entries to include alongside `interactive-desktop`. Must be a JSON object
 *   whose keys are server names and values are MCP server config objects.
 *   If empty or invalid JSON, it is silently ignored.
 * @returns a short status string for logging.
 */
export function syncRemoteConfig(
  appPort: number,
  promptTimeoutSeconds?: number,
  extraMcpServersJson?: string,
): string {
  const mcpTimeout = computeMcpTimeout(
    promptTimeoutSeconds ?? DEFAULT_PROMPT_TIMEOUT_S,
  );

  const desiredUrl = `http://localhost:${appPort}/mcp`;

  if (!existsSync(OPENCODE_CONFIG_FILE)) {
    return 'opencode-config-missing';
  }

  let raw: string;
  try {
    raw = readFileSync(OPENCODE_CONFIG_FILE, 'utf-8');
  } catch {
    return 'read-error';
  }

  // OpenCode config files may contain JS-style comments (// ...).
  // Strip them before parsing JSON.
  const stripped = stripJsonComments(raw);

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stripped);
  } catch {
    return 'parse-error';
  }

  // Ensure mcp section exists
  if (!config.mcp || typeof config.mcp !== 'object') {
    config.mcp = {};
  }

  const mcp = config.mcp as Record<string, unknown>;
  const existing = mcp['interactive-desktop'] as
    | { url?: string; type?: string; timeout?: number; command?: string[] }
    | undefined;

  // Track whether any change is needed
  let needsWrite = false;

  // Remove stale legacy entries if present
  for (const staleKey of ['interactive-bridge']) {
    if (staleKey in mcp) {
      delete mcp[staleKey];
      needsWrite = true;
    }
  }

  // Check if the interactive-desktop entry already matches the desired remote config
  const alreadyCurrent =
    existing &&
    existing.type === 'remote' &&
    existing.url === desiredUrl &&
    existing.timeout === mcpTimeout &&
    !existing.command; // must not be a leftover local entry

  // Parse extra MCP server entries (silently ignore empty/invalid JSON)
  let extraServers: Record<string, unknown> = {};
  if (extraMcpServersJson && extraMcpServersJson.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(extraMcpServersJson);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        extraServers = parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid JSON — ignore
    }
  }

  // Check whether any extra server entries differ from what's on disk
  let extraServersDiffer = false;
  for (const [key, value] of Object.entries(extraServers)) {
    if (JSON.stringify(mcp[key]) !== JSON.stringify(value)) {
      extraServersDiffer = true;
      break;
    }
  }

  if (alreadyCurrent && !needsWrite && !extraServersDiffer) {
    return 'already-current';
  }

  if (!alreadyCurrent) {
    // Write a clean remote entry (replaces any old local/bridge entry)
    mcp['interactive-desktop'] = {
      type: 'remote',
      url: desiredUrl,
      timeout: mcpTimeout,
    };
  }

  // Merge extra server entries (upsert — existing entries with the same key are overwritten)
  for (const [key, value] of Object.entries(extraServers)) {
    mcp[key] = value;
  }

  // Write back. We re-serialize the stripped JSON (comments are lost, which is
  // acceptable since OpenCode configs rarely have user-added comments beyond
  // the defaults).
  try {
    writeFileSync(
      OPENCODE_CONFIG_FILE,
      JSON.stringify(config, null, 2) + '\n',
      'utf-8',
    );
  } catch {
    return 'write-error';
  }

  return 'updated';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip single-line `// ...` comments from JSON-with-comments.
 * Does NOT handle block comments or comments inside strings.
 * Good enough for the simple comment style used in OpenCode configs.
 */
function stripJsonComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Find // that is NOT inside a string
      let inString = false;
      let escaped = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString && ch === '/' && line[i + 1] === '/') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}
