import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionApiMocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionPromptAsync: vi.fn(),
}));

vi.mock('./session-api', () => ({
  sessionCreate: sessionApiMocks.sessionCreate,
  sessionPromptAsync: sessionApiMocks.sessionPromptAsync,
}));

import { createOpenCodeSession } from './session';

const PORT = 4096;
const DIRECTORY = '/repo';

beforeEach(() => {
  sessionApiMocks.sessionCreate.mockReset();
  sessionApiMocks.sessionPromptAsync.mockReset();
  sessionApiMocks.sessionCreate.mockResolvedValue({
    data: { id: 'ses_123', title: 'Created' },
    error: undefined,
  });
  sessionApiMocks.sessionPromptAsync.mockResolvedValue({
    data: undefined,
    error: undefined,
  });
});

describe('createOpenCodeSession', () => {
  it('passes explicit agent and model to SDK session.create', async () => {
    await createOpenCodeSession(PORT, {
      title: 'New Chat',
      parentID: 'parent_1',
      directory: DIRECTORY,
      agent: 'plan',
      model: {
        id: 'gpt-5.5',
        providerID: 'github-copilot',
        variant: 'high',
      },
    });

    expect(sessionApiMocks.sessionCreate).toHaveBeenCalledWith(
      PORT,
      {
        title: 'New Chat',
        parentID: 'parent_1',
        agent: 'plan',
        model: {
          id: 'gpt-5.5',
          providerID: 'github-copilot',
          variant: 'high',
        },
      },
      expect.objectContaining({ directory: DIRECTORY }),
    );
  });

  it('trims blank agent before session.create', async () => {
    await createOpenCodeSession(PORT, {
      title: 'New Chat',
      agent: '   ',
    });

    expect(sessionApiMocks.sessionCreate).toHaveBeenCalledWith(
      PORT,
      { title: 'New Chat', parentID: undefined },
      expect.any(Object),
    );
  });
});
