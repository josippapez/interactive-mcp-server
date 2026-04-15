/**
 * Tests for provider.ts — OpenCode provider/model API integration.
 *
 * Following TDD: write tests first, then implement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import functions we'll implement
import {
  fetchProviders,
  fetchModels,
  getProviderById,
  getModelById,
  getCachedProviders,
  clearProviderCache,
  fetchProviderAuthMethods,
  authorizeProvider,
  callbackProvider,
  setProviderApiKey,
  type AuthMethod,
  type AuthorizeResult,
} from './provider';

/** Raw model structure from OpenCode API. */
interface RawModel {
  id: string;
  name: string;
  limit?: { context?: number; input?: number; output?: number };
  capabilities?: { reasoning?: boolean };
  variants?: Record<string, unknown>;
}

/** Raw provider structure from OpenCode API. */
interface RawProvider {
  id: string;
  name: string;
  models: Record<string, RawModel>;
}

/** Response shape from GET /provider. */
interface RawProvidersResponse {
  all: RawProvider[];
  default: Record<string, string>;
  connected: string[];
}

/** Helper to create mock provider response. */
function createMockResponse(providers: RawProvider[]): RawProvidersResponse {
  return {
    all: providers,
    default: Object.fromEntries(
      providers.map((p) => [p.id, Object.keys(p.models)[0] ?? '']),
    ),
    connected: providers.map((p) => p.id),
  };
}

describe('provider', () => {
  beforeEach(() => {
    clearProviderCache();
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Unexpected unmocked fetch call'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchProviders', () => {
    it('returns providers from the OpenCode API', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
            'claude-opus-4-20250514': {
              id: 'claude-opus-4-20250514',
              name: 'Claude Opus 4',
              limit: { context: 200000 },
            },
          },
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchProviders(3000);

      expect(result).toHaveLength(2);
      expect(result?.[0]).toEqual(
        expect.objectContaining({ id: 'anthropic', name: 'Anthropic' }),
      );
      expect(result?.[0].models).toHaveLength(2);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/provider',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns null when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await fetchProviders(3000);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await fetchProviders(3000);

      expect(result).toBeNull();
    });

    it('falls back to default port when configured port fails', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const result = await fetchProviders(5000);

      expect(result).toHaveLength(1);
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/provider',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:4096/provider',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('merges model variants across reachable ports for the same model', async () => {
      const partialResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { reasoningEffort: 'low' },
                medium: { reasoningEffort: 'medium' },
                high: { reasoningEffort: 'high' },
              },
            },
          },
        },
      ]);

      const maxOnlyResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                max: { reasoningEffort: 'max' },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => partialResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => maxOnlyResponse,
        } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.variants).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('keeps reasoning true when merged model responses differ by port', async () => {
      const reasoningResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              capabilities: { reasoning: true },
            },
          },
        },
      ]);

      const missingCapabilitiesResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => reasoningResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => missingCapabilitiesResponse,
        } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.reasoning).toBe(true);
    });

    it('caches providers after successful fetch', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchProviders(3000);
      const cached = getCachedProviders();

      expect(cached).toHaveLength(1);
      expect(cached?.[0]).toEqual(
        expect.objectContaining({ id: 'anthropic', name: 'Anthropic' }),
      );
    });
  });

  describe('fetchModels', () => {
    it('returns all models from all providers', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
            'claude-opus-4-20250514': {
              id: 'claude-opus-4-20250514',
              name: 'Claude Opus 4',
              limit: { context: 200000 },
            },
          },
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchModels(3000);

      expect(result).toHaveLength(3);
      expect(result).toContainEqual(
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          providerId: 'anthropic',
        }),
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          id: 'claude-opus-4-20250514',
          providerId: 'anthropic',
        }),
      );
      expect(result).toContainEqual(
        expect.objectContaining({ id: 'gpt-4o', providerId: 'openai' }),
      );
    });

    it('preserves input and output limits from OpenCode models', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000, input: 198000, output: 64000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchModels(3000);

      expect(result).toContainEqual(
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          contextWindow: 200000,
          inputLimit: 198000,
          outputLimit: 64000,
        }),
      );
    });

    it('returns empty array when providers fetch fails', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await fetchModels(3000);

      expect(result).toEqual([]);
    });
  });

  describe('getProviderById', () => {
    it('returns provider from cache', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Populate cache
      await fetchProviders(3000);

      const provider = getProviderById('anthropic');
      expect(provider).toEqual(
        expect.objectContaining({ id: 'anthropic', name: 'Anthropic' }),
      );
    });

    it('returns null for unknown provider', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchProviders(3000);

      const provider = getProviderById('unknown');
      expect(provider).toBeNull();
    });

    it('returns null when cache is empty', () => {
      const provider = getProviderById('anthropic');
      expect(provider).toBeNull();
    });
  });

  describe('getModelById', () => {
    it('returns model from cache with provider info', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchProviders(3000);

      const model = getModelById('claude-sonnet-4-20250514');
      expect(model).toEqual(
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          name: 'Claude Sonnet 4',
          providerId: 'anthropic',
          providerName: 'Anthropic',
          contextWindow: 200000,
        }),
      );
    });

    it('returns null for unknown model', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchProviders(3000);

      const model = getModelById('unknown-model');
      expect(model).toBeNull();
    });
  });

  describe('clearProviderCache', () => {
    it('clears the cached providers', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchProviders(3000);
      expect(getCachedProviders()).not.toBeNull();

      clearProviderCache();
      expect(getCachedProviders()).toBeNull();
    });
  });

  describe('variant extraction', () => {
    it('extracts variant keys from model', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { thinking: { type: 'enabled', budgetTokens: 5000 } },
                medium: { thinking: { type: 'enabled', budgetTokens: 10000 } },
                high: { thinking: { type: 'enabled', budgetTokens: 20000 } },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.reasoning).toBe(true);
      expect(model?.variants).toEqual(['low', 'medium', 'high']);
    });

    it('normalizes max variant key to xhigh', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { reasoningEffort: 'low' },
                medium: { reasoningEffort: 'medium' },
                high: { reasoningEffort: 'high' },
                max: { reasoningEffort: 'max' },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.variants).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('returns undefined variants when model has no variants', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000 },
              capabilities: { reasoning: false },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.reasoning).toBe(false);
      expect(model?.variants).toBeUndefined();
    });
  });

  describe('default variant inference', () => {
    it('infers "medium" as default for GPT-5 models', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { reasoningEffort: 'low' },
                medium: { reasoningEffort: 'medium' },
                high: { reasoningEffort: 'high' },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('medium');
    });

    it('infers "high" as default for Claude models', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4': {
              id: 'claude-sonnet-4',
              name: 'Claude Sonnet 4',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { thinking: { type: 'enabled', budgetTokens: 5000 } },
                medium: { thinking: { type: 'enabled', budgetTokens: 10000 } },
                high: { thinking: { type: 'enabled', budgetTokens: 20000 } },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('high');
    });

    it('infers "high" as default for Gemini-3 models', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'google',
          name: 'Google',
          models: {
            'gemini-3-pro': {
              id: 'gemini-3-pro',
              name: 'Gemini 3 Pro',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { thinkingLevel: 'low' },
                high: { thinkingLevel: 'high' },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('high');
    });

    it('returns undefined when model has no variants', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000 },
              capabilities: { reasoning: false },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBeUndefined();
    });

    it('falls back to "medium" when available for unknown model patterns', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'custom',
          name: 'Custom Provider',
          models: {
            'custom-reasoning-model': {
              id: 'custom-reasoning-model',
              name: 'Custom Reasoning Model',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                low: { effort: 'low' },
                medium: { effort: 'medium' },
                high: { effort: 'high' },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('medium');
    });

    it('falls back to first variant when no common pattern matches', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'custom',
          name: 'Custom Provider',
          models: {
            'custom-model': {
              id: 'custom-model',
              name: 'Custom Model',
              limit: { context: 200000 },
              capabilities: { reasoning: true },
              variants: {
                minimal: { effort: 'minimal' },
                extended: { effort: 'extended' },
              },
            },
          },
        },
      ]);

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('minimal');
    });
  });

  // ─── Provider Auth Tests ─────────────────────────────────────────────────────

  describe('fetchProviderAuthMethods', () => {
    it('returns auth methods from the OpenCode API', async () => {
      const mockAuthMethods: Record<string, AuthMethod[]> = {
        anthropic: [
          { type: 'api', label: 'API Key' },
          {
            type: 'oauth',
            label: 'Sign in with Anthropic',
            prompts: [
              {
                type: 'text',
                key: 'workspace',
                message: 'Enter your workspace ID',
                placeholder: 'ws-123',
              },
            ],
          },
        ],
        openai: [{ type: 'api', label: 'API Key' }],
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockAuthMethods,
      } as Response);

      const result = await fetchProviderAuthMethods(3000);

      expect(result).toEqual(mockAuthMethods);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/provider/auth',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns null when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await fetchProviderAuthMethods(3000);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await fetchProviderAuthMethods(3000);

      expect(result).toBeNull();
    });
  });

  describe('authorizeProvider', () => {
    it('returns authorization result with URL and method', async () => {
      const mockAuthResult: AuthorizeResult = {
        url: 'https://accounts.anthropic.com/oauth/authorize?client_id=xxx',
        method: 'auto',
        instructions: 'You will be redirected to Anthropic to sign in.',
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockAuthResult,
      } as Response);

      const result = await authorizeProvider(3000, 'anthropic', 0, {
        workspace: 'ws-123',
      });

      expect(result).toEqual(mockAuthResult);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/provider/anthropic/oauth/authorize',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 0, inputs: { workspace: 'ws-123' } }),
        }),
      );
    });

    it('returns null when authorize returns undefined', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => undefined,
      } as Response);

      const result = await authorizeProvider(3000, 'anthropic', 0);

      expect(result).toBeNull();
    });

    it('returns null when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const result = await authorizeProvider(3000, 'anthropic', 0);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await authorizeProvider(3000, 'anthropic', 0);

      expect(result).toBeNull();
    });
  });

  describe('callbackProvider', () => {
    it('returns true when callback succeeds', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => true,
      } as Response);

      const result = await callbackProvider(3000, 'anthropic', 0);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/provider/anthropic/oauth/callback',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 0, code: undefined }),
        }),
      );
    });

    it('returns true when callback succeeds with code', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => true,
      } as Response);

      const result = await callbackProvider(
        3000,
        'anthropic',
        1,
        'oauth-code-123',
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/provider/anthropic/oauth/callback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ method: 1, code: 'oauth-code-123' }),
        }),
      );
    });

    it('returns false when callback returns false', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => false,
      } as Response);

      const result = await callbackProvider(3000, 'anthropic', 0);

      expect(result).toBe(false);
    });

    it('returns false when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const result = await callbackProvider(3000, 'anthropic', 0);

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await callbackProvider(3000, 'anthropic', 0);

      expect(result).toBe(false);
    });
  });

  describe('setProviderApiKey', () => {
    it('returns true when API key is set successfully', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => true,
      } as Response);

      const result = await setProviderApiKey(
        3000,
        'anthropic',
        'sk-ant-api-key',
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/auth/set',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerID: 'anthropic',
            auth: { type: 'api', key: 'sk-ant-api-key' },
          }),
        }),
      );
    });

    it('returns false when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const result = await setProviderApiKey(
        3000,
        'anthropic',
        'sk-ant-api-key',
      );

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await setProviderApiKey(
        3000,
        'anthropic',
        'sk-ant-api-key',
      );

      expect(result).toBe(false);
    });
  });
});
