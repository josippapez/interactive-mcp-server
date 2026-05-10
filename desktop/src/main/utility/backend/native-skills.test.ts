import { describe, expect, it, vi, beforeEach } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  skills: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

import { getClient } from './sdk-client';
import { listNativeOpenCodeSkills } from './native-skills';

describe('listNativeOpenCodeSkills', () => {
  beforeEach(() => {
    sdkMocks.skills.mockReset();
    sdkMocks.getClient.mockReset();
    sdkMocks.getClient.mockReturnValue({
      app: {
        skills: sdkMocks.skills,
      },
    });
  });

  it('uses the SDK skills API instead of filesystem or raw HTTP', async () => {
    sdkMocks.skills.mockResolvedValue({
      data: [
        {
          name: 'zeta',
          description: 'Z skill',
          location: 'opencode-sdk:zeta',
          content: 'z content',
        },
        {
          name: 'alpha',
          description: 'A skill',
          location: 'opencode-sdk:alpha',
          content: 'a content',
        },
        {
          name: 'invalid',
          description: 'missing content',
          location: 'opencode-sdk:invalid',
        },
      ],
      error: undefined,
    });

    await expect(listNativeOpenCodeSkills(4321, '/repo')).resolves.toEqual([
      {
        name: 'alpha',
        description: 'A skill',
        location: 'opencode-sdk:alpha',
        content: 'a content',
      },
      {
        name: 'zeta',
        description: 'Z skill',
        location: 'opencode-sdk:zeta',
        content: 'z content',
      },
    ]);

    expect(getClient).toHaveBeenCalledWith(4321, '/repo');
    expect(sdkMocks.skills).toHaveBeenCalledWith(
      { directory: '/repo' },
      { signal: expect.any(AbortSignal) },
    );
  });
});
