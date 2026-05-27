import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllRegisteredConnections: vi.fn(),
  getRegisteredConnectionBySessionId: vi.fn(),
  getClient: vi.fn(),
  fetchAllOpenCodeSessions: vi.fn(),
  fetchOpenCodeSession: vi.fn(),
}));

vi.mock('./database', () => ({
  getAllRegisteredConnections: mocks.getAllRegisteredConnections,
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
}));

vi.mock('./sdk-client', () => ({
  getClient: mocks.getClient,
}));

vi.mock('./session', () => ({
  fetchAllOpenCodeSessions: mocks.fetchAllOpenCodeSessions,
  fetchOpenCodeSession: mocks.fetchOpenCodeSession,
}));

import {
  _resetClearedQuestionRequestIdsForTest,
  fetchPendingQuestions,
  replyToOpenCodeQuestion,
  rejectPendingQuestionsForSession,
} from './question-list';

const PORT = 4321;

function question(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    questions: [{ question: 'Continue?', header: 'Confirm', options: [] }],
  };
}

beforeEach(() => {
  mocks.getAllRegisteredConnections.mockReset();
  mocks.getRegisteredConnectionBySessionId.mockReset();
  mocks.getClient.mockReset();
  mocks.fetchAllOpenCodeSessions.mockReset();
  mocks.fetchOpenCodeSession.mockReset();
  _resetClearedQuestionRequestIdsForTest();
  mocks.fetchAllOpenCodeSessions.mockResolvedValue([]);
  mocks.fetchOpenCodeSession.mockResolvedValue(null);
});

describe('fetchPendingQuestions', () => {
  it('fans out across registered OpenCode base directories and dedupes by request id', async () => {
    mocks.getAllRegisteredConnections.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_a',
        baseDirectory: '/repo-a',
      },
      {
        providerType: 'opencode',
        providerSessionId: 'ses_b',
        baseDirectory: '/repo-b',
      },
      {
        providerType: 'standalone',
        providerSessionId: 'standalone',
        baseDirectory: '/ignored',
      },
    ]);
    mocks.getClient.mockImplementation((_port: number, directory?: string) => ({
      question: {
        list: vi.fn().mockResolvedValue({
          data:
            directory === '/repo-a'
              ? [question('req_a', 'ses_a'), question('req_shared', 'ses_a')]
              : directory === '/repo-b'
                ? [question('req_b', 'ses_b'), question('req_shared', 'ses_b')]
                : [],
        }),
      },
    }));

    const result = await fetchPendingQuestions(PORT);

    expect(mocks.getClient).toHaveBeenCalledWith(PORT, '/repo-a');
    expect(mocks.getClient).toHaveBeenCalledWith(PORT, '/repo-b');
    expect(mocks.getClient).toHaveBeenCalledWith(PORT, undefined);
    expect(result.map((item) => item.requestId)).toEqual([
      'req_a',
      'req_shared',
      'req_b',
    ]);
  });

  it('also polls live OpenCode session directories when registrations are missing', async () => {
    mocks.getAllRegisteredConnections.mockReturnValue([]);
    mocks.fetchAllOpenCodeSessions.mockResolvedValue([
      {
        id: 'ses_a',
        directory: '/repo-a',
      },
    ]);
    mocks.getClient.mockImplementation((_port: number, directory?: string) => ({
      question: {
        list: vi.fn().mockResolvedValue({
          data: directory === '/repo-a' ? [question('req_a', 'ses_a')] : [],
        }),
      },
    }));

    const result = await fetchPendingQuestions(PORT);

    expect(mocks.getClient).toHaveBeenCalledWith(PORT, undefined);
    expect(mocks.getClient).toHaveBeenCalledWith(PORT, '/repo-a');
    expect(result.map((item) => item.requestId)).toEqual(['req_a']);
  });
});

describe('rejectPendingQuestionsForSession', () => {
  it('rejects only pending questions for the aborted session and returns their request ids', async () => {
    const rejectA = vi.fn().mockResolvedValue({ data: true });
    const rejectB = vi.fn().mockResolvedValue({ data: true });
    mocks.getAllRegisteredConnections.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_a',
        baseDirectory: '/repo-a',
      },
    ]);
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue({
      providerType: 'opencode',
      providerSessionId: 'ses_a',
      baseDirectory: '/repo-a',
    });
    mocks.getClient.mockImplementation((_port: number, directory?: string) => ({
      question: {
        list: vi.fn().mockResolvedValue({
          data:
            directory === '/repo-a'
              ? [question('req_a', 'ses_a'), question('req_b', 'ses_b')]
              : [],
        }),
        reject: directory === '/repo-a' ? rejectA : rejectB,
      },
    }));

    const result = await rejectPendingQuestionsForSession(PORT, 'ses_a');

    expect(result).toEqual(['req_a']);
    expect(rejectA).toHaveBeenCalledWith({
      requestID: 'req_a',
      directory: '/repo-a',
    });
    expect(rejectB).not.toHaveBeenCalled();
  });
});

describe('replyToOpenCodeQuestion', () => {
  it('returns ok only after the scoped reply removes the pending question', async () => {
    const reply = vi.fn().mockResolvedValue({ data: true });
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [question('req_a', 'ses_a')] })
      .mockResolvedValueOnce({ data: [] });
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue({
      providerType: 'opencode',
      providerSessionId: 'ses_a',
      baseDirectory: '/repo-a',
    });
    mocks.getClient.mockReturnValue({ question: { reply, list } });

    const result = await replyToOpenCodeQuestion(
      PORT,
      'req_a',
      [['Yes']],
      'ses_a',
    );

    expect(result).toEqual({ ok: true });
    expect(reply).toHaveBeenCalledWith({
      requestID: 'req_a',
      answers: [['Yes']],
      directory: '/repo-a',
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('falls back to the live session directory when the registration row is missing', async () => {
    const reply = vi.fn().mockResolvedValue({ data: true });
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [question('req_a', 'ses_a')] })
      .mockResolvedValueOnce({ data: [] });
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue(null);
    mocks.fetchOpenCodeSession.mockResolvedValue({
      id: 'ses_a',
      directory: '/repo-a',
    });
    mocks.getClient.mockReturnValue({ question: { reply, list } });

    const result = await replyToOpenCodeQuestion(
      PORT,
      'req_a',
      [['Yes']],
      'ses_a',
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.getClient).toHaveBeenCalledWith(PORT, '/repo-a');
    expect(reply).toHaveBeenCalledWith({
      requestID: 'req_a',
      answers: [['Yes']],
      directory: '/repo-a',
    });
  });

  it('treats reply as success when the server returns an error but the question is already cleared', async () => {
    // Simulates a structured SDK error where OpenCode has also removed the
    // question from the pending list. The desktop should detect that the
    // question is gone and return ok:true instead of propagating the error.
    const reply = vi
      .fn()
      .mockResolvedValue({ error: { message: 'request failed' } });
    const list = vi.fn().mockResolvedValue({ data: [] }); // question already gone
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue({
      providerType: 'opencode',
      providerSessionId: 'ses_a',
      baseDirectory: '/repo-a',
    });
    mocks.getClient.mockReturnValue({ question: { reply, list } });

    const result = await replyToOpenCodeQuestion(
      PORT,
      'req_a',
      [['Yes']],
      'ses_a',
    );

    expect(result).toEqual({ ok: true });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('suppresses a stale pending question when OpenCode reports it as unknown', async () => {
    const reply = vi
      .fn()
      .mockResolvedValue({ error: { message: 'reply for unknown request' } });
    const list = vi
      .fn()
      .mockResolvedValue({ data: [question('req_unknown', 'ses_a')] });
    mocks.getAllRegisteredConnections.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_a',
        baseDirectory: '/repo-a',
      },
    ]);
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue({
      providerType: 'opencode',
      providerSessionId: 'ses_a',
      baseDirectory: '/repo-a',
    });
    mocks.getClient.mockReturnValue({ question: { reply, list } });

    await expect(
      replyToOpenCodeQuestion(PORT, 'req_unknown', [['Yes']], 'ses_a'),
    ).resolves.toEqual({ ok: true });

    await expect(fetchPendingQuestions(PORT)).resolves.toEqual([]);
  });

  it('retries unscoped and reports failure when the question remains pending', async () => {
    const scopedReply = vi.fn().mockResolvedValue({ data: true });
    const scopedList = vi.fn().mockResolvedValue({
      data: [question('req_a', 'ses_a')],
    });
    const unscopedReply = vi.fn().mockResolvedValue({ data: true });
    const unscopedList = vi.fn().mockResolvedValue({
      data: [question('req_a', 'ses_a')],
    });
    mocks.getRegisteredConnectionBySessionId.mockResolvedValue({
      providerType: 'opencode',
      providerSessionId: 'ses_a',
      baseDirectory: '/repo-a',
    });
    mocks.getClient.mockImplementation((_port: number, directory?: string) => ({
      question: directory
        ? { reply: scopedReply, list: scopedList }
        : { reply: unscopedReply, list: unscopedList },
    }));

    const result = await replyToOpenCodeQuestion(
      PORT,
      'req_a',
      [['Yes']],
      'ses_a',
    );

    expect(result).toEqual({
      ok: false,
      error: 'Question reply was accepted but the request is still pending.',
    });
    expect(unscopedReply).toHaveBeenCalledWith({
      requestID: 'req_a',
      answers: [['Yes']],
    });
  });
});
