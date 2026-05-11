import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllRegisteredConnections: vi.fn(),
  getRegisteredConnectionBySessionId: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('./database', () => ({
  getAllRegisteredConnections: mocks.getAllRegisteredConnections,
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
}));

vi.mock('./sdk-client', () => ({
  getClient: mocks.getClient,
}));

import { fetchPendingQuestions } from './question-list';

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
});
