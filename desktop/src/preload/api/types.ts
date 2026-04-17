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
