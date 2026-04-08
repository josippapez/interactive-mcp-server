export type Attachment = {
  data: string; // base64 data (no data URL prefix)
  mimeType: string;
  name: string;
  size: number; // bytes
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

export type PromptData = {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
};

export type MessageKind = 'question' | 'answer' | 'outbound' | 'agent_message';

export type ChannelMessage = {
  id: string;
  kind: MessageKind;
  text: string;
  timestamp: Date;
  attachments?: Attachment[];
  /** True once an outbound message has been successfully injected into OpenCode */
  sent?: boolean;
};

export type SessionStatus = {
  status: string;
  type: 'info' | 'working' | 'success' | 'error';
  timestamp: Date;
};

/**
 * Represents one OpenCode session (or a direct MCP connection with no OpenCode
 * session) as shown in the sidebar.
 *
 * Primary key: `openCodeSessionId` for sessions discovered via the OpenCode
 * API, or `connectionId` for "Direct Connections" that have no OpenCode
 * session at all.
 *
 * The renderer uses `openCodeSessionId ?? connectionId` as the map key so both
 * types can live in the same `Map<string, SessionNode>`.
 */
export type SessionNode = {
  /**
   * Stable key for this node.
   * - OpenCode sessions: their OpenCode session ID.
   * - Direct connections (no OpenCode): their MCP connectionId.
   */
  id: string;

  /** OpenCode session ID, or null for direct connections. */
  openCodeSessionId: string | null;

  /** Parent's OpenCode session ID, or null for root/direct-connection nodes. */
  openCodeParentId: string | null;

  /** Human-readable display name (OpenCode title or registered agent name). */
  title: string;

  /** Working directory (from OpenCode or register_connection). */
  directory: string;

  /** 0 = root / top-level agent, >0 = subagent depth. */
  depth: number;

  /** MCP connectionId — set when the agent called register_connection. */
  connectionId: string | null;

  /** Whether this session has an active MCP channel (register_connection was called). */
  hasMcpChannel: boolean;

  /** True when this node represents an MCP agent with no associated OpenCode session. */
  isDirectConnection: boolean;

  /** Active prompt waiting for a response. */
  prompt: PromptData | null;

  /** Active intensive-chat session. */
  activeSession: { id: string; title: string } | null;

  /** baseDirectory for file autocomplete. */
  baseDirectory: string | null;

  /** Persisted + live channel messages for this session. */
  channelMessages: ChannelMessage[];

  /** Count of messages received while this node was not active. */
  unreadCount: number;

  /** True when there is a pending prompt that needs attention. */
  hasPendingPrompt: boolean;

  /** Session channel for the queued-message bar (present when hasMcpChannel). */
  sessionChannel: { sessionId: string; label?: string } | null;

  /** Status badge updates pushed by the agent. */
  sessionStatuses: SessionStatus[];

  /**
   * Per-session toggle for doc context injection.
   * When false, injectDocContext calls are skipped for this session.
   * Defaults to true (undefined = enabled).
   */
  docContextEnabled?: boolean;
};

/**
 * Legacy alias kept so existing callers that still reference `ConnectionState`
 * don't need to be updated all at once.
 * @deprecated Use `SessionNode` directly.
 */
export type ConnectionState = SessionNode;
