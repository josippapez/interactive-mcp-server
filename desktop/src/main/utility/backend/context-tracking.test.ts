import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkClientMocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  sessionGet: vi.fn(),
  sessionMessages: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkClientMocks.getClient,
}));

import {
  _clearAllUsageForTest,
  fetchSessionTokens,
  setSessionTotalTokens,
  getSessionContextUsage,
} from './context-tracking';

beforeEach(() => {
  _clearAllUsageForTest();
  sdkClientMocks.getClient.mockReset();
  sdkClientMocks.sessionGet.mockReset();
  sdkClientMocks.sessionMessages.mockReset();
  sdkClientMocks.getClient.mockReturnValue({
    session: {
      get: sdkClientMocks.sessionGet,
      messages: sdkClientMocks.sessionMessages,
    },
  });
});

describe('context tracking token normalization', () => {
  it('accepts OpenCode token objects when setting session totals', () => {
    const usage = setSessionTotalTokens('ses_token_object', {
      input: 1000,
      output: 200,
      cache: { read: 300, write: 50 },
    } as never);

    expect(usage.totalTokens).toBe(1550);
    expect(Number.isFinite(usage.usagePercent)).toBe(true);
    expect(getSessionContextUsage('ses_token_object')?.totalTokens).toBe(1550);
  });

  it('falls back to zero for invalid token totals', () => {
    const usage = setSessionTotalTokens('ses_invalid_tokens', {
      total: { bad: true },
    } as never);

    expect(usage.totalTokens).toBe(0);
    expect(usage.usagePercent).toBe(0);
  });

  it('prefers the selected session latest assistant message tokens over aggregate session tokens', async () => {
    sdkClientMocks.sessionGet.mockResolvedValue({
      data: {
        id: 'ses_child',
        tokens: 9000,
        model: { id: 'gpt-5.5' },
        provider: { id: 'github-copilot' },
      },
      error: undefined,
    });
    sdkClientMocks.sessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            modelID: 'gpt-5.5',
            providerID: 'github-copilot',
            tokens: { total: 1200 },
          },
        },
      ],
      error: undefined,
    });

    const info = await fetchSessionTokens('ses_child', 4096);

    expect(sdkClientMocks.sessionMessages).toHaveBeenCalledWith(
      { sessionID: 'ses_child', limit: 20 },
      { signal: expect.any(AbortSignal) },
    );
    expect(info).toEqual({
      id: 'ses_child',
      tokens: 1200,
      modelId: 'gpt-5.5',
      providerId: 'github-copilot',
    });
  });
});
