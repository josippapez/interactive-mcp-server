import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetQuestionClientFactory,
  _setQuestionClientFactory,
  fetchPendingQuestions,
  rejectOpenCodeQuestion,
  replyToOpenCodeQuestion,
} from './question-list';

const mocks = vi.hoisted(() => ({
  getRegisteredConnectionBySessionId: vi.fn<
    (...args: unknown[]) => { baseDirectory?: string } | null
  >(() => null),
}));

vi.mock('../database', () => ({
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
}));

describe('question-list', () => {
  beforeEach(() => {
    _resetQuestionClientFactory();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetQuestionClientFactory();
  });

  it('fetches pending questions from the v2 question client', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'que_1',
          sessionID: 'ses_1',
          questions: [
            {
              question: 'Pick one',
              header: 'Header',
              options: [{ label: 'A', description: 'Option A' }],
            },
          ],
          tool: { messageID: 'msg_1', callID: 'call_1' },
        },
      ],
    });

    _setQuestionClientFactory(
      () =>
        ({
          question: {
            list,
            reply: vi.fn(),
            reject: vi.fn(),
          },
        }) as never,
    );

    const result = await fetchPendingQuestions(4096);

    expect(list).toHaveBeenCalledOnce();
    expect(result).toEqual([
      {
        requestId: 'que_1',
        sessionID: 'ses_1',
        questions: [
          {
            question: 'Pick one',
            header: 'Header',
            options: [{ label: 'A', description: 'Option A' }],
          },
        ],
        tool: { messageID: 'msg_1', callID: 'call_1' },
      },
    ]);
  });

  it('replies to questions through the v2 question client', async () => {
    const reply = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const list = vi.fn().mockResolvedValue({ data: [] });

    _setQuestionClientFactory(
      () =>
        ({
          question: {
            list,
            reply,
            reject: vi.fn(),
          },
        }) as never,
    );

    const result = await replyToOpenCodeQuestion(
      4096,
      'que_1',
      [['Yes']],
      'ses_1',
    );

    expect(reply).toHaveBeenCalledWith({
      requestID: 'que_1',
      answers: [['Yes']],
      directory: undefined,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects questions through the v2 question client', async () => {
    const reject = vi.fn().mockResolvedValue({ data: true, error: undefined });

    _setQuestionClientFactory(
      () =>
        ({
          question: {
            list: vi.fn(),
            reply: vi.fn(),
            reject,
          },
        }) as never,
    );

    const result = await rejectOpenCodeQuestion(4096, 'que_1', 'ses_1');

    expect(reject).toHaveBeenCalledWith({
      requestID: 'que_1',
      directory: undefined,
    });
    expect(result).toEqual({ ok: true });
  });

  it('uses the registered baseDirectory as client scope and reply body when available', async () => {
    const reply = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const list = vi.fn().mockResolvedValue({ data: [] });
    mocks.getRegisteredConnectionBySessionId.mockReturnValue({
      baseDirectory: '/repo',
    });

    const factory = vi.fn((_port: number, directory?: string) => {
      expect(directory).toBe('/repo');
      return {
        question: {
          list,
          reply,
          reject: vi.fn(),
        },
      } as never;
    });
    _setQuestionClientFactory(factory);

    const result = await replyToOpenCodeQuestion(
      4096,
      'que_1',
      [['Yes']],
      'ses_1',
    );

    expect(result).toEqual({ ok: true });
    expect(factory).toHaveBeenCalledWith(4096, '/repo');
    expect(reply).toHaveBeenCalledWith({
      requestID: 'que_1',
      answers: [['Yes']],
      directory: '/repo',
    });
    expect(list).toHaveBeenCalledWith({ directory: '/repo' });
  });

  it('returns reply-not-delivered error when requestID is still pending after reply', async () => {
    const reply = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const list = vi.fn().mockResolvedValue({
      data: [{ id: 'que_1', sessionID: 'ses_1' }],
    });

    _setQuestionClientFactory(
      () =>
        ({
          question: {
            list,
            reply,
            reject: vi.fn(),
          },
        }) as never,
    );

    const result = await replyToOpenCodeQuestion(
      4096,
      'que_1',
      [['Yes']],
      'ses_1',
    );

    expect(result).toEqual({ ok: false, error: 'reply not delivered' });
  });
});
