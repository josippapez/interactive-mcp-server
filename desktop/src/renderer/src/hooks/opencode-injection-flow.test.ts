import { describe, it, expect, vi } from 'vitest';
import {
  shouldDetectSessionForInjection,
  isRecoverableInjectionError,
  buildInjectionSuccessStatus,
  injectWithSessionRecovery,
} from './opencode-injection-flow';

describe('opencode-injection-flow', () => {
  it('detects a session for direct connections with no openCodeSessionId', () => {
    expect(
      shouldDetectSessionForInjection({
        openCodeSessionId: null,
        isDirectConnection: true,
      }),
    ).toBe(true);
  });

  it('does not detect for non-direct nodes that have no session id', () => {
    expect(
      shouldDetectSessionForInjection({
        openCodeSessionId: null,
        isDirectConnection: false,
      }),
    ).toBe(false);
  });

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

  it('does not retry for non-recoverable errors', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '500 Internal Server Error' });
    const detect = vi.fn();

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        baseDirectory: '/repo',
      },
      { inject, detect },
    );

    expect(result).toEqual({
      ok: false,
      retried: false,
      sessionId: 'ses_old',
      error: '500 Internal Server Error',
    });
    expect(detect).not.toHaveBeenCalled();
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('retries once with detected session for recoverable errors', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'OpenCode API returned 404' })
      .mockResolvedValueOnce({ ok: true });
    const detect = vi.fn().mockResolvedValueOnce('ses_new');

    const result = await injectWithSessionRecovery(
      {
        initialSessionId: 'ses_old',
        baseDirectory: '/repo',
      },
      { inject, detect },
    );

    expect(result).toEqual({
      ok: true,
      retried: true,
      sessionId: 'ses_new',
    });
    expect(detect).toHaveBeenCalledWith('/repo');
    expect(inject).toHaveBeenNthCalledWith(1, 'ses_old');
    expect(inject).toHaveBeenNthCalledWith(2, 'ses_new');
  });

  it('returns an explicit noReply success status', () => {
    expect(buildInjectionSuccessStatus(true, false)).toBe(
      'Context injected (no reply)',
    );
    expect(buildInjectionSuccessStatus(true, true)).toBe(
      'Context injected after session recovery (no reply)',
    );
    expect(buildInjectionSuccessStatus(false, false)).toBeNull();
  });
});
