import { basename } from 'path';
import {
  createSessionChannel,
  getRegisteredConnectionBySessionId,
  upsertRegisteredConnection,
} from '../database';
import { autoDetectOpenCodeSession } from '../session';
import { pickUnregisteredConnectionsForCleanup } from '../session/registration-cleanup';
import { invalidateSessionTree } from '../session-tree-service';
import type { AgentBackend } from '../../../settings-core';
import { maybeInjectDbContextOnConnect } from '../tools/db-context-injection';
import type { ProviderType } from '../tools/register-connection';
import type { SessionSummary } from './session-types';
import { createLogger } from '../../../utils/logger';
import { emitToRenderer } from '../renderer-emit';

const log = createLogger('mcp-auto-register');

export const DEFAULT_MAIN_CHANNEL_NAME = 'OpenCode - Main Channel';

function fallbackBaseDirectory(rawCwd: string): string {
  return rawCwd === '/' || rawCwd === ''
    ? (process.env.HOME ?? process.env.USERPROFILE ?? rawCwd)
    : rawCwd;
}

function preferSessionDirectory(
  sessionDirectory: string | undefined,
  fallback: string,
): string {
  return sessionDirectory && sessionDirectory !== '/'
    ? sessionDirectory
    : fallback;
}

export interface AutoRegisterDeps {
  connectionId: string;
  channelName: string;
  providerType: ProviderType;
  getOpenCodePort: () => number;
  getAgentBackend: () => AgentBackend;
  getSessionEntries: () => Promise<SessionSummary[]>;
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
  getOpenCodePort,
  getAgentBackend,
  getSessionEntries,
  cleanupConnection,
}: AutoRegisterDeps): Promise<void> {
  // process.cwd() is '/' when the app is launched from the macOS Dock or at
  // login item, which would cause the doc indexer to traverse the entire
  // filesystem. Fall back to the user's home directory in that case.
  const rawCwd = process.cwd();
  const baseDirectory = fallbackBaseDirectory(rawCwd);
  const projectName = basename(baseDirectory) || 'project';
  const backend = getAgentBackend();
  const openCodeEnabled = backend === 'opencode';

  // Only auto-detect the OpenCode session for the main channel. Subagent
  // channels will call register_connection explicitly with their own session.
  const detected = openCodeEnabled
    ? await autoDetectOpenCodeSession(getOpenCodePort())
    : null;

  if (detected) {
    const detectedBaseDirectory = preferSessionDirectory(
      detected.directory,
      baseDirectory,
    );
    log.info(
      `auto-detected OpenCode session=${detected.id} for connection=${connectionId}`,
    );
    // Look up existing registration (written by the SSE session.created handler)
    const existing = await getRegisteredConnectionBySessionId(
      detected.id,
      'opencode',
    );
    if (existing) {
      upsertRegisteredConnection({
        providerSessionId: detected.id,
        providerType: 'opencode',
        connectionId,
        channelName: existing.channelName ?? channelName,
        projectName: existing.projectName ?? basename(detectedBaseDirectory),
        baseDirectory: preferSessionDirectory(
          detected.directory,
          existing.baseDirectory ?? detectedBaseDirectory,
        ),
        parentSessionId: existing.parentSessionId ?? detected.parentId,
      });
      await createSessionChannel(connectionId, channelName);
      invalidateSessionTree();
      // Re-inject DB-stored skills/instructions on the resume path. OpenCode
      // does not replay MCP `system` injections across resumed steps, so the
      // agent loses any previously injected DB context. The helper de-duplicates
      // per-process to avoid spam on repeated MCP transport reconnects.
      maybeInjectDbContextOnConnect({
        openCodeSessionId: detected.id,
        channelName: existing.channelName ?? channelName,
        projectName: existing.projectName ?? basename(detectedBaseDirectory),
        baseDirectory: preferSessionDirectory(
          detected.directory,
          existing.baseDirectory ?? detectedBaseDirectory,
        ),
        connectionId,
        getOpenCodePort,
      });
      return;
    }
    // Fallback: SSE row not yet written (race or first connect).
    await upsertRegisteredConnection({
      providerSessionId: detected.id,
      providerType: 'opencode',
      connectionId,
      channelName,
      projectName: basename(detectedBaseDirectory) || projectName,
      baseDirectory: detectedBaseDirectory,
      parentSessionId: detected.parentId ?? undefined,
    });
    // First-connect path for a detected OpenCode session (no prior DB row).
    // Inject DB context so root sessions that never call register_connection
    // still receive enabled DB skills/instructions.
    maybeInjectDbContextOnConnect({
      openCodeSessionId: detected.id,
      channelName,
      projectName: basename(detectedBaseDirectory) || projectName,
      baseDirectory: detectedBaseDirectory,
      connectionId,
      getOpenCodePort,
    });
  } else {
    // No OpenCode session detected — use connectionId as a synthetic session
    // ID so non-OpenCode clients continue to work.
    // Use the detected provider type for isolation.
    await upsertRegisteredConnection({
      providerSessionId: connectionId,
      providerType,
      connectionId,
      channelName,
      projectName,
      baseDirectory,
    });
  }

  await createSessionChannel(connectionId, channelName);

  const toCleanup = pickUnregisteredConnectionsForCleanup(
    await getSessionEntries(),
    {
      connectionId,
      channelName,
    },
  );
  for (const staleConnectionId of toCleanup) {
    await cleanupConnection(staleConnectionId);
  }

  if (openCodeEnabled && detected) {
    // An OpenCode session is bound — the session-tree-updated snapshot will
    // create the renderer node via mergeSessionTreeSnapshot. Emitting
    // connection-opened here would create a redundant direct-connection node
    // that the snapshot cannot yet absorb (race). Skip it; the snapshot is
    // sufficient.
    invalidateSessionTree();
  } else {
    // No OpenCode session detected — emit connection-opened so the renderer
    // shows a direct-connection node immediately (classic non-OC path).
    emitToRenderer('connection-opened', {
      connectionId,
      name: channelName,
      sessionId: connectionId,
      label: channelName,
      providerType,
    });
    if (openCodeEnabled) {
      invalidateSessionTree();
    }
  }
}
