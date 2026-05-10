import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpResource {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
}

export interface McpServer {
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
  tools?: McpTool[];
  resources?: McpResource[];
  prompts?: McpPrompt[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook to fetch and manage MCP server status for a session.
 *
 * Reads MCP state from the active OpenCode workspace instance on demand rather
 * than polling continuously from the desktop UI.
 */
export function useMcpServers(
  directory?: string,
  enabled = true,
): {
  servers: McpServer[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  connect: (name: string) => Promise<boolean>;
  disconnect: (name: string) => Promise<boolean>;
  authenticate: (name: string) => Promise<boolean>;
  removeAuth: (name: string) => Promise<boolean>;
} {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch MCP status
  const fetchStatus = useCallback(async () => {
    if (!enabled) return;

    let ignoreResult = false;
    const uiTimeout = window.setTimeout(() => {
      ignoreResult = true;
      setError('MCP status request timed out');
    }, 12_000);

    try {
      const result = await window.api.fetchMcpStatus(directory);
      window.clearTimeout(uiTimeout);
      if (ignoreResult) return;
      if (result.ok && result.servers) {
        setServers(result.servers);
        setError(null);
      } else {
        setError(result.error ?? 'Failed to fetch MCP status');
      }
    } catch (err) {
      window.clearTimeout(uiTimeout);
      if (ignoreResult) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [directory, enabled]);

  // Initial fetch
  useEffect(() => {
    if (!enabled) {
      setServers([]);
      return;
    }

    let mounted = true;

    const doFetch = async () => {
      if (!mounted) return;
      setIsLoading(true);
      await fetchStatus();
      if (mounted) setIsLoading(false);
    };

    void doFetch();

    return () => {
      mounted = false;
    };
  }, [enabled, fetchStatus]);

  // Manual refresh
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchStatus();
    setIsLoading(false);
  }, [fetchStatus]);

  // Connect an MCP server
  const connect = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const result = await window.api.connectMcp(name, directory);
        if (result.ok) {
          // Refresh to get updated status
          await fetchStatus();
          return true;
        }
        setError(result.error ?? 'Failed to connect MCP');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [directory, fetchStatus],
  );

  // Disconnect an MCP server
  const disconnect = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const result = await window.api.disconnectMcp(name, directory);
        if (result.ok) {
          // Refresh to get updated status
          await fetchStatus();
          return true;
        }
        setError(result.error ?? 'Failed to disconnect MCP');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [directory, fetchStatus],
  );

  const authenticate = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const result = await window.api.authenticateMcp(name, directory);
        if (result.ok) {
          await fetchStatus();
          setError(null);
          return true;
        }
        setError(result.error ?? 'Failed to authenticate MCP');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [directory, fetchStatus],
  );

  const removeAuth = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const result = await window.api.removeMcpAuth(name, directory);
        if (result.ok) {
          await fetchStatus();
          setError(null);
          return true;
        }
        setError(result.error ?? 'Failed to remove MCP auth');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [directory, fetchStatus],
  );

  return {
    servers,
    isLoading,
    error,
    refresh,
    connect,
    disconnect,
    authenticate,
    removeAuth,
  };
}
