import { ipcRenderer } from 'electron';
import type { McpAuthResult } from './types';

export function createMcpApi() {
  return {
    restartMcpServer: (): Promise<boolean> =>
      ipcRenderer.invoke('restart-mcp-server'),
    reconnectMcpServer: (): Promise<{ ok: boolean; cleared: number }> =>
      ipcRenderer.invoke('reconnect-mcp-server'),

    // ─── MCP Status API ─────────────────────────────────────────────────────────

    /**
     * Fetch the status of all MCP servers from OpenCode.
     *
     * @param directory - Optional directory context for project-specific MCPs
     * @returns Status of all MCP servers including tools, resources, and prompts
     */
    fetchMcpStatus: (
      directory?: string,
    ): Promise<{
      ok: boolean;
      servers?: Array<{
        name: string;
        type: 'local' | 'remote';
        status:
          | 'connected'
          | 'disconnected'
          | 'connecting'
          | 'error'
          | 'needs_auth'
          | 'needs_client_registration';
        error?: string;
        url?: string;
        command?: string[];
        environmentKeys?: string[];
        tools?: Array<{ name: string; description?: string }>;
        resources?: Array<{
          name: string;
          uri: string;
          description?: string;
          mimeType?: string;
        }>;
        prompts?: Array<{ name: string; description?: string }>;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('fetch-mcp-status', { directory }),

    /**
     * Connect or reconnect an MCP server.
     */
    connectMcp: (
      name: string,
      directory?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('connect-mcp', { name, directory }),

    /**
     * Disconnect an MCP server.
     */
    disconnectMcp: (
      name: string,
      directory?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('disconnect-mcp', { name, directory }),

    /**
     * Register a new MCP server with OpenCode.
     */
    registerMcp: (
      name: string,
      config: {
        type: 'local' | 'remote';
        url?: string;
        command?: string[];
        environment?: Record<string, string>;
        timeout?: number;
      },
      directory?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('register-mcp', { name, config, directory }),

    /**
     * Start an MCP OAuth flow and return the authorization URL.
     */
    startMcpAuth: (name: string, directory?: string): Promise<McpAuthResult> =>
      ipcRenderer.invoke('start-mcp-auth', { name, directory }),

    /**
     * Complete an MCP OAuth callback with an authorization code.
     */
    callbackMcpAuth: (
      name: string,
      code: string,
      directory?: string,
    ): Promise<McpAuthResult> =>
      ipcRenderer.invoke('callback-mcp-auth', { name, code, directory }),

    /**
     * Let OpenCode run the full MCP OAuth flow, including browser open/callback.
     */
    authenticateMcp: (
      name: string,
      directory?: string,
    ): Promise<McpAuthResult> =>
      ipcRenderer.invoke('authenticate-mcp', { name, directory }),

    /**
     * Remove stored MCP OAuth credentials.
     */
    removeMcpAuth: (
      name: string,
      directory?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('remove-mcp-auth', { name, directory }),

    // ─── Slash Command API ────────────────────────────────────────────────────────

    /**
     * Fetch all available slash commands from OpenCode.
     *
     * @param baseDirectory Optional project directory to scope the command
     *   lookup. Pass the active session's baseDirectory so project-local
     *   commands resolve correctly.
     */
    fetchCommands: (
      baseDirectory?: string,
    ): Promise<
      | {
          name: string;
          description: string;
          args: { name: string; description: string; required?: boolean }[];
        }[]
      | null
    > => ipcRenderer.invoke('fetch-commands', baseDirectory),

    /**
     * Execute a slash command in an OpenCode session.
     *
     * @param baseDirectory Optional project directory to scope the command
     *   execution (for project-local commands).
     */
    executeCommand: (
      sessionId: string,
      commandName: string,
      args?: Record<string, string>,
      baseDirectory?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('execute-command', {
        sessionId,
        commandName,
        args,
        baseDirectory,
      }),
  };
}
