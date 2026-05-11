// Shared types for preload API domain modules.
// These are re-exported from `../index.ts` to preserve the public surface.

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
  chatTextSize: 'sm' | 'md' | 'lg';
  defaultModelId: string;
  defaultProviderId: string;
  defaultReasoningVariant: string;
  hideSystemReminders: boolean;
  hideDocInjections: boolean;
  wrapCodeBlocks: boolean;
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

export type OpenCodeLspStatus = {
  id: string;
  name: string;
  root: string;
  status: 'connected' | 'error';
};

export type OpenCodeFormatterStatus = {
  name: string;
  extensions: string[];
  enabled: boolean;
};

export type OpenCodeSdkStatus = {
  lsp: OpenCodeLspStatus[];
  formatter: OpenCodeFormatterStatus[];
};

export type OpenCodePathInfo = {
  home: string;
  state: string;
  config: string;
  worktree: string;
  directory: string;
};

export type OpenCodeProjectInfo = {
  id: string;
  worktree: string;
  vcs?: 'git';
  name?: string;
  icon?: {
    url?: string;
    override?: string;
    color?: string;
  };
  commands?: { start?: string };
  time: { created: number; updated: number; initialized?: number };
  sandboxes: string[];
};

export type OpenCodeFileStatus = {
  path: string;
  added: number;
  removed: number;
  status: 'added' | 'deleted' | 'modified';
};

export type OpenCodeFileNode = {
  name: string;
  path: string;
  absolute: string;
  type: 'file' | 'directory';
  ignored: boolean;
};

export type OpenCodeUtilitySnapshot = {
  path: OpenCodePathInfo | null;
  project: OpenCodeProjectInfo | null;
  toolIds: string[];
  fileStatus: OpenCodeFileStatus[];
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
  folderId: number | null;
  scope: 'global' | 'session-scoped';
  injectionMode?: 'always' | 'catalog' | null;
  alwaysModeWarning?: string | null;
};

export type NativeOpenCodeSkill = {
  name: string;
  description: string;
  location: string;
  content: string;
};

export type FolderRecord = {
  id: number;
  name: string;
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
  native?: boolean;
  hidden?: boolean;
  editable?: boolean;
};

export type OpenCodeConfigDefaults = {
  model: string | null;
  providerId: string | null;
  modelId: string | null;
  variant: string | null;
  defaultAgentName: string | null;
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
  | 'subtask'
  | 'unknown';

export type ConversationMessagePart = {
  id: string;
  type: ConversationPartType;
  text?: string;
  /** OpenCode marks some text as synthetic/internal; it should not be displayed as user-authored text. */
  synthetic?: boolean;
  /** OpenCode marks ignored text as hidden from prompt context; mirror TUI by hiding it in chat text. */
  ignored?: boolean;
  toolName?: string;
  toolCallId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolStatus?: 'pending' | 'running' | 'completed' | 'error';
  /** Human-readable tool title from OpenCode tool state. */
  toolTitle?: string;
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
  /** Spawned subagent session id (for 'subtask' parts). Authoritative child sessionID from the opencode SDK. */
  subtaskSessionId?: string;
  /** Subagent prompt (for 'subtask' parts). */
  subtaskPrompt?: string;
  /** Subagent short description (for 'subtask' parts). */
  subtaskDescription?: string;
  /** Subagent type/name (for 'subtask' parts). */
  subtaskAgent?: string;
  /** Tool execution start timestamp in ms (for 'tool-call' parts; present when status is running/completed/error). Sourced from SDK ToolState.time.start. */
  toolStartedAt?: number;
  /** Tool execution end timestamp in ms (for 'tool-call' parts; present when status is completed/error). Sourced from SDK ToolState.time.end. */
  toolCompletedAt?: number;
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
  /** Provider finish reason for assistant messages. */
  finish?: string;
  /** User-visible assistant error, if OpenCode reports one. */
  error?: string;
  /** OpenCode assistant error name, e.g. MessageAbortedError. */
  errorName?: string;
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

// ─── Conversation Event Stream (C1 scaffold) ─────────────────────────────────

/**
 * Discriminated union of conversation events emitted by the main-process
 * event-stream and delivered to the renderer in coalesced batches.
 *
 * Modeled after opencode's `event-reducer.ts` handlers (message.updated,
 * message.part.updated, message.removed, session.updated, session.idle,
 * session.error). Kept transport-agnostic so the renderer reducer is pure.
 */
export type ConversationTodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
};

export type ConversationContextUsage = {
  sessionId: string;
  totalTokens: number;
  contextLimit: number;
  usableLimit: number;
  usagePercent: number;
  isNearOverflow: boolean;
  isOverflow: boolean;
};

export type ConversationSessionNextModel = {
  modelId: string;
  providerId: string;
  variant?: string;
};

export type ConversationToolProgressContent =
  | { type: 'text'; text: string }
  | { type: 'file'; uri: string; mime: string; name?: string };

export type ConversationSessionSideChannel = {
  model?: ConversationSessionNextModel;
};

export type ConversationEvent =
  | {
      type: 'message.updated';
      sessionId: string;
      message: ConversationMessage;
    }
  | {
      type: 'message.part.updated';
      sessionId: string;
      messageId: string;
      part: ConversationMessagePart;
    }
  | {
      type: 'message.part.delta';
      sessionId: string;
      messageId: string;
      partId: string;
      field: 'text' | 'reasoning';
      delta: string;
    }
  | {
      type: 'message.part.removed';
      sessionId: string;
      messageId: string;
      partId: string;
    }
  | {
      type: 'message.removed';
      sessionId: string;
      messageId: string;
    }
  | {
      type: 'session.status';
      sessionId: string;
      status: 'idle' | 'streaming' | 'error';
      error?: string;
    }
  | {
      type: 'session.compacted';
      sessionId: string;
      messageId: string;
    }
  // ── C5 additions: merged from legacy orphan IPC channels ──
  | {
      type: 'todo.updated';
      sessionId: string;
      todos: ConversationTodoItem[];
    }
  | {
      type: 'vcs.updated';
      branch: string | null;
    }
  | {
      type: 'context.usage';
      sessionId: string;
      totalTokens: number;
      contextLimit: number;
      usableLimit: number;
      usagePercent: number;
      isNearOverflow: boolean;
      isOverflow: boolean;
    }
  | {
      type: 'session.compaction-done';
      sessionId: string;
      beforeTokens: number;
      afterTokens: number;
    }
  | {
      type: 'session.next.model.switched';
      sessionId: string;
      modelId: string;
      providerId: string;
      variant?: string;
      timestamp: number;
    }
  | {
      type: 'session.next.retried';
      sessionId: string;
      attempt: number;
      error: {
        message: string;
        isRetryable: boolean;
        statusCode?: number;
      };
      timestamp: number;
    }
  | {
      type: 'session.next.compaction.started';
      sessionId: string;
      reason: 'auto' | 'manual';
      timestamp: number;
    }
  | {
      type: 'session.next.compaction.ended';
      sessionId: string;
      include?: string;
      timestamp: number;
    }
  | {
      type: 'session.next.tool.progress';
      sessionId: string;
      callId: string;
      structured: Record<string, unknown>;
      content: ConversationToolProgressContent[];
      timestamp: number;
    }
  | {
      type: 'file.edited';
      directory: string | null;
      file: string;
    }
  // ── Permission / question prompts (previously delivered on legacy
  //    IPC channels `permission-asked`/`permission-replied`/`question-asked`/
  //    `question-cleared`; now routed through the unified conversation-batch
  //    stream so the renderer can react to live OpenCode prompts).
  | {
      type: 'permission.asked';
      sessionId: string;
      requestId: string;
      permission: string;
      patterns?: string[];
      always?: string[];
      tool?: { messageID: string; callID: string };
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'permission.replied';
      sessionId: string;
      requestId: string;
      reply: 'once' | 'always' | 'reject';
    }
  | {
      type: 'question.asked';
      sessionId: string;
      requestId: string;
      questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiple?: boolean;
        custom?: boolean;
      }>;
      tool?: { messageID: string; callID: string };
    }
  | {
      type: 'question.cleared';
      sessionId: string;
      requestId: string;
      /** 'replied' when user answered (may include answer text), 'rejected' when user rejected the prompt. */
      outcome: 'replied' | 'rejected';
    }
  // ── Low-risk additions: forward SDK signals that have no renderer
  //    surface yet but are cheap to expose so future features can consume.
  | {
      type: 'session.diff';
      sessionId: string;
      diff: Array<{
        file: string;
        patch: string;
        additions: number;
        deletions: number;
        status?: 'added' | 'deleted' | 'modified';
      }>;
    }
  | {
      type: 'mcp.tools.changed';
      server: string;
    }
  | {
      type: 'mcp.browser.open.failed';
      mcpName: string;
      url: string;
    }
  | {
      type: 'installation.update-available';
      version: string;
    };

/**
 * A flushed batch of `ConversationEvent` delivered in one IPC message.
 * The main-process `event-stream` coalesces high-frequency updates into
 * ~16ms-spaced batches. `seq` monotonically increases per stream connection
 * so the renderer can detect gaps / reset.
 */
export type ConversationBatch = {
  seq: number;
  events: ConversationEvent[];
  /** Epoch ms of flush on the main side (for perf telemetry). */
  flushedAt: number;
};

// Shared node shape used by session tree events.
export type SessionTreeNode = {
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
  providerType: 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone' | null;
  vcsInfo: {
    branch: string | null;
    additions: number;
    deletions: number;
    files: number;
  } | null;
};
