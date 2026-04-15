/**
 * Conversation mirroring types.
 *
 * Abstract types for mirroring conversations from various AI providers
 * (OpenCode, Claude SDK, etc.) into the desktop app.
 */

/**
 * Role of the message sender.
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Type of message content part.
 */
export type PartType =
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

/**
 * A single part of a message (text, tool call, image, etc.).
 */
export interface MessagePart {
  id: string;
  type: PartType;
  /** Text content (for 'text' and 'reasoning' parts). */
  text?: string;
  /** Tool name (for 'tool-call' parts). */
  toolName?: string;
  /** Tool call ID (for 'tool-call' and 'tool-result' parts). */
  toolCallId?: string;
  /** Tool input (for 'tool-call' parts). */
  toolInput?: Record<string, unknown>;
  /** Tool output (for 'tool-result' parts). */
  toolOutput?: string;
  /** Tool status (for 'tool-call' parts). */
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
  /** Raw provider-specific data. */
  raw?: unknown;
}

/**
 * A single message in a conversation.
 */
export interface ConversationMessage {
  /** Unique message ID. */
  id: string;
  /** Session/conversation ID this message belongs to. */
  sessionId: string;
  /** Parent message ID (for threaded conversations). */
  parentId?: string | null;
  /** Role of the sender. */
  role: MessageRole;
  /** Message content parts. */
  parts: MessagePart[];
  /** Model ID used to generate the message (for assistant messages). */
  modelId?: string;
  /** Provider ID (e.g., 'github-copilot', 'anthropic'). */
  providerId?: string;
  /** Agent name/mode (e.g., 'build', 'plan'). */
  agent?: string;
  /** Message mode (e.g., 'compaction' for context compaction summaries). */
  mode?: string;
  /** Reasoning effort variant (e.g., 'low', 'medium', 'high', 'xhigh'). */
  variant?: string;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Completion timestamp (ms since epoch). */
  completedAt?: number;
  /** Token usage statistics. */
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
  /** Cost in USD. */
  cost?: number;
  /** Working directory path info. */
  path?: {
    cwd?: string;
    root?: string;
  };
}

/**
 * Event types emitted by conversation providers.
 */
export type ConversationEventType =
  | 'message.created'
  | 'message.updated'
  | 'message.completed'
  | 'message.deleted'
  | 'part.added'
  | 'part.updated'
  | 'part.delta';

/**
 * Event emitted by a conversation provider.
 */
export interface ConversationEvent {
  type: ConversationEventType;
  sessionId: string;
  message?: ConversationMessage;
  part?: MessagePart;
  messageId?: string;
  /** For part.delta events: the field being updated (e.g., 'text'). */
  deltaField?: string;
  /** For part.delta events: the delta text to append. */
  deltaValue?: string;
  /** For part.delta events: the part ID being updated. */
  partId?: string;
}

/**
 * Callback for conversation events.
 */
export type ConversationEventCallback = (event: ConversationEvent) => void;

/**
 * Abstract interface for conversation providers.
 *
 * Implement this interface to add support for mirroring conversations
 * from a new AI provider (e.g., Claude SDK, Gemini, etc.).
 */
export interface ConversationProvider {
  /** Provider identifier (e.g., 'opencode', 'claude-sdk'). */
  readonly providerId: string;

  /** Whether this provider supports real-time streaming. */
  readonly supportsStreaming: boolean;

  /**
   * Fetch message history for a session.
   * @param sessionId - The session ID to fetch messages for.
   * @param limit - Maximum number of messages to fetch.
   * @returns Array of messages, newest first.
   */
  fetchMessages(
    sessionId: string,
    limit?: number,
  ): Promise<ConversationMessage[]>;

  /**
   * Subscribe to real-time conversation events.
   * @param sessionId - The session ID to subscribe to (or null for all sessions).
   * @param callback - Callback invoked for each event.
   * @returns Unsubscribe function.
   */
  subscribe(
    sessionId: string | null,
    callback: ConversationEventCallback,
  ): () => void;

  /**
   * Check if this provider is available/connected.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Start the provider (connect to APIs, start SSE subscriptions, etc.).
   */
  start(): Promise<void>;

  /**
   * Stop the provider (disconnect, cleanup resources).
   */
  stop(): void;
}

/**
 * Registry of conversation providers.
 */
export interface ConversationProviderRegistry {
  /**
   * Register a provider.
   */
  register(provider: ConversationProvider): void;

  /**
   * Get a provider by ID.
   */
  get(providerId: string): ConversationProvider | undefined;

  /**
   * Get all registered providers.
   */
  all(): ConversationProvider[];

  /**
   * Get the first available provider for a session.
   */
  getForSession(sessionId: string): ConversationProvider | undefined;
}
