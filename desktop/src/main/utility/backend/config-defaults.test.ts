import { describe, expect, it, vi, beforeEach } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

import {
  fetchOpenCodeConfigDefaults,
  parseConfigModel,
} from './config-defaults';

const PORT = 4321;
const BASE_DIR = '/repo';

beforeEach(() => {
  sdkMocks.configGet.mockReset();
  sdkMocks.getClient.mockReset();
  sdkMocks.getClient.mockReturnValue({
    config: { get: sdkMocks.configGet },
  });
});

describe('parseConfigModel', () => {
  it('splits provider/model config values', () => {
    expect(parseConfigModel('github-copilot/gpt-5.5')).toEqual({
      model: 'github-copilot/gpt-5.5',
      providerId: 'github-copilot',
      modelId: 'gpt-5.5',
    });
  });

  it('preserves unqualified model values', () => {
    expect(parseConfigModel('gpt-5.5')).toEqual({
      model: 'gpt-5.5',
      providerId: null,
      modelId: 'gpt-5.5',
    });
  });

  it('returns null fields for blank values', () => {
    expect(parseConfigModel('   ')).toEqual({
      model: null,
      providerId: null,
      modelId: null,
    });
  });
});

describe('fetchOpenCodeConfigDefaults', () => {
  it('reads merged config defaults from the SDK for a directory', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: {
        model: 'anthropic/claude-sonnet-4-5',
        default_agent: 'plan',
      },
      error: undefined,
    });

    await expect(fetchOpenCodeConfigDefaults(PORT, BASE_DIR)).resolves.toEqual({
      model: 'anthropic/claude-sonnet-4-5',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      variant: null,
      defaultAgentName: 'plan',
    });

    expect(sdkMocks.getClient).toHaveBeenCalledWith(PORT, BASE_DIR);
    expect(sdkMocks.configGet).toHaveBeenCalledWith(
      { directory: BASE_DIR },
      expect.any(Object),
    );
  });

  it('uses the configured default agent model and variant when present', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: {
        model: 'anthropic/claude-sonnet-4-5',
        default_agent: 'plan',
        agent: {
          plan: {
            model: 'github-copilot/gpt-5.5',
            variant: 'high',
          },
        },
      },
      error: undefined,
    });

    await expect(fetchOpenCodeConfigDefaults(PORT, BASE_DIR)).resolves.toEqual({
      model: 'github-copilot/gpt-5.5',
      providerId: 'github-copilot',
      modelId: 'gpt-5.5',
      variant: 'high',
      defaultAgentName: 'plan',
    });
  });
});
