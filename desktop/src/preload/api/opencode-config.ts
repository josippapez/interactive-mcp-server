import { ipcRenderer } from 'electron';

export function createOpenCodeConfigApi() {
  return {
    // Manually trigger OpenCode config sync (register MCP server + update config file)
    syncOpencodeConfig: (): Promise<string> =>
      ipcRenderer.invoke('sync-opencode-config'),

    // ─── OpenCode config file IO (read/write global + per-project configs) ────
    // Writes preserve the `mcp["interactive-desktop"]` managed subtree; callers
    // should not attempt to change it. Comments in .jsonc/.json files are stripped
    // on read (block, line, and string-internal `//` limitations documented in
    // config-sync.ts). Reads return `{ exists:false, config:null }` when absent.

    readOpenCodeGlobalConfig: (): Promise<{
      exists: boolean;
      config: Record<string, unknown> | null;
      filePath: string;
    }> => ipcRenderer.invoke('read-opencode-global-config'),

    readOpenCodeProjectConfig: (
      baseDirectory: string,
    ): Promise<{
      exists: boolean;
      config: Record<string, unknown> | null;
      filePath: string;
    }> => ipcRenderer.invoke('read-opencode-project-config', baseDirectory),

    writeOpenCodeGlobalConfig: (
      config: Record<string, unknown>,
    ): Promise<{ filePath: string }> =>
      ipcRenderer.invoke('write-opencode-global-config', config),

    writeOpenCodeProjectConfig: (
      baseDirectory: string,
      config: Record<string, unknown>,
    ): Promise<{ filePath: string }> =>
      ipcRenderer.invoke('write-opencode-project-config', {
        baseDirectory,
        config,
      }),
  };
}
