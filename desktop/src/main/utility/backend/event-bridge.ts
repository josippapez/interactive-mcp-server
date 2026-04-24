/**
 * event-bridge.ts — map raw SDK `GlobalEvent` payloads → ConversationEvent[]
 *
 * Single responsibility: convert the opencode SDK's generated event shapes
 * (`EventMessageUpdated`, `EventMessagePartUpdated`, `EventMessagePartDelta`,
 * `EventMessageRemoved`, `EventSessionStatus`, `EventSessionIdle`,
 * `EventSessionError`, `EventSessionCompacted`) into the desktop-app's
 * `ConversationEvent` union (defined in `preload/api/types.ts`).
 *
 * Kept deliberately minimal:
 *   - No coalescing, no batching, no IPC — that's `event-stream.ts`.
 *   - No side effects, no I/O — pure mapping for testability.
 *   - Unknown part types (step-start, step-finish, patch, subtask, snapshot,
 *     agent, retry, file internal, etc.) are skipped via `SKIP_PART_TYPES`,
 *     mirroring opencode TUI's `SKIP_PARTS` set.
 *
 * Reference:
 *   /Users/josippapez/Desktop/opencode/packages/app/src/context/global-sync/event-reducer.ts
 *   /Users/josippapez/Desktop/opencode/packages/sdk/js/src/v2/gen/types.gen.ts
 */

import type {
  AssistantMessage,
  Event as SdkEvent,
  UserMessage,
} from '@opencode-ai/sdk/v2/client';
import type { ConversationEvent } from '../../../preload/api/types';
import { mapMessage, mapPart } from '../../../shared/opencode-mapping';
import {
  computeContextUsage,
  getSessionContextUsage,
} from './context-tracking';

// Re-export the shared mappers so existing callers inside this backend
// package can continue importing them from `./event-bridge`.
export { mapMessage, mapPart };

// ─── Top-level dispatch ──────────────────────────────────────────────────────

/**
 * Bridge state — tracks sessions whose `session.compacted` event arrived,
 * so the NEXT `message.updated` for that session can be emitted as a
 * synthetic `session.compaction-done` event with before/after token counts.
 *
 * The v2 SDK `EventSessionCompacted` payload does NOT carry token counts
 * (see types.gen.d.ts: only `sessionID`). We snapshot the pre-compaction
 * total from our context-tracking accumulator at compaction time, then
 * read the post-compaction total from the first message.updated we see
 * after. This matches the contract the legacy `session-compacted` IPC
 * channel advertised.
 */
type PendingCompaction = {
  beforeTokens: number;
};
const pendingCompactions = new Map<string, PendingCompaction>();

/**
 * Envelope-level metadata the bridge needs from the SDK `GlobalEvent`
 * wrapper (not every caller has it — tests and historical call sites
 * pass only the payload). When absent we degrade gracefully: `file.edited`
 * events produce `directory: null`.
 */
export type BridgeEnvelope = {
  directory?: string | null;
  /** Port of the OpenCode server, used for async model-limit lookups. */
  port?: number;
};

/**
 * Convert a raw SDK `Event` payload into zero or more `ConversationEvent`s
 * for the main-process pump. Returns `[]` for payload types we don't
 * mirror.
 *
 * Optional `envelope` carries fields from the outer `GlobalEvent` wrapper
 * (`directory`, `port`) needed by certain event types (notably
 * `file.edited` which requires the project directory).
 */
export function bridgeEvent(
  payload: SdkEvent,
  envelope?: BridgeEnvelope,
): ConversationEvent[] {
  switch (payload.type) {
    case 'message.updated': {
      const events: ConversationEvent[] = [
        {
          type: 'message.updated',
          sessionId: payload.properties.sessionID,
          message: mapMessage(payload.properties.info),
        },
      ];

      // Context usage hook — emit a synthetic `context.usage` whenever
      // an assistant message carries token data.
      const info = payload.properties.info;
      const usage = computeContextUsage(
        {
          id: info.id,
          sessionID: info.sessionID,
          role: info.role,
          modelID:
            info.role === 'assistant'
              ? (info as AssistantMessage).modelID
              : (info as UserMessage).model?.modelID,
          providerID:
            info.role === 'assistant'
              ? (info as AssistantMessage).providerID
              : (info as UserMessage).model?.providerID,
          tokens:
            info.role === 'assistant'
              ? (info as AssistantMessage).tokens
              : undefined,
        },
        envelope?.port,
      );
      if (usage) {
        events.push({
          type: 'context.usage',
          sessionId: usage.sessionId,
          totalTokens: usage.totalTokens,
          contextLimit: usage.contextLimit,
          usableLimit: usage.usableLimit,
          usagePercent: usage.usagePercent,
          isNearOverflow: usage.isNearOverflow,
          isOverflow: usage.isOverflow,
        });

        // If we were awaiting compaction-done for this session, emit it
        // now using the pre-compaction snapshot and the new post-
        // compaction total.
        const pending = pendingCompactions.get(usage.sessionId);
        if (pending) {
          pendingCompactions.delete(usage.sessionId);
          events.push({
            type: 'session.compaction-done',
            sessionId: usage.sessionId,
            beforeTokens: pending.beforeTokens,
            afterTokens: usage.totalTokens,
          });
        }
      }

      return events;
    }

    case 'message.removed': {
      return [
        {
          type: 'message.removed',
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.messageID,
        },
      ];
    }

    case 'message.part.updated': {
      const mapped = mapPart(payload.properties.part);
      if (!mapped) return [];
      return [
        {
          type: 'message.part.updated',
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.part.messageID,
          part: mapped,
        },
      ];
    }

    case 'message.part.delta': {
      // Forward both `text` (TextPart.text) and `reasoning`
      // (ReasoningPart.text) deltas. Other fields (future SDK additions)
      // ignored until proven necessary.
      const { field } = payload.properties;
      if (field !== 'text' && field !== 'reasoning') return [];
      return [
        {
          type: 'message.part.delta',
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.messageID,
          partId: payload.properties.partID,
          field,
          delta: payload.properties.delta,
        },
      ];
    }

    case 'message.part.removed': {
      return [
        {
          type: 'message.part.removed',
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.messageID,
          partId: payload.properties.partID,
        },
      ];
    }

    case 'session.status': {
      // SDK `SessionStatus` is a discriminated union `{type: 'idle' | 'retry' | 'busy'}`.
      // Map to our coarse streaming/idle/error triplet.
      const kind = payload.properties.status?.type;
      let status: 'idle' | 'streaming' | 'error';
      if (kind === 'busy' || kind === 'retry') {
        status = 'streaming';
      } else {
        status = 'idle';
      }
      return [
        {
          type: 'session.status',
          sessionId: payload.properties.sessionID,
          status,
        },
      ];
    }

    case 'session.idle': {
      return [
        {
          type: 'session.status',
          sessionId: payload.properties.sessionID,
          status: 'idle',
        },
      ];
    }

    case 'session.error': {
      const sessionID = payload.properties.sessionID;
      if (!sessionID) return [];
      const err = payload.properties.error;
      const errorMsg =
        (err && 'message' in err && typeof err.message === 'string'
          ? err.message
          : undefined) ??
        (err && 'name' in err && typeof err.name === 'string'
          ? err.name
          : undefined) ??
        'Unknown error';
      return [
        {
          type: 'session.status',
          sessionId: sessionID,
          status: 'error',
          error: errorMsg,
        },
      ];
    }

    case 'session.compacted': {
      const sessionID = payload.properties.sessionID;
      // Snapshot the pre-compaction token count; emit `session.compaction-done`
      // on the next `message.updated` for this session.
      const existing = getSessionContextUsage(sessionID);
      pendingCompactions.set(sessionID, {
        beforeTokens: existing?.totalTokens ?? 0,
      });
      return [
        {
          type: 'session.compacted',
          sessionId: sessionID,
          // compacted doesn't carry messageId in current SDK; use sessionId
          // placeholder. Renderer uses this to clear/trim message list.
          messageId: sessionID,
        },
      ];
    }

    case 'todo.updated': {
      return [
        {
          type: 'todo.updated',
          sessionId: payload.properties.sessionID,
          // SDK `Todo` has no `id` field — synthesise one from index so
          // the reducer keys stay stable within a single update.
          todos: payload.properties.todos.map((t, i) => ({
            id: `todo-${i}`,
            content: t.content,
            status: t.status as
              | 'pending'
              | 'in_progress'
              | 'completed'
              | 'cancelled',
            priority: t.priority as 'high' | 'medium' | 'low',
          })),
        },
      ];
    }

    case 'vcs.branch.updated': {
      return [
        {
          type: 'vcs.updated',
          branch: payload.properties.branch ?? null,
        },
      ];
    }

    case 'file.edited': {
      return [
        {
          type: 'file.edited',
          directory: envelope?.directory ?? null,
          file: payload.properties.file,
        },
      ];
    }

    // ── Permission prompts ────────────────────────────────────────────
    // Note: auto-approve short-circuit runs out-of-band in
    // `event-stream.ts` before `bridgeEvent` is called, so any
    // `permission.asked` payload that reaches here is a request the
    // user must resolve interactively.
    case 'permission.asked': {
      const p = payload.properties;
      return [
        {
          type: 'permission.asked',
          sessionId: p.sessionID,
          requestId: p.id,
          permission: p.permission,
          patterns: p.patterns,
          always: p.always,
          tool: p.tool,
          metadata: p.metadata,
        },
      ];
    }

    case 'permission.replied': {
      const p = payload.properties;
      return [
        {
          type: 'permission.replied',
          sessionId: p.sessionID,
          requestId: p.requestID,
          reply: p.reply,
        },
      ];
    }

    // ── Question prompts ──────────────────────────────────────────────
    case 'question.asked': {
      const p = payload.properties;
      return [
        {
          type: 'question.asked',
          sessionId: p.sessionID,
          requestId: p.id,
          questions: p.questions,
          tool: p.tool,
        },
      ];
    }

    case 'question.replied': {
      const p = payload.properties;
      return [
        {
          type: 'question.cleared',
          sessionId: p.sessionID,
          requestId: p.requestID,
          outcome: 'replied',
        },
      ];
    }

    case 'question.rejected': {
      const p = payload.properties;
      return [
        {
          type: 'question.cleared',
          sessionId: p.sessionID,
          requestId: p.requestID,
          outcome: 'rejected',
        },
      ];
    }

    // ── Low-risk additions: surface SDK signals for future consumers ──
    case 'session.diff': {
      return [
        {
          type: 'session.diff',
          sessionId: payload.properties.sessionID,
          diff: payload.properties.diff,
        },
      ];
    }

    case 'mcp.tools.changed': {
      return [
        {
          type: 'mcp.tools.changed',
          server: payload.properties.server,
        },
      ];
    }

    case 'mcp.browser.open.failed': {
      return [
        {
          type: 'mcp.browser.open.failed',
          mcpName: payload.properties.mcpName,
          url: payload.properties.url,
        },
      ];
    }

    case 'installation.update-available': {
      return [
        {
          type: 'installation.update-available',
          version: payload.properties.version,
        },
      ];
    }

    default:
      // permission.* and question.* are handled out-of-band in event-stream.ts
      // All other payload types are outside this channel's scope today.
      return [];
  }
}

// ─── Orphan IPC retirement note ──────────────────────────────────────────────
// C5 merge complete: the legacy IPC channels (opencode-todo-updated,
// opencode-vcs-updated, opencode-session-status, opencode-session-idle,
// opencode-session-error, opencode-file-edited, context-usage-updated,
// session-compacted, conversation-message-event, conversation-part-event,
// conversation-part-delta, todos-updated) are now retired — all live
// updates flow through the `conversation-batch` IPC channel via the
// ConversationEvent union.
