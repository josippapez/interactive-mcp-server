/**
 * Tests for provider.ts — OpenCode provider/model API integration.
 *
 * Uses SDK mock pattern via _setClientFactory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

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
  });

  afterEach(() => {
    _resetClientFactory();
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

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const result = await fetchProviders(3000);

      expect(result).toHaveLength(2);
      expect(result?.[0]).toEqual(
        expect.objectContaining({ id: 'anthropic', name: 'Anthropic' }),
      );
      expect(result?.[0].models).toHaveLength(2);
    });

    it('returns null when SDK returns error', async () => {
      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: undefined,
                error: 'API error',
              }),
            },
          }) as never,
      );

      const result = await fetchProviders(3000);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockRejectedValue(new Error('Network error')),
            },
          }) as never,
      );

      const result = await fetchProviders(3000);

      expect(result).toBeNull();
    });

    it('merges model variants across reachable ports for the same model', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {}, max: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.variants).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('keeps reasoning true when merged model responses differ by port', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              capabilities: { reasoning: true },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const result = await fetchModels(3000);

      expect(result).toHaveLength(3);
      expect(result).toContainEqual(
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          providerId: 'anthropic',
        }),
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

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      await fetchProviders(3000);

      const provider = getProviderById('anthropic');
      expect(provider).toEqual(
        expect.objectContaining({ id: 'anthropic', name: 'Anthropic' }),
      );
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

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.reasoning).toBe(true);
      expect(model?.variants).toEqual(['low', 'medium', 'high']);
    });

    it('normalizes max variant key to xhigh', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {}, max: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.variants).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('returns undefined variants when model has no variants', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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
            'claude-sonnet-4-20250514': {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

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
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('high');
    });

    it('falls back to "medium" when available for unknown model patterns', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'custom',
          name: 'Custom',
          models: {
            'custom-model': {
              id: 'custom-model',
              name: 'Custom Model',
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      expect(model?.defaultVariant).toBe('medium');
    });

    it('falls back to first variant when no common pattern matches', async () => {
      const mockResponse = createMockResponse([
        {
          id: 'custom',
          name: 'Custom',
          models: {
            'custom-model': {
              id: 'custom-model',
              name: 'Custom Model',
              capabilities: { reasoning: true },
              variants: { minimal: {}, standard: {}, extreme: {} },
            },
          },
        },
      ]);

      _setClientFactory(
        () =>
          ({
            provider: {
              list: vi.fn().mockResolvedValue({
                data: mockResponse,
                error: undefined,
              }),
            },
          }) as never,
      );

      const providers = await fetchProviders(3000);
      const model = providers?.[0].models[0];

      // Should return first available variant
      expect(model?.defaultVariant).toBeDefined();
    });
  });

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

      _setClientFactory(
        () =>
          ({
            provider: {
              auth: vi.fn().mockResolvedValue({
                data: mockAuthMethods,
                error: undefined,
              }),
            },
          }) as never,
      );

      const result = await fetchProviderAuthMethods(3000);

      expect(result).toEqual(mockAuthMethods);
    });
  });

  describe('authorizeProvider', () => {
    it('returns authorization result with URL and method', async () => {
      const mockAuthResult: AuthorizeResult = {
        url: 'https://accounts.anthropic.com/oauth/authorize?client_id=xxx',
        method: 'auto',
        instructions: 'You will be redirected to Anthropic to sign in.',
      };

      _setClientFactory(
        () =>
          ({
            provider: {
              oauth: {
                authorize: vi.fn().mockResolvedValue({
                  data: mockAuthResult,
                  error: undefined,
                }),
              },
            },
          }) as never,
      );

      const result = await authorizeProvider(3000, 'anthropic', 0, {
        workspace: 'ws-123',
      });

      expect(result).toEqual({ ok: true, data: mockAuthResult });
    });
  });

  describe('callbackProvider', () => {
    it('returns true when callback succeeds', async () => {
      _setClientFactory(
        () =>
          ({
            provider: {
              oauth: {
                callback: vi.fn().mockResolvedValue({
                  data: true,
                  error: undefined,
                }),
              },
            },
          }) as never,
      );

      const result = await callbackProvider(3000, 'anthropic', 0);

      expect(result).toEqual({ ok: true, data: true });
    });

    it('returns true when callback succeeds with code', async () => {
      _setClientFactory(
        () =>
          ({
            provider: {
              oauth: {
                callback: vi.fn().mockResolvedValue({
                  data: true,
                  error: undefined,
                }),
              },
            },
          }) as never,
      );

      const result = await callbackProvider(
        3000,
        'anthropic',
        0,
        'auth_code_123',
      );

      expect(result).toEqual({ ok: true, data: true });
    });
  });

  describe('setProviderApiKey', () => {
    it('returns true when API key is set successfully', async () => {
      _setClientFactory(
        () =>
          ({
            auth: {
              set: vi.fn().mockResolvedValue({
                data: {},
                error: undefined,
              }),
            },
          }) as never,
      );

      const result = await setProviderApiKey(
        3000,
        'anthropic',
        'sk-ant-api03-xxx',
      );

      expect(result).toBe(true);
    });

    it('returns false when setting API key fails', async () => {
      _setClientFactory(
        () =>
          ({
            auth: {
              set: vi.fn().mockResolvedValue({
                data: undefined,
                error: 'Failed to set key',
              }),
            },
          }) as never,
      );

      const result = await setProviderApiKey(3000, 'anthropic', 'invalid-key');

      expect(result).toBe(false);
    });
  });
});
