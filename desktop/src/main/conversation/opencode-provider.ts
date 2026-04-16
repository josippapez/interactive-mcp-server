/**
 * OpenCode conversation provider.
 *
 * Implements the ConversationProvider interface for OpenCode,
 * fetching messages via the REST API and subscribing to real-time
 * updates via SSE.
 */

import { getClient } from '../opencode/sdk-client';
import type {
  ConversationProvider,
  ConversationMessage,
  ConversationEvent,
  ConversationEventCallback,
  MessagePart,
  MessageRole,
  PartType,
} from './types';

// ─── OpenCode API Types ─────────────────────────────────────────────────────

interface OpenCodeMessageInfo {
  id: string;
  sessionID: string;
  parentID?: string | null;
  role: 'user' | 'assistant' | 'system';
  mode?: string;
  agent?: string;
  modelID?: string;
  providerID?: string;
  /** Reasoning effort variant (e.g., 'low', 'medium', 'high', 'xhigh'). */
  variant?: string;
  /** User messages have variant inside model object. */
  model?: {
    providerID?: string;
    modelID?: string;
    variant?: string;
  };
  cost?: number;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { write?: number; read?: number };
  };
  time?: {
    created?: number;
    completed?: number;
  };
  /** Working directory path info. */
  path?: {
    cwd?: string;
    root?: string;
  };
  finish?: string;
}

interface OpenCodePart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    /** Tool state metadata (e.g., sessionId for Task tool subagents). */
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  time?: {
    start?: number;
    end?: number;
  };
  /** Source URL (for 'source-url' parts). */
  url?: string;
  /** Source title (for 'source-url' parts). */
  title?: string;
  /** Source ID (for 'source-url' parts). */
  sourceId?: string;
  /** File media type (for 'file' parts). */
  mediaType?: string;
  /** File name (for 'file' parts). */
  filename?: string;
}

interface OpenCodeMessageResponse {
  info: OpenCodeMessageInfo;
  parts: OpenCodePart[];
}

// ─── Part Type Mapping ──────────────────────────────────────────────────────

function mapPartType(type: string): PartType {
  switch (type) {
    case 'text':
      return 'text';
    case 'reasoning':
      return 'reasoning';
    case 'tool':
      return 'tool-call';
    case 'tool-result':
      return 'tool-result';
    case 'image':
      return 'image';
    case 'file':
      return 'file';
    case 'step-start':
      return 'step-start';
    case 'step-end':
      return 'step-end';
    case 'compaction':
      return 'compaction';
    case 'source-url':
      return 'source-url';
    default:
      return 'unknown';
  }
}

function mapToolStatus(
  status?: string,
): 'pending' | 'running' | 'completed' | 'error' {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'pending';
  }
}

// ─── OpenCode Provider Implementation ───────────────────────────────────────

export class OpenCodeConversationProvider implements ConversationProvider {
  readonly providerId = 'opencode';
  readonly supportsStreaming = true;

  private port: number;
  private sseAbortController: AbortController | null = null;
  private subscribers = new Map<
    string | null,
    Set<ConversationEventCallback>
  >();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(port: number = 4096) {
    this.port = port;
  }

  /**
   * Update the OpenCode port (e.g., after config change).
   */
  setPort(port: number): void {
    this.port = port;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = getClient(this.port);
      // Use session.list() as a health check since SDK doesn't have global.health
      const result = await client.session.list(undefined, {
        signal: AbortSignal.timeout(3000),
      });
      return !result.error;
    } catch {
      return false;
    }
  }

  async fetchMessages(
    sessionId: string,
    limit = 100,
  ): Promise<ConversationMessage[]> {
    console.log(
      `[opencode-conversation] fetchMessages called: sessionId=${sessionId} limit=${limit}`,
    );
    try {
      const client = getClient(this.port);
      // SDK expects { path: { id }, query: { limit } } structure
      const result = await client.session.messages({
        path: { id: sessionId },
        query: { limit },
      });

      console.log(
        `[opencode-conversation] fetchMessages result: error=${JSON.stringify(result.error) ?? 'none'} dataLength=${Array.isArray(result.data) ? result.data.length : 'N/A'}`,
      );

      if (result.error || !result.data) {
        console.warn(
          `[opencode-conversation] Failed to fetch messages: ${JSON.stringify(result.error)}`,
        );
        return [];
      }

      const data = result.data as OpenCodeMessageResponse[];
      const mapped = data.map((msg) => this.mapMessage(msg));
      console.log(
        `[opencode-conversation] Returning ${mapped.length} mapped messages`,
      );
      return mapped;
    } catch (err) {
      console.warn('[opencode-conversation] Error fetching messages:', err);
      return [];
    }
  }

  subscribe(
    sessionId: string | null,
    callback: ConversationEventCallback,
  ): () => void {
    let subs = this.subscribers.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sessionId, subs);
    }
    subs.add(callback);

    // Return unsubscribe function
    return () => {
      subs?.delete(callback);
      if (subs?.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  async start(): Promise<void> {
    if (this.sseAbortController) {
      return; // Already running
    }
    await this.connectSse();
  }

  stop(): void {
    this.sseAbortController?.abort();
    this.sseAbortController = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribers.clear();
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private async connectSse(): Promise<void> {
    const controller = new AbortController();
    this.sseAbortController = controller;

    try {
      const client = getClient(this.port);
      const result = await client.event.subscribe(
        {},
        { signal: controller.signal },
      );

      if (!result.stream) {
        throw new Error('SSE connection failed: no stream');
      }

      console.log('[opencode-conversation] SSE connected via SDK');

      for await (const event of result.stream) {
        if (controller.signal.aborted) break;
        this.handleSseEvent(event);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return; // Normal shutdown
      }
      console.warn('[opencode-conversation] SSE error, reconnecting:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectSse();
    }, 2000);
  }

  private handleSseEvent(event: unknown): void {
    if (!event || typeof event !== 'object') return;

    // The /event endpoint sends events in unwrapped format: { type, properties }
    // NOT the wrapped format used by /global/event: { payload: { type, properties } }
    const { type, properties } = event as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    if (!type || !properties) return;

    // Debug: log event types (except heartbeats)
    // if (type !== 'server.heartbeat' && type !== 'server.connected') {
    //   console.log('[opencode-conversation] SSE event:', type);
    // }

    // Handle message events
    if (type === 'message.created' || type === 'message.updated') {
      const sessionId = properties['sessionID'] as string | undefined;
      if (!sessionId) return;

      // Emit to subscribers
      const convEvent: ConversationEvent = {
        type: type as ConversationEvent['type'],
        sessionId,
        messageId: properties['messageID'] as string | undefined,
      };

      this.emit(sessionId, convEvent);
    }

    // Handle part events (full part update)
    if (type === 'message.part.updated') {
      const sessionId = properties['sessionID'] as string | undefined;
      if (!sessionId) return;

      const part = properties['part'] as OpenCodePart | undefined;
      if (!part) return;

      const convEvent: ConversationEvent = {
        type: 'part.updated',
        sessionId,
        messageId: part.id?.split(':')[0], // Extract messageId from part id if available
        part: this.mapPart(part),
      };

      this.emit(sessionId, convEvent);
    }

    // NOTE: message.part.delta events are handled by bus-events.ts which subscribes
    // to /global/event. We intentionally don't emit them here to avoid duplicate
    // events being sent to the renderer.

    // Legacy part.added/part.updated handling (kept for backward compatibility)
    if (type === 'part.added' || type === 'part.updated') {
      const sessionId = properties['sessionID'] as string | undefined;
      if (!sessionId) return;

      const convEvent: ConversationEvent = {
        type: type as ConversationEvent['type'],
        sessionId,
        messageId: properties['messageID'] as string | undefined,
        part: this.mapPart(properties as unknown as OpenCodePart),
      };

      this.emit(sessionId, convEvent);
    }
  }

  private emit(sessionId: string, event: ConversationEvent): void {
    // Emit to session-specific subscribers
    const sessionSubs = this.subscribers.get(sessionId);
    if (sessionSubs) {
      for (const cb of sessionSubs) {
        try {
          cb(event);
        } catch (err) {
          console.warn('[opencode-conversation] Subscriber error:', err);
        }
      }
    }

    // Emit to global subscribers (sessionId = null)
    const globalSubs = this.subscribers.get(null);
    if (globalSubs) {
      for (const cb of globalSubs) {
        try {
          cb(event);
        } catch (err) {
          console.warn('[opencode-conversation] Subscriber error:', err);
        }
      }
    }
  }

  private mapMessage(msg: OpenCodeMessageResponse): ConversationMessage {
    // Extract variant: assistant messages have it directly, user messages have it in model object
    const variant = msg.info.variant ?? msg.info.model?.variant ?? undefined;

    return {
      id: msg.info.id,
      sessionId: msg.info.sessionID,
      parentId: msg.info.parentID,
      role: msg.info.role as MessageRole,
      parts: msg.parts.map((p) => this.mapPart(p)),
      modelId: msg.info.modelID,
      providerId: msg.info.providerID,
      agent: msg.info.agent,
      mode: msg.info.mode,
      variant,
      createdAt: msg.info.time?.created ?? Date.now(),
      completedAt: msg.info.time?.completed,
      tokens: msg.info.tokens
        ? {
            input: msg.info.tokens.input,
            output: msg.info.tokens.output,
            reasoning: msg.info.tokens.reasoning,
            total: msg.info.tokens.total,
            cache: msg.info.tokens.cache
              ? {
                  read: msg.info.tokens.cache.read,
                  write: msg.info.tokens.cache.write,
                }
              : undefined,
          }
        : undefined,
      cost: msg.info.cost,
      path: msg.info.path,
    };
  }

  private mapPart(part: OpenCodePart): MessagePart {
    return {
      id: part.id,
      type: mapPartType(part.type),
      text: part.text,
      toolName: part.tool,
      toolCallId: part.callID,
      toolInput: part.state?.input,
      toolOutput: part.state?.output,
      toolStatus: part.state?.status
        ? mapToolStatus(part.state.status)
        : undefined,
      // Tool metadata (e.g., sessionId for Task tool) is stored in state.metadata, not part.metadata
      toolMetadata: part.state?.metadata ?? part.metadata,
      // Source URL fields
      sourceUrl: part.url,
      sourceTitle: part.title,
      sourceId: part.sourceId,
      // File fields
      mediaType: part.mediaType,
      filename: part.filename,
      fileUrl: part.url,
      raw: part,
    };
  }
}

// ─── Singleton Instance ─────────────────────────────────────────────────────

let _instance: OpenCodeConversationProvider | null = null;

export function getOpenCodeConversationProvider(
  port?: number,
): OpenCodeConversationProvider {
  if (!_instance) {
    _instance = new OpenCodeConversationProvider(port);
  } else if (port !== undefined) {
    _instance.setPort(port);
  }
  return _instance;
}
