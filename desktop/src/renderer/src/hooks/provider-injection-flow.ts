type InjectionResult = { ok: boolean; error?: string; noReply?: boolean };

/**
 * Result shape returned by the main-process session resolver.
 * Mirrors the preload `resolveSession` / `reResolveSession` return type.
 */
export type ResolvedSessionResult = {
  providerSessionId: string | null;
  parentSessionId: string | null;
  resolvedVia: 'cached' | 're-resolved' | 'ambiguous' | 'none';
  message?: string;
};

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

/**
 * Inject a message into a provider session with one retry on stale-session errors.
 *
 * Flow:
 * 1. Try injecting with `initialSessionId`.
 * 2. If the error is recoverable (404 / expired / closed), call `reResolve`
 *    to clear the cached session and re-detect via the main-process resolver.
 * 3. If re-resolution yields a different session ID, retry injection once.
 *
 * The `reResolve` dependency maps to `window.api.reResolveSession()` which
 * clears the DB cache and re-resolves atomically on the main process.
 */
export async function injectWithSessionRecovery(
  input: {
    initialSessionId: string;
    connectionId: string;
    baseDirectory?: string;
  },
  deps: {
    inject: (sessionId: string) => Promise<InjectionResult>;
    reResolve: (
      connectionId: string,
      baseDirectory?: string,
    ) => Promise<ResolvedSessionResult>;
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

  // Stale session — ask the main-process resolver to clear cache and re-detect.
  const resolved = await deps.reResolve(
    input.connectionId,
    input.baseDirectory,
  );

  if (
    !resolved.providerSessionId ||
    resolved.providerSessionId === input.initialSessionId
  ) {
    // Re-resolution found the same (or no) session — nothing to retry with.
    return {
      ok: false,
      retried: false,
      sessionId: input.initialSessionId,
      error: first.error,
    };
  }

  const second = await deps.inject(resolved.providerSessionId);
  if (second.ok) {
    return {
      ok: true,
      retried: true,
      sessionId: resolved.providerSessionId,
      ...(second.noReply !== undefined ? { noReply: second.noReply } : {}),
    };
  }

  return {
    ok: false,
    retried: true,
    sessionId: resolved.providerSessionId,
    error: second.error,
  };
}
