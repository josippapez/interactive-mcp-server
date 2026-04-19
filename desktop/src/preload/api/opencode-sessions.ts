import { ipcRenderer } from 'electron';
import type { Attachment } from './types';

export function createOpenCodeSessionsApi() {
  return {
    // Detect the active OpenCode session on demand (best-effort)
    detectOpenCodeSession: (baseDirectory?: string): Promise<string | null> =>
      ipcRenderer.invoke('detect-opencode-session', baseDirectory),

    // Provider-agnostic session resolution (connectionId -> provider session ID)
    resolveSession: (
      connectionId: string,
      baseDirectory?: string,
    ): Promise<{
      providerSessionId: string | null;
      parentSessionId: string | null;
      resolvedVia: 'cached' | 're-resolved' | 'ambiguous' | 'none';
      message?: string;
    }> =>
      ipcRenderer.invoke('resolve-session', { connectionId, baseDirectory }),

    // Re-resolve a stale session (clears cache, retries once)
    reResolveSession: (
      connectionId: string,
      baseDirectory?: string,
    ): Promise<{
      providerSessionId: string | null;
      parentSessionId: string | null;
      resolvedVia: 'cached' | 're-resolved' | 'ambiguous' | 'none';
      message?: string;
    }> =>
      ipcRenderer.invoke('re-resolve-session', { connectionId, baseDirectory }),

    // Manually re-seed the session tree cache from the OpenCode REST API
    refreshSessionTree: (): Promise<void> =>
      ipcRenderer.invoke('refresh-session-tree'),

    // Fetch todos for an OpenCode session
    fetchSessionTodos: (
      sessionId: string,
    ): Promise<{
      todos:
        | {
            content: string;
            status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
            priority: 'high' | 'medium' | 'low';
          }[]
        | null;
      error?: string;
    }> => ipcRenderer.invoke('fetch-session-todos', sessionId),

    // Abort a running OpenCode session
    abortSession: (
      sessionId: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('abort-session', sessionId),

    // Create a new OpenCode session
    createOpenCodeSession: (options?: {
      title?: string;
      parentID?: string;
      initialMessage?: string;
      baseDirectory?: string;
      attachments?: {
        data: string;
        mimeType: string;
        name: string;
        size: number;
      }[];
      modelSelection?: {
        providerId: string;
        modelId: string;
        variant?: string;
      };
      /**
       * Optional OpenCode agent name (e.g. "build", "plan", "docs-maintainer").
       * Forwarded to `prompt_async` — OpenCode accepts this per-prompt.
       */
      agent?: string;
    }): Promise<{
      ok: boolean;
      sessionId?: string;
      error?: string;
    }> => ipcRenderer.invoke('create-opencode-session', options ?? {}),

    // Check OpenCode server health
    checkOpenCodeHealth: (): Promise<{
      available: boolean;
      healthy: boolean;
      version: string | null;
      error?: string;
    }> => ipcRenderer.invoke('check-opencode-health'),

    // Fetch VCS info from OpenCode
    fetchVcsInfo: (): Promise<{
      branch: string | null;
      defaultBranch: string | null;
    } | null> => ipcRenderer.invoke('fetch-vcs-info'),

    // Fetch session status from OpenCode
    fetchSessionStatus: (): Promise<Record<
      string,
      { type: 'busy' | 'idle' | 'error' | 'unknown' }
    > | null> => ipcRenderer.invoke('fetch-session-status'),

    // Inject a message into an OpenCode session via its HTTP API
    // Set noReply=false to trigger an agent response (default is true for queuing)
    injectOpenCodeMessage: (
      openCodeSessionId: string,
      message: string,
      attachments?: Attachment[],
      noReply = true,
      modelOverride?: {
        providerId: string;
        modelId: string;
        variant?: string;
      },
      /**
       * Optional per-message OpenCode agent override (e.g. 'plan',
       * 'docs-maintainer'). Whitespace-only or empty strings fall back to
       * the session's default agent. The override is ephemeral — it is
       * applied to a single prompt only and is not persisted.
       */
      agent?: string,
    ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> =>
      ipcRenderer.invoke('inject-opencode-message', {
        openCodeSessionId,
        message,
        attachments,
        noReply,
        modelOverride,
        agent,
      }),

    injectClaudeMessage: (
      connectionId: string,
      message: string,
      baseDirectory?: string,
      attachments?: Attachment[],
    ): Promise<{
      ok: boolean;
      sessionId?: string;
      responseText?: string;
      error?: string;
    }> =>
      ipcRenderer.invoke('inject-claude-message', {
        connectionId,
        message,
        baseDirectory,
        attachments,
      }),

    // Inject relevant repository doc context into OpenCode before a user message
    injectDocContext: (
      connectionId: string,
      openCodeSessionId: string | null,
      message: string,
      baseDirectory?: string,
    ): Promise<{ ok: boolean; injectedCount: number; error?: string }> =>
      ipcRenderer.invoke('inject-doc-context', {
        connectionId,
        openCodeSessionId,
        message,
        baseDirectory,
      }),
  };
}
