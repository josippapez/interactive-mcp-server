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

const THINKING_BLOCK_REGEX = /<thinking>([\s\S]*?)<\/thinking>/gi;

function extractThinkingFromText(text: string): {
  text: string;
  reasoning: string[];
} {
  const reasoning: string[] = [];
  const textWithoutThinking = text.replace(
    THINKING_BLOCK_REGEX,
    (_match, inner) => {
      const normalizedInner = inner.trim();
      if (normalizedInner) {
        reasoning.push(normalizedInner);
      }
      return '';
    },
  );

  return {
    text: textWithoutThinking.trim(),
    reasoning,
  };
}

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
 * - `sending`: Outbound message currently being sent
 * - `queued`: Outbound message that failed to send
 */
export type DisplayRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'sent'
  | 'sending'
  | 'queued';

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
  /** Tool metadata (e.g., sessionId for Task tools) */
  metadata?: Record<string, unknown>;
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
  /** Reasoning/thinking content (for models that support extended thinking) */
  reasoning?: string;
  /** Timestamp in milliseconds since epoch */
  timestamp: number;
  /** File attachments (only present for channel messages) */
  attachments?: Attachment[];
  /** Tool calls made in this message (only present for conversation messages) */
  toolCalls?: ToolCallInfo[];
  /** Model ID used to generate the response (for assistant messages) */
  modelId?: string;
  /** Reasoning effort variant (e.g., 'low', 'medium', 'high', 'xhigh') */
  variant?: string;
  /** Agent name/mode that generated this message */
  agent?: string;
  /** Token usage statistics for this message */
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
  /** Cost in USD for this message */
  cost?: number;
  /** Original channel message kind (used for styling) */
  channelKind?: ChannelMessage['kind'];
  /** Whether this message represents the currently active prompt */
  isActivePrompt?: boolean;
  /** Whether this message contains a compaction summary */
  isCompaction?: boolean;
  /** Source URLs referenced in this message */
  sourceUrls?: Array<{ url: string; title?: string }>;
}

/**
 * Convert a channel message to a unified message format.
 *
 * Maps channel message kinds to display roles:
 * - `answer` → `user` (user's response to a prompt)
 * - `outbound` → `sent`, `sending`, or `queued` (based on sent flag)
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
      // sent === true → sent (success)
      // sent === false → queued (failed)
      // sent === undefined → sending (in flight)
      role =
        msg.sent === true ? 'sent' : msg.sent === false ? 'queued' : 'sending';
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
 * NOTE: This intentionally avoids object-reference memoization.
 * Conversation payloads can be mutated in-place by upstream bridges during
 * streaming, and reference-based caching can hide fresh text/tool updates
 * until a hard refetch occurs.
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
  // Check if this message is a compaction summary
  // A compaction can be detected by:
  // 1. Having mode === 'compaction' (assistant messages with the summary)
  // 2. Having a part with type === 'compaction' (user messages that trigger compaction)
  const isCompactionMessage =
    msg.mode === 'compaction' || msg.parts.some((p) => p.type === 'compaction');

  // Extract text content from parts (including compaction text)
  const extractedTextParts = msg.parts
    .filter((p) => (p.type === 'text' || p.type === 'compaction') && p.text)
    .map((p) => extractThinkingFromText(p.text!));

  const textParts = extractedTextParts
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n\n');

  // Extract reasoning/thinking content from parts
  const reasoningParts = msg.parts
    .filter((p) => p.type === 'reasoning' && p.text)
    .map((p) => p.text)
    .concat(extractedTextParts.flatMap((part) => part.reasoning))
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
      metadata: p.toolMetadata,
    }));

  // Extract source URLs from parts
  const sourceUrls = msg.parts
    .filter((p) => p.type === 'source-url' && p.sourceUrl)
    .map((p) => ({
      url: p.sourceUrl!,
      title: p.sourceTitle,
    }));

  const unified: UnifiedMessage = {
    id: msg.id,
    source: 'conversation',
    role:
      msg.role === 'user'
        ? 'user'
        : msg.role === 'system'
          ? 'system'
          : 'assistant',
    text: textParts,
    reasoning: reasoningParts || undefined,
    timestamp: msg.createdAt,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    modelId: msg.modelId,
    variant: msg.variant,
    agent: msg.agent,
    tokens: msg.tokens,
    cost: msg.cost,
    isCompaction: isCompactionMessage,
    sourceUrls: sourceUrls.length > 0 ? sourceUrls : undefined,
  };

  return unified;
}

type CachedUnifiedEntry = {
  signature: string;
  message: UnifiedMessage;
};

const channelUnifiedCache = new Map<string, CachedUnifiedEntry>();
const conversationUnifiedCache = new Map<string, CachedUnifiedEntry>();

function toSafeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isHumanReadableToolCoveredByChannel(msg: UnifiedMessage): boolean {
  if (msg.source !== 'conversation') {
    return false;
  }

  if (msg.text.trim()) {
    return false;
  }

  if (!msg.toolCalls?.length) {
    return false;
  }

  return msg.toolCalls.every((toolCall) => {
    const name = toolCall.name.toLowerCase();
    return (
      name.includes('request_user_input') ||
      name.includes('send_message') ||
      name.includes('push_session_status')
    );
  });
}

function hashParts(parts: ConversationMessage['parts']): string {
  let hash = 0;

  for (const part of parts) {
    const signature = [
      part.id,
      part.type,
      toSafeText(part.text),
      toSafeText(part.toolName),
      toSafeText(part.toolStatus),
      toSafeText(part.toolOutput),
      toSafeText(part.sourceUrl),
      toSafeText(part.sourceTitle),
      JSON.stringify(part.toolInput ?? null),
      JSON.stringify(part.toolMetadata ?? null),
    ].join('|');

    for (let i = 0; i < signature.length; i += 1) {
      hash = (hash * 31 + signature.charCodeAt(i)) | 0;
    }
  }

  return `${parts.length}:${hash}`;
}

function buildConversationSignature(msg: ConversationMessage): string {
  const tokenSignature = msg.tokens
    ? `${msg.tokens.input ?? ''}:${msg.tokens.output ?? ''}:${msg.tokens.reasoning ?? ''}:${msg.tokens.total ?? ''}:${msg.tokens.cache?.read ?? ''}:${msg.tokens.cache?.write ?? ''}`
    : '';

  return [
    msg.id,
    msg.role,
    msg.createdAt,
    msg.mode ?? '',
    msg.modelId ?? '',
    msg.variant ?? '',
    msg.agent ?? '',
    msg.cost ?? '',
    tokenSignature,
    hashParts(msg.parts),
  ].join('|');
}

function buildChannelSignature(
  msg: ChannelMessage,
  isActivePrompt: boolean,
): string {
  const attachmentSignature = (msg.attachments ?? [])
    .map((attachment) =>
      [
        attachment.name,
        attachment.mimeType,
        attachment.size ?? '',
        attachment.data.length,
      ].join(':'),
    )
    .join(',');

  return [
    msg.id,
    msg.kind,
    msg.text,
    msg.timestamp.getTime(),
    msg.sent === undefined ? '' : String(msg.sent),
    isActivePrompt ? '1' : '0',
    attachmentSignature,
  ].join('|');
}

function getCachedChannelUnified(
  msg: ChannelMessage,
  isActivePrompt: boolean,
): UnifiedMessage {
  const signature = buildChannelSignature(msg, isActivePrompt);
  const cached = channelUnifiedCache.get(msg.id);
  if (cached && cached.signature === signature) {
    return cached.message;
  }

  const unified = channelToUnified(msg, isActivePrompt);
  channelUnifiedCache.set(msg.id, { signature, message: unified });
  return unified;
}

function getCachedConversationUnified(
  msg: ConversationMessage,
): UnifiedMessage {
  const signature = buildConversationSignature(msg);
  const cached = conversationUnifiedCache.get(msg.id);
  if (cached && cached.signature === signature) {
    return cached.message;
  }

  const unified = conversationToUnified(msg);
  conversationUnifiedCache.set(msg.id, { signature, message: unified });
  return unified;
}

function pruneCache(
  cache: Map<string, CachedUnifiedEntry>,
  validIds: Set<string>,
): void {
  for (const key of cache.keys()) {
    if (!validIds.has(key)) {
      cache.delete(key);
    }
  }
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
  const validChannelIds = new Set<string>();
  const validConversationIds = new Set<string>();
  const conversationUserSignatures = new Set<string>();
  const channelPromptTimestamps = new Set<number>();

  for (const msg of conversationMessages) {
    if (msg.role !== 'user') {
      continue;
    }

    const text = msg.parts
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => normalizeComparableText(part.text))
      .join('\n\n')
      .trim();

    if (!text) {
      continue;
    }

    conversationUserSignatures.add(text);
  }

  // Convert channel messages
  for (const msg of channelMessages) {
    if (msg.kind === 'question' || msg.kind === 'agent_message') {
      channelPromptTimestamps.add(msg.timestamp.getTime());
    }

    if (
      msg.kind === 'outbound' &&
      msg.sent === true &&
      conversationUserSignatures.has(normalizeComparableText(msg.text))
    ) {
      validChannelIds.add(msg.id);
      continue;
    }

    validChannelIds.add(msg.id);
    unified.push(getCachedChannelUnified(msg, msg.id === activePromptId));
  }

  // Convert conversation messages
  for (const msg of conversationMessages) {
    validConversationIds.add(msg.id);
    const unifiedMessage = getCachedConversationUnified(msg);
    if (
      isHumanReadableToolCoveredByChannel(unifiedMessage) &&
      channelPromptTimestamps.has(unifiedMessage.timestamp)
    ) {
      continue;
    }
    unified.push(unifiedMessage);
  }

  pruneCache(channelUnifiedCache, validChannelIds);
  pruneCache(conversationUnifiedCache, validConversationIds);

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
