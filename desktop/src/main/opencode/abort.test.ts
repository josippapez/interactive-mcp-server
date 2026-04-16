import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientFactory, _setClientFactory } from './sdk-client';
import { abortOpenCodeSession } from './abort';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getRegisteredConnectionBySessionId: vi.fn<
    (...args: unknown[]) => { baseDirectory?: string } | null
  >(() => null),
}));

vi.mock('../database', () => ({
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
}));

// Silence logger output in test runs.
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// SDK client mock — follows the pattern used in session-api.test.ts.
// ---------------------------------------------------------------------------

type AnyFn = ReturnType<typeof vi.fn>;

let abortMock: AnyFn;
let getClientSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  abortMock = vi.fn().mockResolvedValue({
    data: true,
    error: null,
    response: { ok: true } as unknown as Response,
  });
  const mockClient = {
    session: { abort: abortMock },
  } as unknown as ReturnType<typeof import('./sdk-client').getClient>;
  getClientSpy = vi.fn().mockReturnValue(mockClient);
  _setClientFactory(
    getClientSpy as unknown as (
      port: number,
      directory?: string,
    ) => ReturnType<typeof import('./sdk-client').getClient>,
  );
});

afterEach(() => {
  _resetClientFactory();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const PORT = 4096;
const SID = 'ses_abort_test';

describe('abortOpenCodeSession', () => {
  it('forwards baseDirectory from the DB lookup to getClient and the abort call', async () => {
    mocks.getRegisteredConnectionBySessionId.mockReturnValue({
      baseDirectory: '/repo/x',
    });

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(true);
    // getClient must be scoped to the workspace so opencode's
    // WorkspaceRouterMiddleware routes to the right Instance.
    expect(getClientSpy).toHaveBeenCalledWith(PORT, '/repo/x');
    // The SDK call itself must also carry `directory` (withDirectory forwards it
    // as a query/header depending on SDK version).
    const params = abortMock.mock.calls[0][0];
    expect(params).toMatchObject({ sessionID: SID, directory: '/repo/x' });
    expect(mocks.getRegisteredConnectionBySessionId).toHaveBeenCalledWith(
      SID,
      'opencode',
    );
  });

  it('falls back to no directory when the session is not registered', async () => {
    mocks.getRegisteredConnectionBySessionId.mockReturnValue(null);

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(true);
    expect(getClientSpy).toHaveBeenCalledWith(PORT, undefined);
    const params = abortMock.mock.calls[0][0];
    expect(params.sessionID).toBe(SID);
    expect('directory' in params).toBe(false);
  });

  it('returns false when the SDK response contains an error', async () => {
    abortMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
      response: { ok: false } as unknown as Response,
    });

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(false);
  });

  it('returns false when opencode reports abort=false (wrong-Instance symptom)', async () => {
    // This is the exact shape we saw before the fix: the SDK hit the default
    // Instance (process.cwd()) which has no such session, so opencode returned
    // false. The fix is to pass `directory` so this case becomes rare.
    abortMock.mockResolvedValueOnce({
      data: false,
      error: null,
      response: { ok: true } as unknown as Response,
    });

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(false);
  });

  it('returns false when the SDK throws a non-AbortError', async () => {
    abortMock.mockRejectedValueOnce(new Error('network down'));

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(false);
  });

  it('returns false and swallows AbortError (timeout) silently', async () => {
    const abortErr = Object.assign(new Error('timeout'), {
      name: 'AbortError',
    });
    abortMock.mockRejectedValueOnce(abortErr);

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(false);
  });

  it('returns false when the SDK returns a non-boolean data shape', async () => {
    abortMock.mockResolvedValueOnce({
      data: { unexpected: 'shape' },
      error: null,
      response: { ok: true } as unknown as Response,
    });

    const ok = await abortOpenCodeSession(PORT, SID);

    expect(ok).toBe(false);
  });
});
