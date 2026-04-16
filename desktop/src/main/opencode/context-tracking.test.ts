import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  updateSessionTokens,
  setSessionTotalTokens,
  getSessionContextUsage,
  clearSessionContextUsage,
  handleCompaction,
  setModelContextLimit,
  getModelContextLimit,
  triggerCompaction,
  fetchSessionTokens,
  getTokenCount,
  _clearAllUsageForTest,
  COMPACTION_BUFFER,
  DEFAULT_CONTEXT_WINDOW,
  OUTPUT_TOKEN_MAX,
} from './context-tracking';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

describe('context-tracking', () => {
  beforeEach(() => {
    _clearAllUsageForTest();
  });

  describe('token tracking', () => {
    it('initializes session with zero tokens', () => {
      const usage = getSessionContextUsage('ses_test');
      expect(usage).toBeNull();
    });

    it('updates session tokens from message', () => {
      const usage = updateSessionTokens('ses_test', {
        input: 100,
        output: 200,
        total: 300,
      });

      expect(usage.sessionId).toBe('ses_test');
      expect(usage.totalTokens).toBe(300);
      // 300 tokens is < 1% of 108k usable limit, so percent rounds to 0
      expect(usage.usagePercent).toBeGreaterThanOrEqual(0);
    });

    it('accumulates tokens across multiple messages', () => {
      updateSessionTokens('ses_test', { total: 100 });
      updateSessionTokens('ses_test', { total: 200 });
      const usage = getSessionContextUsage('ses_test');

      expect(usage?.totalTokens).toBe(300);
    });

    it('replaces tokens when replace=true', () => {
      updateSessionTokens('ses_test', { total: 100 });
      updateSessionTokens('ses_test', { total: 200 }, undefined, true);
      const usage = getSessionContextUsage('ses_test');

      expect(usage?.totalTokens).toBe(200);
    });

    it('calculates tokens from input+output when total missing', () => {
      const usage = updateSessionTokens('ses_test', {
        input: 150,
        output: 50,
      });

      expect(usage.totalTokens).toBe(200);
    });

    it('matches OpenCode token counting including reasoning and cache tokens', () => {
      const usage = updateSessionTokens('ses_test', {
        input: 100,
        output: 50,
        reasoning: 25,
        cache: {
          read: 10,
          write: 5,
        },
      });

      expect(usage.totalTokens).toBe(190);
    });

    it('sets total tokens directly', () => {
      const usage = setSessionTotalTokens('ses_test', 50000);
      expect(usage.totalTokens).toBe(50000);
    });

    it('clears session usage', () => {
      updateSessionTokens('ses_test', { total: 1000 });
      clearSessionContextUsage('ses_test');
      expect(getSessionContextUsage('ses_test')).toBeNull();
    });
  });

  describe('context limits', () => {
    it('uses default context window when model unknown', () => {
      const limit = getModelContextLimit();
      expect(limit).toBe(DEFAULT_CONTEXT_WINDOW);
    });

    it('stores and retrieves model context limits', () => {
      setModelContextLimit('claude-3-opus', 200000);
      expect(getModelContextLimit('claude-3-opus')).toBe(200000);
    });

    it('prefers provider-specific model context limits when providerId is provided', () => {
      setModelContextLimit('gpt-5.4', 1050000, 'abacus');
      setModelContextLimit('gpt-5.4', 400000, 'github-copilot');

      expect(getModelContextLimit('gpt-5.4', 'github-copilot')).toBe(400000);
      expect(getModelContextLimit('gpt-5.4', 'abacus')).toBe(1050000);
      expect(getModelContextLimit('gpt-5.4')).toBe(DEFAULT_CONTEXT_WINDOW);
    });

    it('calculates usable limit with compaction buffer', () => {
      const usage = setSessionTotalTokens('ses_test', 1000);
      expect(usage.usableLimit).toBe(DEFAULT_CONTEXT_WINDOW - OUTPUT_TOKEN_MAX);
    });

    it('uses model input and output limits for usable threshold', () => {
      setModelContextLimit('claude-3-opus', {
        contextWindow: 200000,
        inputLimit: 180000,
        outputLimit: 64000,
      });

      const usage = setSessionTotalTokens('ses_test', 1000, 'claude-3-opus');
      expect(usage.usableLimit).toBe(160000);
    });

    it('uses provider-specific limits when computing session usage', () => {
      setModelContextLimit(
        'gpt-5.4',
        {
          contextWindow: 400000,
          inputLimit: 272000,
          outputLimit: 128000,
        },
        'github-copilot',
      );
      setModelContextLimit(
        'gpt-5.4',
        {
          contextWindow: 1050000,
          inputLimit: 797000,
          outputLimit: 253000,
        },
        'abacus',
      );

      const usage = setSessionTotalTokens(
        'ses_test',
        1000,
        'gpt-5.4',
        'github-copilot',
      );

      expect(usage.contextLimit).toBe(400000);
      expect(usage.usableLimit).toBe(252000);
    });
  });

  describe('overflow detection', () => {
    it('detects near-overflow at 80% usage', () => {
      // With default 128k window and 20k buffer, usable = 108k
      // 80% of 108k = 86400
      setSessionTotalTokens('ses_test', 86400);
      const usage = getSessionContextUsage('ses_test');

      expect(usage?.isNearOverflow).toBe(true);
      expect(usage?.isOverflow).toBe(false);
    });

    it('detects overflow at 100%+ usage', () => {
      // With default 128k window and 20k buffer, usable = 108k
      setSessionTotalTokens('ses_test', 110000);
      const usage = getSessionContextUsage('ses_test');

      expect(usage?.isNearOverflow).toBe(false);
      expect(usage?.isOverflow).toBe(true);
    });

    it('calculates usage percentage correctly', () => {
      // Display percent follows full context window like OpenCode TUI.
      setSessionTotalTokens('ses_test', DEFAULT_CONTEXT_WINDOW / 2);
      const usage = getSessionContextUsage('ses_test');

      expect(usage?.usagePercent).toBe(50);
    });
  });

  describe('compaction handling', () => {
    it('resets token count after compaction', () => {
      setSessionTotalTokens('ses_test', 100000);
      handleCompaction('ses_test', 20000);
      const usage = getSessionContextUsage('ses_test');

      expect(usage?.totalTokens).toBe(20000);
      expect(usage?.isOverflow).toBe(false);
    });
  });

  describe('compaction API', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      _resetClientFactory();
    });

    it('triggers compaction via API', async () => {
      let summarizeCalled = false;
      _setClientFactory(
        () =>
          ({
            session: {
              summarize: async () => {
                summarizeCalled = true;
                return { data: {} };
              },
            },
          }) as ReturnType<typeof import('./sdk-client').getClient>,
      );

      const result = await triggerCompaction('ses_test', 4096);

      expect(result.ok).toBe(true);
      expect(summarizeCalled).toBe(true);
    });

    it('handles compaction API errors', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              summarize: async () => ({
                error: 'Internal error',
              }),
            },
          }) as ReturnType<typeof import('./sdk-client').getClient>,
      );

      const result = await triggerCompaction('ses_test', 4096);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Internal error');
    });

    it('handles network errors', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              summarize: async () => {
                throw new Error('Network error');
              },
            },
          }) as ReturnType<typeof import('./sdk-client').getClient>,
      );

      const result = await triggerCompaction('ses_test', 4096);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('fetch session tokens', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      _resetClientFactory();
    });

    it('fetches session token count from API', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              get: async () => ({
                data: {
                  id: 'ses_test',
                  tokens: 50000,
                  model: { id: 'claude-3-opus' },
                },
              }),
            },
          }) as ReturnType<typeof import('./sdk-client').getClient>,
      );

      const result = await fetchSessionTokens('ses_test', 4096);

      expect(result?.id).toBe('ses_test');
      expect(result?.tokens).toBe(50000);
      expect(result?.modelId).toBe('claude-3-opus');
    });

    it('returns null on API error', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              get: async () => ({
                error: 'Not found',
              }),
            },
          }) as ReturnType<typeof import('./sdk-client').getClient>,
      );

      const result = await fetchSessionTokens('ses_test', 4096);
      expect(result).toBeNull();
    });

    it('falls back to latest assistant message tokens when session tokens are missing', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              get: async () => ({
                data: {
                  id: 'ses_test',
                  model: { id: 'gpt-5.4' },
                },
              }),
              messages: async () => ({
                data: [
                  {
                    info: {
                      role: 'user',
                    },
                  },
                  {
                    info: {
                      role: 'assistant',
                      modelID: 'gpt-5.4',
                      tokens: { total: 12345 },
                    },
                  },
                ],
              }),
            },
          }) as ReturnType<typeof import('./sdk-client').getClient>,
      );

      const result = await fetchSessionTokens('ses_test', 4096);

      expect(result).toEqual({
        id: 'ses_test',
        tokens: 12345,
        modelId: 'gpt-5.4',
      });
    });
  });

  describe('getTokenCount', () => {
    it('uses total when present', () => {
      expect(
        getTokenCount({
          total: 321,
          input: 100,
          output: 100,
          reasoning: 100,
          cache: { read: 10, write: 10 },
        }),
      ).toBe(321);
    });

    it('sums input output reasoning and cache tokens like OpenCode', () => {
      expect(
        getTokenCount({
          input: 100,
          output: 50,
          reasoning: 25,
          cache: { read: 10, write: 5 },
        }),
      ).toBe(190);
    });
  });
});
