import { sessionMessages, sessionStatus } from './session-api';

type LoggerLike = {
  warn: (message: string) => void;
};

type ReconcileOptions = {
  noReply: boolean;
  openCodePort: number;
  openCodeSessionId: string;
  fullText: string;
  message: string;
  reconcileTimeoutMs: number;
  reconcileMessageLimit: number;
  reconcileAttempts: number;
  log: LoggerLike;
};

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const matchesUserPayload = (
  candidate: string,
  fullText: string,
  message: string,
): boolean => {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedFullText = normalizeText(fullText);
  const normalizedUserMessage = normalizeText(message);

  if (normalizedCandidate === normalizedFullText) return true;
  if (!normalizedUserMessage) return false;

  return normalizedCandidate.includes(normalizedUserMessage);
};

async function isSessionBusy(
  port: number,
  openCodeSessionId: string,
  reconcileTimeoutMs: number,
): Promise<boolean> {
  try {
    const response = await sessionStatus(port, {
      signal: AbortSignal.timeout(reconcileTimeoutMs),
    });

    if (response.error) return false;

    const status = response.data as
      | Record<string, { type?: string } | undefined>
      | undefined;

    return status?.[openCodeSessionId]?.type === 'busy';
  } catch {
    return false;
  }
}

async function hasDeliveredMessage(
  port: number,
  openCodeSessionId: string,
  reconcileTimeoutMs: number,
  reconcileMessageLimit: number,
  fullText: string,
  message: string,
): Promise<boolean> {
  try {
    // SDK v2 flattens path+query params onto the first argument.
    const response = await sessionMessages(
      port,
      openCodeSessionId,
      { limit: reconcileMessageLimit },
      { signal: AbortSignal.timeout(reconcileTimeoutMs) },
    );

    if (response.error) return false;

    const messages = response.data as
      | Array<{
          info?: { role?: string };
          parts?: Array<{ type?: string; text?: string }>;
        }>
      | undefined;

    if (!messages) return false;

    return messages.some((msg) => {
      if (msg.info?.role !== 'user') return false;

      const userText = (msg.parts ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');

      return matchesUserPayload(userText, fullText, message);
    });
  } catch {
    return false;
  }
}

export async function reconcileDeliveryAfterTimeout(
  options: ReconcileOptions,
): Promise<boolean> {
  const {
    noReply,
    openCodePort,
    openCodeSessionId,
    fullText,
    message,
    reconcileTimeoutMs,
    reconcileMessageLimit,
    reconcileAttempts,
    log,
  } = options;

  if (noReply) return false;

  for (let attempt = 0; attempt < reconcileAttempts; attempt++) {
    try {
      const delivered = await hasDeliveredMessage(
        openCodePort,
        openCodeSessionId,
        reconcileTimeoutMs,
        reconcileMessageLimit,
        fullText,
        message,
      );

      if (delivered) {
        log.warn(
          `[injectOpenCodeMessage] POST timed out, but user message was confirmed in session ${openCodeSessionId}. Returning success to avoid duplicate resend.`,
        );
        return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        `[injectOpenCodeMessage] Delivery reconciliation error for session ${openCodeSessionId}: ${msg}`,
      );
    }

    const busy = await isSessionBusy(
      openCodePort,
      openCodeSessionId,
      reconcileTimeoutMs,
    );
    if (busy) {
      log.warn(
        `[injectOpenCodeMessage] POST timed out and session ${openCodeSessionId} is busy. Treating as accepted to avoid duplicate resend.`,
      );
      return true;
    }

    if (attempt < reconcileAttempts - 1) {
      const backoffMs = (attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return false;
}
