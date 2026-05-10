/**
 * Shared OpenCode ↔ ConversationMessage mapping.
 *
 * Extracted from `event-bridge.ts` so both the utility process (SSE pump,
 * event-bridge event translation) and the main process (conversation IPC
 * handlers seeding a session's REST message list) can use the same mapper
 * without crossing the MessagePort bridge.
 *
 * Kept dependency-free with respect to Electron / DB / logger. The functions
 * are pure — they take an SDK message/part and return our flat
 * `ConversationMessage`/`ConversationMessagePart` shapes.
 */

import type {
  AssistantMessage,
  Message as SdkMessage,
  Part as SdkPart,
  UserMessage,
} from '@opencode-ai/sdk/v2/client';
import type {
  ConversationMessage,
  ConversationMessagePart,
  ConversationMessageRole,
} from '../preload/api/types';

/**
 * Raw SDK part types we DO NOT mirror into the renderer. These are internal
 * step markers or protocol-level parts with no user-visible representation
 * in the chat history. Mirrors opencode TUI's `SKIP_PARTS`.
 */
const SKIP_PART_TYPES = new Set<string>([
  'step-start',
  'step-finish',
  'patch',
  'snapshot',
  'agent',
  'retry',
]);

/**
 * Map a raw SDK `Part` (any variant in the union) to our simplified
 * `ConversationMessagePart`. Returns null for parts we skip.
 */
export function mapPart(part: SdkPart): ConversationMessagePart | null {
  if (SKIP_PART_TYPES.has(part.type)) return null;

  switch (part.type) {
    case 'text': {
      return {
        id: part.id,
        type: 'text',
        text: part.text ?? '',
        synthetic: part.synthetic,
        ignored: part.ignored,
      };
    }
    case 'reasoning': {
      return {
        id: part.id,
        type: 'reasoning',
        text: part.text ?? '',
      };
    }
    case 'file': {
      return {
        id: part.id,
        type: 'file',
        mediaType: part.mime,
        filename: part.filename,
        fileUrl: part.url,
      };
    }
    case 'tool': {
      const state = part.state;
      let toolStatus: ConversationMessagePart['toolStatus'];
      let toolInput: Record<string, unknown> | undefined;
      let toolOutput: string | undefined;
      let stateMetadata: Record<string, unknown> | undefined;
      let toolStartedAt: number | undefined;
      let toolCompletedAt: number | undefined;
      const toolTitle = 'title' in state ? state.title : undefined;

      switch (state.status) {
        case 'pending':
          toolStatus = 'pending';
          toolInput = state.input;
          break;
        case 'running':
          toolStatus = 'running';
          toolInput = state.input;
          stateMetadata = state.metadata;
          toolStartedAt = state.time?.start;
          if (
            typeof (state.metadata as { output?: unknown } | undefined)
              ?.output === 'string'
          ) {
            toolOutput = (state.metadata as { output: string }).output;
          }
          break;
        case 'completed':
          toolStatus = 'completed';
          toolInput = state.input;
          toolOutput = state.output;
          stateMetadata = {
            ...state.metadata,
            ...(state.attachments ? { attachments: state.attachments } : {}),
          };
          toolStartedAt = state.time?.start;
          toolCompletedAt = state.time?.end;
          break;
        case 'error':
          toolStatus = 'error';
          toolInput = state.input;
          toolOutput = state.error;
          stateMetadata = state.metadata;
          toolStartedAt = state.time?.start;
          toolCompletedAt = state.time?.end;
          break;
      }

      const mergedMetadata: Record<string, unknown> = {
        ...(stateMetadata ?? {}),
        ...(part.metadata ?? {}),
      };

      return {
        id: part.id,
        type: 'tool-call',
        toolName: part.tool,
        toolCallId: part.callID,
        toolInput,
        toolOutput,
        toolStatus,
        toolTitle,
        toolMetadata: mergedMetadata,
        toolStartedAt,
        toolCompletedAt,
      };
    }
    case 'subtask': {
      const sub = part as unknown as {
        id: string;
        sessionID: string;
        prompt?: string;
        description?: string;
        agent?: string;
      };
      return {
        id: sub.id,
        type: 'subtask',
        subtaskSessionId: sub.sessionID,
        subtaskPrompt: sub.prompt ?? '',
        subtaskDescription: sub.description ?? '',
        subtaskAgent: sub.agent ?? '',
      };
    }
    case 'compaction': {
      return {
        id: part.id,
        type: 'compaction',
      };
    }
    default:
      return {
        id: (part as { id?: string }).id ?? 'unknown',
        type: 'unknown',
      };
  }
}

function mapRole(message: SdkMessage): ConversationMessageRole {
  return message.role === 'assistant' ? 'assistant' : 'user';
}

/**
 * Build our `ConversationMessage` from a raw SDK message envelope. The SDK
 * emits messages separately from parts — parts arrive via their own
 * `message.part.updated` events. So the mapped message carries an empty
 * `parts: []` and the renderer reducer composes parts by `messageID` key.
 */
export function mapMessage(message: SdkMessage): ConversationMessage {
  const isAssistant = message.role === 'assistant';
  const asAssistant = isAssistant ? (message as AssistantMessage) : null;
  const asUser = !isAssistant ? (message as UserMessage) : null;

  return {
    id: message.id,
    sessionId: message.sessionID,
    parentId: asAssistant?.parentID ?? null,
    role: mapRole(message),
    parts: [], // parts arrive via message.part.updated
    modelId: asAssistant?.modelID ?? asUser?.model?.modelID,
    providerId: asAssistant?.providerID ?? asUser?.model?.providerID,
    agent: asAssistant?.agent ?? asUser?.agent,
    mode: asAssistant?.mode,
    finish: asAssistant?.finish,
    error: asAssistant?.error
      ? 'data' in asAssistant.error &&
        typeof asAssistant.error.data === 'object' &&
        asAssistant.error.data &&
        'message' in asAssistant.error.data &&
        typeof asAssistant.error.data.message === 'string'
        ? asAssistant.error.data.message
        : asAssistant.error.name
      : undefined,
    errorName: asAssistant?.error?.name,
    variant: asAssistant?.variant ?? asUser?.model?.variant,
    createdAt: message.time.created,
    completedAt: asAssistant?.time.completed,
    tokens: asAssistant?.tokens,
    cost: asAssistant?.cost,
    path: asAssistant?.path
      ? { cwd: asAssistant.path.cwd, root: asAssistant.path.root }
      : undefined,
  };
}
