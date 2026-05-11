import {
  saveAttachment,
  saveNamedAttachment,
  resolveAttachmentPath,
} from '../../attachment-store';
import { getRegisteredConnectionBySessionId } from './database';
import { createLogger } from '../../utils/logger';
import { toProviderReasoningVariant } from '../../../shared/reasoning-variant';
import { reconcileDeliveryAfterTimeout } from './injector-reconcile';
import { sessionMessages, sessionPromptAsync } from './session-api';
import { errorMessage } from '../../utils/errors';

const log = createLogger('injector');

/**
 * Resolve the agent currently associated with an OpenCode session by
 * inspecting the most recent message that carries an `agent` value.
 *
 * Why this exists:
 *   When we POST a `noReply:true` system-reminder to OpenCode without an
 *   `agent` field, OpenCode's `createUserMessage` falls back to its global
 *   `defaultAgent()` — which returns the first visible primary agent. If
 *   that differs from the session's actual agent (e.g. injecting into a
 *   subagent session like "librarian"), OpenCode emits `AgentSwitched`
 *   and persists the wrong agent on the session row, contaminating every
 *   subsequent assistant message on that session.
 *
 *   By passing back the session's existing agent on every silent
 *   injection, we keep OpenCode on the correct agent rail.
 *
 * Returns `null` on any failure so callers can fall through to whatever
 * default behaviour they had before — this is a defence-in-depth helper
 * and must never break the injection path.
 */
async function resolveSessionAgent(
  port: number,
  openCodeSessionId: string,
  directory: string | undefined,
): Promise<string | null> {
  try {
    const response = await sessionMessages(
      port,
      openCodeSessionId,
      { limit: 50 },
      {
        directory,
        signal: AbortSignal.timeout(3000),
      },
    );
    if (response.error) return null;

    const messages = response.data as
      | Array<{ info?: { agent?: string; role?: string } }>
      | undefined;
    if (!messages || messages.length === 0) return null;

    // Walk newest-first to find the most recent message with an `agent`.
    for (let i = messages.length - 1; i >= 0; i--) {
      const candidate = messages[i]?.info?.agent;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const SUPPORTED_FILE_EXTENSIONS: string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'txt',
  'md',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'yml',
  'yaml',
  'toml',
  'xml',
  'csv',
  'log',
  'sh',
  'bash',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
];

export interface Attachment {
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

/** Optional model override for message injection. */
export interface ModelOverride {
  /** Provider ID (e.g., 'anthropic', 'openai'). */
  providerId: string;
  /** Model ID (e.g., 'claude-sonnet-4-20250514'). */
  modelId: string;
  /** Optional variant/effort level (e.g., 'low', 'medium', 'high'). */
  variant?: string;
}

export async function injectOpenCodeMessage(
  openCodeSessionId: string,
  message: string,
  attachments: Attachment[] | undefined,
  openCodePort: number,
  mcpServerPort?: number,
  noReply = true,
  modelOverride?: ModelOverride,
  /** Optional system-level message (injected into model's system prompt). */
  systemMessage?: string,
  /**
   * Optional OpenCode agent name (e.g. 'build', 'plan', 'docs-maintainer').
   * Forwarded to OpenCode as the `agent` field on `prompt_async`. Whitespace
   * is trimmed; empty/whitespace-only values are omitted entirely so OpenCode
   * falls back to its default agent.
   */
  agent?: string,
): Promise<{ ok: boolean; error?: string; noReply?: boolean }> {
  log.info(
    `[injectOpenCodeMessage] Starting injection to session ${openCodeSessionId}`,
  );
  log.info(
    `[injectOpenCodeMessage] Message: "${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`,
  );
  log.info(`[injectOpenCodeMessage] noReply: ${noReply}`);
  log.info(`[injectOpenCodeMessage] attachments: ${attachments?.length ?? 0}`);
  log.info(
    `[injectOpenCodeMessage] modelOverride: ${JSON.stringify(modelOverride)}`,
  );
  log.info(
    `[injectOpenCodeMessage] systemMessage: ${systemMessage ? `${systemMessage.length} chars` : 'none'}`,
  );
  const trimmedAgent = agent?.trim();
  log.info(
    `[injectOpenCodeMessage] agent: ${trimmedAgent && trimmedAgent.length > 0 ? trimmedAgent : '(none)'}`,
  );
  // Capture raw model override values to detect malformed/empty selections.
  if (modelOverride) {
    log.info(
      `[injectOpenCodeMessage] modelOverride fields providerId=${modelOverride.providerId ?? '(none)'} modelId=${modelOverride.modelId ?? '(none)'} variant=${modelOverride.variant ?? '(none)'}`,
    );
  }

  // Build the full message text: start with the user's message, then append
  // temp-file references for attachments. This mirrors the non-desktop tool's
  // file-path handoff instead of inlining content or using localhost URLs.
  let fullText = message;
  for (const att of attachments ?? []) {
    if (att.mimeType.startsWith('image/')) {
      // Save image to the per-session tmpdir folder and reference by absolute path.
      const filename = saveAttachment(
        openCodeSessionId,
        att.data,
        att.mimeType,
      );
      const absPath = filename
        ? resolveAttachmentPath(openCodeSessionId, filename)
        : null;
      if (absPath) {
        fullText += `\n\n[Image file: ${absPath}]`;
      } else if (filename) {
        fullText += `\n\n[Image attached: ${att.name}]`;
      }
    } else {
      const isTextLike =
        att.mimeType.startsWith('text/') ||
        /\b(json|xml|yaml|yml|toml|javascript|typescript)\b/i.test(
          att.mimeType,
        );
      const filename = saveNamedAttachment(
        openCodeSessionId,
        att.name,
        att.data,
        isTextLike ? 'utf8' : 'base64',
      );
      const absPath = filename
        ? resolveAttachmentPath(openCodeSessionId, filename)
        : null;

      if (absPath) {
        const label = isTextLike ? 'Text file' : 'Binary file';
        fullText += `\n\n[${label}: ${absPath}]`;
      } else {
        fullText += isTextLike
          ? `\n\n--- File: ${att.name} ---\n${att.data}`
          : `\n\n[Binary file attached: ${att.name}]`;
      }
    }
  }

  const parts: { type: 'text'; text: string }[] = [
    { type: 'text', text: fullText },
  ];

  // Build model configuration if provided
  let model: { providerID: string; modelID: string } | undefined;
  let variant: string | undefined;

  if (modelOverride) {
    const providerId = modelOverride.providerId?.trim();
    const modelId = modelOverride.modelId?.trim();

    if (!providerId || !modelId) {
      log.warn(
        '[injectOpenCodeMessage] Skipping model override because providerId or modelId is empty',
      );
    } else {
      model = {
        providerID: providerId,
        modelID: modelId,
      };
      const providerVariant = toProviderReasoningVariant(modelOverride.variant);
      if (providerVariant) {
        variant = providerVariant;
      }
    }
  }

  // 120 second timeout for all requests - handles network latency, server load,
  // and OpenCode compaction which can block the message endpoint for extended periods
  const timeoutMs = 120000;
  // Retry once on timeout for noReply injections only.
  // For user-facing injections (noReply=false), retrying can duplicate the
  // same user message if the first request reached OpenCode but the response
  // timed out locally.
  const maxRetries = noReply ? 1 : 0;
  const retryDelayMs = 5000; // 5 second delay between retries
  const reconcileTimeoutMs = 5000;
  const reconcileMessageLimit = 20;
  const reconcileAttempts = 3;

  /** Helper to detect timeout errors */
  const isTimeoutError = (err: unknown): boolean => {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      err.name === 'TimeoutError'
    );
  };

  /**
   * After a user-facing timeout (noReply=false), check whether the message was
   * actually accepted by OpenCode. If confirmed, we can return success without
   * retrying the POST and risking duplicate user messages.
   */
  const confirmDeliveredAfterTimeout = async (): Promise<boolean> => {
    return reconcileDeliveryAfterTimeout({
      noReply,
      openCodePort,
      openCodeSessionId,
      fullText,
      message,
      reconcileTimeoutMs,
      reconcileMessageLimit,
      reconcileAttempts,
      log,
    });
  };

  /** Attempt a single injection request using the SDK */
  const attemptInject = async (
    attempt: number,
  ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> => {
    const startTime = Date.now();
    log.info(
      `[injectOpenCodeMessage] Attempt ${attempt + 1}/${maxRetries + 1} - Sending promptAsync request via SDK`,
    );

    try {
      const registered = await getRegisteredConnectionBySessionId(
        openCodeSessionId,
        'opencode',
      );

      // Build the request body for SDK
      const requestBody: {
        noReply: boolean;
        parts: { type: 'text'; text: string }[];
        model?: { providerID: string; modelID: string };
        variant?: string;
        system?: string;
        agent?: string;
      } = {
        noReply,
        parts,
      };

      if (model) {
        requestBody.model = model;
      }
      if (variant) {
        requestBody.variant = variant;
      }
      if (systemMessage) {
        requestBody.system = systemMessage;
      }

      // Without an explicit `agent`, OpenCode falls back to `defaultAgent()`
      // (the first visible primary agent), which on subagent sessions
      // triggers `AgentSwitched` and contaminates every later message.
      // Resolve the session's current agent and pass it back to keep
      // OpenCode on the correct rail.
      let effectiveAgent: string | undefined =
        trimmedAgent && trimmedAgent.length > 0 ? trimmedAgent : undefined;

      if (!effectiveAgent) {
        const resolved = await resolveSessionAgent(
          openCodePort,
          openCodeSessionId,
          registered?.baseDirectory ?? undefined,
        );
        if (resolved) {
          effectiveAgent = resolved;
          log.info(
            `[injectOpenCodeMessage] resolved session agent from history: ${resolved} (session=${openCodeSessionId})`,
          );
        }
      }

      if (effectiveAgent) {
        requestBody.agent = effectiveAgent;
      }

      log.info(
        `[injectOpenCodeMessage] SDK request body: ${JSON.stringify(requestBody)} directory=${registered?.baseDirectory ?? '(none)'}`,
      );

      // Use SDK's promptAsync method with timeout via AbortSignal
      const response = await sessionPromptAsync(
        openCodePort,
        openCodeSessionId,
        requestBody,
        {
          directory: registered?.baseDirectory ?? undefined,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );

      const elapsedMs = Date.now() - startTime;

      // Check if the response indicates an error
      if (response.error) {
        const errorMsg = `OpenCode SDK error: ${JSON.stringify(response.error)}`;
        log.error(
          `inject failed for session ${openCodeSessionId}: ${errorMsg}`,
        );
        console.error(
          `[Inject Error] ${errorMsg} (session: ${openCodeSessionId})`,
        );
        return { ok: false, error: errorMsg, noReply };
      }

      log.info(
        `[injectOpenCodeMessage] SDK injection successful for session ${openCodeSessionId} (took ${elapsedMs}ms)`,
      );
      return { ok: true, noReply };
    } catch (err) {
      const rawMsg = errorMessage(err);
      const isTimeout = isTimeoutError(err);

      if (isTimeout && !noReply) {
        const delivered = await confirmDeliveredAfterTimeout();
        if (delivered) {
          return { ok: true, noReply };
        }
      }

      const errorContext = {
        session: openCodeSessionId,
        timeout: `${timeoutMs}ms`,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        error: rawMsg,
        errorName: err instanceof Error ? err.name : 'Unknown',
        isTimeout,
        timestamp: new Date().toISOString(),
      };

      log.error(
        `inject attempt ${attempt + 1} failed for session ${openCodeSessionId}: ${rawMsg}${isTimeout ? ` (timeout after ${timeoutMs / 1000}s)` : ''} | Context: ${JSON.stringify(errorContext)}`,
      );
      console.error(
        `[Inject Error] ${isTimeout ? `TIMEOUT after ${timeoutMs / 1000}s` : 'FAILED'} for session ${openCodeSessionId} (attempt ${attempt + 1}/${maxRetries + 1}):`,
        errorContext,
      );

      // Return with isTimeout flag for retry logic
      return {
        ok: false,
        error: rawMsg,
        noReply,
        // @ts-expect-error - internal flag for retry logic
        _isTimeout: isTimeout,
      };
    }
  };

  log.info(`[injectOpenCodeMessage] Starting injection with SDK promptAsync`);

  // First attempt
  let result = await attemptInject(0);
  if (result.ok) return result;

  // Retry on timeout errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((result as any)._isTimeout && maxRetries > 0) {
    log.info(
      `[injectOpenCodeMessage] Timeout detected, retrying in ${retryDelayMs / 1000}s...`,
    );
    console.log(
      `[Inject] Timeout during injection, retrying in ${retryDelayMs / 1000}s (OpenCode may be compacting)...`,
    );

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    result = await attemptInject(1);
    if (result.ok) return result;
  }

  // All attempts failed - return user-friendly error
  const userMsg =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)._isTimeout
      ? 'Request timed out — OpenCode may be busy with compaction. Try again in a moment.'
      : (result.error ?? 'Unknown error');

  return { ok: false, error: userMsg, noReply };
}
