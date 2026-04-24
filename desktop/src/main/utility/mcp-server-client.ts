/**
 * Main-side proxy client for the MCP Express server that now lives in the
 * utility process.
 *
 * Mirrors the APIs originally exposed by `main/mcp-server.ts`. Each function
 * dispatches over the supervisor bridge. The utility starts the Express
 * listener in-process; main only holds these thin proxies so `main/index.ts`
 * can start/stop/soft-restart the server during app lifecycle.
 */

import { getUtilitySupervisor } from './supervisor';

function bridge() {
  return getUtilitySupervisor().getBridge();
}

/** Start the MCP Express server inside the utility process. */
export async function startMcpServer(): Promise<void> {
  await bridge().request<{ ok: boolean; error?: string }>(
    'mcp.server.start',
    {},
  );
}

/** Stop the HTTP listener and tear down all session state. */
export async function stopMcpServer(): Promise<void> {
  try {
    await bridge().request<{ ok: boolean }>('mcp.server.stop', {});
  } catch {
    // Supervisor may already be dead during before-quit — non-fatal.
  }
}

/**
 * Clear all in-memory MCP sessions without stopping the HTTP listener.
 * Returns the number of sessions cleared, or 0 if the server is not running.
 */
export async function softRestartMcpServer(): Promise<number> {
  try {
    const result = await bridge().request<{ cleared: number }>(
      'mcp.server.softRestart',
      {},
    );
    return result?.cleared ?? 0;
  } catch {
    return 0;
  }
}

/** Full stop/start cycle against the utility-owned server. */
export async function restartMcpServer(): Promise<void> {
  await bridge().request<{ ok: boolean }>('mcp.server.restart', {});
}

export async function closeSessionByConnectionId(
  connectionId: string,
): Promise<boolean> {
  try {
    const result = await bridge().request<{ closed: boolean }>(
      'mcp.server.closeSessionByConnectionId',
      { connectionId },
    );
    return result?.closed ?? false;
  } catch {
    return false;
  }
}

export async function getActiveMcpSessionCount(): Promise<number> {
  try {
    const result = await bridge().request<{ count: number }>(
      'mcp.server.activeSessionCount',
      {},
    );
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Mark a providerSessionId as deleted — utility-owned `connection-guard` state. */
export async function markSessionDeleted(
  providerSessionId: string,
): Promise<void> {
  try {
    bridge().emit('mcp.server.markSessionDeleted', { providerSessionId });
  } catch {
    /* non-fatal */
  }
}
