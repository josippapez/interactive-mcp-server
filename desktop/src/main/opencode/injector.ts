import { saveAttachment, attachmentUrl } from '../attachment-store';
import { getRegisteredConnectionBySessionId } from '../database';
import { createLogger } from '../utils/logger';
import { toProviderReasoningVariant } from '../../shared/reasoning-variant';
import { reconcileDeliveryAfterTimeout } from './injector-reconcile';
import { sessionPromptAsync } from './session-api';
import { errorMessage } from '../utils/errors';

const log = createLogger('injector');

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
  // Capture raw model override values to detect malformed/empty selections.
  if (modelOverride) {
    log.info(
      `[injectOpenCodeMessage] modelOverride fields providerId=${modelOverride.providerId ?? '(none)'} modelId=${modelOverride.modelId ?? '(none)'} variant=${modelOverride.variant ?? '(none)'}`,
    );
  }

  // Build the full message text: start with the user's message, then append
  // attachment references. Images are saved to persistent storage and
  // referenced by URL (served via the MCP server). Text files are inlined.
  let fullText = message;
  for (const att of attachments ?? []) {
    if (att.mimeType.startsWith('image/')) {
      // Save image to persistent attachment store and reference by URL
      const filename = saveAttachment(att.data, att.mimeType);
      if (filename && mcpServerPort) {
        const imageUrl = attachmentUrl(filename, mcpServerPort);
        fullText += `\n\n[Image: ${att.name}](${imageUrl})`;
      } else if (filename) {
        // Fallback: reference the file by name (no port available)
        fullText += `\n\n[Image attached: ${att.name}]`;
      }
    } else {
      // Text file: inline the content
      fullText += `\n\n--- File: ${att.name} ---\n${att.data}`;
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
      const registered = getRegisteredConnectionBySessionId(
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
