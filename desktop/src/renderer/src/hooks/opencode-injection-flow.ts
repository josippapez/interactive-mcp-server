type InjectionResult = { ok: boolean; error?: string; noReply?: boolean };

export function shouldDetectSessionForInjection(input: {
  openCodeSessionId: string | null;
  isDirectConnection: boolean;
}): boolean {
  return !input.openCodeSessionId && input.isDirectConnection;
}

/**
 * Resolves the OpenCode session ID to use as the injection target.
 *
 * Always injects into the node's own OpenCode session so that subagent
 * channels route messages directly to the subagent, not to the parent.
 */
export function resolveInjectionSessionId(
  node: {
    openCodeSessionId: string | null;
  } | null,
): string | null {
  if (!node) return null;
  return node.openCodeSessionId;
}

export function isRecoverableInjectionError(error?: string): boolean {
  if (!error) return false;
  const text = error.toLowerCase();
  return (
    text.includes('session not found') ||
    text.includes('expired') ||
    text.includes('404') ||
    text.includes('connection closed')
  );
}

export function buildInjectionSuccessStatus(
  noReply: boolean,
  retried: boolean,
): string | null {
  if (!noReply) return null;
  return retried
    ? 'Context injected after session recovery (no reply)'
    : 'Context injected (no reply)';
}

export async function injectWithSessionRecovery(
  input: {
    initialSessionId: string;
    baseDirectory?: string;
  },
  deps: {
    inject: (sessionId: string) => Promise<InjectionResult>;
    detect: (baseDirectory?: string) => Promise<string | null>;
  },
): Promise<{
  ok: boolean;
  retried: boolean;
  sessionId: string;
  error?: string;
  noReply?: boolean;
}> {
  const first = await deps.inject(input.initialSessionId);
  if (first.ok) {
    return {
      ok: true,
      retried: false,
      sessionId: input.initialSessionId,
      ...(first.noReply !== undefined ? { noReply: first.noReply } : {}),
    };
  }

  if (!isRecoverableInjectionError(first.error)) {
    return {
      ok: false,
      retried: false,
      sessionId: input.initialSessionId,
      error: first.error,
    };
  }

  const detected = await deps.detect(input.baseDirectory);
  if (!detected || detected === input.initialSessionId) {
    return {
      ok: false,
      retried: false,
      sessionId: input.initialSessionId,
      error: first.error,
    };
  }

  const second = await deps.inject(detected);
  if (second.ok) {
    return {
      ok: true,
      retried: true,
      sessionId: detected,
      ...(second.noReply !== undefined ? { noReply: second.noReply } : {}),
    };
  }

  return {
    ok: false,
    retried: true,
    sessionId: detected,
    error: second.error,
  };
}
