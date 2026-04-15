/**
 * Context/token tracking for OpenCode sessions.
 *
 * Tracks cumulative token usage per session and provides:
 * - Token usage accumulation from message.updated events
 * - Overflow detection based on model context limits
 * - Compaction triggering via POST /session/:id/summarize
 *
 * Based on OpenCode's overflow detection logic:
 * - COMPACTION_BUFFER = 20_000 tokens (reserved for tool calls/responses)
 * - Overflow when: tokenCount >= contextLimit - COMPACTION_BUFFER
 */

/** Buffer reserved for tool calls and responses (matches OpenCode). */
export const COMPACTION_BUFFER = 20_000;
export const OUTPUT_TOKEN_MAX = 32_000;

/** Default context window if model limit is unknown. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Token usage for a single message. */
export interface MessageTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
  cache?: {
    read?: number;
    write?: number;
  };
}

/** Cumulative context usage for a session. */
export interface ContextUsage {
  /** Session ID. */
  sessionId: string;
  /** Total tokens used in the session (cumulative). */
  totalTokens: number;
  /** Model's context window size (if known). */
  contextLimit: number;
  /** Usable limit after subtracting compaction buffer. */
  usableLimit: number;
  /** Percentage of context used (0-100+). */
  usagePercent: number;
  /** Whether the session is approaching overflow. */
  isNearOverflow: boolean;
  /** Whether the session has exceeded usable limit. */
  isOverflow: boolean;
  /** Last updated timestamp. */
  updatedAt: number;
}

/** Event emitted when context usage changes. */
export interface ContextUsageEvent {
  type: 'context.usage.updated';
  usage: ContextUsage;
}

/** Event emitted when compaction occurs. */
export interface CompactionEvent {
  type: 'session.compacted';
  sessionId: string;
  beforeTokens: number;
  afterTokens: number;
}

// ─── In-memory state ─────────────────────────────────────────────────────────

/** Per-session context usage tracking. */
const _sessionUsage = new Map<string, ContextUsage>();

type ModelLimits = {
  contextWindow: number;
  inputLimit?: number;
  outputLimit?: number;
};

/** Model context limits cache. */
const _modelLimits = new Map<string, ModelLimits>();

function getModelLimitsKey(
  modelId?: string,
  providerId?: string | null,
): string | null {
  if (!modelId) {
    return null;
  }

  return providerId ? `${providerId}:${modelId}` : modelId;
}

// ─── Context limit helpers ───────────────────────────────────────────────────

/**
 * Set the context limit for a model.
 * Called when we receive model info from the provider API.
 */
export function setModelContextLimit(
  modelId: string,
  limit: number | ModelLimits,
  providerId?: string | null,
): void {
  const key = getModelLimitsKey(modelId, providerId);
  if (!key) {
    return;
  }

  if (typeof limit === 'number') {
    _modelLimits.set(key, { contextWindow: limit });
    return;
  }

  _modelLimits.set(key, limit);
}

/**
 * Get the context limit for a model, falling back to default.
 */
export function getModelContextLimit(
  modelId?: string,
  providerId?: string | null,
): number {
  return getModelLimits(modelId, providerId).contextWindow;
}

function getModelLimits(
  modelId?: string,
  providerId?: string | null,
): ModelLimits {
  if (!modelId) {
    return { contextWindow: DEFAULT_CONTEXT_WINDOW };
  }

  const providerKey = getModelLimitsKey(modelId, providerId);
  if (providerKey && _modelLimits.has(providerKey)) {
    return (
      _modelLimits.get(providerKey) ?? {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
      }
    );
  }

  return _modelLimits.get(modelId) ?? { contextWindow: DEFAULT_CONTEXT_WINDOW };
}

function getMaxOutputTokens(
  modelId?: string,
  providerId?: string | null,
): number {
  const outputLimit = getModelLimits(modelId, providerId).outputLimit;
  if (!outputLimit || outputLimit <= 0) {
    return OUTPUT_TOKEN_MAX;
  }

  return Math.min(outputLimit, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX;
}

export function getTokenCount(tokens?: MessageTokens): number {
  if (!tokens) {
    return 0;
  }

  return (
    tokens.total ??
    (tokens.input ?? 0) +
      (tokens.output ?? 0) +
      (tokens.reasoning ?? 0) +
      (tokens.cache?.read ?? 0) +
      (tokens.cache?.write ?? 0)
  );
}

// ─── Usage tracking ──────────────────────────────────────────────────────────

/**
 * Compute context usage metrics from raw values.
 */
function computeUsage(
  sessionId: string,
  totalTokens: number,
  modelId?: string,
  providerId?: string | null,
): ContextUsage {
  const limits = getModelLimits(modelId, providerId);
  const contextLimit = limits.contextWindow;
  const maxOutputTokens = getMaxOutputTokens(modelId, providerId);
  const reserved = Math.min(COMPACTION_BUFFER, maxOutputTokens);
  const usableLimit = Math.max(
    0,
    limits.inputLimit
      ? limits.inputLimit - reserved
      : contextLimit - maxOutputTokens,
  );
  const usagePercent =
    contextLimit > 0 ? Math.round((totalTokens / contextLimit) * 100) : 0;
  const overflowPercent =
    usableLimit > 0 ? Math.round((totalTokens / usableLimit) * 100) : 0;

  return {
    sessionId,
    totalTokens,
    contextLimit,
    usableLimit,
    usagePercent,
    // Near overflow at 80% usage
    isNearOverflow: overflowPercent >= 80 && overflowPercent < 100,
    // Overflow at 100%+ usage
    isOverflow: overflowPercent >= 100,
    updatedAt: Date.now(),
  };
}

/**
 * Update token usage for a session.
 * Called when a message.updated event arrives with token counts.
 *
 * @param sessionId - OpenCode session ID
 * @param tokens - Token usage from the message
 * @param modelId - Model ID for context limit lookup
 * @param replace - If true, replace total tokens; if false, add to existing
 * @returns Updated context usage
 */
export function updateSessionTokens(
  sessionId: string,
  tokens: MessageTokens,
  modelId?: string,
  providerIdOrReplace?: string | boolean | null,
  replace = false,
): ContextUsage {
  const existing = _sessionUsage.get(sessionId);
  const providerId =
    typeof providerIdOrReplace === 'string' ? providerIdOrReplace : undefined;
  const shouldReplace =
    typeof providerIdOrReplace === 'boolean' ? providerIdOrReplace : replace;

  const messageTokens = getTokenCount(tokens);

  // Either replace or accumulate
  const totalTokens = shouldReplace
    ? messageTokens
    : (existing?.totalTokens ?? 0) + messageTokens;

  const usage = computeUsage(sessionId, totalTokens, modelId, providerId);
  _sessionUsage.set(sessionId, usage);

  return usage;
}

/**
 * Set the total token count for a session (replaces existing).
 * Used when we get a definitive token count from the API.
 */
export function setSessionTotalTokens(
  sessionId: string,
  totalTokens: number,
  modelId?: string,
  providerId?: string | null,
): ContextUsage {
  const usage = computeUsage(sessionId, totalTokens, modelId, providerId);
  _sessionUsage.set(sessionId, usage);
  return usage;
}

/**
 * Get current context usage for a session.
 */
export function getSessionContextUsage(sessionId: string): ContextUsage | null {
  return _sessionUsage.get(sessionId) ?? null;
}

/**
 * Clear context usage for a session (e.g., after compaction).
 */
export function clearSessionContextUsage(sessionId: string): void {
  _sessionUsage.delete(sessionId);
}

/**
 * Handle compaction event - reset token count to post-compaction value.
 */
export function handleCompaction(
  sessionId: string,
  afterTokens: number,
  modelId?: string,
  providerId?: string | null,
): ContextUsage {
  return setSessionTotalTokens(sessionId, afterTokens, modelId, providerId);
}

// ─── Compaction API ──────────────────────────────────────────────────────────

export interface CompactionResult {
  ok: boolean;
  error?: string;
}

/**
 * Trigger context compaction for a session.
 *
 * Calls POST /session/:id/summarize which asks the model to summarize
 * the conversation context, reducing token usage.
 *
 * @param sessionId - OpenCode session ID
 * @param openCodePort - OpenCode API port
 * @param options - Optional compaction options
 * @returns Result of the compaction request
 */
export async function triggerCompaction(
  sessionId: string,
  openCodePort: number,
  options: {
    providerId?: string;
    modelId?: string;
    auto?: boolean;
  } = {},
): Promise<CompactionResult> {
  const url = `http://localhost:${openCodePort}/session/${encodeURIComponent(sessionId)}/summarize`;
  const body = {
    providerID: options.providerId,
    modelID: options.modelId,
    auto: options.auto ?? false,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000), // Compaction can take a while
    });

    if (!res.ok) {
      const responseBody = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Compaction failed: ${res.status} - ${responseBody}`,
      };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ─── Fetch current session token count ───────────────────────────────────────

export interface SessionInfo {
  id: string;
  tokens?: number;
  modelId?: string;
  providerId?: string;
}

interface SessionMessageInfo {
  role?: string;
  modelID?: string;
  providerID?: string;
  tokens?: MessageTokens;
}

interface SessionMessageResponse {
  info?: SessionMessageInfo;
}

function getMessageTokenTotal(tokens?: MessageTokens): number | undefined {
  const total = getTokenCount(tokens);
  return total > 0 ? total : undefined;
}

async function fetchLatestAssistantMessageTokens(
  sessionId: string,
  openCodePort: number,
): Promise<{ tokens?: number; modelId?: string; providerId?: string }> {
  try {
    const url = `http://localhost:${openCodePort}/session/${encodeURIComponent(sessionId)}/message?limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      return {};
    }

    const messages = (await res.json()) as SessionMessageResponse[];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const info = messages[index]?.info;
      if (info?.role !== 'assistant') {
        continue;
      }

      const total = getMessageTokenTotal(info.tokens);
      if (!total) {
        continue;
      }

      return {
        tokens: total,
        modelId: info.modelID,
        providerId: info.providerID,
      };
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Fetch current token count for a session from the OpenCode API.
 * This provides an accurate point-in-time token count.
 */
export async function fetchSessionTokens(
  sessionId: string,
  openCodePort: number,
): Promise<SessionInfo | null> {
  try {
    const url = `http://localhost:${openCodePort}/session/${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      id: string;
      tokens?: number;
      model?: { id?: string };
      provider?: { id?: string };
    };

    const fallback =
      data.tokens === undefined
        ? await fetchLatestAssistantMessageTokens(sessionId, openCodePort)
        : null;

    return {
      id: data.id,
      tokens: data.tokens ?? fallback?.tokens,
      modelId: data.model?.id ?? fallback?.modelId,
      providerId: data.provider?.id ?? fallback?.providerId,
    };
  } catch {
    return null;
  }
}

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Clear all tracked usage (for testing). */
export function _clearAllUsageForTest(): void {
  _sessionUsage.clear();
  _modelLimits.clear();
}
