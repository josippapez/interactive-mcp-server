import { basename } from 'path';
import type { BrowserWindow } from 'electron';
import {
  createSessionChannel,
  getRegisteredConnectionBySessionId,
  updateConnectionId,
  upsertRegisteredConnection,
} from '../database';
import { autoDetectOpenCodeSession } from '../opencode/session';
import { pickUnregisteredConnectionsForCleanup } from '../session/registration-cleanup';
import { triggerSessionTreeUpdate } from '../session/tree-manager';
import type { AgentBackend } from '../settings';
import type { ProviderType } from '../tools/register-connection';
import type { SessionSummary } from './session-types';

export const DEFAULT_MAIN_CHANNEL_NAME = 'OpenCode - Main Channel';

export interface AutoRegisterDeps {
  connectionId: string;
  channelName: string;
  providerType: ProviderType;
  getWindow: () => BrowserWindow | null;
  getOpenCodePort: () => number;
  getAgentBackend: () => AgentBackend;
  getSessionEntries: () => SessionSummary[];
  cleanupConnection: (connectionId: string) => Promise<boolean>;
}

/**
 * Auto-register a default connection when a new MCP session initializes.
 * Binds the connection to an OpenCode session when one is detected; otherwise
 * falls back to using the connection ID as a synthetic provider session ID.
 */
export async function autoRegisterDefaultConnection({
  connectionId,
  channelName,
  providerType,
  getWindow,
  getOpenCodePort,
  getAgentBackend,
  getSessionEntries,
  cleanupConnection,
}: AutoRegisterDeps): Promise<void> {
  // process.cwd() is '/' when the app is launched from the macOS Dock or at
  // login item, which would cause the doc indexer to traverse the entire
  // filesystem. Fall back to the user's home directory in that case.
  const rawCwd = process.cwd();
  const baseDirectory =
    rawCwd === '/' || rawCwd === ''
      ? (process.env.HOME ?? process.env.USERPROFILE ?? rawCwd)
      : rawCwd;
  const projectName = basename(baseDirectory) || 'project';
  const backend = getAgentBackend();
  const openCodeEnabled = backend === 'opencode';

  // Only auto-detect the OpenCode session for the main channel. Subagent
  // connections ALWAYS call register_connection explicitly with their own
  // openCodeSessionId so we do not auto-detect for them here.
  const isMainChannel = channelName === DEFAULT_MAIN_CHANNEL_NAME;
  let detected: Awaited<ReturnType<typeof autoDetectOpenCodeSession>> = null;
  if (openCodeEnabled && isMainChannel) {
    try {
      detected = await autoDetectOpenCodeSession(
        getOpenCodePort(),
        baseDirectory,
      );
    } catch {
      // non-critical: still register defaults without a session binding
    }
  }

  if (detected) {
    // Phase 2: providerSessionId with composite PK. The SSE handler may have
    // already written the row (via autoRegisterSession). If so, just bind
    // this MCP transport's connectionId to the existing row.
    const existing = getRegisteredConnectionBySessionId(
      detected.id,
      'opencode',
    );
    if (existing) {
      updateConnectionId(detected.id, connectionId, 'opencode');
      createSessionChannel(connectionId, channelName);
      void triggerSessionTreeUpdate(getWindow);
      return;
    }
    // Fallback: SSE row not yet written (race or first connect).
    upsertRegisteredConnection({
      providerSessionId: detected.id,
      providerType: 'opencode',
      connectionId,
      channelName,
      projectName,
      baseDirectory,
      parentSessionId: detected.parentId ?? undefined,
    });
  } else {
    // No OpenCode session detected — use connectionId as a synthetic session
    // ID so non-OpenCode clients continue to work.
    // Use the detected provider type for isolation.
    upsertRegisteredConnection({
      providerSessionId: connectionId,
      providerType,
      connectionId,
      channelName,
      projectName,
      baseDirectory,
    });
  }

  createSessionChannel(connectionId, channelName);

  const toCleanup = pickUnregisteredConnectionsForCleanup(getSessionEntries(), {
    connectionId,
    channelName,
  });
  for (const staleConnectionId of toCleanup) {
    await cleanupConnection(staleConnectionId);
  }

  if (openCodeEnabled && detected) {
    // An OpenCode session is bound — the session-tree-updated snapshot will
    // create the renderer node via mergeSessionTreeSnapshot. Emitting
    // connection-opened here would create a redundant direct-connection node
    // that the snapshot cannot yet absorb (race). Skip it; the snapshot is
    // sufficient.
    void triggerSessionTreeUpdate(getWindow);
  } else {
    // No OpenCode session detected — emit connection-opened so the renderer
    // shows a direct-connection node immediately (classic non-OC path).
    getWindow()?.webContents.send('connection-opened', {
      connectionId,
      name: channelName,
      sessionId: connectionId,
      label: channelName,
      providerType,
    });
    if (openCodeEnabled) {
      void triggerSessionTreeUpdate(getWindow);
    }
  }
}
