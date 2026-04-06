import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const SESSION_FILE = join(tmpdir(), 'imcp-session.json');
// Also write to CWD-based path for repo-local persistence
export const CWD_SESSION_FILE = join(process.cwd(), '.imcp-session');
// Ready-to-use MCP config snippet for OpenCode / other clients
export const MCP_CONFIG_FILE = join(tmpdir(), 'imcp-mcp-config.json');

export function writeSessionFile(
  sessionId: string,
  port: number,
  promptTimeoutMs?: number,
): void {
  const payload: Record<string, unknown> = { sessionId, port };
  if (promptTimeoutMs != null && promptTimeoutMs > 0) {
    payload.promptTimeoutMs = promptTimeoutMs;
  }
  const data = JSON.stringify(payload);
  for (const path of [SESSION_FILE, CWD_SESSION_FILE]) {
    try {
      writeFileSync(path, data, 'utf-8');
    } catch {
      // non-critical
    }
  }
}

/**
 * Write a ready-to-use MCP server config snippet to a well-known location.
 * Users (or the Settings UI) can point to this file or copy its contents
 * into their OpenCode config to connect via the remote HTTP endpoint.
 */
export function writeMcpConfigHint(port: number): void {
  const config: Record<string, unknown> = {};

  // Remote HTTP config — primary connection method
  config['interactive-desktop'] = {
    type: 'remote',
    url: `http://localhost:${port}/mcp`,
  };

  try {
    writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // non-critical
  }
}

export function clearSessionFile(): void {
  for (const path of [SESSION_FILE, CWD_SESSION_FILE]) {
    try {
      unlinkSync(path);
    } catch {
      // non-critical
    }
  }
  // Also clean up the MCP config hint
  try {
    unlinkSync(MCP_CONFIG_FILE);
  } catch {
    // non-critical
  }
}
