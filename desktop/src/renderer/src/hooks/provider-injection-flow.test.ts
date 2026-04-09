import { describe, it, expect, vi } from 'vitest';
import {
  isRecoverableInjectionError,
  buildInjectionSuccessStatus,
  injectWithSessionRecovery,
} from './provider-injection-flow';

describe('provider-injection-flow', () => {
  // ── isRecoverableInjectionError ──────────────────────────────────────────

  it('marks stale-session errors as recoverable', () => {
    expect(
      isRecoverableInjectionError(
        'OpenCode API returned 404: session not found',
      ),
    ).toBe(true);
    expect(
      isRecoverableInjectionError(
        'Session not found or expired. Please reinitialize.',
      ),
    ).toBe(true);
    expect(isRecoverableInjectionError('connection closed')).toBe(true);
  });

  it('returns false for non-recoverable errors', () => {
    expect(isRecoverableInjectionError('500 Internal Server Error')).toBe(
      false,
    );
    expect(isRecoverableInjectionError(undefined)).toBe(false);
  });

  // ── buildInjectionSuccessStatus ──────────────────────────────────────────

  it('returns an explicit noReply success status', () => {
    expect(buildInjectionSuccessStatus(true, false)).toBe(
      'Context injected (no reply)',
    );
    expect(buildInjectionSuccessStatus(true, true)).toBe(
      'Context injected after session recovery (no reply)',
    );
    expect(buildInjectionSuccessStatus(false, false)).toBeNull();
  });

  // ── injectWithSessionRecovery ────────────────────────────────────────────

  it('returns success on first try without re-resolve', async () => {
    const inject = vi.fn().mockResolvedValueOnce({ ok: true, noReply: false });
    const reResolve = vi.fn();

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_abc',
        connectionId: 'conn_1',
        baseDirectory: '/repo',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: true,
      retried: false,
      sessionId: 'ses_abc',
      noReply: false,
    });
    expect(reResolve).not.toHaveBeenCalled();
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('does not retry for non-recoverable errors', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '500 Internal Server Error' });
    const reResolve = vi.fn();

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        connectionId: 'conn_1',
        baseDirectory: '/repo',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: false,
      retried: false,
      sessionId: 'ses_old',
      error: '500 Internal Server Error',
    });
    expect(reResolve).not.toHaveBeenCalled();
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('retries once with re-resolved session for recoverable errors', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'OpenCode API returned 404' })
      .mockResolvedValueOnce({ ok: true });
    const reResolve = vi.fn().mockResolvedValueOnce({
      providerSessionId: 'ses_new',
      parentSessionId: null,
      resolvedVia: 're-resolved',
    });

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        connectionId: 'conn_1',
        baseDirectory: '/repo',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: true,
      retried: true,
      sessionId: 'ses_new',
    });
    expect(reResolve).toHaveBeenCalledWith('conn_1', '/repo');
    expect(inject).toHaveBeenNthCalledWith(1, 'ses_old');
    expect(inject).toHaveBeenNthCalledWith(2, 'ses_new');
  });

  it('does not retry when re-resolve returns the same session', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'session not found' });
    const reResolve = vi.fn().mockResolvedValueOnce({
      providerSessionId: 'ses_old',
      parentSessionId: null,
      resolvedVia: 're-resolved',
    });

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        connectionId: 'conn_1',
        baseDirectory: '/repo',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: false,
      retried: false,
      sessionId: 'ses_old',
      error: 'session not found',
    });
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('does not retry when re-resolve returns no session', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'expired' });
    const reResolve = vi.fn().mockResolvedValueOnce({
      providerSessionId: null,
      parentSessionId: null,
      resolvedVia: 'none',
      message: 'No session found',
    });

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        connectionId: 'conn_1',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: false,
      retried: false,
      sessionId: 'ses_old',
      error: 'expired',
    });
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('handles retry failure gracefully', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '404' })
      .mockResolvedValueOnce({ ok: false, error: 'still broken' });
    const reResolve = vi.fn().mockResolvedValueOnce({
      providerSessionId: 'ses_new',
      parentSessionId: null,
      resolvedVia: 're-resolved',
    });

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        connectionId: 'conn_1',
        baseDirectory: '/repo',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: false,
      retried: true,
      sessionId: 'ses_new',
      error: 'still broken',
    });
    expect(inject).toHaveBeenCalledTimes(2);
  });

  it('propagates noReply on successful retry', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '404' })
      .mockResolvedValueOnce({ ok: true, noReply: true });
    const reResolve = vi.fn().mockResolvedValueOnce({
      providerSessionId: 'ses_new',
      parentSessionId: null,
      resolvedVia: 're-resolved',
    });

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        connectionId: 'conn_1',
      },
      { inject, reResolve },
    );

    expect(result).toEqual({
      ok: true,
      retried: true,
      sessionId: 'ses_new',
      noReply: true,
    });
  });
});
