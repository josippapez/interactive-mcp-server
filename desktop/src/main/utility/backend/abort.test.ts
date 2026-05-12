import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRegisteredConnectionBySessionId: vi.fn(),
  sessionAbort: vi.fn(),
  fetchOpenCodeSession: vi.fn(),
  getOpenCodePassword: vi.fn(),
}));

vi.mock('./database', () => ({
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
}));

vi.mock('./session-api', () => ({
  sessionAbort: mocks.sessionAbort,
}));

vi.mock('./session', () => ({
  fetchOpenCodeSession: mocks.fetchOpenCodeSession,
}));

vi.mock('./opencode/password-subject', () => ({
  getOpenCodePassword: mocks.getOpenCodePassword,
}));

import { abortOpenCodeSession } from './abort';

beforeEach(() => {
  mocks.getRegisteredConnectionBySessionId.mockReset();
  mocks.sessionAbort.mockReset();
  mocks.fetchOpenCodeSession.mockReset();
  mocks.getOpenCodePassword.mockReset();
  mocks.getOpenCodePassword.mockReturnValue('password');
});

describe('abortOpenCodeSession', () => {
  it('uses the live session directory when the registration row is missing', async () => {
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue(null);
    mocks.fetchOpenCodeSession.mockResolvedValue({
      id: 'ses_a',
      directory: '/repo-a',
    });
    mocks.sessionAbort.mockResolvedValue({ data: true });

    const result = await abortOpenCodeSession(4321, 'ses_a');

    expect(result).toBe(true);
    expect(mocks.sessionAbort).toHaveBeenCalledWith(4321, 'ses_a', {
      directory: '/repo-a',
      signal: expect.any(AbortSignal),
    });
  });
});
