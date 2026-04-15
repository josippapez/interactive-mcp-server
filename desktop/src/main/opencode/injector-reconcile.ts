import { buildOpenCodePortCandidates } from './endpoints';

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

async function isSessionBusyOnPort(
  port: number,
  openCodeSessionId: string,
  reconcileTimeoutMs: number,
): Promise<boolean> {
  try {
    const statusRes = await fetch(`http://localhost:${port}/session/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(reconcileTimeoutMs),
    });

    if (!statusRes.ok) return false;
    const status = (await statusRes.json()) as Record<
      string,
      { type?: string } | undefined
    >;
    return status[openCodeSessionId]?.type === 'busy';
  } catch {
    return false;
  }
}

async function hasDeliveredMessageOnPort(
  port: number,
  openCodeSessionId: string,
  reconcileTimeoutMs: number,
  reconcileMessageLimit: number,
  fullText: string,
  message: string,
): Promise<boolean> {
  const reconcileUrl = `http://localhost:${port}/session/${encodeURIComponent(openCodeSessionId)}/message?limit=${reconcileMessageLimit}`;

  const res = await fetch(reconcileUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(reconcileTimeoutMs),
  });

  if (!res.ok) return false;

  const messages = (await res.json()) as Array<{
    info?: { role?: string };
    parts?: Array<{ type?: string; text?: string }>;
  }>;

  return messages.some((msg) => {
    if (msg.info?.role !== 'user') return false;

    const userText = (msg.parts ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');

    return matchesUserPayload(userText, fullText, message);
  });
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

  const candidatePorts = buildOpenCodePortCandidates(openCodePort);

  for (let attempt = 0; attempt < reconcileAttempts; attempt++) {
    for (const port of candidatePorts) {
      try {
        const delivered = await hasDeliveredMessageOnPort(
          port,
          openCodeSessionId,
          reconcileTimeoutMs,
          reconcileMessageLimit,
          fullText,
          message,
        );

        if (delivered) {
          log.warn(
            `[injectOpenCodeMessage] POST timed out, but user message was confirmed in session ${openCodeSessionId} on port ${port}. Returning success to avoid duplicate resend.`,
          );
          return true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          `[injectOpenCodeMessage] Delivery reconciliation error for session ${openCodeSessionId} on port ${port}: ${msg}`,
        );
      }

      const busy = await isSessionBusyOnPort(
        port,
        openCodeSessionId,
        reconcileTimeoutMs,
      );
      if (busy) {
        log.warn(
          `[injectOpenCodeMessage] POST timed out and session ${openCodeSessionId} is busy on port ${port}. Treating as accepted to avoid duplicate resend.`,
        );
        return true;
      }
    }

    if (attempt < reconcileAttempts - 1) {
      const backoffMs = (attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return false;
}
