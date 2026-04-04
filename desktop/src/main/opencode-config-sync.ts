/**
 * Syncs the Interactive MCP Desktop bridge entry into the user's global
 * OpenCode config (`~/.config/opencode/opencode.json`).
 *
 * Called once at app startup. It ensures the `interactive-desktop` MCP entry
 * always points to the correct bridge path — whether running from source
 * (dev) or from an installed Electron app (production).
 *
 * Only writes when:
 *   1. The config file exists (we never create it from scratch).
 *   2. The bridge script exists on disk.
 *   3. The existing entry is missing or the path differs.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { resolveBridgePath } from './session-file';

const OPENCODE_CONFIG_DIR = join(homedir(), '.config', 'opencode');
const OPENCODE_CONFIG_FILE = join(OPENCODE_CONFIG_DIR, 'opencode.json');

/** Timeout to use for the interactive-desktop MCP entry (ms). */
const MCP_TIMEOUT = 1_210_000;

/**
 * Ensure the user's `~/.config/opencode/opencode.json` has an
 * `interactive-desktop` MCP entry pointing to the current bridge path.
 *
 * Returns a short status string for logging.
 */
export function syncBridgeConfig(): string {
  const bridgePath = resolveBridgePath();
  if (!bridgePath) {
    return 'bridge-not-found';
  }

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
    | { command?: string[]; type?: string; timeout?: number }
    | undefined;

  const desiredCommand = ['node', bridgePath];

  // Check if update is needed
  if (
    existing &&
    existing.type === 'local' &&
    Array.isArray(existing.command) &&
    existing.command.length === 2 &&
    existing.command[0] === 'node' &&
    existing.command[1] === bridgePath
  ) {
    return 'already-current';
  }

  // Update the entry
  mcp['interactive-desktop'] = {
    command: desiredCommand,
    type: 'local',
    timeout: MCP_TIMEOUT,
  };

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
