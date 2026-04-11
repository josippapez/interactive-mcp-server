/**
 * Unified message types for displaying messages from multiple sources.
 *
 * This abstraction allows ChatHistoryView to display both:
 * - Channel messages (from MCP tool calls: prompts, answers, agent messages)
 * - Conversation messages (from providers like OpenCode: full conversation history)
 *
 * @module unified-message
 */

import type { ChannelMessage, Attachment } from '../types';
import type { ConversationMessage } from '../../../preload/index';

/**
 * Source of a unified message.
 * - `channel`: Messages from MCP tool calls (prompts, answers, agent messages)
 * - `conversation`: Messages from conversation providers (OpenCode, Claude SDK)
 */
export type MessageSource = 'channel' | 'conversation';

/**
 * Role for display purposes.
 * - `user`: Message from the human user
 * - `assistant`: Message from the AI assistant
 * - `system`: System-level message (prompts, instructions)
 * - `sent`: Outbound message that has been successfully sent
 * - `queued`: Outbound message waiting to be sent
 */
export type DisplayRole = 'user' | 'assistant' | 'system' | 'sent' | 'queued';

/**
 * Tool call information extracted from conversation message parts.
 * Used to display tool invocations in the chat history.
 */
export interface ToolCallInfo {
  /** Unique identifier for this tool call */
  id: string;
  /** Name of the tool being called */
  name: string;
  /** Current execution status of the tool call */
  status?: 'pending' | 'running' | 'completed' | 'error';
  /** Input parameters passed to the tool */
  input?: Record<string, unknown>;
  /** Output/result from the tool execution */
  output?: string;
}

/**
 * A unified message that can represent either a channel message or a conversation message.
 * This is the common format used by ChatHistoryView to render all message types.
 */
export interface UnifiedMessage {
  /** Unique identifier for this message */
  id: string;
  /** Source of the message (channel or conversation) */
  source: MessageSource;
  /** Display role determining styling and positioning */
  role: DisplayRole;
  /** Main text content of the message */
  text: string;
  /** Timestamp in milliseconds since epoch */
  timestamp: number;
  /** File attachments (only present for channel messages) */
  attachments?: Attachment[];
  /** Tool calls made in this message (only present for conversation messages) */
  toolCalls?: ToolCallInfo[];
  /** Model ID used to generate the response (for assistant messages) */
  modelId?: string;
  /** Agent name/mode that generated this message */
  agent?: string;
  /** Token usage statistics for this message */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** Cost in USD for this message */
  cost?: number;
  /** Original channel message kind (used for styling) */
  channelKind?: ChannelMessage['kind'];
  /** Whether this message represents the currently active prompt */
  isActivePrompt?: boolean;
}

/**
 * Convert a channel message to a unified message format.
 *
 * Maps channel message kinds to display roles:
 * - `answer` → `user` (user's response to a prompt)
 * - `outbound` → `sent` or `queued` (based on sent flag)
 * - `agent_message` → `assistant` (agent status updates)
 * - `question` (default) → `assistant` (agent prompt)
 *
 * @param msg - The channel message to convert
 * @param isActivePrompt - Whether this message is the currently active prompt
 * @returns A unified message representation
 *
 * @example
 * ```ts
 * const unified = channelToUnified(channelMessage, true);
 * // unified.isActivePrompt === true
 * ```
 */
export function channelToUnified(
  msg: ChannelMessage,
  isActivePrompt = false,
): UnifiedMessage {
  let role: DisplayRole;
  switch (msg.kind) {
    case 'answer':
      role = 'user';
      break;
    case 'outbound':
      role = msg.sent ? 'sent' : 'queued';
      break;
    case 'agent_message':
      role = 'assistant';
      break;
    default:
      role = 'assistant';
  }

  return {
    id: msg.id,
    source: 'channel',
    role,
    text: msg.text,
    timestamp: msg.timestamp.getTime(),
    attachments: msg.attachments,
    channelKind: msg.kind,
    isActivePrompt,
  };
}

/**
 * Convert a conversation message to a unified message format.
 *
 * Extracts text content from message parts and assembles tool call information.
 * Multiple text parts are joined with double newlines.
 *
 * @param msg - The conversation message to convert
 * @returns A unified message representation with extracted text and tool calls
 *
 * @example
 * ```ts
 * const unified = conversationToUnified(conversationMessage);
 * // unified.text contains joined text from all text parts
 * // unified.toolCalls contains extracted tool call info (if any)
 * ```
 */
export function conversationToUnified(
  msg: ConversationMessage,
): UnifiedMessage {
  // Extract text content from parts
  const textParts = msg.parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n\n');

  // Extract tool calls from parts
  const toolCalls: ToolCallInfo[] = msg.parts
    .filter((p) => p.type === 'tool-call')
    .map((p) => ({
      id: p.id,
      name: p.toolName ?? 'Unknown tool',
      status: p.toolStatus,
      input: p.toolInput,
      output: p.toolOutput,
    }));

  return {
    id: msg.id,
    source: 'conversation',
    role:
      msg.role === 'user'
        ? 'user'
        : msg.role === 'system'
          ? 'system'
          : 'assistant',
    text: textParts,
    timestamp: msg.createdAt,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    modelId: msg.modelId,
    agent: msg.agent,
    tokens: msg.tokens,
    cost: msg.cost,
  };
}

/**
 * Merge channel messages and conversation messages into a unified timeline.
 *
 * The merge strategy:
 * - Both sources are converted to unified format
 * - All messages are sorted by timestamp (ascending)
 * - The active prompt is marked based on `activePromptId`
 *
 * @param channelMessages - Messages from MCP channel (prompts, answers, agent messages)
 * @param conversationMessages - Messages from conversation provider (OpenCode, etc.)
 * @param activePromptId - ID of the currently active prompt (optional)
 * @returns Unified messages sorted by timestamp, ready for rendering
 *
 * @example
 * ```ts
 * const unified = mergeMessages(
 *   channelMessages,
 *   conversationMessages,
 *   currentPrompt?.id
 * );
 * // Returns sorted array of UnifiedMessage objects
 * ```
 */
export function mergeMessages(
  channelMessages: ChannelMessage[],
  conversationMessages: ConversationMessage[],
  activePromptId?: string | null,
): UnifiedMessage[] {
  const unified: UnifiedMessage[] = [];

  // Convert channel messages
  for (const msg of channelMessages) {
    unified.push(channelToUnified(msg, msg.id === activePromptId));
  }

  // Convert conversation messages
  for (const msg of conversationMessages) {
    unified.push(conversationToUnified(msg));
  }

  // Sort by timestamp
  unified.sort((a, b) => a.timestamp - b.timestamp);

  return unified;
}

/**
 * Configuration for which message sources to display in the chat view.
 * Used by ChatHistoryView to determine what content to render.
 */
export interface MessageDisplayConfig {
  /** Whether to show channel messages (MCP tool interactions) */
  showChannelMessages: boolean;
  /** Whether to show conversation messages (provider conversation history) */
  showConversationMessages: boolean;
  /** Whether conversation provider is available and connected */
  conversationAvailable: boolean;
}
