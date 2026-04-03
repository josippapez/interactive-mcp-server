export type Attachment = {
  data: string; // base64 data (no data URL prefix)
  mimeType: string;
  name: string;
  size: number; // bytes
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

export type ConnectionState = {
  id: string;
  name: string;
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  baseDirectory?: string;
  channelMessages: ChannelMessage[];
  unreadCount: number;
  hasPendingPrompt: boolean;
  sessionChannel: { sessionId: string; label?: string } | null;
  sessionStatuses: SessionStatus[];
  /** True for sessions restored from DB on app startup (no active MCP transport yet) */
  isRestored?: boolean;
  /** OpenCode session ID — when set, messages are also injected via OpenCode's noReply HTTP API */
  openCodeSessionId?: string | null;
  /**
   * OpenCode session ID of the parent session that spawned this subagent.
   * Set when this connection was registered from inside a Task-tool subagent.
   * Used to nest the subagent under its parent in the sidebar.
   */
  parentSessionId?: string | null;
  /**
   * True for auto-detected subagent sessions that have not yet called
   * `register_connection`. The entry is pre-created by the session-tree poller
   * and will be upgraded to a real connection once the agent registers.
   */
  isPlaceholder?: boolean;
};
