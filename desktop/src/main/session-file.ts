import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export const SESSION_FILE = join(tmpdir(), 'imcp-session.json');
// Also write to CWD-based path for repo-local persistence
export const CWD_SESSION_FILE = join(process.cwd(), '.imcp-session');
// Ready-to-use MCP config snippet for OpenCode / other clients
export const MCP_CONFIG_FILE = join(tmpdir(), 'imcp-mcp-config.json');

/**
 * Resolve the path to the bundled desktop-bridge.cjs script.
 *
 * In a packaged Electron app, `process.resourcesPath` points to the
 * platform-specific resources directory where extraResources are placed.
 * In development, we fall back to the source tree location.
 */
export function resolveBridgePath(): string | null {
  // Packaged app: <app>/Contents/Resources/desktop-bridge.cjs
  if (process.resourcesPath) {
    const packaged = join(process.resourcesPath, 'desktop-bridge.cjs');
    if (existsSync(packaged)) return packaged;
  }

  // Dev mode: resolve relative to the repo root
  // __dirname in dev is desktop/src/main (or similar); walk up to repo root
  const devPath = resolve(__dirname, '../../../tools/mcp/desktop-bridge.cjs');
  if (existsSync(devPath)) return devPath;

  return null;
}

export function writeSessionFile(sessionId: string, port: number): void {
  const bridgePath = resolveBridgePath();
  const payload: Record<string, unknown> = { sessionId, port };
  if (bridgePath) {
    payload.bridgePath = bridgePath;
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
 * into their OpenCode config to connect via the stdio bridge.
 *
 * Also writes a direct HTTP config variant for clients that support
 * type: "remote" (like the existing OpenCode setup).
 */
export function writeMcpConfigHint(port: number): void {
  const bridgePath = resolveBridgePath();
  const config: Record<string, unknown> = {};

  // Bridge config (recommended — survives app restarts)
  if (bridgePath) {
    config['interactive-desktop'] = {
      type: 'local',
      command: 'node',
      args: [bridgePath],
    };
  }

  // Direct HTTP config (simpler but requires manual toggle on full app restart)
  config['interactive-desktop-http'] = {
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
