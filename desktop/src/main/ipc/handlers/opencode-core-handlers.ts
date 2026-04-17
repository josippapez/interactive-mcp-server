import { ipcMain } from 'electron';
import { softRestartMcpServer, restartMcpServer } from '../../mcp-server';
import { autoDetectOpenCodeSessionId } from '../../opencode/session';
import { registerMcpAcrossReachablePorts } from '../../opencode/mcp-register';
import { syncRemoteConfig } from '../../opencode/config-sync';
import {
  readGlobalConfig,
  readProjectConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from '../../opencode/config-io';
import { resolveSession, reResolveStaleSession } from '../../session/resolver';
import { IpcHandlerDeps } from './types';
import { logIpcInfo } from './shared';

export function registerOpenCodeCoreHandlers(deps: IpcHandlerDeps): void {
  // Manually trigger MCP registration + config sync into OpenCode
  ipcMain.handle('sync-opencode-config', async () => {
    const settings = deps.getSettings();
    logIpcInfo(`sync-opencode-config: backend=${settings.agentBackend}`);
    if (settings.agentBackend !== 'opencode') {
      return 'skipped: agentBackend is not opencode';
    }
    const regResult = await registerMcpAcrossReachablePorts({
      appPort: settings.port,
      openCodePort: settings.openCodePort,
      promptTimeoutSeconds: settings.promptTimeoutSeconds,
    });
    const syncResult = syncRemoteConfig(
      settings.port,
      settings.promptTimeoutSeconds,
    );
    return `register=${regResult.status}, config=${syncResult}`;
  });

  // ─── OpenCode config file IO ────────────────────────────────────────────────
  // Read/write the global and per-project OpenCode config files from the UI.
  // Writes preserve the `mcp["interactive-desktop"]` managed key.

  ipcMain.handle('read-opencode-global-config', async () => {
    try {
      return readGlobalConfig();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logIpcInfo(`read-opencode-global-config failed: ${message}`);
      throw new Error(message, { cause: err });
    }
  });

  ipcMain.handle(
    'read-opencode-project-config',
    async (_event, baseDirectory: string) => {
      try {
        return readProjectConfig(baseDirectory);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logIpcInfo(`read-opencode-project-config failed: ${message}`);
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.handle(
    'write-opencode-global-config',
    async (_event, config: Record<string, unknown>) => {
      try {
        return writeGlobalConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logIpcInfo(`write-opencode-global-config failed: ${message}`);
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.handle(
    'write-opencode-project-config',
    async (
      _event,
      data: { baseDirectory: string; config: Record<string, unknown> },
    ) => {
      try {
        return writeProjectConfig(data.baseDirectory, data.config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logIpcInfo(`write-opencode-project-config failed: ${message}`);
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.handle(
    'detect-opencode-session',
    async (_event, baseDirectory?: string): Promise<string | null> => {
      return autoDetectOpenCodeSessionId(
        deps.getSettings().openCodePort,
        baseDirectory,
      );
    },
  );

  // Provider-agnostic session resolution: maps connectionId → provider session ID.
  ipcMain.handle(
    'resolve-session',
    async (_event, data: { connectionId: string; baseDirectory?: string }) => {
      logIpcInfo(`resolve-session: connectionId=${data.connectionId}`);
      const settings = deps.getSettings();
      return resolveSession({
        connectionId: data.connectionId,
        backend: settings.agentBackend,
        openCodePort: settings.openCodePort,
        baseDirectory: data.baseDirectory,
      });
    },
  );

  ipcMain.handle(
    're-resolve-session',
    async (_event, data: { connectionId: string; baseDirectory?: string }) => {
      const settings = deps.getSettings();
      return reResolveStaleSession({
        connectionId: data.connectionId,
        backend: settings.agentBackend,
        openCodePort: settings.openCodePort,
        baseDirectory: data.baseDirectory,
      });
    },
  );

  // Soft-restart: clear all in-memory MCP sessions but keep the HTTP listener
  ipcMain.handle('reconnect-mcp-server', async () => {
    logIpcInfo('reconnect-mcp-server: soft restart requested');
    const cleared = await softRestartMcpServer();
    return { ok: true, cleared };
  });

  // Restart the MCP server (reconnect all clients)
  ipcMain.handle('restart-mcp-server', async () => {
    await restartMcpServer();
    return true;
  });
}
