/**
 * Unified message types for displaying messages from multiple sources.
 *
 * This abstraction allows ChatHistoryView to display both:
 * - Channel messages (from MCP tool calls: prompts, answers, agent messages)
 * - Conversation messages (from providers like OpenCode: full conversation history)
 *
 * @module unified-message
 */

import { filterMessageText } from '../components/prompt/message-item-helpers';
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
  /** Human-readable tool title from OpenCode tool state. */
  title?: string;
  /** Input parameters passed to the tool */
  input?: Record<string, unknown>;
  /** Output/result from the tool execution */
  output?: string;
  /** Tool metadata (e.g., sessionId for Task tools) */
  metadata?: Record<string, unknown>;
  /**
   * Spawned subagent session id (Task tool only). Sourced from a sibling
   * `subtask` part in the same message via ordering-based matching (the
   * Nth task tool call binds to the Nth subtask part). Authoritative
   * before `tool.metadata.sessionId` is populated by opencode.
   */
  subtaskSessionId?: string;
  /** Tool execution start timestamp in ms (present when status is running/completed/error). */
  startedAt?: number;
  /** Tool execution end timestamp in ms (present when status is completed/error). */
  completedAt?: number;
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
  /** File/context parts that are not previewable as inline attachments. */
  fileParts?: Array<{ name: string; mimeType?: string; url?: string }>;
  /** Tool calls made in this message (only present for conversation messages) */
  toolCalls?: ToolCallInfo[];
  /** Model ID used to generate the response (for assistant messages) */
  modelId?: string;
  /** Reasoning effort variant (e.g., 'low', 'medium', 'high', 'xhigh') */
  variant?: string;
  /** Agent name/mode that generated this message */
  agent?: string;
  /** OpenCode assistant mode, e.g. build, plan, or compaction. */
  mode?: string;
  /** Provider finish reason for assistant messages. */
  finish?: string;
  /** User-visible assistant error, if OpenCode reports one. */
  error?: string;
  /** OpenCode assistant error name, e.g. MessageAbortedError. */
  errorName?: string;
  /** Completion timestamp in milliseconds since epoch. */
  completedAt?: number;
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
  /** Number of synthetic/ignored text parts hidden from the rendered body. */
  hiddenTextPartCount?: number;
  /** Parent OpenCode message id, used to relate assistant replies to user turns. */
  parentId?: string | null;
}

function fileUrlToAttachment(
  part: ConversationMessage['parts'][number],
): Attachment | null {
  if (part.type !== 'file' || !part.fileUrl) return null;
  if (!part.fileUrl.startsWith('data:')) return null;

  const commaIndex = part.fileUrl.indexOf(',');
  const meta = part.fileUrl.slice(5, commaIndex);
  if (commaIndex === -1 || !meta.endsWith(';base64')) return null;

  const data = part.fileUrl.slice(commaIndex + 1);
  const mimeType = meta.slice(0, -';base64'.length) || part.mediaType;
  if (!mimeType || !data) return null;

  return {
    data,
    mimeType,
    name: part.filename ?? 'attachment',
    size: data.length,
  };
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
    .filter(
      (p) =>
        (p.type === 'text' || p.type === 'compaction') &&
        p.text &&
        !p.synthetic &&
        !p.ignored,
    )
    .map((p) => extractThinkingFromText(p.text!));
  const hiddenTextPartCount = msg.parts.filter(
    (p) => p.type === 'text' && p.text && (p.synthetic || p.ignored),
  ).length;

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

  // Extract tool calls from parts. For Task tool calls, bind the spawned
  // subagent session id using ordering-based matching: the Nth `task` tool
  // call in the message is paired with the Nth `subtask` part in the same
  // message. Subtask parts carry the authoritative child sessionID (from
  // the opencode SDK SubtaskPart). Assumption: opencode emits subtask
  // parts in the same order as the task tool calls that produced them,
  // within one message. Holds in practice because each Task tool invocation
  // causes one subtask part emission from the SDK.
  const subtaskSessionIds: string[] = msg.parts
    .filter(
      (p) => p.type === 'subtask' && typeof p.subtaskSessionId === 'string',
    )
    .map((p) => p.subtaskSessionId as string);

  let taskToolSeen = 0;
  const toolCalls: ToolCallInfo[] = msg.parts
    .filter((p) => p.type === 'tool-call')
    .map((p) => {
      const info: ToolCallInfo = {
        id: p.id,
        name: p.toolName ?? 'Unknown tool',
        status: p.toolStatus,
        title: p.toolTitle,
        input: p.toolInput,
        output: p.toolOutput,
        metadata: p.toolMetadata,
        startedAt: p.toolStartedAt,
        completedAt: p.toolCompletedAt,
      };
      const lowerName = (p.toolName ?? '').toLowerCase();
      if (lowerName === 'task' || lowerName === 'mcp__opencode__task') {
        const candidate = subtaskSessionIds[taskToolSeen];
        if (candidate) info.subtaskSessionId = candidate;
        taskToolSeen += 1;
      }
      return info;
    });

  // Extract source URLs from parts
  const sourceUrls = msg.parts
    .filter((p) => p.type === 'source-url' && p.sourceUrl)
    .map((p) => ({
      url: p.sourceUrl!,
      title: p.sourceTitle,
    }));

  const fileAttachments = msg.parts
    .map(fileUrlToAttachment)
    .filter((attachment): attachment is Attachment => attachment !== null);
  const fileParts = msg.parts
    .filter((p) => p.type === 'file')
    .map((p) => ({
      name: p.filename ?? 'attachment',
      mimeType: p.mediaType,
      url: p.fileUrl,
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
    attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
    fileParts: fileParts.length > 0 ? fileParts : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    modelId: msg.modelId,
    variant: msg.variant,
    agent: msg.agent,
    mode: msg.mode,
    finish: msg.finish,
    error: msg.error,
    errorName: msg.errorName,
    completedAt: msg.completedAt,
    parentId: msg.parentId,
    tokens: msg.tokens,
    cost: msg.cost,
    isCompaction: isCompactionMessage,
    sourceUrls: sourceUrls.length > 0 ? sourceUrls : undefined,
    hiddenTextPartCount:
      hiddenTextPartCount > 0 ? hiddenTextPartCount : undefined,
  };

  return unified;
}

type CachedUnifiedEntry = {
  signature: string;
  message: UnifiedMessage;
};

const channelUnifiedCache = new Map<string, CachedUnifiedEntry>();
const conversationUnifiedCache = new Map<string, CachedUnifiedEntry>();
const CACHE_PRUNE_THRESHOLD = 200;
const HUMAN_READABLE_TOOL_DEDUPE_WINDOW_MS = 120_000;

type PartCacheEntry = {
  signature: string;
  id: string;
  type: string;
  text: string;
  toolName: string;
  toolStatus: string;
  toolOutput: string;
  sourceUrl: string;
  sourceTitle: string;
  toolInputRef: unknown;
  toolInputJson: string;
  toolMetadataRef: unknown;
  toolMetadataJson: string;
  toolStartedAt: number | undefined;
  toolCompletedAt: number | undefined;
  /** Short hash derived from signature (length + tail-64 FNV-ish) — stable for same signature. */
  sigHash: number;
};

const partSignatureCache = new WeakMap<
  NonNullable<ConversationMessage['parts']>[number],
  PartCacheEntry
>();

/**
 * Streaming fast-path cache. Immer mints a new part object on each delta,
 * so the WeakMap always misses for the actively-streaming part. Key on
 * stable `part.id` so we can reuse the prior signature + short hash when
 * only the text tail grew and no tool fields changed.
 */
const partSignatureByIdCache = new Map<string, PartCacheEntry>();
const partSignatureByIdCacheOrder: string[] = [];
export const PART_SIGNATURE_BY_ID_CACHE_MAX = 1000;

function setPartSignatureByIdCache(id: string, entry: PartCacheEntry): void {
  partSignatureByIdCache.set(id, entry);
  const existingIndex = partSignatureByIdCacheOrder.indexOf(id);
  if (existingIndex !== -1)
    partSignatureByIdCacheOrder.splice(existingIndex, 1);
  partSignatureByIdCacheOrder.push(id);
  while (partSignatureByIdCacheOrder.length > PART_SIGNATURE_BY_ID_CACHE_MAX) {
    const evicted = partSignatureByIdCacheOrder.shift();
    if (evicted) partSignatureByIdCache.delete(evicted);
  }
}

/**
 * Compute a short hash of the full signature without scanning every char.
 * Correctness argument: `signature` already contains `part.id`, `type`,
 * all tool fields, and the full `text`. Any change in those inputs
 * changes `signature.length` or the trailing bytes of `text` (which is
 * always at a fixed field position within `signature` — last fields are
 * toolInputJson and toolMetadataJson, whose ref-equality we check
 * before using this path). So `length + tail-64` distinguishes all
 * deltas encountered during streaming.
 */
function shortHashSignature(signature: string): number {
  const tail = signature.slice(-64);
  let h = signature.length | 0;
  for (let i = 0; i < tail.length; i += 1) {
    h = (h * 31 + tail.charCodeAt(i)) | 0;
  }
  return h;
}

function toSafeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type HumanReadableChannelMarker = {
  kind: ChannelMessage['kind'];
  text: string;
  timestamp: number;
};

function getStringInput(
  input: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = input?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getHumanReadableToolCover(
  toolCall: ToolCallInfo,
): Pick<HumanReadableChannelMarker, 'kind' | 'text'> | null {
  const name = toolCall.name.toLowerCase();
  if (name.includes('send_message')) {
    const text = getStringInput(toolCall.input, 'message');
    return text ? { kind: 'agent_message', text } : null;
  }
  if (name.includes('request_user_input')) {
    const text = getStringInput(toolCall.input, 'message');
    return text ? { kind: 'question', text } : null;
  }
  return null;
}

function isHumanReadableToolCoveredByChannel(
  msg: UnifiedMessage,
  channelMarkers: readonly HumanReadableChannelMarker[],
): boolean {
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
    const cover = getHumanReadableToolCover(toolCall);
    if (!cover) return false;
    return channelMarkers.some(
      (marker) =>
        marker.kind === cover.kind &&
        marker.text.trim() === cover.text &&
        Math.abs(marker.timestamp - msg.timestamp) <=
          HUMAN_READABLE_TOOL_DEDUPE_WINDOW_MS,
    );
  });
}

function hashParts(parts: ConversationMessage['parts']): string {
  let hash = 0;

  for (const part of parts) {
    const text = toSafeText(part.text);
    const toolName = toSafeText(part.toolName);
    const toolStatus = toSafeText(part.toolStatus);
    const toolOutput = toSafeText(part.toolOutput);
    const sourceUrl = toSafeText(part.sourceUrl);
    const sourceTitle = toSafeText(part.sourceTitle);
    const toolInputRef = part.toolInput ?? null;
    const toolMetadataRef = part.toolMetadata ?? null;
    const toolStartedAt = part.toolStartedAt;
    const toolCompletedAt = part.toolCompletedAt;
    const cached = partSignatureCache.get(part);

    let entry: PartCacheEntry | undefined;

    if (
      cached &&
      cached.id === part.id &&
      cached.type === part.type &&
      cached.text === text &&
      cached.toolName === toolName &&
      cached.toolStatus === toolStatus &&
      cached.toolOutput === toolOutput &&
      cached.sourceUrl === sourceUrl &&
      cached.sourceTitle === sourceTitle &&
      cached.toolInputRef === toolInputRef &&
      cached.toolMetadataRef === toolMetadataRef &&
      cached.toolStartedAt === toolStartedAt &&
      cached.toolCompletedAt === toolCompletedAt
    ) {
      // WeakMap hit — same part object, unchanged.
      entry = cached;
    } else {
      // WeakMap miss. During streaming, Immer produces a new part object
      // every tick, but `part.id` is stable. Try the id-keyed cache for
      // a streaming tail-append fast path.
      const prior =
        part.id != null ? partSignatureByIdCache.get(part.id) : undefined;

      const toolFieldsMatch =
        prior !== undefined &&
        prior.id === part.id &&
        prior.type === part.type &&
        prior.toolName === toolName &&
        prior.toolStatus === toolStatus &&
        prior.toolOutput === toolOutput &&
        prior.sourceUrl === sourceUrl &&
        prior.sourceTitle === sourceTitle &&
        prior.toolInputRef === toolInputRef &&
        prior.toolMetadataRef === toolMetadataRef &&
        prior.toolStartedAt === toolStartedAt &&
        prior.toolCompletedAt === toolCompletedAt;

      // Streaming tail-append: only `text` grew; every other field is
      // ref/value-equal. We can rebuild `signature` cheaply and use the
      // short-hash. If any tool field changed, `toolFieldsMatch` is false
      // and we fall through to the full recompute branch — which also
      // uses shortHashSignature but re-stringifies JSON fields as needed.
      if (toolFieldsMatch && text.length >= prior.text.length) {
        const signature = [
          part.id,
          part.type,
          text,
          toolName,
          toolStatus,
          toolOutput,
          sourceUrl,
          sourceTitle,
          prior.toolInputJson,
          prior.toolMetadataJson,
          toolStartedAt ?? '',
          toolCompletedAt ?? '',
        ].join('|');

        entry = {
          signature,
          id: part.id,
          type: part.type,
          text,
          toolName,
          toolStatus,
          toolOutput,
          sourceUrl,
          sourceTitle,
          toolInputRef,
          toolInputJson: prior.toolInputJson,
          toolMetadataRef,
          toolMetadataJson: prior.toolMetadataJson,
          toolStartedAt,
          toolCompletedAt,
          sigHash: shortHashSignature(signature),
        };
      } else {
        // Full recompute: tool fields changed, length shrank, no prior,
        // or no id. Re-stringify JSON fields unless ref-equal to prior.
        const toolInputJson =
          prior?.toolInputRef === toolInputRef
            ? prior.toolInputJson
            : cached?.toolInputRef === toolInputRef
              ? cached.toolInputJson
              : JSON.stringify(toolInputRef);
        const toolMetadataJson =
          prior?.toolMetadataRef === toolMetadataRef
            ? prior.toolMetadataJson
            : cached?.toolMetadataRef === toolMetadataRef
              ? cached.toolMetadataJson
              : JSON.stringify(toolMetadataRef);

        const signature = [
          part.id,
          part.type,
          text,
          toolName,
          toolStatus,
          toolOutput,
          sourceUrl,
          sourceTitle,
          toolInputJson,
          toolMetadataJson,
          toolStartedAt ?? '',
          toolCompletedAt ?? '',
        ].join('|');

        entry = {
          signature,
          id: part.id,
          type: part.type,
          text,
          toolName,
          toolStatus,
          toolOutput,
          sourceUrl,
          sourceTitle,
          toolInputRef,
          toolInputJson,
          toolMetadataRef,
          toolMetadataJson,
          toolStartedAt,
          toolCompletedAt,
          sigHash: shortHashSignature(signature),
        };
      }

      partSignatureCache.set(part, entry);
      if (part.id != null) {
        setPartSignatureByIdCache(part.id, entry);
      }
    }

    hash = (hash * 31 + entry.sigHash) | 0;
  }

  return `${parts.length}:${hash}`;
}

export function resetUnifiedMessageCachesForTests(): void {
  channelUnifiedCache.clear();
  conversationUnifiedCache.clear();
  partSignatureByIdCache.clear();
  partSignatureByIdCacheOrder.splice(0, partSignatureByIdCacheOrder.length);
}

export function getPartSignatureByIdCacheSizeForTests(): number {
  return partSignatureByIdCache.size;
}

function buildConversationSignature(msg: ConversationMessage): string {
  const tokenSignature = msg.tokens
    ? `${msg.tokens.input ?? ''}:${msg.tokens.output ?? ''}:${msg.tokens.reasoning ?? ''}:${msg.tokens.total ?? ''}:${msg.tokens.cache?.read ?? ''}:${msg.tokens.cache?.write ?? ''}`
    : '';

  return [
    msg.id,
    msg.parentId ?? '',
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

export type HiddenMessageFilterOptions = {
  hideSystemReminders?: boolean;
  hideDocInjections?: boolean;
};

function shouldHideUnifiedMessage(
  msg: UnifiedMessage,
  options?: HiddenMessageFilterOptions,
): boolean {
  if (!options) return false;

  const filteredText = filterMessageText(
    msg.text,
    options.hideSystemReminders ?? false,
    options.hideDocInjections ?? false,
  );

  if (filteredText) {
    return false;
  }

  return !msg.reasoning && !msg.toolCalls?.length && !msg.attachments?.length;
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
  hiddenFilterOptions?: HiddenMessageFilterOptions,
): UnifiedMessage[] {
  const unified: UnifiedMessage[] = [];
  const validChannelIds = new Set<string>();
  const validConversationIds = new Set<string>();
  const humanReadableChannelMarkers: HumanReadableChannelMarker[] = [];
  const userTurnMeta = new Map<
    string,
    Pick<ConversationMessage, 'modelId' | 'variant' | 'agent'>
  >();

  for (const msg of conversationMessages) {
    if (msg.role !== 'user') continue;
    userTurnMeta.set(msg.id, {
      modelId: msg.modelId,
      variant: msg.variant,
      agent: msg.agent,
    });
  }

  // Build a set of normalized text signatures for user-role conversation
  // messages. Used to dedupe the optimistic local outbound echo against
  // the server-confirmed echo OpenCode emits via `message.updated`. Once
  // the server echo arrives the outbound is dropped so a single bubble
  // remains. Until then the outbound renders with SENDING/QUEUED/SENT.
  const conversationUserTexts = new Set<string>();
  for (const cmsg of conversationMessages) {
    if (cmsg.role !== 'user') continue;
    const text = cmsg.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text as string)
      .join('\n\n')
      .trim();
    if (text) conversationUserTexts.add(text);
  }

  // Convert channel messages
  //
  // Outbound (user-sent) channel messages render in the timeline so the
  // SENDING/QUEUED/SENT badge is visible on the user bubble. Once the
  // OpenCode server echoes the same text via `message.updated`, the
  // outbound is dropped (matched by normalized text) and the server
  // message becomes the single source of truth for that bubble.
  for (const msg of channelMessages) {
    if (msg.kind === 'outbound' && conversationUserTexts.has(msg.text.trim())) {
      validChannelIds.add(msg.id);
      continue;
    }

    if (msg.kind === 'question' || msg.kind === 'agent_message') {
      humanReadableChannelMarkers.push({
        kind: msg.kind,
        text: msg.text.trim(),
        timestamp: msg.timestamp.getTime(),
      });
    }

    validChannelIds.add(msg.id);
    const unifiedMessage = getCachedChannelUnified(
      msg,
      msg.id === activePromptId,
    );
    if (!shouldHideUnifiedMessage(unifiedMessage, hiddenFilterOptions)) {
      unified.push(unifiedMessage);
    }
  }

  // Convert conversation messages
  for (const msg of conversationMessages) {
    validConversationIds.add(msg.id);
    const unifiedMessage = getCachedConversationUnified(msg);
    if (
      isHumanReadableToolCoveredByChannel(
        unifiedMessage,
        humanReadableChannelMarkers,
      )
    ) {
      continue;
    }
    if (!shouldHideUnifiedMessage(unifiedMessage, hiddenFilterOptions)) {
      unified.push(unifiedMessage);
    }
  }

  if (channelUnifiedCache.size > CACHE_PRUNE_THRESHOLD) {
    pruneCache(channelUnifiedCache, validChannelIds);
  }
  if (conversationUnifiedCache.size > CACHE_PRUNE_THRESHOLD) {
    pruneCache(conversationUnifiedCache, validConversationIds);
  }

  // Sort by timestamp
  unified.sort((a, b) => a.timestamp - b.timestamp);

  let latestPriorUserTurnMeta:
    | Pick<ConversationMessage, 'modelId' | 'variant' | 'agent'>
    | undefined;
  for (let index = 0; index < unified.length; index += 1) {
    const msg = unified[index];
    if (msg.source !== 'conversation') {
      continue;
    }
    if (msg.role === 'user') {
      latestPriorUserTurnMeta = {
        modelId: msg.modelId,
        variant: msg.variant,
        agent: msg.agent,
      };
      continue;
    }
    if (msg.role !== 'assistant') {
      continue;
    }
    const parentMeta = msg.parentId
      ? userTurnMeta.get(msg.parentId)
      : undefined;
    const fallbackMeta = parentMeta ?? latestPriorUserTurnMeta;
    if (fallbackMeta && !msg.variant) {
      unified[index] = {
        ...msg,
        modelId: msg.modelId ?? fallbackMeta.modelId,
        variant: fallbackMeta.variant,
        agent: msg.agent ?? fallbackMeta.agent,
      };
    }
  }

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

// ─── Markdown serialization ──────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m${seconds}s`;
}

function formatToolCallMarkdown(
  call: NonNullable<UnifiedMessage['toolCalls']>[number],
): string {
  const parts: string[] = [`**${call.name}**`];
  if (call.status && call.status !== 'completed') {
    parts.push(`[${call.status}]`);
  }
  if (
    typeof call.startedAt === 'number' &&
    typeof call.completedAt === 'number' &&
    call.completedAt >= call.startedAt
  ) {
    parts.push(`(${formatDurationMs(call.completedAt - call.startedAt)})`);
  }
  const header = `  - ${parts.join(' ')}`;
  const inputLines: string[] = [];
  if (call.input && Object.keys(call.input).length > 0) {
    const summary = Object.entries(call.input)
      .slice(0, 3)
      .map(([k, v]) => {
        const str =
          typeof v === 'string'
            ? v.length > 80
              ? `${v.slice(0, 80)}…`
              : v
            : typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : Array.isArray(v)
                ? `[${v.length} items]`
                : '{…}';
        return `${k}: ${str}`;
      })
      .join(', ');
    if (summary) inputLines.push(`    - input: ${summary}`);
  }
  return [header, ...inputLines].join('\n');
}

function roleLabel(role: UnifiedMessage['role']): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'sent':
    case 'sending':
    case 'queued':
      return 'Outbound';
    default:
      return role;
  }
}

function formatTimestamp(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return '';
  }
}

/**
 * Serialize a list of unified messages to a markdown transcript. Intended
 * for the "copy full session" action in the channel header. Omits
 * attachments, reasoning, and source URLs to keep the output concise;
 * includes tool calls with duration + input summary.
 */
export function conversationToMarkdown(messages: UnifiedMessage[]): string {
  if (messages.length === 0) return '';

  const blocks: string[] = [];
  for (const msg of messages) {
    const ts = formatTimestamp(msg.timestamp);
    const header = `### ${roleLabel(msg.role)}${ts ? ` — ${ts}` : ''}${msg.modelId ? ` — ${msg.modelId}` : ''}`;
    const sections: string[] = [header];

    if (msg.text && msg.text.trim()) {
      sections.push(msg.text.trim());
    }

    if (msg.reasoning && msg.reasoning.trim()) {
      sections.push(
        [
          '<details><summary>Reasoning</summary>',
          '',
          msg.reasoning.trim(),
          '',
          '</details>',
        ].join('\n'),
      );
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      sections.push(
        ['**Tool calls:**', ...msg.toolCalls.map(formatToolCallMarkdown)].join(
          '\n',
        ),
      );
    }

    blocks.push(sections.join('\n\n'));
  }

  return blocks.join('\n\n---\n\n') + '\n';
}
