import { contextBridge, ipcRenderer } from 'electron';

export type PromptRequest = {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  /** MCP transport handle (optional; not always present on IPC payloads). */
  connectionId?: string;
  connectionName: string;
  timeoutSeconds: number;
  /** Unix ms timestamp when this prompt expires. 0 means no timeout. */
  expiresAt: number;
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
  /** Canonical provider-session identity — the renderer uses this to route
   *  the prompt to the correct channel. */
  providerSessionId?: string | null;
};

export type PromptClearData = {
  id: string;
  /** Optional MCP transport handle (legacy callers may still include this). */
  connectionId?: string;
  providerSessionId?: string | null;
  answer?: string;
  rejected?: boolean;
};

export type Attachment = {
  data: string;
  mimeType: string;
  name: string;
  size: number;
};

export type ConversationRecord = {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  attachments: string | null;
  createdAt: string;
};

export type SessionChannelHistoryRecord = {
  id: number;
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
};

export type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  autoStartOpenCode: boolean;
  autoSyncOpencode: boolean;
  docContextDebug: boolean;
  agentBackend: 'standalone' | 'opencode' | 'claude_sdk';
  autoRegisterSubagents: boolean;
  compactMode: boolean;
  toolAutoExpandExclusions: string[];
  discoveredTools: string[];
  defaultNoReply: boolean;
  defaultExpandAllTools: boolean;
  defaultShowThinking: boolean;
  allowedReadFolders: string[];
  allowedPermissions: string[];
};

export type PendingPermissionRequest = {
  requestId: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  always?: string[];
  tool?: { messageID: string; callID: string };
  metadata?: Record<string, unknown>;
};

export type PendingQuestionRequest = {
  requestId: string;
  sessionID: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
  tool?: { messageID: string; callID: string };
};

export type ProviderActionResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export type ProviderStatus = {
  backend: 'standalone' | 'opencode' | 'claude_sdk';
  effectiveMode: 'standalone' | 'opencode' | 'claude_sdk' | 'standalone_compat';
  supportsSessionHierarchy: boolean;
  supportsProviderInjection: boolean;
  runtime: {
    available: boolean;
    reason?: 'module_not_installed' | 'missing_api_key' | 'init_failed';
    message: string;
  } | null;
};

export type SkillOrInstructionRecord = {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category: string | null;
  tags: string[] | null;
  enabled: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentDefinition = {
  name: string;
  filePath: string;
  scope: 'global' | 'project';
  baseDirectory?: string;
  description: string;
  mode: 'subagent' | 'primary' | string;
  tools: Record<string, boolean>;
  model?: string;
  body: string;
  rawContents: string;
  overridden?: boolean;
};

// ─── Provider Auth Types ─────────────────────────────────────────────────────

export type PromptWhen = {
  key: string;
  op: 'eq' | 'neq';
  value: string;
};

export type TextPrompt = {
  type: 'text';
  key: string;
  message: string;
  placeholder?: string;
  when?: PromptWhen;
};

export type SelectPrompt = {
  type: 'select';
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
  when?: PromptWhen;
};

export type AuthPrompt = TextPrompt | SelectPrompt;

export type AuthMethod = {
  type: 'oauth' | 'api';
  label: string;
  prompts?: AuthPrompt[];
};

export type AuthorizeResult = {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
};

export type McpAuthResult = {
  ok: boolean;
  authorizationUrl?: string;
  status?:
    | 'connected'
    | 'disconnected'
    | 'connecting'
    | 'error'
    | 'needs_auth'
    | 'needs_client_registration';
  error?: string;
};

// ─── Conversation Mirroring Types ─────────────────────────────────────────────

export type ConversationMessageRole = 'user' | 'assistant' | 'system';

export type ConversationPartType =
  | 'text'
  | 'reasoning'
  | 'tool-call'
  | 'tool-result'
  | 'image'
  | 'file'
  | 'step-start'
  | 'step-end'
  | 'compaction'
  | 'source-url'
  | 'unknown';

export type ConversationMessagePart = {
  id: string;
  type: ConversationPartType;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolStatus?: 'pending' | 'running' | 'completed' | 'error';
  /** Tool metadata (for 'tool-call' parts, includes sessionId for Task tools). */
  toolMetadata?: Record<string, unknown>;
  /** Source URL (for 'source-url' parts). */
  sourceUrl?: string;
  /** Source title (for 'source-url' parts). */
  sourceTitle?: string;
  /** Source ID (for 'source-url' parts). */
  sourceId?: string;
  /** File media type (for 'file' parts). */
  mediaType?: string;
  /** File name (for 'file' parts). */
  filename?: string;
  /** File URL (for 'file' parts). */
  fileUrl?: string;
};

export type ConversationMessage = {
  id: string;
  sessionId: string;
  parentId?: string | null;
  role: ConversationMessageRole;
  parts: ConversationMessagePart[];
  modelId?: string;
  providerId?: string;
  agent?: string;
  /** Message mode (e.g., 'compaction' for context compaction summaries). */
  mode?: string;
  /** Reasoning effort variant (e.g., 'low', 'medium', 'high', 'xhigh'). */
  variant?: string;
  createdAt: number;
  completedAt?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    total?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
  cost?: number;
  /** Working directory path info. */
  path?: {
    cwd?: string;
    root?: string;
  };
};

const api = {
  // Prompt handling
  onPromptRequest: (callback: (data: PromptRequest) => void) => {
    ipcRenderer.removeAllListeners('prompt-request');
    ipcRenderer.on('prompt-request', (_event, data) => callback(data));
  },
  onPromptClear: (callback: (data: PromptClearData) => void) => {
    ipcRenderer.removeAllListeners('prompt-clear');
    ipcRenderer.on('prompt-clear', (_event, data) => callback(data));
  },
  sendPromptResponse: (response: {
    id: string;
    answer: string;
    attachments?: Attachment[];
  }) => {
    ipcRenderer.send('prompt-response', response);
  },

  // Intensive chat lifecycle
  onIntensiveChatStart: (
    callback: (data: {
      sessionId: string;
      title: string;
      connectionId: string;
      providerSessionId?: string | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('intensive-chat-start');
    ipcRenderer.on('intensive-chat-start', (_event, data) => callback(data));
  },
  onIntensiveChatStop: (
    callback: (data: {
      sessionId: string;
      connectionId: string;
      providerSessionId?: string | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('intensive-chat-stop');
    ipcRenderer.on('intensive-chat-stop', (_event, data) => callback(data));
  },

  // Session tree — full snapshot of all OpenCode sessions + direct connections.
  // Emitted every ~2 s by session-tree-manager and immediately after
  // register_connection or session removal.
  onSessionTreeUpdated: (
    callback: (
      nodes: {
        providerSessionId: string;
        openCodeParentId: string | null;
        title: string;
        directory: string;
        createdAt: number;
        updatedAt: number;
        depth: number;
        connectionId: string | null;
        channelName: string | null;
        hasMcpChannel: boolean;
        baseDirectory: string | null;
        registeredParentSessionId: string | null;
        providerType:
          | 'opencode'
          | 'copilot-cli'
          | 'claude-sdk'
          | 'standalone'
          | null;
        vcsInfo: {
          branch: string | null;
          additions: number;
          deletions: number;
          files: number;
        } | null;
      }[],
    ) => void,
  ) => {
    ipcRenderer.removeAllListeners('session-tree-updated');
    ipcRenderer.on('session-tree-updated', (_event, data) => callback(data));
  },
  onOptimisticSessionNodeCreated: (
    callback: (node: {
      providerSessionId: string;
      openCodeParentId: string | null;
      title: string;
      directory: string;
      createdAt: number;
      updatedAt: number;
      depth: number;
      connectionId: string | null;
      channelName: string | null;
      hasMcpChannel: boolean;
      baseDirectory: string | null;
      registeredParentSessionId: string | null;
      providerType:
        | 'opencode'
        | 'copilot-cli'
        | 'claude-sdk'
        | 'standalone'
        | null;
      vcsInfo: {
        branch: string | null;
        additions: number;
        deletions: number;
        files: number;
      } | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('session-node-created-optimistic');
    ipcRenderer.on('session-node-created-optimistic', (_event, data) =>
      callback(data),
    );
  },

  // Direct-connection lifecycle — fired when an MCP agent connects/disconnects
  // but has no associated OpenCode session (i.e. it never called register_connection
  // with an openCodeSessionId and OpenCode is not running).
  onConnectionOpened: (
    callback: (data: {
      connectionId: string;
      name: string;
      sessionId?: string;
      label?: string;
      providerType?: 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone';
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('connection-opened');
    ipcRenderer.on('connection-opened', (_event, data) => callback(data));
  },
  onConnectionClosed: (callback: (data: { connectionId: string }) => void) => {
    ipcRenderer.removeAllListeners('connection-closed');
    ipcRenderer.on('connection-closed', (_event, data) => callback(data));
  },
  onChannelLabelUpdated: (
    callback: (data: {
      connectionId: string;
      name: string;
      providerSessionId?: string | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('channel-label-updated');
    ipcRenderer.on('channel-label-updated', (_event, data) => callback(data));
  },

  // History
  getHistory: (): Promise<ConversationRecord[]> =>
    ipcRenderer.invoke('get-history'),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('clear-history'),
  resetDatabase: (): Promise<{
    ok: boolean;
    clearedTables: string[];
    removedIdFiles: number;
  }> => ipcRenderer.invoke('reset-database'),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke('save-settings', settings),
  onSettingsChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('settings-changed', handler);
    return () => {
      ipcRenderer.removeListener('settings-changed', handler);
    };
  },

  // Server status
  getServerStatus: (): Promise<{ running: boolean; port: number }> =>
    ipcRenderer.invoke('get-server-status'),

  // App version
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // Provider backend status/capabilities
  getProviderStatus: (): Promise<ProviderStatus> =>
    ipcRenderer.invoke('get-provider-status'),

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
  }> => ipcRenderer.invoke('resolve-session', { connectionId, baseDirectory }),

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

  // File search for autocomplete
  searchFiles: (baseDirectory: string, query: string): Promise<string[]> =>
    ipcRenderer.invoke('search-files', baseDirectory, query),

  // File dialog and file reading
  openFileDialog: (): Promise<string[]> =>
    ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('open-folder-dialog'),
  readFileForAttachment: (
    filePath: string,
  ): Promise<{
    type: 'image' | 'text';
    data: string;
    mimeType: string;
    name: string;
    size: number;
  } | null> => ipcRenderer.invoke('read-file-for-attachment', filePath),
  saveClipboardAttachment: (
    data: string,
    mimeType: string,
  ): Promise<{
    filename: string;
    absolutePath: string;
    url: string | null;
  } | null> =>
    ipcRenderer.invoke('save-clipboard-attachment', { data, mimeType }),
  forceTerminateChat: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke('force-terminate-chat', connectionId),

  // Pinned projects management
  getPinnedProjects: (): Promise<
    { path: string; name: string; createdAt: string }[]
  > => ipcRenderer.invoke('get-pinned-projects'),
  addPinnedProject: (path: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke('add-pinned-project', { path, name }),
  removePinnedProject: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('remove-pinned-project', path),

  // Return all currently-active prompts so the renderer can recover them on startup.
  getActivePrompts: (): Promise<PromptRequest[]> =>
    ipcRenderer.invoke('get-active-prompts'),
  getPendingPermissions: (): Promise<PendingPermissionRequest[]> =>
    ipcRenderer.invoke('get-pending-permissions'),
  getPendingQuestions: (): Promise<PendingQuestionRequest[]> =>
    ipcRenderer.invoke('get-pending-questions'),
  dismissSession: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke('dismiss-session', connectionId),
  restartMcpServer: (): Promise<boolean> =>
    ipcRenderer.invoke('restart-mcp-server'),
  reconnectMcpServer: (): Promise<{ ok: boolean; cleared: number }> =>
    ipcRenderer.invoke('reconnect-mcp-server'),
  getPersistedSessionChannels: (): Promise<
    {
      sessionId: string;
      label: string | null;
      createdAt: string;
      providerSessionId: string | null;
      parentSessionId: string | null;
    }[]
  > => ipcRenderer.invoke('get-persisted-session-channels'),
  getSessionChannelHistory: (
    sessionId: string,
  ): Promise<SessionChannelHistoryRecord[]> =>
    ipcRenderer.invoke('get-session-channel-history', sessionId),
  clearSessionChannelMessages: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('clear-session-channel-messages', sessionId),
  removeSessionChannel: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('remove-session-channel', sessionId),

  // Session channel — queue a message for the agent (persisted in SQLite)
  queueSessionMessage: (sessionId: string, message: string): void => {
    ipcRenderer.send('queue-session-message', { sessionId, message });
  },

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
  ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> =>
    ipcRenderer.invoke('inject-opencode-message', {
      openCodeSessionId,
      message,
      attachments,
      noReply,
      modelOverride,
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

  // Fired when the agent sends a message via send_message tool
  onAgentMessage: (
    callback: (data: {
      connectionId: string;
      message: string;
      providerSessionId?: string | null;
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('agent-message');
    ipcRenderer.on('agent-message', (_event, data) => callback(data));
  },

  // Fired when POST /api/sessions creates a new channel
  onSessionChannelCreated: (
    callback: (data: { sessionId: string; label?: string }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('session-channel-created');
    ipcRenderer.on('session-channel-created', (_event, data) => callback(data));
  },

  // Fired when DELETE /api/sessions/:sessionId cleans up a channel
  onSessionChannelDeleted: (
    callback: (data: { sessionId: string }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('session-channel-deleted');
    ipcRenderer.on('session-channel-deleted', (_event, data) => callback(data));
  },
  onSessionChannelMessagesCleared: (
    callback: (data: { sessionId: string }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('session-channel-messages-cleared');
    ipcRenderer.on('session-channel-messages-cleared', (_event, data) =>
      callback(data),
    );
  },

  onDatabaseReset: (
    callback: (data: {
      ok: boolean;
      clearedTables: string[];
      removedIdFiles: number;
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('database-reset');
    ipcRenderer.on('database-reset', (_event, data) => callback(data));
  },

  // Agent-pushed status updates
  onSessionStatusUpdate: (
    callback: (data: {
      connectionId: string;
      status: string;
      type: string;
      providerSessionId?: string | null;
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('session-status-update');
    ipcRenderer.on('session-status-update', (_event, data) => callback(data));
  },

  // Permission events from OpenCode bus
  onPermissionAsked: (
    callback: (data: {
      connectionId: string;
      requestId: string;
      sessionID: string;
      directory?: string;
      permission: string;
      patterns?: string[];
      always?: string[];
      tool?: { messageID: string; callID: string };
      metadata?: Record<string, unknown>;
      providerSessionId?: string | null;
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('permission-asked');
    ipcRenderer.on('permission-asked', (_event, data) => callback(data));
  },

  onPermissionReplied: (
    callback: (data: {
      sessionID: string;
      requestID: string;
      reply: 'once' | 'always' | 'reject';
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('permission-replied');
    ipcRenderer.on('permission-replied', (_event, data) => callback(data));
  },

  onQuestionAsked: (
    callback: (
      data: PendingQuestionRequest & {
        connectionId: string;
        providerSessionId?: string | null;
      },
    ) => void,
  ): void => {
    ipcRenderer.removeAllListeners('question-asked');
    ipcRenderer.on('question-asked', (_event, data) => callback(data));
  },

  onQuestionCleared: (
    callback: (data: {
      requestId: string;
      sessionID: string;
      answer?: string;
      rejected?: boolean;
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('question-cleared');
    ipcRenderer.on('question-cleared', (_event, data) => callback(data));
  },

  replyPermission: (
    sessionID: string,
    requestID: string,
    reply: 'once' | 'always' | 'reject',
    directory?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('reply-permission', {
      sessionID,
      requestID,
      reply,
      directory,
    }),
  replyQuestion: (
    requestID: string,
    answers: string[][],
    sessionID: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('reply-question', { requestID, answers, sessionID }),
  rejectQuestion: (
    requestID: string,
    sessionID: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('reject-question', { requestID, sessionID }),

  // Skills & Instructions CRUD
  upsertSkillOrInstruction: (data: {
    name: string;
    type: 'skill' | 'instruction';
    description: string;
    content: string;
    category?: string | null;
    tags?: string[] | null;
  }): Promise<SkillOrInstructionRecord | null> =>
    ipcRenderer.invoke('upsert-skill-or-instruction', data),
  listSkillsAndInstructions: (
    filterType?: 'skill' | 'instruction',
    filterCategory?: string,
  ): Promise<SkillOrInstructionRecord[]> =>
    ipcRenderer.invoke('list-skills-and-instructions', {
      filterType,
      filterCategory,
    }),
  getSkillOrInstruction: (
    name: string,
  ): Promise<SkillOrInstructionRecord | null> =>
    ipcRenderer.invoke('get-skill-or-instruction', name),
  deleteSkillOrInstruction: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('delete-skill-or-instruction', name),
  toggleSkillOrInstructionEnabled: (
    name: string,
    enabled: boolean,
  ): Promise<SkillOrInstructionRecord | null> =>
    ipcRenderer.invoke('toggle-skill-or-instruction-enabled', {
      name,
      enabled,
    }),
  duplicateSkillOrInstruction: (
    name: string,
  ): Promise<SkillOrInstructionRecord | null> =>
    ipcRenderer.invoke('duplicate-skill-or-instruction', name),
  resetBuiltinTemplates: (): Promise<{
    resetCount: number;
    templateNames: string[];
  }> => ipcRenderer.invoke('reset-builtin-templates'),
  getMissingBuiltinCount: (): Promise<{
    missingCount: number;
    totalBuiltins: number;
  }> => ipcRenderer.invoke('get-missing-builtin-count'),
  onSkillsUpdated: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('skills-updated');
    ipcRenderer.on('skills-updated', () => callback());
  },
  exportSkillsMarkdown: (): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export-skills-markdown'),
  exportSingleSkill: (
    name: string,
  ): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export-single-skill', name),

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

  // ─── OpenCode Custom Agents ──────────────────────────────────────────────

  /**
   * List all OpenCode custom agents (global + project-scoped for baseDirectory).
   * Returns project-scoped agents first, then globals. Globals with the same
   * name as a project agent are marked `overridden: true`.
   */
  listAgents: (
    baseDirectory?: string,
  ): Promise<
    { ok: true; data: AgentDefinition[] } | { ok: false; error: string }
  > => ipcRenderer.invoke('list-agents', baseDirectory),

  /**
   * Read a single agent by absolute file path. Returns null if missing.
   */
  readAgent: (
    filePath: string,
  ): Promise<
    { ok: true; data: AgentDefinition | null } | { ok: false; error: string }
  > => ipcRenderer.invoke('read-agent', filePath),

  /**
   * Create or overwrite an agent file.
   * scope='global' → ~/.config/opencode/agent/<name>.md
   * scope='project' → <baseDirectory>/.opencode/agent/<name>.md (baseDirectory required)
   */
  writeAgent: (params: {
    scope: 'global' | 'project';
    baseDirectory?: string;
    name: string;
    description: string;
    mode: string;
    tools: Record<string, boolean>;
    model?: string;
    body: string;
  }): Promise<
    { ok: true; data: { filePath: string } } | { ok: false; error: string }
  > => ipcRenderer.invoke('write-agent', params),

  /**
   * Delete the agent file at the given absolute path. Rejects paths outside
   * the known agent directories.
   */
  deleteAgent: (
    filePath: string,
  ): Promise<{ ok: true; data: null } | { ok: false; error: string }> =>
    ipcRenderer.invoke('delete-agent', filePath),

  // Listen for todo updates (emitted by the main process when todos change)
  onTodosUpdated: (
    callback: (data: {
      sessionId: string;
      todos: {
        content: string;
        status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
        priority: 'high' | 'medium' | 'low';
      }[];
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('todos-updated');
    ipcRenderer.on('todos-updated', (_event, data) => callback(data));
  },

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

  // ─── Global Search ─────────────────────────────────────────────────────────

  searchGlobal: (
    query: string,
    options?: { sessionLimit?: number; messageLimit?: number },
  ): Promise<{
    sessions: {
      sessionId: string;
      channelName: string;
      projectName: string;
      createdAt: string;
      updatedAt: string;
    }[];
    messages: {
      id: number;
      sessionId: string;
      sessionName: string;
      messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
      messageText: string;
      snippet: string;
      createdAt: string;
    }[];
  }> =>
    ipcRenderer.invoke('search-global', {
      query,
      sessionLimit: options?.sessionLimit,
      messageLimit: options?.messageLimit,
    }),

  // ─── SSE Event Listeners (real-time updates from OpenCode) ─────────────────

  /**
   * Real-time todo updates via SSE (todo.updated event)
   * Replaces polling when available
   */
  onOpenCodeTodoUpdated: (
    callback: (data: {
      sessionID: string;
      todos: {
        id: string;
        content: string;
        status: string;
        priority: string;
      }[];
    }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('opencode-todo-updated');
    ipcRenderer.on('opencode-todo-updated', (_event, data) => callback(data));
  },

  /**
   * Real-time VCS branch updates via SSE (vcs.branch.updated event)
   * Replaces polling when available
   */
  onOpenCodeVcsUpdated: (
    callback: (data: { branch: string | null }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('opencode-vcs-updated');
    ipcRenderer.on('opencode-vcs-updated', (_event, data) => callback(data));
  },

  /**
   * Real-time session status updates via SSE (session.status event)
   * Replaces polling when available
   *
   * NOTE: Returns a cleanup function to support multiple subscribers.
   * Each caller should invoke the returned function in their effect cleanup.
   */
  onOpenCodeSessionStatus: (
    callback: (data: { sessionID: string; status: string }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { sessionID: string; status: string },
    ) => callback(data);
    ipcRenderer.on('opencode-session-status', handler);
    return () => {
      ipcRenderer.removeListener('opencode-session-status', handler);
    };
  },

  // ─── Conversation Mirroring ─────────────────────────────────────────────────

  /**
   * Fetch conversation messages for a session.
   * Returns messages from the conversation provider (e.g., OpenCode).
   */
  fetchConversationMessages: (
    sessionId: string,
    limit?: number,
  ): Promise<ConversationMessage[]> =>
    ipcRenderer.invoke('fetch-conversation-messages', { sessionId, limit }),

  /**
   * Check if conversation provider is available.
   */
  isConversationAvailable: (providerId?: string): Promise<boolean> =>
    ipcRenderer.invoke('is-conversation-available', providerId),

  /**
   * Listen for conversation message events (created, updated, completed).
   *
   * NOTE: Returns a cleanup function to support multiple subscribers.
   * Each caller should invoke the returned function in their effect cleanup.
   */
  onConversationMessageEvent: (
    callback: (data: {
      type:
        | 'message.created'
        | 'message.updated'
        | 'message.completed'
        | 'message.removed';
      sessionId: string;
      messageId?: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        type:
          | 'message.created'
          | 'message.updated'
          | 'message.completed'
          | 'message.removed';
        sessionId: string;
        messageId?: string;
      },
    ) => callback(data);
    ipcRenderer.on('conversation-message-event', handler);
    return () => {
      ipcRenderer.removeListener('conversation-message-event', handler);
    };
  },

  /**
   * Listen for conversation part events (added, updated).
   *
   * NOTE: Returns a cleanup function to support multiple subscribers.
   * Each caller should invoke the returned function in their effect cleanup.
   */
  onConversationPartEvent: (
    callback: (data: {
      type: 'part.added' | 'part.updated' | 'part.removed';
      sessionId: string;
      messageId?: string;
      part?: ConversationMessagePart;
      partId?: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        type: 'part.added' | 'part.updated' | 'part.removed';
        sessionId: string;
        messageId?: string;
        part?: ConversationMessagePart;
        partId?: string;
      },
    ) => callback(data);
    ipcRenderer.on('conversation-part-event', handler);
    return () => {
      ipcRenderer.removeListener('conversation-part-event', handler);
    };
  },

  /**
   * Listen for conversation part delta events (streaming text updates).
   *
   * NOTE: Returns a cleanup function to support multiple subscribers.
   * Each caller should invoke the returned function in their effect cleanup.
   */
  onConversationPartDelta: (
    callback: (data: {
      type: 'part.delta';
      sessionId: string;
      messageId: string;
      partId: string;
      deltaField: string;
      deltaValue: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        type: 'part.delta';
        sessionId: string;
        messageId: string;
        partId: string;
        deltaField: string;
        deltaValue: string;
      },
    ) => callback(data);
    ipcRenderer.on('conversation-part-delta', handler);
    return () => {
      ipcRenderer.removeListener('conversation-part-delta', handler);
    };
  },

  // ─── Allowed Read Folders Management ─────────────────────────────────────────

  addAllowedReadFolder: (folderPath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('add-allowed-read-folder', folderPath),

  removeAllowedReadFolder: (folderPath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('remove-allowed-read-folder', folderPath),

  getAllowedReadFolders: (): Promise<string[]> =>
    ipcRenderer.invoke('get-allowed-read-folders'),

  addAllowedPermission: (permission: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('add-allowed-permission', permission),

  removeAllowedPermission: (permission: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('remove-allowed-permission', permission),

  getAllowedPermissions: (): Promise<string[]> =>
    ipcRenderer.invoke('get-allowed-permissions'),

  selectFolderDialog: (): Promise<{ canceled: boolean; folderPath?: string }> =>
    ipcRenderer.invoke('select-folder-dialog'),

  // ─── Context Tracking ─────────────────────────────────────────────────────────

  /**
   * Get current context/token usage for a session.
   */
  getContextUsage: (
    sessionId: string,
  ): Promise<{
    sessionId: string;
    totalTokens: number;
    contextLimit: number;
    usableLimit: number;
    usagePercent: number;
    isNearOverflow: boolean;
    isOverflow: boolean;
    updatedAt: number;
  } | null> => ipcRenderer.invoke('get-context-usage', sessionId),

  /**
   * Trigger context compaction for a session.
   */
  triggerCompaction: (options: {
    sessionId: string;
    providerId?: string;
    modelId?: string;
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('trigger-compaction', options),

  /**
   * Fetch current token count for a session from OpenCode API.
   */
  fetchSessionTokens: (
    sessionId: string,
  ): Promise<{
    id: string;
    tokens?: number;
    modelId?: string;
  } | null> => ipcRenderer.invoke('fetch-session-tokens', sessionId),

  /**
   * Listen for context usage updates (emitted when token counts change).
   */
  onContextUsageUpdated: (
    callback: (data: {
      sessionId: string;
      totalTokens: number;
      contextLimit: number;
      usableLimit: number;
      usagePercent: number;
      isNearOverflow: boolean;
      isOverflow: boolean;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        sessionId: string;
        totalTokens: number;
        contextLimit: number;
        usableLimit: number;
        usagePercent: number;
        isNearOverflow: boolean;
        isOverflow: boolean;
      },
    ) => callback(data);
    ipcRenderer.on('context-usage-updated', handler);
    return () => {
      ipcRenderer.removeListener('context-usage-updated', handler);
    };
  },

  /**
   * Listen for compaction events (emitted when a session is compacted).
   *
   * NOTE: This uses addListener instead of removeAllListeners to support
   * multiple React hooks subscribing to the same event (useConversation +
   * useContextUsage both need this). Returns a cleanup function that removes
   * only this specific listener.
   */
  onSessionCompacted: (
    callback: (data: {
      sessionId: string;
      beforeTokens: number;
      afterTokens: number;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        sessionId: string;
        beforeTokens: number;
        afterTokens: number;
      },
    ) => callback(data);
    ipcRenderer.on('session-compacted', handler);
    return () => {
      ipcRenderer.removeListener('session-compacted', handler);
    };
  },

  // ─── Provider/Model API ─────────────────────────────────────────────────────

  /**
   * Fetch all available providers and their models from OpenCode.
   */
  fetchProviders: (): Promise<
    | {
        id: string;
        name: string;
        models: {
          id: string;
          name: string;
          contextWindow?: number;
          inputLimit?: number;
          outputLimit?: number;
          reasoning?: boolean;
          variants?: string[];
          defaultVariant?: string;
        }[];
      }[]
    | null
  > => ipcRenderer.invoke('fetch-providers'),

  /**
   * Fetch full providers info including connected status.
   * Use this when you need to know which providers are authenticated.
   */
  fetchProvidersInfo: (): Promise<{
    providers: {
      id: string;
      name: string;
      models: {
        id: string;
        name: string;
        contextWindow?: number;
        inputLimit?: number;
        outputLimit?: number;
        reasoning?: boolean;
        variants?: string[];
        defaultVariant?: string;
      }[];
    }[];
    connectedProviderIds: string[];
    defaults: Record<string, string>;
  } | null> => ipcRenderer.invoke('fetch-providers-info'),

  /**
   * Fetch all models from all providers, flattened with provider info.
   */
  fetchModels: (): Promise<
    {
      id: string;
      name: string;
      providerId: string;
      providerName: string;
      contextWindow?: number;
      inputLimit?: number;
      outputLimit?: number;
      reasoning?: boolean;
      variants?: string[];
      defaultVariant?: string;
    }[]
  > => ipcRenderer.invoke('fetch-models'),

  /**
   * Fetch available auth methods for all providers.
   */
  fetchProviderAuthMethods: (): Promise<Record<string, AuthMethod[]> | null> =>
    ipcRenderer.invoke('fetch-provider-auth-methods'),

  /**
   * Start OAuth authorization flow for a provider.
   *
   * @param providerId - The provider to authorize
   * @param method - The auth method index (from fetchProviderAuthMethods)
   * @param inputs - Optional inputs from prompts (for OAuth methods with prompts)
   * @returns Authorization result with URL and method, or null on failure
   */
  authorizeProvider: (
    providerId: string,
    method: number,
    inputs?: Record<string, string>,
  ): Promise<ProviderActionResult<AuthorizeResult>> =>
    ipcRenderer.invoke('authorize-provider', { providerId, method, inputs }),

  /**
   * Complete OAuth callback for a provider.
   *
   * @param providerId - The provider to complete auth for
   * @param method - The auth method index
   * @param code - Optional OAuth code (required for "code" method, not for "auto")
   * @returns true if callback succeeded, false otherwise
   */
  callbackProvider: (
    providerId: string,
    method: number,
    code?: string,
  ): Promise<ProviderActionResult<true>> =>
    ipcRenderer.invoke('callback-provider', { providerId, method, code }),

  /**
   * Set an API key for a provider.
   * This is the "api" auth type flow — user pastes their API key.
   *
   * @param providerId - The provider to set the API key for
   * @param apiKey - The API key to store
   * @returns true if the key was set successfully, false otherwise
   */
  setProviderApiKey: (providerId: string, apiKey: string): Promise<boolean> =>
    ipcRenderer.invoke('set-provider-api-key', { providerId, apiKey }),

  // ─── Slash Command API ────────────────────────────────────────────────────────

  /**
   * Fetch all available slash commands from OpenCode.
   */
  fetchCommands: (): Promise<
    | {
        name: string;
        description: string;
        args: { name: string; description: string; required?: boolean }[];
      }[]
    | null
  > => ipcRenderer.invoke('fetch-commands'),

  /**
   * Execute a slash command in an OpenCode session.
   */
  executeCommand: (
    sessionId: string,
    commandName: string,
    args?: Record<string, string>,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('execute-command', { sessionId, commandName, args }),

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
   *
   * @param name - The MCP server name
   * @param directory - Optional directory context
   */
  connectMcp: (
    name: string,
    directory?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('connect-mcp', { name, directory }),

  /**
   * Disconnect an MCP server.
   *
   * @param name - The MCP server name
   * @param directory - Optional directory context
   */
  disconnectMcp: (
    name: string,
    directory?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('disconnect-mcp', { name, directory }),

  /**
   * Register a new MCP server with OpenCode.
   *
   * @param name - The name for the MCP server
   * @param config - The MCP server configuration
   * @param directory - Optional directory context
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
  authenticateMcp: (name: string, directory?: string): Promise<McpAuthResult> =>
    ipcRenderer.invoke('authenticate-mcp', { name, directory }),

  /**
   * Remove stored MCP OAuth credentials.
   */
  removeMcpAuth: (
    name: string,
    directory?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('remove-mcp-auth', { name, directory }),

  // ─── Renderer Logging ─────────────────────────────────────────────────────
  /**
   * Log a message from the renderer to the main process log file.
   * Use this for routing diagnostics and debugging that need to be persisted.
   *
   * @param level - Log level (debug, info, warn, error)
   * @param category - Category/subsystem name (e.g., 'message-dispatch', 'routing')
   * @param message - The log message
   */
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    category: string,
    message: string,
  ): void => {
    ipcRenderer.send('renderer-log', { level, category, message });
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
